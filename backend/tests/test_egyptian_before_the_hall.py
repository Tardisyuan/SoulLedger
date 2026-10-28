"""Egyptian stages before the hall (review P2-9; docs/02 §1.1, 01 §4.2, 03 §六).

- a death is embalmed for 70 days before the soul sets out: the case is held until then (like 枉死城);
- an early death is not weighed and goes straight to the Field of Reeds;
- the nameless do not enter the underworld, an improper burial cannot complete the journey: held for ever,
  never in the hall.
"""
from datetime import date, timedelta

import pytest

from apps.authentication.models import User
from apps.disposition.models import Disposition
from apps.events.models import SoulEvent
from apps.judgment import claims
from apps.judgment.claims import ClaimRefusedError
from apps.judgment.models import DuatStage
from apps.realms.models import Realm
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


@pytest.fixture
def eg_tenant():
    tenant = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Duat"})[0]
    for code in ("EG_AARU", "EG_ANNIHILATION", "EG_DUAT_ENTRY", "EG_HALL_TWO_TRUTHS"):
        Realm.objects.create(realm_code=code, civilization="EGYPTIAN", name_local=code, name_zh=code,
                             realm_type="HEAVEN", tenant=tenant)
    return tenant


@pytest.fixture
def judge(eg_tenant):
    return User.objects.create_user(username="eg_judge", role="JUDGE", tenant=eg_tenant)


def _soul(tenant, passage=""):
    return Soul.objects.create(name="Ka", tenant=tenant, current_state=SoulState.ALIVE, duat_passage=passage)


def test_a_death_is_embalmed_for_seventy_days_before_the_case_can_be_heard(eg_tenant, judge):
    died = date.today()
    case = _soul(eg_tenant).die(death_date=died)
    assert case.duat_stage == DuatStage.EMBALMING and case.held_until == died + timedelta(days=70)
    assert case.untimely is False and case.realm.realm_code == "EG_HALL_TWO_TRUTHS"
    for act in (lambda: claims.claim(case.pk, judge), lambda: case.conclude("PASSED")):
        with pytest.raises(ClaimRefusedError) as refused:
            act()
        assert refused.value.code == "embalming"


def test_embalming_long_finished_holds_nothing(eg_tenant, judge):
    case = _soul(eg_tenant).die(death_date=date.today() - timedelta(days=71))
    assert case.duat_stage == DuatStage.EMBALMING
    claims.claim(case.pk, judge)


@pytest.mark.parametrize("passage", ["NAMELESS", "IMPROPER_BURIAL"])
def test_the_nameless_and_the_improperly_buried_never_reach_the_hall(eg_tenant, judge, passage):
    soul = _soul(eg_tenant, passage)
    case = soul.die(death_date=date.today() - timedelta(days=400))
    assert case.duat_stage == passage and case.held_until is None and case.realm is None
    for act in (lambda: claims.claim(case.pk, judge), lambda: case.conclude("PASSED")):
        with pytest.raises(ClaimRefusedError) as refused:
            act()
        assert refused.value.code == "duat_unfinished"
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.JUDGING


def test_an_early_death_goes_straight_to_the_field_of_reeds_unweighed(eg_tenant):
    from apps.workflow.models import ApprovalWorkflow

    soul = _soul(eg_tenant, "EARLY_DEATH")
    case = soul.die()
    case.refresh_from_db()
    assert case.duat_stage == DuatStage.EARLY_DEATH and case.verdict == "PASSED" and case.is_final
    assert case.weighing_result is None and case.heart_weight is None         # not weighed
    assert not ApprovalWorkflow.objects.filter(judgment=case).exists()        # no weighing flow
    assert Disposition.objects.get(judgment=case).destination_realm.realm_code == "EG_AARU"
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.DISPOSED


def test_other_civilizations_have_no_duat_stage(cn_tenant):
    from tests.city_god_support import default_city_god

    default_city_god(cn_tenant)  # 地府开案要有城隍收案(2026-10-29)
    case = Soul.objects.create(name="张三", tenant=cn_tenant, current_state=SoulState.ALIVE).die()
    assert case.duat_stage == "" and case.held_until is None


def test_only_an_egyptian_soul_records_a_duat_passage(cn_tenant, eg_tenant, admin_user):
    from tests.soul_account_support import officer_client

    client = officer_client(admin_user)
    cn = Soul.objects.create(name="张三", tenant=cn_tenant, current_state=SoulState.ALIVE)
    eg = _soul(eg_tenant)
    res = client.patch(f"/api/v1/souls/{cn.pk}/", {"duat_passage": "NAMELESS"}, format="json")
    assert res.status_code == 400 and "duat_passage" in res.data
    res = client.patch(f"/api/v1/souls/{eg.pk}/", {"duat_passage": "NAMELESS"}, format="json")
    assert res.status_code == 200 and res.data["duat_passage"] == "NAMELESS"


