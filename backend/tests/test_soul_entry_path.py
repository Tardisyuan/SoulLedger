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


# ── manage.py backfill_soul_entry_path ─────────────────────────────────


def _backfill(*args):
    out = io.StringIO()
    call_command("backfill_soul_entry_path", *args, stdout=out)
    return out.getvalue()


def _dead(tenant, name, *, state=SoulState.JUDGING, death=(1990, 5, 7)):
    y, m, d = death
    return Soul.objects.create(name=name, tenant=tenant, current_state=state,
                               death_year=y, death_month=m, death_day=d)


@pytest.fixture
def population(seeded):
    cn, eg = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT")
    souls = {
        "cn_dead": _dead(cn, "旧亡者"),
        "cn_disposed": _dead(cn, "已处置", state=SoulState.DISPOSED, death=(1801, 1, 2)),
        "eg_dead": _dead(eg, "埃及亡者"),
        "cn_no_date": Soul.objects.create(name="无日", tenant=cn, current_state=SoulState.JUDGING),
        "eg_bce": _dead(eg, "前朝", death=(-1300, 3, 4)),
        "cn_partial": _dead(cn, "缺日", death=(1900, 6, None)),
        "cn_alive": Soul.objects.create(name="在世", tenant=cn, current_state=SoulState.ALIVE),
    }
    has = _dead(cn, "已有行程")
    SoulPathEntry.all_objects.create(soul=has, realm=Realm.all_objects.get(realm_code="DY_COURT_01_QINGUANG"),
                                     sequence=1, entered_at="2020-01-01T00:00:00Z", tenant=cn)
    souls["cn_has_path"] = has
    return souls


@pytest.mark.django_db
def test_the_backfill_writes_one_open_entry_at_the_entry_realm_on_the_death_date(population):
    _backfill()
    for key, code in (("cn_dead", "DY_00_PURGATORY"), ("cn_disposed", "DY_00_PURGATORY"), ("eg_dead", "EG_DUAT_ENTRY")):
        soul = population[key]
        [entry] = _path(soul)
        assert entry.realm.realm_code == code and entry.tenant_id == soul.tenant_id
        assert (entry.sequence, entry.left_at) == (1, None)
        assert entry.entered_at.isoformat() == (
            f"{soul.death_year:04d}-{soul.death_month:02d}-{soul.death_day:02d}T00:00:00+00:00"
        )
    for key in ("cn_no_date", "eg_bce", "cn_partial", "cn_alive"):
        assert _path(population[key]) == [], key
    [kept] = _path(population["cn_has_path"])
    assert kept.realm.realm_code == "DY_COURT_01_QINGUANG"


@pytest.mark.django_db
def test_the_backfill_counts_per_civilization(population):
    out = _backfill()
    assert "CHINESE: created=2 has_path=1 alive=1 no_death_date=1 undatable=1 no_entry_realm=0" in out
    assert "EGYPTIAN: created=1 has_path=0 alive=0 no_death_date=0 undatable=1 no_entry_realm=0" in out
    assert "total: created=3 " in out


@pytest.mark.django_db
def test_a_second_run_creates_nothing(population):
    _backfill()
    before = SoulPathEntry.all_objects.count()
    out = _backfill()
    assert "total: created=0 has_path=4 " in out
    assert SoulPathEntry.all_objects.count() == before


@pytest.mark.django_db
def test_a_dry_run_writes_nothing_and_reports_what_it_would(population):
    before = SoulPathEntry.all_objects.count()
    out = _backfill("--dry-run")
    assert SoulPathEntry.all_objects.count() == before
    assert "DRY RUN (nothing written) total: created=3 " in out


@pytest.mark.django_db
def test_a_tenant_without_its_entry_realm_is_skipped_and_counted(population):
    Realm.all_objects.filter(realm_code="EG_DUAT_ENTRY").update(is_deleted=True)
    out = _backfill()
    assert "EGYPTIAN: created=0 has_path=0 alive=0 no_death_date=0 undatable=1 no_entry_realm=1" in out
    assert _path(population["eg_dead"]) == []
