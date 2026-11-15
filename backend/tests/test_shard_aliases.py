"""Guards G3 and G7 (docs/ARCHITECTURE-tenant-sharding.md 4.1) on the real shard aliases (stage 2).

Until stage 2 these ran on a test-only second alias behind a test-only router (`config/multidb.py`,
`ShadowTenantRouter`, `reconcile_tenant_shadow`). Those are gone: the four civilization shards of
`config.settings_sharded` sit behind the production `config.sharding.ShardRouter`, and `reconcile_shards`
is the reconcile tool. What carried over, on real rows in real databases:

  G3  migrate ran on every shard (same schema on all four, each its own database); a key between two
      SHARD rows in different databases is refused, a bare id to a CONTROL row is not.
  G7  is tests/test_shard_sync.py (reconcile passes on synced data, names model + pk on a difference,
      a missing and an extra row) -- the shadow's own G7 tests went with its command.
  1B  deleting a non-authoritative copy applies no bare-id rule; check_bare_ids counts a SHARD target on
      any of its homes and a CONTROL one only on control.

Dropped, because they only made sense for a full-schema shadow behind its own router:
  * "data migrations ran on the shadow too" -- a shard has no CONTROL table to seed, and our apps' seeds
    skip a shard (`placed_here`); tests/test_control_boundary.py holds that a migrated shard is empty.
  * "a tenant-scoped write lands on the routed alias" -- in stage 2 ShardRouter routes no write (the sync
    copies them); tests/test_shard_router_is_neutral.py holds that, stage 4 changes it.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded --no-cov tests/test_shard_aliases.py
"""
import uuid

import pytest
from django.apps import apps
from django.db import connections

from apps.core.sharding import CONTROL, civilization_aliases, placement
from tests.tenancy_fk_inventory import EDGES

GREEK, CHINESE = "civ_greek", "civ_chinese"

pytestmark = [
    pytest.mark.sharded,  # skips unless the four shards exist (root conftest.py)
    pytest.mark.django_db(databases="__all__"),
]


def _tables(alias):
    with connections[alias].cursor() as cursor:
        return set(connections[alias].introspection.table_names(cursor))


@pytest.fixture
def halls():
    """A Greek and a Chinese hall in control, each copied to its shard (D4) with bulk_create (no signals)."""
    from apps.tenants.models import Tenant

    out = []
    for code, civ, alias in (("GR_SA", "GREEK", GREEK), ("CN_SA", "CHINESE", CHINESE)):
        hall = Tenant.objects.create(code=code, display_name=code, declared_civilization=civ)
        Tenant._base_manager.using(alias).bulk_create(
            [Tenant(**{f.attname: getattr(hall, f.attname) for f in Tenant._meta.concrete_fields})])
        out.append(hall)
    return out


def _realm(hall, code, alias, **kw):
    from apps.realms.models import Realm

    realm = Realm(realm_code=code, name_en=code, name_local=code, civilization="GREEK", realm_type="HELL",
                  tenant_id=hall.pk, **kw)
    realm.save(using=alias)
    return realm


# --- G3 -------------------------------------------------------------------

def test_migrate_ran_on_every_shard_and_each_is_its_own_database():
    shards = civilization_aliases()
    tables = {a: _tables(a) - {"django_migrations"} for a in shards}
    expected = {m._meta.db_table for m in apps.get_models(include_auto_created=True) if placement(m) != CONTROL}
    wrong = {a: (sorted(expected - t)[:5], sorted(t - expected)[:5]) for a, t in tables.items() if t != expected}
    assert not wrong, f"shard schema is not SHARD + REFERENCE (missing, extra): {wrong}"
    # Each its own database (on SQLite every shard is ":memory:" by NAME): a row written on one shows on no other.
    from apps.tenants.models import Tenant

    Tenant._base_manager.using(GREEK).bulk_create([Tenant(code="ONLY_GR", display_name="g")])
    assert [a for a in ["default", *shards] if Tenant._base_manager.using(a).filter(code="ONLY_GR").exists()] == [GREEK]