@pytest.mark.parametrize("passage", ["NAMELESS", "IMPROPER_BURIAL"])
def test_a_burial_found_proper_releases_the_held_case_to_embalming_and_the_hall(eg_tenant, judge, admin_user,
                                                                                passage):
    from tests.soul_account_support import officer_client

    soul = _soul(eg_tenant, passage)
    died = date.today() - timedelta(days=10)
    case = soul.die(death_date=died)
    res = officer_client(admin_user).patch(f"/api/v1/souls/{soul.pk}/", {"duat_passage": ""}, format="json")
    assert res.status_code == 200, res.data
    case.refresh_from_db()
    assert case.duat_stage == DuatStage.EMBALMING and case.held_until == died + timedelta(days=70)
    assert case.realm.realm_code == "EG_HALL_TWO_TRUTHS"
    with pytest.raises(ClaimRefusedError) as refused:
        claims.claim(case.pk, judge)
    assert refused.value.code == "embalming"
    assert _passage_events(soul) == [{"from": passage, "to": "", "judgments": [str(case.pk)]}]


def test_a_release_after_the_seventy_days_holds_nothing(eg_tenant, judge, admin_user):
    from tests.soul_account_support import officer_client

    soul = _soul(eg_tenant, "NAMELESS")
    case = soul.die(death_date=date.today() - timedelta(days=200))
    res = officer_client(admin_user).patch(f"/api/v1/souls/{soul.pk}/", {"duat_passage": ""}, format="json")
    assert res.status_code == 200, res.data
    case.refresh_from_db()
    assert case.duat_stage == DuatStage.EMBALMING and case.realm.realm_code == "EG_HALL_TWO_TRUTHS"
    claims.claim(case.pk, judge)


def test_early_death_cannot_be_recorded_once_the_case_has_opened(eg_tenant, admin_user):
    """`Soul.die` decides an early death on the spot; after death the case has gone another way (serializer)."""
    from tests.soul_account_support import officer_client

    client = officer_client(admin_user)
    dead = _soul(eg_tenant, "NAMELESS")
    case = dead.die(death_date=date.today())
    res = client.patch(f"/api/v1/souls/{dead.pk}/", {"duat_passage": "EARLY_DEATH"}, format="json")
    assert res.status_code == 400 and "duat_passage" in res.data
    case.refresh_from_db()
    assert case.duat_stage == DuatStage.NAMELESS and not case.is_final
    alive = _soul(eg_tenant)
    res = client.patch(f"/api/v1/souls/{alive.pk}/", {"duat_passage": "EARLY_DEATH"}, format="json")
    assert res.status_code == 200


def _patch_passage(admin_user, soul, passage):
    from tests.soul_account_support import officer_client

    return officer_client(admin_user).patch(f"/api/v1/souls/{soul.pk}/", {"duat_passage": passage}, format="json")


def _passage_events(soul):
    return [{k: v for k, v in e.payload.items() if k != "soul_id"}
            for e in SoulEvent.objects.filter(soul=soul, event_type="DUAT_PASSAGE_CHANGED")]


def test_nameless_and_improper_burial_swap_only_the_stage(eg_tenant, judge, admin_user):
    soul = _soul(eg_tenant, "NAMELESS")
    case = soul.die(death_date=date.today() - timedelta(days=200))
    assert _patch_passage(admin_user, soul, "IMPROPER_BURIAL").status_code == 200
    case.refresh_from_db()
    assert (case.duat_stage, case.held_until, case.realm) == (DuatStage.IMPROPER_BURIAL, None, None)
    assert _passage_events(soul) == [{"from": "NAMELESS", "to": "IMPROPER_BURIAL", "judgments": [str(case.pk)]}]


@pytest.mark.parametrize("passage", ["NAMELESS", "IMPROPER_BURIAL"])
def test_a_passage_barred_after_death_takes_the_unclaimed_case_back_to_the_duat_entry(eg_tenant, judge, admin_user,
                                                                                     passage):
    from apps.realms.models import SoulPathEntry

    soul = _soul(eg_tenant)
    case = soul.die(death_date=date.today() - timedelta(days=10))
    assert case.realm.realm_code == "EG_HALL_TWO_TRUTHS"
    res = _patch_passage(admin_user, soul, passage)
    assert res.status_code == 200, res.data
    case.refresh_from_db()
    assert (case.duat_stage, case.held_until, case.realm) == (passage, None, None)    # as at death registration
    here = SoulPathEntry.all_objects.get(soul=soul, left_at__isnull=True)
    assert here.realm.realm_code == "EG_DUAT_ENTRY"
    with pytest.raises(ClaimRefusedError) as refused:
        claims.claim(case.pk, judge)
    assert refused.value.code == "duat_unfinished"
    assert _passage_events(soul) == [{"from": "", "to": passage, "judgments": [str(case.pk)]}]


def test_a_passage_cannot_be_barred_once_an_officer_claimed_the_case(eg_tenant, judge, admin_user):
    soul = _soul(eg_tenant)
    case = soul.die(death_date=date.today() - timedelta(days=200))
    claims.claim(case.pk, judge)
    res = _patch_passage(admin_user, soul, "NAMELESS")
    assert res.status_code == 400 and "duat_passage" in res.data
    case.refresh_from_db()
    soul.refresh_from_db()
    assert soul.duat_passage == "" and case.duat_stage == DuatStage.EMBALMING
    assert case.realm.realm_code == "EG_HALL_TWO_TRUTHS" and not _passage_events(soul)


def test_a_passage_recorded_for_the_living_logs_nothing(eg_tenant, admin_user):
    soul = _soul(eg_tenant)
    assert _patch_passage(admin_user, soul, "NAMELESS").status_code == 200
    assert not _passage_events(soul)
