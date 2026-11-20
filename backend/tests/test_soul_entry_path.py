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


@pytest.fixture(autouse=True)
def _diyu_has_a_city_god(db):
    """地府开案要有城隍收案(用户 2026-10-29):本殿先有一位兜底城隍。"""
    from tests.city_god_support import default_city_god

    default_city_god(plan.tenant("CN_DIYU"))


TENANTS = {
    "CN_DIYU": "DY_00_PURGATORY",
    "EG_DUAT": "EG_DUAT_ENTRY",
    "GR_HADES": "GR_ACHERON",
}


@pytest.fixture
def seeded(db):
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)


def _path(soul):
    return list(SoulPathEntry.all_objects.filter(soul=soul).order_by("sequence"))


@pytest.mark.django_db
def test_every_entry_realm_code_exists_in_the_seed_under_its_civilization(seeded):
    # 欧洲没有入口站(用户 2026-11-14):死时还不知道去向,渡口只在地狱路上。
    assert set(ENTRY_REALM_CODES) == {c.value for c in Civilization} - {Civilization.EUROPEAN}
    for civ, code in ENTRY_REALM_CODES.items():
        realm = Realm.all_objects.get(realm_code=code, is_deleted=False)
        assert realm.civilization == civ, code


@pytest.mark.django_db
@pytest.mark.parametrize(("tenant_code", "realm_code"), sorted(TENANTS.items()))
def test_death_puts_the_soul_at_its_civilizations_entry_realm(seeded, tenant_code, realm_code):
    tenant = plan.tenant(tenant_code)
    soul = Soul.objects.create(name=f"亡{tenant_code}", tenant=tenant, current_state=SoulState.ALIVE)
    assert soul.die() is not None
    entry, *after = _path(soul)
    realm = Realm.all_objects.get(realm_code=realm_code, tenant=tenant)
    assert (entry.realm_id, entry.sequence, entry.tenant_id) == (realm.pk, 1, tenant.pk)
    # 埃及:穿过杜阿特入口,停在两真之殿受审(docs/02 §1.1);其余文明停在入口。
    if tenant_code == "EG_DUAT":
        assert entry.left_at is not None
        assert [(e.realm.realm_code, e.left_at) for e in after] == [("EG_HALL_TWO_TRUTHS", None)]
    else:
        assert (entry.left_at, after) == (None, [])


@pytest.mark.django_db
def test_a_european_death_records_no_station(seeded):
    soul = Soul.objects.create(name="亡欧", tenant=plan.tenant("EU_HEAVEN_HELL"), current_state=SoulState.ALIVE)
    assert soul.die() is not None
    assert _path(soul) == []


def _european_route(*codes):
    from apps.realms.path import SoulPathService

    tenant = plan.tenant("EU_HEAVEN_HELL")
    soul = Soul.objects.create(name="行路", tenant=tenant, current_state=SoulState.JUDGING)
    for code in codes:
        SoulPathService.enter(soul, Realm.all_objects.get(realm_code=code, tenant=tenant))
    return [(e.realm.realm_code, e.left_at is None) for e in _path(soul)]


@pytest.mark.django_db
def test_the_hell_road_passes_the_vestibule_then_the_ferry_once(seeded):
    # 死亡 → 地狱前庭 → 阿刻戎渡口 → 九圈(用户 2026-11-14);圈与圈之间改判不再过一次渡口。
    assert _european_route("EU_HELL_4TH", "EU_HELL_7TH") == [
        ("EU_ANTINFERNO", False), ("EU_ACHERON", False), ("EU_HELL_4TH", False), ("EU_HELL_7TH", True),
    ]


@pytest.mark.django_db
@pytest.mark.parametrize("code", ["EU_PURGATORY_T3_WRATH", "EU_EARTHLY_PARADISE", "EU_HEAVEN", "EU_ANTINFERNO"])
def test_purgatory_heaven_and_the_neutrals_do_not_pass_the_ferry(seeded, code):
    assert _european_route(code) == [(code, True)]


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