def test_a_shard_key_across_databases_is_refused_and_a_bare_id_to_control_is_not(halls):
    from apps.authentication.models import User
    from apps.realms.models import Realm

    # The edge to try comes from the G1 inventory, so a renamed field fails here too.
    edge = "realms.Realm.parent_realm->realms.Realm"
    assert EDGES[edge][:2] == ("S->S", "DB")
    greek, chinese = halls
    child = _realm(greek, "RC", GREEK)
    for other in (_realm(chinese, "RP", CHINESE), _realm(chinese, "RD", "default")):
        with pytest.raises(ValueError, match="different database|router prevents"):
            child.parent_realm = other
    sibling = _realm(greek, "RS", GREEK)  # same shard: allowed
    child.parent_realm = sibling
    child.create_user = User.objects.create_user(username="sa-officer", password="x", role="JUDGE")  # control
    child.save(using=GREEK)
    again = Realm._base_manager.using(GREEK).get(pk=child.pk)
    assert (again.parent_realm_id, again.create_user_id) == (sibling.pk, child.create_user_id)
    assert not Realm._base_manager.using("default").filter(pk=child.pk).exists()


# --- bare ids across databases (stage 1B, apps/core/bare_ids.py) ------------------

def _soul_with_account(hall, name):
    """A soul on control and the control account naming it by a bare id."""
    from apps.authentication.models import User
    from apps.soul_accounts.models import AccountOrigin, SoulAccount
    from apps.souls.models import Soul

    soul = Soul.objects.create(name=name, tenant=hall)
    user = User.objects.create_user(username=name, password="x", role="SOUL", tenant=hall)
    return soul, SoulAccount.objects.create(user=user, soul=soul, cycle=0, origin=AccountOrigin.OFFICER)


def _copy_to(alias, soul):
    from apps.souls.models import Soul

    row = Soul._base_manager.using("default").get(pk=soul.pk)
    row.owner_org_id = None  # the hall's root unit is on control only here
    Soul._base_manager.using(alias).bulk_create([row])


def test_deleting_a_shard_copy_of_a_soul_leaves_the_control_account_and_the_primary_does_not(halls):
    """A bare id's rule runs where the deleted row is authoritative (bare_ids.primary_alias: control until
    a civilization's writes are cut over). Deleting the shard copy, as a reconcile fix would, must not
    reach the control database."""
    from apps.soul_accounts.models import SoulAccount
    from apps.souls.models import Soul

    greek, _ = halls
    soul, account = _soul_with_account(greek, "copy-soul")
    _copy_to(GREEK, soul)

    Soul._base_manager.using(GREEK).filter(pk=soul.pk).delete()
    assert not Soul._base_manager.using(GREEK).filter(pk=soul.pk).exists()
    assert SoulAccount.objects.filter(pk=account.pk).exists()
    assert Soul._base_manager.using("default").filter(pk=soul.pk).exists()

    Soul._base_manager.using("default").get(pk=soul.pk).purge()  # the primary: its CASCADE applies
    assert not SoulAccount.objects.filter(pk=account.pk).exists()


def test_check_bare_ids_counts_a_shard_target_on_any_home_and_a_control_target_only_on_control(halls):
    """A SHARD target (Soul) counts on every alias it is migrated on: once a civilization is cut over its
    souls live in the shard, and a bare id naming one is not an orphan. A CONTROL target (User) has one
    home, control: a shard row naming a user control does not have is an orphan, on that shard."""
    from apps.core.bare_ids import orphans
    from apps.soul_accounts.models import SoulAccount
    from apps.souls.models import Soul

    greek, _ = halls
    soul, account = _soul_with_account(greek, "shard-soul")
    aliases = ["default", *civilization_aliases()]
    assert orphans(aliases) == []

    # The account now names a soul that exists only on the shard, as it would a cut-over shard's soul.
    elsewhere = Soul._base_manager.using("default").get(pk=soul.pk)
    elsewhere.pk, elsewhere.owner_org_id = uuid.uuid4(), None
    Soul._base_manager.using(GREEK).bulk_create([elsewhere])
    SoulAccount.objects.filter(pk=account.pk).update(soul_id=elsewhere.pk)
    assert orphans(aliases) == []

    realm = _realm(greek, "RG", GREEK)
    type(realm)._base_manager.using(GREEK).filter(pk=realm.pk).update(create_user_id=9_000_000)
    assert orphans(aliases) == [("realms.Realm.create_user", GREEK, 1)]
