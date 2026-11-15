"""Guards G3 and G7 (docs/ARCHITECTURE-tenant-sharding.md 4.1), single-database form.

G3: with a second alias and a router, migrate runs on both, a tenant-scoped write
lands on the routed alias, and an FK between rows of different aliases is refused.
G7: `reconcile_tenant_shadow` passes on equal data and names model + pk on a
difference.

Opt-in. The alias only exists under the multidb settings, so this file skips in
every normal run:

    cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true \
      DATABASE_URL=sqlite:///:memory: REDIS_URL=redis://127.0.0.1:6399/0 \
      .venv/bin/python -m pytest --ds=config.settings_multidb -m multidb --no-cov \
      tests/test_multidb_shadow.py
"""
import io

import pytest
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connections

from config.multidb import SHADOW_ALIAS, SHADOW_TENANTS
from tests.tenancy_fk_inventory import EDGES

pytestmark = [
    pytest.mark.multidb,
    pytest.mark.skipif(SHADOW_ALIAS not in settings.DATABASES, reason="needs --ds=config.settings_multidb"),
    pytest.mark.django_db(databases=["default", SHADOW_ALIAS]),
]


@pytest.fixture
def halls():
    """Two tenants; B's rows are routed to the shadow alias (and B exists there too)."""
    from apps.scheduler.models import ScheduledJob
    from apps.tenants.models import Tenant

    a = Tenant.objects.create(code="MA", display_name="A")
    b = Tenant.objects.create(code="MB", display_name="B")
    Tenant(pk=b.pk, code=b.code, display_name=b.display_name).save(using=SHADOW_ALIAS, force_insert=True)
    # Creating a tenant seeds its ScheduledJob rows in `default` (reconcile flagged them first).
    # They point at django-celery-beat rows that exist only in `default`; not part of this test.
    ScheduledJob.objects.filter(tenant=b).delete()
    SHADOW_TENANTS.add(b.pk)
    yield a, b
    SHADOW_TENANTS.clear()


def _realm(tenant, code, **kw):
    from apps.realms.models import Realm

    return Realm(realm_code=code, name_en=code, name_local=code, civilization="CHINESE",
                 realm_type="HELL", tenant=tenant, **kw)


def test_migrate_ran_on_both_aliases():
    names = {a: set(connections[a].introspection.table_names()) for a in ("default", SHADOW_ALIAS)}
    assert names["default"] == names[SHADOW_ALIAS] and "realms_realm" in names["default"]
    assert connections["default"].settings_dict["NAME"] != connections[SHADOW_ALIAS].settings_dict["NAME"]


def test_data_migrations_ran_on_the_shadow_too():
    """RunPython seeds (menus, roles, permissions) must exist on the shadow: they run against
    `schema_editor.connection.alias`, not against whatever the router answers."""
    from apps.menus.models import Menu
    from apps.perm.models import Permission, Role

    for model in (Menu, Role, Permission):
        on_default = model.all_objects.using("default").count()
        assert on_default > 0, model
        assert model.all_objects.using(SHADOW_ALIAS).count() == on_default, model


def test_a_tenant_scoped_write_lands_on_the_routed_alias(halls):
    from apps.realms.models import Realm

    a, b = halls
    _realm(a, "RA").save()
    _realm(b, "RB").save()
    assert list(Realm.objects.using("default").values_list("realm_code", flat=True)) == ["RA"]
    assert list(Realm.objects.using(SHADOW_ALIAS).values_list("realm_code", flat=True)) == ["RB"]


def test_a_foreign_key_across_aliases_is_refused(halls):
    from apps.realms.models import Realm

    # The edge to try comes from the G1 inventory, so a renamed field fails here too.
    edge = "realms.Realm.parent_realm->realms.Realm"
    assert EDGES[edge][0] == "S->S"
    a, b = halls
    parent = _realm(a, "RP")
    parent.save()
    child = _realm(b, "RC")
    child.save()
    assert child._state.db == SHADOW_ALIAS and parent._state.db == "default"
    with pytest.raises(ValueError, match="different database|router prevents"):
        child.parent_realm = parent
    # Same alias is fine.
    sibling = _realm(b, "RS")
    sibling.save()
    child.parent_realm = sibling
    child.save()
    assert Realm.objects.using(SHADOW_ALIAS).get(pk=child.pk).parent_realm_id == sibling.pk


# --- G7 -------------------------------------------------------------------

def _reconcile():
    out = io.StringIO()
    try:
        call_command("reconcile_tenant_shadow", tenant="MB", alias=SHADOW_ALIAS, stdout=out)
    except CommandError as e:
        return str(e), out.getvalue()
    return None, out.getvalue()


def _two_equal_rows(b):
    """Two realms in `default`, then a dual-write: every row of tenant B copied to the
    shadow with its stamps intact (bulk_create + queryset.update skip auto_now)."""
    from apps.tenants.management.commands.reconcile_tenant_shadow import STAMPS, tenant_scoped_models

    for code in ("R1", "R2"):
        _realm(b, code).save(using="default")  # explicit: the router would send tenant B to the shadow
    for model in tenant_scoped_models():
        rows = list(model._base_manager.using("default").filter(tenant_id=b.pk))
        stamps = {(r.pk, n): getattr(r, n) for r in rows for n in STAMPS if hasattr(r, n)}  # bulk_create rewrites auto_now
        model._base_manager.using(SHADOW_ALIAS).bulk_create(rows)
        for (pk, n), v in stamps.items():
            model._base_manager.using(SHADOW_ALIAS).filter(pk=pk).update(**{n: v})


