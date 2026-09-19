"""受刑计划阶段 1:只加模型与记录(docs/ARCHITECTURE-sentence-plan.md §9)。

三组:
* 记录 —— 原审判结案建计划 + 原属节点;原属处置执行标节点;不写任何 SENTENCE_* 事件。
* 约束 —— §2.3 每一条都在数据库层,违反即 IntegrityError(变异证明记在交付日志里)。
* 联审补齐(Q12)—— 挂审判、node_order、`sentence/`、挂了审判的联审 `conclude` 校验。
另有只读 API 的可见性与回填命令的幂等。

用户都不是 ADMIN,除非测试名说是:ADMIN 绕过租户检查,证明不了各方各自能做什么。
"""
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import IntegrityError, transaction

from apps.authentication.models import User
from apps.dispatch.models import (
    CrossTenantJudgment,
    CrossTenantJudgmentParticipant,
    DispatchRecord,
    DispatchStatus,
    JudgmentStatus,
)
from apps.dispatch.services import CrossTenantJudgmentService, DispatchService
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment, Verdict
from apps.realms.models import Realm
from apps.sentence_plan.models import (
    SentenceNode,
    SentenceNodeStatus,
    SentencePlan,
    SentencePlanRequest,
    SentencePlanStatus,
)
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db
CJ = "/api/v1/dispatch/cross-tenant-judgments/"
PLANS = "/api/v1/sentence-plans/"


def _tenant(code):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]


@pytest.fixture
def cn():
    return _tenant("CN_DIYU")


@pytest.fixture
def eg():
    return _tenant("EG_DUAT")


@pytest.fixture
def eu():
    return _tenant("EU_HEAVEN_HELL")


def _judge(tenant, name=None):
    return User.objects.create_user(
        username=name or f"judge_{tenant.code}", password="x", role="JUDGE", tenant=tenant,
    )


def _realm(code, civilization, *, eternal=False, reset="NONE"):
    return Realm.objects.create(
        realm_code=code, civilization=civilization, name_local=code, realm_type="HELL",
        is_eternal=eternal, memory_reset_mechanism=reset,
    )


def _open_case(tenant, name="案主"):
    soul = Soul.objects.create(name=name, tenant=tenant, current_state=SoulState.JUDGING)
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=tenant)


def _concluded(tenant, name="案主"):
    case = _open_case(tenant, name)
    case.conclude(Verdict.PASSED, "")
    case.refresh_from_db()
    return case


# ── 记录 ─────────────────────────────────────────────────────────────────────


def test_an_original_conclusion_records_a_plan_with_one_active_home_node(cn):
    case = _concluded(cn)
    disposition = Disposition.objects.get(judgment=case)

    plan = SentencePlan.objects.get(soul=case.soul)
    assert (plan.tenant_id, plan.cycle, plan.status) == (cn.pk, case.cycle, SentencePlanStatus.ACTIVE)
    assert plan.origin_judgment_id == case.pk and plan.cross_judgment_id is None
    [node] = plan.nodes.all()
    assert (node.order, node.is_home, node.tenant_code, node.status) == (1, True, "CN_DIYU", SentenceNodeStatus.ACTIVE)
    assert node.disposition_id == disposition.pk and node.added_by_judgment_id == case.pk
    # 阶段 2 起:一条 SENTENCE_PLAN_CREATED;处置回指节点(原属处置本来就挂着裁决,can_delete 不变)。
    assert [e.event_type for e in SoulEvent.objects.filter(soul=case.soul, event_type__startswith="SENTENCE_")] == [
        "SENTENCE_PLAN_CREATED"]
    disposition.refresh_from_db()
    assert disposition.sentence_node_id == node.pk and disposition.can_delete is False


def test_executing_the_home_disposition_completes_node_and_plan(cn):
    case = _concluded(cn)
    disposition = Disposition.objects.get(judgment=case)
    assert DispositionService.execute(disposition) is True

    plan = SentencePlan.objects.get(soul=case.soul)
    node = plan.nodes.get()
    assert node.status == SentenceNodeStatus.COMPLETED and node.completed_at is not None
    assert plan.status == SentencePlanStatus.COMPLETED and plan.completed_at is not None


