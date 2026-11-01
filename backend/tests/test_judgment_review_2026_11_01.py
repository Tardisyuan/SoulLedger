"""审查 2026-11-01(local-gates/review-2026-11-01.md)judgment 一组:P0 #1、P2 #9 / #10 / #12、P3。

#1 的并发版本(两条真连接)在 `tests/test_concurrency.py::TestConcludeRechecksUnderTheLock`,只在 PostgreSQL 上跑;
这里是每个引擎都跑的顺序版本:拿着结案前读到的旧对象再结一次。
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.disposition.models import Disposition
from apps.judgment import appeals
from apps.judgment.claims import ClaimRefusedError
from apps.judgment.models import DuatStage, Judgment, JudgmentAppeal, Verdict, WeighingResult
from apps.judgment.services import JudgmentConclusionService, JudgmentService, OpenCaseRefusedError
from apps.judgment.tasks import auto_conclude_stale_judgments_for_tenant
from apps.realms.models import SoulPathEntry
from apps.realms.path import SoulPathService
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import RecordCategory, SoulRecord
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

HALL = "/api/v1/judgment/appeals/"


def _case(tenant, state=SoulState.JUDGING, **fields):
    soul = Soul.objects.create(name="复查", tenant=tenant, current_state=state)
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=tenant, **fields)


# ── P0 #1:结案在锁内复查 ──────────────────────────────────────────────────────


def test_a_second_conclusion_from_a_stale_copy_is_refused_and_writes_nothing(cn_tenant):
    case = _case(cn_tenant)
    stale = Judgment.all_objects.get(pk=case.pk)  # read before the first conclusion, as the view's get_object()
    JudgmentConclusionService.conclude_judgment(case, Verdict.FAILED, "原判")
    with pytest.raises(ClaimRefusedError) as refused:
        JudgmentConclusionService.conclude_judgment(stale, Verdict.FAILED, "又判")
    assert refused.value.code == "already_concluded" and refused.value.status == 409
    assert Disposition.all_objects.filter(judgment_id=case.pk).count() == 1
    assert Judgment.all_objects.get(pk=case.pk).notes == "原判"


def test_a_retry_concluded_twice_opens_one_retrial(cn_tenant):
    """RETRY(及埃及天平摇摆)在结案里另开一案:此前第二次结案照样再开一件。"""
    case = _case(cn_tenant)
    stale = Judgment.all_objects.get(pk=case.pk)
    JudgmentConclusionService.conclude_judgment(case, Verdict.RETRY)
    with pytest.raises(ClaimRefusedError):
        JudgmentConclusionService.conclude_judgment(stale, Verdict.RETRY)
    assert Judgment.all_objects.filter(retrial_of_id=case.pk).count() == 1


def test_an_officer_concluding_a_stale_copy_is_refused_too(cn_tenant):
    """`by` 给了的路径(API)走 `lock_for_conclude`,同一条复查。"""
    case = _case(cn_tenant)
    judge = sp.officer("j1101", "ADMIN", cn_tenant)
    stale = Judgment.all_objects.get(pk=case.pk)
    JudgmentConclusionService.conclude_judgment(case, Verdict.FAILED, by=judge)
    with pytest.raises(ClaimRefusedError) as refused:
        JudgmentConclusionService.conclude_judgment(stale, Verdict.FAILED, by=judge)
    assert refused.value.code == "already_concluded"


# ── P2 #10:灵魂此刻结不了案,就不开案 ───────────────────────────────────────


@pytest.mark.parametrize("state", [SoulState.REINCARNATING, SoulState.LOST, SoulState.DISPOSED])
def test_no_case_is_opened_on_a_soul_no_conclusion_can_move(cn_tenant, state):
    soul = Soul.objects.create(name="结不了", tenant=cn_tenant, current_state=state)
    admin = sp.officer(f"adm_{state.lower()}", "ADMIN", cn_tenant)
    for actor in (None, admin):  # ADMIN 的豁免是修数据用的,开一件永远结不了的案不是修
        with pytest.raises(OpenCaseRefusedError) as refused:
            JudgmentService.open_case(soul, actor=actor, civilization="CHINESE", court="—")
        assert refused.value.code == "cannot_enter_judgment"
    assert not Judgment.all_objects.filter(soul=soul).exists()


def test_a_disposed_soul_serving_a_plan_still_gets_its_amendment(cn_tenant):
    soul, plan = sp.planned(cn_tenant)
    assert soul.current_state == SoulState.DISPOSED
    case = JudgmentService.open_case(soul, civilization="CHINESE", court="—")
    assert case.kind == "AMENDMENT" and case.amends_plan_id == plan.pk


# ── P3:开案时早夭直入芦苇原 ─────────────────────────────────────────────────


def test_opening_a_case_for_a_living_early_death_goes_straight_to_the_field_of_reeds():
    eg = sp.tenant("EG_DUAT")
    soul = Soul.objects.create(name="婴", tenant=eg, current_state=SoulState.ALIVE,
                               duat_passage=Soul.DuatPassage.EARLY_DEATH)
    case = JudgmentService.open_case(soul, civilization="EGYPTIAN", court="—")
    case.refresh_from_db()
    assert case.duat_stage == DuatStage.EARLY_DEATH
    assert case.verdict == Verdict.PASSED and case.is_final and case.weighing_result is None
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED


# ── P3:重审把灵魂带回审它的殿 ────────────────────────────────────────────────


def test_a_retrial_puts_the_soul_back_in_its_court(cn_tenant):
    court = sp.realm("TEST_REVIEW_COURT", "CHINESE")
    elsewhere = sp.realm("TEST_REVIEW_ELSEWHERE", "CHINESE")
    case = _case(cn_tenant, realm=court)
    SoulPathService.enter(case.soul, elsewhere, tenant_id=cn_tenant.pk)
    JudgmentConclusionService.conclude_judgment(case, Verdict.RETRY)
    retrial = Judgment.all_objects.get(retrial_of_id=case.pk)
    assert retrial.realm_id == court.pk
    open_entries = SoulPathEntry.all_objects.filter(soul_id=case.soul_id, left_at__isnull=True)
    assert [e.realm_id for e in open_entries] == [court.pk]


# ── P3:陈旧案件不标被握住的案 ────────────────────────────────────────────────


def test_the_stale_flag_skips_cases_held_by_rule(cn_tenant):
    old = timezone.now() - timedelta(days=60)
    plain = _case(cn_tenant)
    held = _case(cn_tenant, held_until=timezone.localdate() + timedelta(days=30))
    barred = _case(cn_tenant, duat_stage=DuatStage.NAMELESS)
    released = _case(cn_tenant, held_until=timezone.localdate() - timedelta(days=1))
    Judgment.all_objects.filter(pk__in=[plain.pk, held.pk, barred.pk, released.pk]).update(
        created_at=old, update_time=old)
    auto_conclude_stale_judgments_for_tenant(str(cn_tenant.pk), days_threshold=30)
    flagged = set(Judgment.all_objects.filter(stale_since__isnull=False).values_list("pk", flat=True))
    assert flagged == {plain.pk, released.pk}


# ── P2 #12:结案按案子所在殿的文明,不按驻地 ──────────────────────────────────


def test_a_residing_souls_original_is_concluded_under_its_own_cosmology(cn_tenant, eu_tenant):
    """地府的 PURGATORY 是「再审」(待审所);欧洲的是去处。灵魂暂居欧洲时,地府原审判 PURGATORY 此前按欧洲读,
    建了一份炼狱处置。"""
    case = _case(cn_tenant)
    Soul.objects.filter(pk=case.soul_id).update(tenant=eu_tenant)
    case = Judgment.all_objects.get(pk=case.pk)
    assert case.soul.is_residing and case.soul.civilization == "EUROPEAN"
    JudgmentConclusionService.conclude_judgment(case, Verdict.PURGATORY)
    assert Judgment.all_objects.filter(retrial_of_id=case.pk).count() == 1
    assert not Disposition.all_objects.filter(judgment_id=case.pk).exists()


# ── P2 #9:申诉改判 ──────────────────────────────────────────────────────────


def _appeal_in_review(case, reviewer, original):
    return JudgmentAppeal.objects.create(judgment=case, soul=case.soul, tenant_id=case.tenant_id, round=1, reason="冤",
                                         original_verdict=original, status="IN_REVIEW", reviewer=reviewer)


def _concluded(tenant, verdict, **fields):
    return _case(tenant, verdict=verdict, is_final=True, concluded_at=timezone.now(), **fields)


@pytest.fixture
def executed_stop(monkeypatch):
    """The plan side stubbed: one executed stop handed back to compensate (amend_for_appeal is fix-afterlife's)."""
    from apps.sentence_plan import requests as plan_requests

    made = {}

    def fake(soul, judgment, verdict, keep_foreign=None):
        disposition = Disposition.objects.create(soul=soul, judgment=judgment, tenant=judgment.tenant,
                                                 sentence_years=50, is_executed=True)
        made["disposition"] = disposition
        return [(None, disposition)]

    monkeypatch.setattr(plan_requests, "amend_for_appeal", fake)
    return made


def _decide(reviewer, appeal, verdict):
    return officer_client(reviewer).post(f"{HALL}{appeal.pk}/decide/",
                                         {"outcome": "AMENDED", "verdict": verdict, "note": "改"}, format="json")


def _compensations(soul):
    return SoulRecord.objects.filter(soul=soul, category=RecordCategory.COMPENSATION)


def test_an_amendment_to_a_lighter_verdict_compensates_and_a_heavier_one_does_not(cn_tenant, executed_stop):
    reviewer = sp.officer("rv1101", "JUDGE", cn_tenant)
    lighter = _concluded(cn_tenant, Verdict.FAILED)
    response = _decide(reviewer, _appeal_in_review(lighter, reviewer, Verdict.FAILED), Verdict.PASSED)
    assert response.status_code == 200, response.data
    assert _compensations(lighter.soul).count() == 1

    heavier = _concluded(cn_tenant, Verdict.PASSED)
    response = _decide(reviewer, _appeal_in_review(heavier, reviewer, Verdict.PASSED), Verdict.FAILED)
    assert response.status_code == 200, response.data
    assert response.data["compensations"] == []
    assert not _compensations(heavier.soul).exists()
    assert Judgment.all_objects.get(pk=heavier.pk).verdict == Verdict.FAILED


def test_no_compensation_lands_in_a_life_after_the_wronged_one(cn_tenant, executed_stop, monkeypatch):
    reviewer = sp.officer("rv1102", "JUDGE", cn_tenant)
    case = _concluded(cn_tenant, Verdict.FAILED)
    appeal = _appeal_in_review(case, reviewer, Verdict.FAILED)
    monkeypatch.setattr(Soul, "life_index", property(lambda self: case.cycle + 1))  # reborn since
    response = _decide(reviewer, appeal, Verdict.PASSED)
    assert response.status_code == 200, response.data
    assert response.data["compensations"] == []
    assert not _compensations(case.soul).exists()


def test_compensate_skips_only_when_the_life_has_changed(cn_tenant):
    """The guard itself, without the API: same life → one row per executed stop."""
    case = _concluded(cn_tenant, Verdict.PASSED)
    disposition = Disposition.objects.create(soul=case.soul, judgment=case, tenant=cn_tenant, sentence_years=20)
    appeal = _appeal_in_review(case, sp.officer("rv1103", "JUDGE", cn_tenant), Verdict.FAILED)
    assert len(appeals._compensate(case.soul, case, appeal, [(None, disposition)])) == 1


def test_an_egyptian_amendment_must_agree_with_the_scale(executed_stop):
    eg = sp.tenant("EG_DUAT")
    reviewer = sp.officer("rv1104", "JUDGE", eg)
    case = _concluded(eg, Verdict.FAILED, weighing_result=WeighingResult.HEAVIER)
    SoulRecord.objects.create(soul=case.soul, record_type="DEMERIT", description="窃", weight=12)
    appeal = _appeal_in_review(case, reviewer, Verdict.FAILED)

    refused = _decide(reviewer, appeal, Verdict.PASSED)
    assert refused.status_code == 400 and refused.data["code"] == "verdict_contradicts_weighing", refused.data
    assert refused.data["weighed_verdict"] == Verdict.FAILED
    assert Judgment.all_objects.get(pk=case.pk).verdict == Verdict.FAILED
    assert JudgmentAppeal.objects.get(pk=appeal.pk).status == "IN_REVIEW"
    assert "disposition" not in executed_stop  # refused before the plan was touched

    SoulRecord.objects.create(soul=case.soul, record_type="MERIT", description="施舍", weight=20)  # 心比羽轻了
    response = _decide(reviewer, appeal, Verdict.PASSED)
    assert response.status_code == 200, response.data
    case.refresh_from_db()
    assert case.verdict == Verdict.PASSED and case.weighing_result == WeighingResult.LIGHTER