def test_equal_data_reconciles(halls):
    _, b = halls
    _two_equal_rows(b)
    err, out = _reconcile()
    assert err is None, out
    assert "ok  realms.Realm" in out


def test_one_changed_row_fails_and_names_model_and_pk(halls):
    from apps.realms.models import Realm

    _, b = halls
    _two_equal_rows(b)
    victim = Realm.objects.using(SHADOW_ALIAS).get(realm_code="R2")
    Realm.objects.using(SHADOW_ALIAS).filter(pk=victim.pk).update(update_time=victim.update_time.replace(year=2001))
    err, out = _reconcile()
    assert err and "1 model(s) differ" in err
    assert f"realms.Realm pk={victim.pk} differs" in out
    assert "pk=" + str(Realm.objects.using(SHADOW_ALIAS).get(realm_code="R1").pk) not in out


def test_a_missing_and_an_extra_row_fail(halls):
    from apps.realms.models import Realm

    _, b = halls
    _two_equal_rows(b)
    gone = Realm.objects.using(SHADOW_ALIAS).get(realm_code="R1")
    Realm.objects.using(SHADOW_ALIAS).filter(pk=gone.pk).delete()
    extra = _realm(b, "R3")
    extra.save()  # routed to the shadow only
    err, out = _reconcile()
    assert err
    assert f"realms.Realm pk={gone.pk} missing in {SHADOW_ALIAS}" in out
    assert f"realms.Realm pk={extra.pk} only in {SHADOW_ALIAS}" in out


def test_unknown_tenant_or_alias_is_an_error(halls):
    with pytest.raises(CommandError, match="no tenant"):
        call_command("reconcile_tenant_shadow", tenant="NOPE", alias=SHADOW_ALIAS)
    with pytest.raises(CommandError, match="no database alias"):
        call_command("reconcile_tenant_shadow", tenant="MB", alias="nowhere")


# --- bare ids across two databases (stage 1B, apps/core/bare_ids.py) ------------

def _soul_with_account(hall, user_hall, name):
    """A soul on default and the control account naming it by a bare id."""
    from apps.authentication.models import User
    from apps.soul_accounts.models import AccountOrigin, SoulAccount
    from apps.souls.models import Soul

    soul = Soul(name=name, tenant=hall)
    soul.save(using="default")  # explicit: the router would send tenant B to the shadow
    user = User.objects.db_manager("default").create_user(username=name, password="x", role="SOUL", tenant=user_hall)
    account = SoulAccount.objects.using("default").create(user=user, soul=soul, cycle=0, origin=AccountOrigin.OFFICER)
    return soul, account


def test_deleting_a_shadow_copy_of_a_soul_leaves_the_control_account_and_the_primary_does_not(halls):
    """A bare id's rule runs where the deleted row is authoritative (bare_ids.primary_alias: default
    until a civilization's writes are cut over). Deleting the shadow copy, as a dual-write repair or a
    reconcile would, must not reach the control database."""
    from apps.soul_accounts.models import SoulAccount
    from apps.souls.models import Soul

    a, b = halls
    soul, account = _soul_with_account(b, a, "copy-soul")
    Soul._base_manager.using(SHADOW_ALIAS).bulk_create([Soul._base_manager.using("default").get(pk=soul.pk)])

    Soul._base_manager.using(SHADOW_ALIAS).filter(pk=soul.pk).delete()
    assert not Soul._base_manager.using(SHADOW_ALIAS).filter(pk=soul.pk).exists()
    assert SoulAccount.objects.using("default").filter(pk=account.pk).exists()
    assert Soul._base_manager.using("default").filter(pk=soul.pk).exists()

    Soul._base_manager.using("default").get(pk=soul.pk).purge()  # the primary: its CASCADE applies
    assert not SoulAccount.objects.using("default").filter(pk=account.pk).exists()


def test_check_bare_ids_finds_a_shard_target_on_any_home_and_a_control_target_only_on_default(halls):
    """A SHARD target (Soul) counts on every alias it is migrated on: once a civilization is cut over
    its souls live in the shard, and a bare id naming one is not an orphan. A CONTROL target (User)
    counts only on default: a stray copy elsewhere does not make a dangling id real."""
    import uuid

    from apps.authentication.models import User
    from apps.core.bare_ids import orphans
    from apps.soul_accounts.models import SoulAccount
    from apps.souls.models import Soul

    a, b = halls
    soul, account = _soul_with_account(b, a, "shadow-soul")
    aliases = ["default", SHADOW_ALIAS]
    assert orphans(aliases) == []

    # The account now names a soul that exists only on the shadow, as it would a cut-over shard's soul.
    elsewhere = Soul._base_manager.using("default").get(pk=soul.pk)
    elsewhere.pk, elsewhere.owner_org_id = uuid.uuid4(), None  # its hall's root org is on default only
    Soul._base_manager.using(SHADOW_ALIAS).bulk_create([elsewhere])
    SoulAccount.objects.using("default").filter(pk=account.pk).update(soul_id=elsewhere.pk)
    assert orphans(aliases) == []

    ghost = User(pk=9_000_000, username="ghost", role="JUDGE")
    ghost.save(using=SHADOW_ALIAS)  # a user that exists only on the shadow (a pk default has no row for)
    realm = _realm(a, "RG")
    realm.save(using="default")
    type(realm)._base_manager.using("default").filter(pk=realm.pk).update(create_user_id=ghost.pk)
    assert orphans(aliases) == [("realms.Realm.create_user", "default", 1)]