def test_an_eternal_home_disposition_with_nothing_after_it_completes_the_plan(cn):
    case = _concluded(cn)
    disposition = Disposition.objects.get(judgment=case)
    Disposition.all_objects.filter(pk=disposition.pk).update(is_eternal=True)
    disposition.refresh_from_db()
    DispositionService.execute(disposition)

    plan = SentencePlan.objects.get(soul=case.soul)
    assert plan.nodes.get().status == SentenceNodeStatus.ETERNAL
    assert plan.status == SentencePlanStatus.COMPLETED


def test_a_refused_conclusion_leaves_no_plan(cn):
    """结案 saga 回滚时计划跟着回滚:同一事务。"""
    case = _open_case(cn)
    Soul.all_objects.filter(pk=case.soul_id).update(current_state=SoulState.ALIVE)
    case.refresh_from_db()
    with pytest.raises(Exception):
        case.conclude(Verdict.PASSED, "")
    assert not SentencePlan.all_objects.filter(soul=case.soul).exists()


def test_a_second_in_progress_plan_is_not_recorded_and_the_conclusion_still_stands(cn, caplog):
    """一份记录不能拒绝一次审判(阶段 1 的承诺)。"""
    case = _concluded(cn)
    Soul.all_objects.filter(pk=case.soul_id).update(current_state=SoulState.JUDGING)
    second = Judgment.objects.create(soul=case.soul, civilization=case.civilization, court="第二殿", tenant=cn)
    assert second.conclude(Verdict.FAILED, "") is True

    assert SentencePlan.all_objects.filter(soul=case.soul).count() == 1
    assert "already has in-progress plan" in caplog.text


def test_a_residing_soul_executing_an_away_disposition_touches_no_plan(cn, eg):
    """手动调拨的暂居(不挂节点)里的处置:照旧回归,计划原样。"""
    case = _concluded(cn)
    record = DispatchRecord.objects.create(
        source_tenant=cn, target_tenant=eg, soul=case.soul, status=DispatchStatus.APPROVED, reason="x", tenant=cn,
    )
    DispatchService.execute(record, "executor")
    case.soul.refresh_from_db()
    away = Disposition.objects.create(soul=case.soul, tenant=eg)
    assert DispositionService.execute(away) is True

    case.soul.refresh_from_db()
    assert case.soul.tenant_id == cn.pk
    plan = SentencePlan.objects.get(soul=case.soul)
    assert plan.status == SentencePlanStatus.ACTIVE
    assert [n.status for n in plan.nodes.all()] == [SentenceNodeStatus.ACTIVE]


def test_a_disposition_a_node_points_at_cannot_be_deleted(cn):
    soul = Soul.objects.create(name="外地", tenant=cn, current_state=SoulState.DISPOSED)
    free = Disposition.objects.create(soul=soul, tenant=cn)
    held = Disposition.objects.create(soul=soul, tenant=cn, sentence_node_id="00000000-0000-0000-0000-000000000001")
    assert free.can_delete is True
    assert held.can_delete is False


# ── 约束(§2.3)────────────────────────────────────────────────────────────


def _plan(cn, *, status=SentencePlanStatus.ACTIVE, name="约束"):
    soul = Soul.objects.create(name=name, tenant=cn, current_state=SoulState.DISPOSED)
    return SentencePlan.objects.create(soul=soul, tenant=cn, status=status)


def _node(plan, order, *, status=SentenceNodeStatus.PENDING, is_home=False, **kw):
    return SentenceNode.objects.create(
        plan=plan, order=order, tenant_code="X", is_home=is_home, status=status, **kw,
    )


def _refused(make):
    with pytest.raises(IntegrityError), transaction.atomic():
        make()


def test_one_in_progress_plan_per_soul(cn):
    plan = _plan(cn)
    _refused(lambda: SentencePlan.objects.create(soul=plan.soul, tenant=cn, status=SentencePlanStatus.HELD))
    _refused(lambda: SentencePlan.objects.create(soul=plan.soul, tenant=cn, status=SentencePlanStatus.RETRIAL))
    # 完成的不占位。
    SentencePlan.objects.create(soul=plan.soul, tenant=cn, status=SentencePlanStatus.COMPLETED)
    assert SentencePlan.objects.filter(soul=plan.soul).count() == 2


