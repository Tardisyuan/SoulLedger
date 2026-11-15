"""Stage 1B is schema only and reversible (plan docs/audit/2026-11-15-sharding/PLAN.md, 阶段 1B):
the `*_bare_ids_across_databases` migrations drop exactly the foreign-key constraints of the bare ids,
the reverse puts every one of them back, and forward again drops them again -- rows untouched.

Read from the database's own catalogue (`introspection.get_constraints`), not from the models: the
models say what the migrations should do, this says what they did. On SQLite here, on PostgreSQL in
`run-gates.sh --real-pg --full` (the migration round trips run there).
"""
from django.apps import apps
from django.db import connection, models

from apps.core.bare_ids import is_bare

STAGE = "bare_ids_across_databases"


def _stage_migrations():
    from django.db.migrations.loader import MigrationLoader

    loader = MigrationLoader(connection)
    mine = sorted(k for k in loader.disk_migrations if k[1].endswith(STAGE))
    before = []
    for app, name in mine:
        parents = [p for p in loader.graph.node_map[(app, name)].parents if p.key[0] == app]
        (parent,) = parents
        before.append(parent.key)
    return mine, before


def _bare_columns():
    """(table, column) of every bare id, auto-created M2M tables included (their M2M field says
    db_constraint=False for both of their keys)."""
    out = set()
    for m in apps.get_models(include_auto_created=True):
        for f in m._meta.concrete_fields:
            if isinstance(f, models.ForeignKey) and not f.db_constraint:
                assert is_bare(f) or m._meta.auto_created, f"{m._meta.label}.{f.name}"
                out.add((m._meta.db_table, f.column))
    return out


def _constrained():
    """(table, column) that carry a foreign-key constraint, as the database reports it."""
    out = set()
    with connection.cursor() as cursor:
        for table in connection.introspection.table_names(cursor):
            for c in connection.introspection.get_constraints(cursor, table).values():
                if c.get("foreign_key"):
                    out.update((table, col) for col in c["columns"])
    return out


def test_the_stage_drops_exactly_the_bare_constraints_and_its_reverse_restores_them(migration_round_trip):
    from apps.authentication.models import User
    from apps.realms.models import Realm
    from apps.tenants.models import Tenant
    from tests.migration_roundtrip import migrate_to, migrate_to_latest

    mine, before = _stage_migrations()
    assert len(mine) >= 20, mine
    bare = _bare_columns()
    assert ("realms_realm", "create_user_id") in bare and ("judgment_citygod_officers", "user_id") in bare
    kept = ("souls_soul", "tenant_id")  # a constraint 1B keeps (SHARD -> REFERENCE)

    hall = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})[0]
    user = User.objects.create_user(username="rt-bare", password="x", role="JUDGE", tenant=hall)
    realm = Realm.objects.create(realm_code="RTB", name_en="r", name_local="r", civilization="CHINESE",
                                 realm_type="HELL", tenant=hall, create_user=user)

    def stored():  # the column is the same on both sides of the stage
        return Realm._base_manager.filter(pk=realm.pk).values_list("create_user_id", flat=True).get()

    at_latest = _constrained()
    assert not (bare & at_latest), f"still constrained: {sorted(bare & at_latest)[:10]}"
    assert kept in at_latest

    migrate_to(before)
    reversed_ = _constrained()
    assert bare <= reversed_, f"the reverse did not restore: {sorted(bare - reversed_)[:10]}"
    assert reversed_ - bare == at_latest  # and touched no other constraint
    assert stored() == user.pk

    migrate_to_latest()
    again = _constrained()
    assert not (bare & again) and kept in again
    assert again == at_latest
    assert stored() == user.pk
