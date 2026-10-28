"""申诉(apps/judgment/appeals.py,用户 2026-10-24 决定):30 天、两次、另一位官员复核、维持 / 改判、
改判时未执行的部分改按新裁决、已执行的记补偿、租户隔离。"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.dispatch.models import DispatchRecord
from apps.dispatch.services import DispatchService
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment, JudgmentAppeal, Verdict
from apps.judgment.services import JudgmentConclusionService
from apps.sentence_plan.models import SentenceNode, SentencePlan
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin
from apps.souls.models import SoulState
from apps.souls.record_models import RecordCategory, SoulRecord
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client, ready_soul, soul_client

pytestmark = pytest.mark.django_db

MINE = "/api/v1/me/judgment-appeals/"
HALL = "/api/v1/judgment/appeals/"


def _realm_for(soul, verdict):
    return sp.realm(DispositionService._route_to_realm(soul, verdict, "STANDARD"), "CHINESE")


@pytest.fixture
def case(cn_tenant):
    """一个灵魂(带 /me 客户端)、一件由 `decider` 结案 FAILED 的原审判。两个裁决的 realm 都种好。"""
    account, client = ready_soul(cn_tenant)
    soul = account.soul
    for verdict in (Verdict.FAILED, Verdict.PASSED):
        _realm_for(soul, verdict)
    decider = sp.officer("decider", "JUDGE", cn_tenant)
    judgment = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=cn_tenant)
    JudgmentConclusionService.conclude_judgment(judgment, Verdict.FAILED, "原判", by=decider)
    judgment.refresh_from_db()
    return {"account": account, "client": client, "soul": soul, "judgment": judgment, "decider": decider,
            "reviewer": sp.officer("reviewer", "JUDGE", cn_tenant)}


def _file(case, **body):
    return case["client"].post(MINE, {"judgment": str(case["judgment"].pk), "reason": "冤", **body}, format="json")


def _claim_and_decide(case, outcome, verdict=None, who="reviewer"):
    client = officer_client(case[who])
    appeal_id = case["client"].get(MINE).data["results"][0]["id"]
    assert client.post(f"{HALL}{appeal_id}/claim/").status_code == 200
    body = {"outcome": outcome, "note": "复核意见", **({"verdict": verdict} if verdict else {})}
    return client.post(f"{HALL}{appeal_id}/decide/", body, format="json")


# ── 提出:30 天、两次、只对自己已结案的原审判 ─────────────────────────────


def test_a_soul_files_an_appeal_on_its_concluded_judgment(case):
    response = _file(case, evidence="新证人")
    assert response.status_code == 201, response.data
    assert response.data["round"] == 1 and response.data["status"] == "PENDING"
    assert response.data["original_verdict"] == "FAILED" and response.data["evidence"] == "新证人"
    assert "reviewer" not in response.data
    assert SoulEvent.objects.filter(soul=case["soul"], event_type="JUDGMENT_APPEAL_FILED").count() == 1
    listing = case["client"].get(MINE).data
    assert listing["judgments"][0]["can_appeal"] is False
    assert listing["judgments"][0]["refusal_code"] == "appeal_open"


def test_the_window_closes_thirty_days_after_the_conclusion(case):
    judgment = case["judgment"]
    Judgment.all_objects.filter(pk=judgment.pk).update(concluded_at=timezone.now() - timedelta(days=31))
    response = _file(case)
    assert response.status_code == 409 and response.data["code"] == "appeal_window_closed"
    Judgment.all_objects.filter(pk=judgment.pk).update(concluded_at=timezone.now() - timedelta(days=29))
    assert _file(case).status_code == 201


def test_the_second_window_runs_from_the_first_appeals_decision(case):
    """2026-10-24: the second appeal's 30 days start when the first one is decided, not at the conclusion."""
    assert _file(case).status_code == 201
    assert _claim_and_decide(case, "UPHELD").status_code == 200
    judgment = case["judgment"]
    Judgment.all_objects.filter(pk=judgment.pk).update(concluded_at=timezone.now() - timedelta(days=60))
    assert _file(case).status_code == 201