def test_live_node_orders_are_unique_but_a_removed_one_frees_its_number(cn):
    plan = _plan(cn)
    _node(plan, 2, status=SentenceNodeStatus.COMPLETED)
    _refused(lambda: _node(plan, 2))
    _node(plan, 3, status=SentenceNodeStatus.REMOVED)
    _node(plan, 3)
    assert plan.nodes.filter(order=3).count() == 2


def test_at_most_one_node_holds_the_soul(cn):
    plan = _plan(cn)
    _node(plan, 2, status=SentenceNodeStatus.ACTIVE)
    _refused(lambda: _node(plan, 3, status=SentenceNodeStatus.DISPATCHING))
    _refused(lambda: _node(plan, 3, status=SentenceNodeStatus.WAITING))
    _node(plan, 3, status=SentenceNodeStatus.PENDING)


def test_exactly_one_home_node_and_it_is_first(cn):
    plan = _plan(cn)
    _refused(lambda: _node(plan, 2, is_home=True))
    _node(plan, 1, is_home=True)
    _refused(lambda: _node(plan, 1, is_home=True, status=SentenceNodeStatus.REMOVED))


def test_node_order_is_positive(cn):
    plan = _plan(cn)
    _refused(lambda: SentenceNode.objects.bulk_create([SentenceNode(plan=plan, order=0, tenant_code="X")]))


def test_sentence_years_are_not_negative(cn):
    plan = _plan(cn)
    _refused(lambda: _node(plan, 2, sentence_years=-1))
    _node(plan, 2, sentence_years=0)


def test_one_pending_request_per_plan(cn):
    plan = _plan(cn)
    SentencePlanRequest.objects.create(plan=plan, from_tenant_code="X", kind="AMEND")
    _refused(lambda: SentencePlanRequest.objects.create(plan=plan, from_tenant_code="Y", kind="REOPEN"))
    SentencePlanRequest.objects.create(plan=plan, from_tenant_code="Y", kind="AMEND", status="REJECTED")


def test_participant_node_order_and_years_are_constrained(cn, eg):
    j = CrossTenantJudgment.objects.create(title="t", description="d", initiating_tenant=cn, tenant=cn)
    CrossTenantJudgmentParticipant.objects.create(judgment=j, participant_tenant=eg, tenant=eg, node_order=2)
    _refused(lambda: CrossTenantJudgmentParticipant.objects.create(
        judgment=j, participant_tenant=eg, tenant=eg, node_order=2,
    ))
    _refused(lambda: CrossTenantJudgmentParticipant.objects.create(
        judgment=j, participant_tenant=eg, tenant=eg, sentence_years=-1,
    ))
    # 没有序号的(ADVISOR / 存量会议)可以有任意多个。
    CrossTenantJudgmentParticipant.objects.create(judgment=j, participant_tenant=eg, tenant=eg)
    CrossTenantJudgmentParticipant.objects.create(judgment=j, participant_tenant=eg, tenant=eg)


# ── 联审补齐(Q12)─────────────────────────────────────────────────────────


@pytest.fixture
def bench(cn, eg, eu):
    _realm("EG_TEST_HALL", "EGYPTIAN")
    _realm("EU_TEST_ETERNAL", "EUROPEAN", eternal=True, reset="LETHE")
    _realm("EU_TEST_PURGE", "EUROPEAN")
    case = _open_case(cn)
    clients = {t.code: officer_client(_judge(t)) for t in (cn, eg, eu)}
    resp = clients["CN_DIYU"].post(CJ, {"title": "联审", "description": "d", "judgment": str(case.pk)}, format="json")
    assert resp.status_code == 201, resp.data
    return {"case": case, "cj": CrossTenantJudgment.objects.get(pk=resp.data["id"]), "c": clients,
            "cn": cn, "eg": eg, "eu": eu}


def _seat(bench, tenant, order, role="CO_JUDGE"):
    body = {"participant_tenant": tenant.pk, "role": role}
    if order is not None:
        body["node_order"] = order
    return bench["c"]["CN_DIYU"].post(f"{CJ}{bench['cj'].pk}/participate/", body, format="json")


def _submit(bench, tenant, realm_code, years=10, client_code=None):
    participant = bench["cj"].participants.get(participant_tenant=tenant)
    return bench["c"][client_code or tenant.code].post(
        f"{CJ}{bench['cj'].pk}/sentence/",
        {"participant": str(participant.pk), "realm_code": realm_code, "sentence_years": years},
        format="json",
    )


