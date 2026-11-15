"""Stage 1B exit, on a real shard database (plan docs/audit/2026-11-15-sharding/PLAN.md, 阶段 1B).

A civilization shard is migrated from the same migrations as the control database, through
`ShardRouter.allow_migrate` and the shard engine (`config/shard_db/`). What it must end up as:

  * every SHARD and REFERENCE table, and no CONTROL table (authentication_*, perm_*, menus_*,
    the soul's login identity...) -- by placement, plus the names the plan spells out;
  * no foreign key to a table that is not there; no row (seeds run on control only);
  * a shard row keeps a control user's id, and `row.create_user` resolves it from control;
  * a JOIN to a control table fails loudly. That is the D3 limitation, recorded: a bare id cannot be
    `select_related` from a shard, and the error is the guard against a query that silently reads
    across databases.

PostgreSQL only, under the multidb settings (the alias `civ_greek` exists only there):

    cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true \
      REDIS_URL=redis://127.0.0.1:6399/0 .venv/bin/python -m pytest --ds=config.settings_multidb \
      -m multidb --no-cov --create-db tests/test_control_boundary.py

Mutation to prove it red (on real PG): `ShardRouter.allow_migrate` answering True for CONTROL on a shard
-> the table tests list the control tables and the JOIN test does not raise.
"""
import pytest
from django.apps import apps
from django.conf import settings
from django.db import ProgrammingError, connection, connections, transaction

from apps.core.sharding import CONTROL, placement

SQLITE = connection.vendor == "sqlite"
SHARD = "civ_greek"
HAVE_SHARD = SHARD in settings.DATABASES

pytestmark = [
    pytest.mark.multidb,
    pytest.mark.skipif(SQLITE, reason="a shard database is PostgreSQL only (config/settings_multidb.py)"),
    pytest.mark.skipif(not HAVE_SHARD, reason="needs --ds=config.settings_multidb on PostgreSQL"),
    pytest.mark.django_db(databases=["default", SHARD] if HAVE_SHARD else ["default"]),
]

#: Named by the plan; the placement-derived test below covers the rest.
CONTROL_PREFIXES = ("authentication_", "perm_", "menus_")


def _tables(alias):
    with connections[alias].cursor() as cursor:
        return set(connections[alias].introspection.table_names(cursor))


def test_the_shard_has_no_control_table_and_control_has_them():
    on_shard, on_control = _tables(SHARD), _tables("default")
    named = sorted(t for t in on_shard if t.startswith(CONTROL_PREFIXES))
    assert not named, f"control tables on {SHARD}: {named}"
    assert {"authentication_user", "perm_role", "menus_menu"} <= on_control  # the check can see them
    assert {"souls_soul", "tenants_tenant", "realms_realm", "judgment_citygod_officers"} <= on_shard


def test_the_shard_holds_exactly_the_shard_and_reference_tables():
    on_shard = _tables(SHARD) - {"django_migrations"}
    expected = {m._meta.db_table for m in apps.get_models(include_auto_created=True) if placement(m) != CONTROL}
    missing, extra = sorted(expected - on_shard), sorted(on_shard - expected)
    assert not (missing or extra), f"{SHARD}: missing {missing}; not SHARD / REFERENCE {extra}"


def test_no_foreign_key_on_the_shard_points_at_a_missing_table():
    conn = connections[SHARD]
    tables = _tables(SHARD)
    dangling, count = [], 0
    with conn.cursor() as cursor:
        for table in sorted(tables):
            for name, c in conn.introspection.get_constraints(cursor, table).items():
                if c.get("foreign_key"):
                    count += 1
                    if c["foreign_key"][0] not in tables:
                        dangling.append(f"{table}.{name} -> {c['foreign_key'][0]}")
    assert count > 50, f"only {count} foreign keys on {SHARD}: introspection is not seeing them"
    assert not dangling, dangling


def test_migrate_left_the_shard_empty():
    """Seeds and backfills run on control only (`placed_here`); a shard is filled by the stage-2 sync."""
    full = []
    for m in apps.get_models(include_auto_created=True):
        if placement(m) != CONTROL and m._base_manager.using(SHARD).exists():
            full.append(m._meta.label)
    assert not full, f"rows on a freshly migrated {SHARD}: {full}"


@pytest.fixture
def shard_hall():
    """A hall in control and its copy on the shard (D4); bulk_create so no signal writes elsewhere."""
    from apps.tenants.models import Tenant

    hall = Tenant.objects.get_or_create(code="GR_HADES", defaults={"display_name": "Hades"})[0]
    copy = Tenant(**{f.attname: getattr(hall, f.attname) for f in Tenant._meta.concrete_fields})
    Tenant._base_manager.using(SHARD).bulk_create([copy])
    return Tenant._base_manager.using(SHARD).get(pk=hall.pk)


def _realm(hall, user):
    from apps.realms.models import Realm

    realm = Realm(realm_code="B1", name_en="b", name_local="b", civilization="GREEK", realm_type="HELL")
    realm.tenant = hall          # from the shard: the row now belongs to the shard
    realm.create_user = user     # from control: a bare id, allowed across databases
    realm.save()
    return realm


def test_a_shard_row_keeps_a_control_users_id_and_resolves_it(shard_hall):
    from apps.authentication.models import User
    from apps.realms.models import Realm

    user = User.objects.create_user(username="cb-officer", password="x", role="JUDGE")
    realm = _realm(shard_hall, user)
    assert realm._state.db == SHARD
    assert not Realm._base_manager.using("default").filter(pk=realm.pk).exists()
    again = Realm._base_manager.using(SHARD).get(pk=realm.pk)
    assert again.create_user_id == user.pk
    assert again.create_user == user and again.create_user._state.db == "default"


def test_a_join_to_a_control_table_fails_loudly_on_the_shard(shard_hall):
    """D3, recorded: `select_related` of a bare id needs both tables in one database."""
    from apps.authentication.models import User
    from apps.realms.models import Realm

    _realm(shard_hall, User.objects.create_user(username="cb-join", password="x", role="JUDGE"))
    with pytest.raises(ProgrammingError, match="authentication_user"), transaction.atomic(using=SHARD):
        list(Realm._base_manager.using(SHARD).select_related("create_user"))
