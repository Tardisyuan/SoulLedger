"""Death is the first path station (maintainer decision, 2026-09-25).

The ALIVE -> JUDGING edge in `Soul.transition_to` puts the soul in its
civilization's entry realm, inside the same transaction as the state change.
"""
import io
from unittest import mock

import pytest
from django.core.management import call_command

from apps.realms.models import Realm, SoulPathEntry
from apps.realms.path import ENTRY_REALM_CODES
from apps.souls.models import Civilization, Soul, SoulState
from tests import sentence_plan_support as plan

TENANTS = {
    "CN_DIYU": "DY_00_PURGATORY",
    "EG_DUAT": "EG_DUAT_ENTRY",
    "GR_HADES": "GR_ACHERON",
    "EU_HEAVEN_HELL": "EU_ACHERON",
}


@pytest.fixture
def seeded(db):
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)


def _path(soul):
    return list(SoulPathEntry.all_objects.filter(soul=soul).order_by("sequence"))


@pytest.mark.django_db
def test_every_entry_realm_code_exists_in_the_seed_under_its_civilization(seeded):
    assert set(ENTRY_REALM_CODES) == {c.value for c in Civilization}
    for civ, code in ENTRY_REALM_CODES.items():
        realm = Realm.all_objects.get(realm_code=code, is_deleted=False)
        assert realm.civilization == civ, code


@pytest.mark.django_db
@pytest.mark.parametrize(("tenant_code", "realm_code"), sorted(TENANTS.items()))
def test_death_puts_the_soul_at_its_civilizations_entry_realm(seeded, tenant_code, realm_code):
    tenant = plan.tenant(tenant_code)
    soul = Soul.objects.create(name=f"亡{tenant_code}", tenant=tenant, current_state=SoulState.ALIVE)
    assert soul.die() is not None
    [entry] = _path(soul)
    realm = Realm.all_objects.get(realm_code=realm_code, tenant=tenant)
    assert (entry.realm_id, entry.sequence, entry.left_at, entry.tenant_id) == (realm.pk, 1, None, tenant.pk)


@pytest.mark.django_db
def test_the_death_station_rolls_back_with_the_death(seeded):
    cn = plan.tenant("CN_DIYU")
    soul = Soul.objects.create(name="回滚", tenant=cn, current_state=SoulState.ALIVE)
    with (
        mock.patch("apps.judgment.models.Judgment.objects.create", side_effect=RuntimeError("boom")),
        pytest.raises(RuntimeError),
    ):
        soul.die()
    soul.refresh_from_db()
    assert soul.current_state == SoulState.ALIVE
    assert _path(soul) == []


@pytest.mark.django_db
def test_a_tenant_without_its_entry_realm_records_the_death_and_writes_no_path(db):
    cn = plan.tenant("CN_DIYU")  # not seeded: no 待审所 in this tenant
    soul = Soul.objects.create(name="无所", tenant=cn, current_state=SoulState.ALIVE)
    assert soul.die() is not None
    soul.refresh_from_db()
    assert soul.current_state == SoulState.JUDGING
    assert _path(soul) == []


@pytest.mark.django_db
def test_another_tenants_entry_realm_is_never_used(seeded):
    """The realm is looked up in the soul's own tenant, not by code alone."""
    cn = plan.tenant("CN_DIYU")
    other = plan.tenant("CN_OTHER")
    Realm.all_objects.filter(realm_code="DY_00_PURGATORY").update(tenant=other)
    soul = Soul.objects.create(name="只认本家", tenant=cn, current_state=SoulState.ALIVE)
    soul.die()
    assert _path(soul) == []


@pytest.mark.django_db
def test_only_the_death_edge_writes_the_station(seeded):
    cn = plan.tenant("CN_DIYU")
    soul = Soul.objects.create(name="已审", tenant=cn, current_state=SoulState.JUDGING)
    assert soul.transition_to(SoulState.DISPOSED, "verdict")
    assert _path(soul) == []