def _convene(bench):
    assert bench["c"]["CN_DIYU"].post(f"{CJ}{bench['cj'].pk}/activate/", {}, format="json").status_code == 200


def _conclude(bench):
    return bench["c"]["CN_DIYU"].post(f"{CJ}{bench['cj'].pk}/conclude/", {"conclusion_type": "PASS"}, format="json")


def test_a_cross_judgment_attaches_to_the_initiators_open_original_judgment(bench):
    assert bench["cj"].judgment_id == bench["case"].pk


def test_attaching_someone_elses_or_a_concluded_judgment_is_refused(bench, cn, eg):
    theirs = _open_case(eg, "外人")
    done = _concluded(cn, "已结")
    for target in (theirs, done):
        resp = bench["c"]["CN_DIYU"].post(CJ, {"title": "x", "description": "d", "judgment": str(target.pk)}, format="json")
        assert resp.status_code == 400, resp.data
        assert not CrossTenantJudgment.all_objects.filter(judgment=target).exists()
    again = bench["c"]["CN_DIYU"].post(CJ, {"title": "x", "description": "d", "judgment": str(bench["case"].pk)}, format="json")
    assert again.status_code == 400
    assert CrossTenantJudgment.all_objects.filter(judgment=bench["case"]).count() == 1


def test_the_attached_judgment_cannot_be_changed_afterwards(bench, cn):
    other = _open_case(cn, "另一案")
    resp = bench["c"]["CN_DIYU"].patch(f"{CJ}{bench['cj'].pk}/", {"judgment": str(other.pk)}, format="json")
    assert resp.status_code == 400
    bench["cj"].refresh_from_db()
    assert bench["cj"].judgment_id == bench["case"].pk


def test_node_order_rules_on_an_attached_bench(bench, cn, eg, eu):
    assert _seat(bench, eg, None).status_code == 400            # 非 ADVISOR 必须带序号
    assert _seat(bench, eg, 2, role="ADVISOR").status_code == 400  # ADVISOR 不带节点
    assert _seat(bench, cn, 2).status_code == 400               # 原属是节点 1,不能再排
    assert _seat(bench, eg, 2).status_code == 200
    assert _seat(bench, eu, 2).status_code == 400               # 序号重复
    assert _seat(bench, eu, None, role="ADVISOR").status_code == 200
    orders = sorted(bench["cj"].participants.values_list("participant_tenant__code", "node_order"))
    assert orders == [("EG_DUAT", 2), ("EU_HEAVEN_HELL", None)]


def test_a_meeting_with_no_judgment_behaves_as_before(cn, eg):
    client = officer_client(_judge(cn))
    resp = client.post(CJ, {"title": "会议", "description": "d"}, format="json")
    assert resp.status_code == 201 and resp.data["judgment"] is None
    cj_id = resp.data["id"]
    seat = client.post(f"{CJ}{cj_id}/participate/", {"participant_tenant": eg.pk, "role": "CO_JUDGE"}, format="json")
    assert seat.status_code == 200, seat.data
    ordered = client.post(f"{CJ}{cj_id}/participate/", {"participant_tenant": eg.pk, "node_order": 2}, format="json")
    assert ordered.status_code == 400
    assert client.post(f"{CJ}{cj_id}/activate/", {}, format="json").status_code == 200
    done = client.post(f"{CJ}{cj_id}/conclude/", {"conclusion_type": "FAIL"}, format="json")
    assert done.status_code == 200 and done.data["status"] == JudgmentStatus.CONCLUDED


def test_a_participant_submits_its_own_civilizations_realm(bench, eg):
    _seat(bench, eg, 2)
    resp = _submit(bench, eg, "EG_TEST_HALL", years=30)
    assert resp.status_code == 200, resp.data
    p = bench["cj"].participants.get(participant_tenant=eg)
    assert (p.sentence_realm_code, p.sentence_years, p.sentence_is_eternal) == ("EG_TEST_HALL", 30, False)
    assert p.sentence_submitted_at is not None and p.sentence_submitted_by.tenant_id == eg.pk