def test_at_most_two_rounds_and_a_withdrawn_one_counts(case):
    for expected_round in (1, 2):
        filed = _file(case)
        assert filed.status_code == 201 and filed.data["round"] == expected_round
        assert _file(case).data["code"] == "appeal_open"
        withdrawn = case["client"].post(f"{MINE}{filed.data['id']}/withdraw/")
        assert withdrawn.status_code == 200 and withdrawn.data["status"] == "WITHDRAWN"
    third = _file(case)
    assert third.status_code == 409 and third.data["code"] == "appeal_rounds_used"
    assert JudgmentAppeal.objects.filter(judgment=case["judgment"]).count() == 2


def test_an_open_judgment_or_another_souls_judgment_is_refused(case, cn_tenant):
    other_account, other_client = ready_soul(cn_tenant, name="旁人")
    response = other_client.post(MINE, {"judgment": str(case["judgment"].pk), "reason": "x"}, format="json")
    assert response.status_code == 404 and response.data["code"] == "not_found"
    _, open_case = sp.open_case(cn_tenant)
    open_case.soul = other_account.soul
    open_case.save()
    response = other_client.post(MINE, {"judgment": str(open_case.pk), "reason": "x"}, format="json")
    assert response.status_code == 409 and response.data["code"] == "not_concluded"
    assert not JudgmentAppeal.objects.exists()


def test_a_greek_judgment_cannot_be_appealed(case):
    # Minos's judgment is final (docs/02 希腊 §5.2; user 2026-10-27): no appeal entry, and filing is refused.
    Judgment.objects.filter(pk=case["judgment"].pk).update(civilization="GREEK")
    row = case["client"].get(MINE).data["judgments"][0]
    assert (row["can_appeal"], row["refusal_code"]) == (False, "no_appeal_above_minos")
    response = _file(case)
    assert response.status_code == 409 and response.data["code"] == "no_appeal_above_minos"
    assert not JudgmentAppeal.objects.exists()


# ── 复核:另一位官员 ──────────────────────────────────────────────────────


def test_the_officer_who_decided_cannot_review_and_only_the_reviewer_decides(case, cn_tenant):
    appeal_id = _file(case).data["id"]
    refused = officer_client(case["decider"]).post(f"{HALL}{appeal_id}/claim/")
    assert refused.status_code == 403 and refused.data["code"] == "original_judge"
    third = sp.officer("third", "JUDGE", cn_tenant)
    early = officer_client(third).post(f"{HALL}{appeal_id}/decide/", {"outcome": "UPHELD", "note": "x"},
                                       format="json")
    assert early.status_code == 403 and early.data["code"] == "not_reviewer"
    claimed = officer_client(case["reviewer"]).post(f"{HALL}{appeal_id}/claim/")
    assert claimed.status_code == 200 and claimed.data["status"] == "IN_REVIEW"
    taken = officer_client(third).post(f"{HALL}{appeal_id}/claim/")
    assert taken.status_code == 409 and taken.data["code"] == "already_claimed"


def test_the_claimant_of_the_original_case_is_also_excluded(case, cn_tenant):
    claimant = sp.officer("claimant", "JUDGE", cn_tenant)
    Judgment.all_objects.filter(pk=case["judgment"].pk).update(claimed_by=claimant)
    appeal_id = _file(case).data["id"]
    refused = officer_client(claimant).post(f"{HALL}{appeal_id}/claim/")
    assert refused.status_code == 403 and refused.data["code"] == "original_judge"


def test_uphold_leaves_the_verdict_and_tells_the_soul(case):
    _file(case)
    response = _claim_and_decide(case, "UPHELD")
    assert response.status_code == 200, response.data
    assert response.data["status"] == "UPHELD" and response.data["new_verdict"] is None
    case["judgment"].refresh_from_db()
    assert case["judgment"].verdict == "FAILED"
    decided = SoulEvent.objects.get(soul=case["soul"], event_type="JUDGMENT_APPEAL_DECIDED")
    assert decided.payload["status"] == "UPHELD" and "reason" not in decided.payload
    from apps.soul_push.services import rule_for
    assert rule_for("JUDGMENT_APPEAL_DECIDED", decided.payload, None)[1] == "appeal_upheld"


