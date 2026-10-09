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