def test_a_realm_from_another_cosmology_is_refused(bench, eg):
    _seat(bench, eg, 2)
    assert _submit(bench, eg, "EU_TEST_PURGE").status_code == 400
    assert _submit(bench, eg, "NO_SUCH_REALM").status_code == 400
    assert bench["cj"].participants.get(participant_tenant=eg).sentence_submitted_at is None


def test_only_the_seats_own_tenant_fills_it(bench, eg):
    _seat(bench, eg, 2)
    assert _submit(bench, eg, "EG_TEST_HALL", client_code="CN_DIYU").status_code == 403
    assert bench["cj"].participants.get(participant_tenant=eg).sentence_submitted_at is None


def test_an_advisor_carries_no_sentence(bench, eu):
    _seat(bench, eu, None, role="ADVISOR")
    assert _submit(bench, eu, "EU_TEST_PURGE").status_code == 400


def test_an_eternal_sentence_is_copied_from_the_realm(bench, eu):
    _seat(bench, eu, 2)
    assert _submit(bench, eu, "EU_TEST_ETERNAL").status_code == 200
    p = bench["cj"].participants.get(participant_tenant=eu)
    assert p.sentence_is_eternal is True and p.sentence_memory_reset == "LETHE"


def test_conclude_refuses_an_unfilled_seat(bench, eg):
    _seat(bench, eg, 2)
    _convene(bench)
    resp = _conclude(bench)
    assert resp.status_code == 400 and "not submitted" in resp.data["error"]
    bench["cj"].refresh_from_db()
    assert bench["cj"].status == JudgmentStatus.ACTIVE


def test_conclude_refuses_a_gap_in_the_order(bench, eg, eu):
    _seat(bench, eg, 2)
    _seat(bench, eu, 4)
    _submit(bench, eg, "EG_TEST_HALL")
    _submit(bench, eu, "EU_TEST_PURGE")
    _convene(bench)
    resp = _conclude(bench)
    assert resp.status_code == 400 and "without gaps" in resp.data["error"]


def test_conclude_refuses_an_eternal_node_that_is_not_last(bench, eg, eu):
    """Q5:永久刑期只能排最后。"""
    _seat(bench, eu, 2)
    _seat(bench, eg, 3)
    _submit(bench, eu, "EU_TEST_ETERNAL")
    _submit(bench, eg, "EG_TEST_HALL")
    _convene(bench)
    resp = _conclude(bench)
    assert resp.status_code == 400 and "must be the last node" in resp.data["error"]
    bench["cj"].refresh_from_db()
    assert bench["cj"].status == JudgmentStatus.ACTIVE and bench["cj"].conclusion_type is None


def test_conclude_accepts_a_complete_bench_with_eternal_last(bench, eg, eu):
    _seat(bench, eg, 2)
    _seat(bench, eu, 3)
    _submit(bench, eg, "EG_TEST_HALL")
    _submit(bench, eu, "EU_TEST_ETERNAL")
    _convene(bench)
    resp = _conclude(bench)
    assert resp.status_code == 200, resp.data
    assert _submit(bench, eg, "EG_TEST_HALL").status_code == 400  # 结束后不能再改


def test_a_realm_that_no_longer_matches_is_caught_at_conclude(bench, eg):
    _seat(bench, eg, 2)
    _submit(bench, eg, "EG_TEST_HALL")
    Realm.all_objects.filter(realm_code="EG_TEST_HALL").update(civilization="EUROPEAN")
    _convene(bench)
    resp = _conclude(bench)
    assert resp.status_code == 400 and "civilization" in resp.data["error"]


def test_an_unfinished_bench_now_refuses_the_conclusion(bench):
    """阶段 1 时这条是「计划记下挂着的联审」;阶段 2 起(Q17)联审没结束,原审判结不了案、什么都不写。
    结束了的联审怎样抄进计划见 tests/test_sentence_plan_phase2.py。"""
    from apps.sentence_plan.services import CrossJudgmentOpenError

    with pytest.raises(CrossJudgmentOpenError):
        bench["case"].conclude(Verdict.PASSED, "")
    bench["case"].refresh_from_db()
    assert bench["case"].verdict is None
    assert not SentencePlan.all_objects.filter(soul=bench["case"].soul).exists()


def test_the_service_check_is_empty_for_a_meeting(cn):
    j = CrossTenantJudgment.objects.create(title="t", description="d", initiating_tenant=cn, tenant=cn)
    assert CrossTenantJudgmentService.check_bench_sentences(j) == []