# ── 改判 ────────────────────────────────────────────────────────────────


def test_amend_reroutes_an_unexecuted_disposition_in_place_and_compensates_nothing(case):
    judgment, soul = case["judgment"], case["soul"]
    disposition = Disposition.all_objects.get(judgment=judgment)
    assert not disposition.is_executed
    _file(case)
    response = _claim_and_decide(case, "AMENDED", "PASSED")
    assert response.status_code == 200, response.data
    assert response.data["status"] == "AMENDED" and response.data["compensations"] == []
    judgment.refresh_from_db()
    assert judgment.verdict == "PASSED"
    disposition.refresh_from_db()
    passed_realm = _realm_for(soul, Verdict.PASSED)
    assert disposition.destination_realm_id == passed_realm.pk
    home = SentenceNode.all_objects.get(plan__origin_judgment_id=judgment.pk, order=1)
    assert home.status == "ACTIVE" and home.realm_code == passed_realm.realm_code
    assert not SoulRecord.objects.filter(soul=soul, category=RecordCategory.COMPENSATION).exists()
    assert JudgmentAppeal.objects.get().original_verdict == "FAILED"


def test_amend_compensates_an_executed_stop_and_replaces_the_pending_ones(cn_tenant):
    """原属已执行(→ 补偿)、外地站调拨被拒退回 PENDING(→ 减项),追加一个按新裁决路由的原属站并激活。"""
    away = sp.tenant("EG_DUAT")
    soul, plan = sp.planned(cn_tenant, [(away, sp.stop_realm(away), 5)], verdict=Verdict.FAILED)
    passed_realm = _realm_for(soul, Verdict.PASSED)
    sp.serve(soul, plan, 1)
    record = DispatchRecord.all_objects.get(pk=sp.node(plan, 2).dispatch_record_id)
    DispatchService.reject(record, sp.officer("eg", "MODERATOR", away), "不收")
    assert sp.node(plan, 2).status == "PENDING"
    account, _ = svc.provision_account(soul, AccountOrigin.OFFICER)
    account.must_change_password = False
    account.save()
    client = soul_client(account)
    judgment = Judgment.all_objects.get(pk=plan.origin_judgment_id)
    filed = client.post(MINE, {"judgment": str(judgment.pk), "reason": "冤"}, format="json")
    assert filed.status_code == 201, filed.data
    reviewer = officer_client(sp.officer("reviewer", "JUDGE", cn_tenant))
    assert reviewer.post(f"{HALL}{filed.data['id']}/claim/").status_code == 200
    # A not-yet-started foreign stop: the reviewing judge must say whether it stays (2026-10-24).
    asked = reviewer.post(f"{HALL}{filed.data['id']}/decide/",
                          {"outcome": "AMENDED", "verdict": "PASSED", "note": "改"}, format="json")
    assert asked.status_code == 400 and asked.data["code"] == "foreign_stops_choice_required", asked.data
    response = reviewer.post(f"{HALL}{filed.data['id']}/decide/",
                             {"outcome": "AMENDED", "verdict": "PASSED", "note": "改", "keep_foreign_stops": False},
                             format="json")
    assert response.status_code == 200, response.data
    assert len(response.data["compensations"]) == 1
    assert response.data["compensations"][0]["order"] == 1 and response.data["deadline"]
    closed = reviewer.get(HALL, {"status__in": "UPHELD,AMENDED"}).data
    assert [a["id"] for a in closed["results"]] == [filed.data["id"]]
    assert reviewer.get(HALL, {"status__in": "PENDING,WITHDRAWN"}).data["count"] == 0
    compensation = SoulRecord.objects.get(soul=soul, category=RecordCategory.COMPENSATION)
    assert compensation.record_type == "MERIT"
    assert compensation.evidence_json["appeal_id"] == filed.data["id"]
    nodes = list(SentenceNode.all_objects.filter(plan=plan).order_by("create_time"))
    assert [(n.order, n.tenant_code, n.status) for n in nodes] == [
        (1, "CN_DIYU", "COMPLETED"),   # 已执行的不动
        (2, "EG_DUAT", "REMOVED"),     # 按原判排的未执行站;不再占序号
        (2, "CN_DIYU", "ACTIVE"),      # 按新裁决的原属站;推进:灵魂在家,立刻激活
    ]
    assert nodes[2].realm_code == passed_realm.realm_code
    assert SentencePlan.all_objects.get(pk=plan.pk).status == "ACTIVE"