# ── 只读 API ─────────────────────────────────────────────────────────────


def test_the_home_tenant_and_a_node_tenant_read_the_plan_and_nobody_else(cn, eg, eu):
    case = _concluded(cn)
    plan = SentencePlan.objects.get(soul=case.soul)
    home, away, third = (officer_client(_judge(t)) for t in (cn, eg, eu))

    assert [p["id"] for p in home.get(PLANS).data["results"]] == [str(plan.pk)]
    assert away.get(f"{PLANS}{plan.pk}/").status_code == 404
    SentenceNode.objects.create(plan=plan, order=2, tenant_code="EG_DUAT")
    resp = away.get(f"{PLANS}{plan.pk}/")
    assert resp.status_code == 200 and [n["order"] for n in resp.data["nodes"]] == [1, 2]
    assert away.get(PLANS).data["count"] == 1
    assert third.get(PLANS).data["count"] == 0
    assert third.get(f"{PLANS}{plan.pk}/").status_code == 404


def test_the_plan_api_is_read_only(cn):
    case = _concluded(cn)
    plan = SentencePlan.objects.get(soul=case.soul)
    client = officer_client(_judge(cn))
    assert client.post(PLANS, {}, format="json").status_code == 405
    assert client.patch(f"{PLANS}{plan.pk}/", {"status": "COMPLETED"}, format="json").status_code == 405
    assert client.delete(f"{PLANS}{plan.pk}/").status_code == 405
    plan.refresh_from_db()
    assert plan.status == SentencePlanStatus.ACTIVE


def test_a_role_without_judgment_read_gets_nothing(cn):
    _concluded(cn)
    guardian = User.objects.create_user(username="guardian_sp", password="x", role="GUARDIAN", tenant=cn)
    assert officer_client(guardian).get(PLANS).status_code == 403


# ── 回填(§7.2)────────────────────────────────────────────────────────


def _backfill():
    out = StringIO()
    call_command("backfill_sentence_plans", stdout=out)
    return dict(line.split(": ") for line in out.getvalue().splitlines() if ": " in line and not line.startswith("conflict ("))


def _legacy_case(tenant, name):
    """阶段 1 之前结案的:有裁决、有处置,没有计划。"""
    case = _concluded(tenant, name)
    SentencePlan.all_objects.filter(soul=case.soul).delete()
    return case


def test_backfill_describes_what_happened_and_a_second_run_writes_nothing(cn, eg):
    executed = _legacy_case(cn, "已执行")
    DispositionService.execute(Disposition.objects.get(judgment=executed))

    returned = _legacy_case(cn, "去过埃及")
    record = DispatchRecord.objects.create(
        source_tenant=cn, target_tenant=eg, soul=returned.soul, status=DispatchStatus.APPROVED, reason="x", tenant=cn,
    )
    DispatchService.execute(record, "executor")
    returned.soul.refresh_from_db()
    assert DispositionService.execute(Disposition.objects.create(soul=returned.soul, tenant=eg)) is True
    assert DispositionService.execute(Disposition.objects.get(judgment=returned)) is True

    first = _backfill()
    assert first["plans_created"] == "2" and first["nodes_created"] == "3"

    plan = SentencePlan.objects.get(soul=executed.soul)
    assert plan.status == SentencePlanStatus.COMPLETED
    assert [n.status for n in plan.nodes.all()] == [SentenceNodeStatus.COMPLETED]

    plan = SentencePlan.objects.get(soul=returned.soul)
    assert plan.status == SentencePlanStatus.COMPLETED
    assert [(n.order, n.tenant_code, n.status) for n in plan.nodes.all()] == [
        (1, "CN_DIYU", SentenceNodeStatus.COMPLETED), (2, "EG_DUAT", SentenceNodeStatus.COMPLETED),
    ]
    assert plan.nodes.get(order=2).dispatch_record_id == record.pk

    second = _backfill()
    assert second["plans_created"] == "0" and second["nodes_created"] == "0"
    assert second["already_planned"] == "2"
    assert SentencePlan.objects.count() == 2


def test_backfill_marks_a_manual_return_as_aborted(cn, eg):
    case = _legacy_case(cn, "被接回")
    record = DispatchRecord.objects.create(
        source_tenant=cn, target_tenant=eg, soul=case.soul, status=DispatchStatus.APPROVED, reason="x", tenant=cn,
    )
    DispatchService.execute(record, "executor")
    case.soul.refresh_from_db()
    DispatchService.end_residence(case.soul, actor="system", trigger=DispatchService.RETURN_MANUAL, reason="接回")
    _backfill()
    plan = SentencePlan.objects.get(soul=case.soul)
    assert plan.status == SentencePlanStatus.ACTIVE
    assert [n.status for n in plan.nodes.order_by("order")] == [SentenceNodeStatus.ACTIVE, SentenceNodeStatus.ABORTED]


def test_backfill_records_the_home_node_pending_while_the_soul_serves_abroad(cn, eg):
    """原属处置未执行、灵魂已在外地受刑(用户 2026-09-19 决定):原属节点 PENDING,灵魂回来后再执行。

    PENDING 不是占位状态,所以写得进 `unique_occupying_sentence_node`;第二次运行零写入。
    """
    case = _legacy_case(cn, "两头占")
    record = DispatchRecord.objects.create(
        source_tenant=cn, target_tenant=eg, soul=case.soul, status=DispatchStatus.APPROVED, reason="x", tenant=cn,
    )
    DispatchService.execute(record, "executor")
    case.soul.refresh_from_db()
    away = Disposition.objects.create(soul=case.soul, tenant=eg)

    first = _backfill()
    assert first["plans_created"] == "1" and first["nodes_created"] == "2" and first["skipped_conflict"] == "0"
    plan = SentencePlan.objects.get(soul=case.soul)
    assert plan.status == SentencePlanStatus.ACTIVE
    home, abroad = plan.nodes.order_by("order")
    assert (home.is_home, home.status, home.activated_at) == (True, SentenceNodeStatus.PENDING, None)
    assert home.disposition_id == Disposition.objects.get(judgment=case).pk
    assert (abroad.tenant_code, abroad.status, abroad.disposition_id) == ("EG_DUAT", SentenceNodeStatus.ACTIVE, away.pk)
    # 断缺席:同一计划里只有一个占位节点。
    assert plan.nodes.filter(status__in=["ACTIVE", "DISPATCHING", "WAITING"]).count() == 1

    second = _backfill()
    assert second["plans_created"] == "0" and second["nodes_created"] == "0" and second["already_planned"] == "1"
    assert SentenceNode.objects.filter(plan__soul=case.soul).count() == 2


def test_backfill_leaves_the_home_node_active_once_the_soul_is_back(cn, eg):
    """回归之后原属处置仍未执行:灵魂就在原属,原属节点是 ACTIVE,不改成 PENDING。"""
    case = _legacy_case(cn, "回来了")
    record = DispatchRecord.objects.create(
        source_tenant=cn, target_tenant=eg, soul=case.soul, status=DispatchStatus.APPROVED, reason="x", tenant=cn,
    )
    DispatchService.execute(record, "executor")
    case.soul.refresh_from_db()
    assert DispositionService.execute(Disposition.objects.create(soul=case.soul, tenant=eg)) is True
    _backfill()
    statuses = [n.status for n in SentencePlan.objects.get(soul=case.soul).nodes.order_by("order")]
    assert statuses == [SentenceNodeStatus.ACTIVE, SentenceNodeStatus.COMPLETED]


def test_backfill_reports_rather_than_writes_two_away_nodes_holding_one_soul(cn, eg, eu):
    """正常流程产生不了的形状(两条都没回归的外地调拨):不写,只报。"""
    from django.utils import timezone

    case = _legacy_case(cn, "两地同占")
    for target in (eg, eu):
        DispatchRecord.objects.create(
            source_tenant=cn, target_tenant=target, soul=case.soul, status=DispatchStatus.EXECUTED,
            executed_at=timezone.now(), reason="x", tenant=cn,
        )
        Disposition.objects.create(soul=case.soul, tenant=target)
    out = StringIO()
    call_command("backfill_sentence_plans", stdout=out)
    assert "skipped_conflict: 1" in out.getvalue()
    assert f"conflict (not written): soul {case.soul_id}" in out.getvalue()
    assert not SentencePlan.all_objects.filter(soul=case.soul).exists()