def test_amend_waits_while_the_soul_is_in_transit_and_writes_nothing(cn_tenant):
    away = sp.tenant("EG_DUAT")
    soul, plan = sp.planned(cn_tenant, [(away, sp.stop_realm(away), 5)], verdict=Verdict.FAILED)
    _realm_for(soul, Verdict.PASSED)
    sp.serve(soul, plan, 1)
    assert sp.node(plan, 2).status == "DISPATCHING"
    judgment = Judgment.all_objects.get(pk=plan.origin_judgment_id)
    reviewer = sp.officer("reviewer", "JUDGE", cn_tenant)
    appeal = JudgmentAppeal.objects.create(judgment=judgment, soul=soul, tenant=cn_tenant, round=1, reason="x",
                                           original_verdict="FAILED", status="IN_REVIEW", reviewer=reviewer)
    response = officer_client(reviewer).post(f"{HALL}{appeal.pk}/decide/",
                                             {"outcome": "AMENDED", "verdict": "PASSED", "note": "改"}, format="json")
    assert response.status_code == 409 and response.data["code"] == "plan_in_transit"
    judgment.refresh_from_db()
    appeal.refresh_from_db()
    assert judgment.verdict == "FAILED" and appeal.status == "IN_REVIEW"
    assert not SoulRecord.objects.filter(soul=soul, category=RecordCategory.COMPENSATION).exists()


def test_amend_after_the_plan_finished_only_compensates(case):
    judgment, soul = case["judgment"], case["soul"]
    sp.walk_flow(judgment)  # 原审的处置等审批流程走完才执行(2026-10-29)
    DispositionService.execute(Disposition.all_objects.get(judgment=judgment))
    plan = SentencePlan.all_objects.get(origin_judgment_id=judgment.pk)
    assert plan.status == "COMPLETED"
    soul.refresh_from_db()
    state = soul.current_state
    _file(case)
    response = _claim_and_decide(case, "AMENDED", "PASSED")
    assert response.status_code == 200, response.data
    assert SoulRecord.objects.filter(soul=soul, category=RecordCategory.COMPENSATION).count() == 1
    assert SentenceNode.all_objects.filter(plan=plan).count() == 1
    soul.refresh_from_db()
    assert soul.current_state == state != SoulState.DISPOSED


def test_an_officer_cannot_write_a_compensation_record_by_hand(case, admin_user):
    response = officer_client(admin_user).post(
        f"/api/v1/souls/{case['soul'].pk}/add_record/",
        {"record_type": "MERIT", "category": "COMPENSATION", "description": "x", "weight": 5}, format="json")
    assert response.status_code == 400 and "category" in response.data


# ── 租户隔离 ─────────────────────────────────────────────────────────────


def test_another_hall_neither_sees_nor_claims_the_appeal(case, eu_tenant):
    appeal_id = _file(case).data["id"]
    eu_judge = officer_client(sp.officer("eu_judge", "JUDGE", eu_tenant))
    assert eu_judge.get(HALL).data["count"] == 0
    assert eu_judge.post(f"{HALL}{appeal_id}/claim/").status_code == 404
    hall = officer_client(case["reviewer"]).get(HALL, {"status": "PENDING"}).data
    assert [row["id"] for row in hall["results"]] == [appeal_id]
