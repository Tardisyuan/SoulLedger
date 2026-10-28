"""第四十三批:审批流程按域分段 —— 本域生成时选站、外域选站与门口等待、加减站、按默认流程走、提醒,
跨域审判并入流程(走完 = PASS 并把参与方的站追加进受刑计划;驳回 = FAIL;取消 = 跳过外域段),以及跨租户的可达范围。

每个域用一份存好的三站模板(初审 / 复核 / 终审,都指定 JUDGE 角色),这样每一站都有人能批。
用户都不是 ADMIN(ADMIN 不按租户划界,测不出跨租户的门)。
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.dispatch.models import JudgmentStatus, ParticipantRole
from apps.dispatch.services import CrossTenantJudgmentService
from apps.notifications.models import UserNotification
from apps.sentence_plan.models import SentencePlan
from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    NodeStatus,
    SegmentState,
    SkipKind,
    WorkflowSegment,
    WorkflowTemplate,
)
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

WF = "/api/v1/workflows/"
CJ = "/api/v1/dispatch/cross-tenant-judgments/"
TODO = "/api/v1/officer-app/todo/"
STATIONS = [("初审", "TRIAL"), ("复核", "EVALUATION"), ("终审", "FINAL")]


def _template(tenant, civilization):
    WorkflowTemplate.objects.create(
        name=f"{tenant.code} 默认流程", civilization=civilization, case_type="ROUTINE", is_active=True,
        tenant=tenant, nodes_json=[
            {"id": f"n{i}", "node_name": name, "node_type": kind, "court_code": tenant.code,
             "approver_type": "ROLE", "approver_role": "JUDGE", "node_order": i}
            for i, (name, kind) in enumerate(STATIONS, start=1)
        ],
    )


class World:
    pass


@pytest.fixture
def w():
    x = World()
    x.cn, x.eg, x.eu = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT"), plan.tenant("EU_HEAVEN_HELL")
    _template(x.cn, "CHINESE")
    _template(x.eg, "EGYPTIAN")
    _template(x.eu, "EUROPEAN")
    x.cn_judge = plan.officer("b43_cn_judge", "JUDGE", x.cn)
    x.cn_mod = plan.officer("b43_cn_mod", "MODERATOR", x.cn)
    x.eg_judge = plan.officer("b43_eg_judge", "JUDGE", x.eg)
    x.eg_mod = plan.officer("b43_eg_mod", "MODERATOR", x.eg)
    x.eu_judge = plan.officer("b43_eu_judge", "JUDGE", x.eu)
    return x


def merged(w, realms, *, skip_orders=(), convene=True):
    """原审判挂一场还没结束的跨域审判(每个参与域一个 CO_JUDGE 席,已填站),然后结案 → 强制生成审批流程。"""
    soul, case = plan.open_case(w.cn)
    cj = CrossTenantJudgmentService.create("联审", "d", w.cn, None)
    cj.judgment = case
    cj.save(update_fields=["judgment"])
    for order, realm in enumerate(realms, start=2):
        seat = CrossTenantJudgmentService.add_participant(cj, realm, None, ParticipantRole.CO_JUDGE, node_order=order)
        CrossTenantJudgmentService.submit_sentence(seat, plan.stop_realm(realm), 5, "", None)
    if convene:
        CrossTenantJudgmentService.activate(cj)
    case.conclude("FAILED", "", skip_node_orders=skip_orders)  # 地府判无罪不建原属节点(2026-10-29)
    return soul, case, cj, ApprovalWorkflow.objects.get(judgment=case)


def _seg(wf, order):
    return WorkflowSegment.objects.get(workflow=wf, order=order)


def _nodes(wf, order):
    return list(ApprovalNode.objects.filter(segment__workflow=wf, segment__order=order).order_by("node_order"))


def _decide(user, wf, verdict="PASSED", node=None):
    body = {"verdict": verdict, "notes": "x"}
    if node is not None:
        body["node_id"] = str(node.pk)
    return officer_client(user).post(f"{WF}{wf.pk}/approve_node/", body, format="json")


def _pick(user, wf, order, skip=(), version=None):
    return officer_client(user).post(
        f"{WF}{wf.pk}/segments/{order}/pick/",
        {"skip_node_ids": [str(n.pk) for n in skip], "version": version or _seg(wf, order).version}, format="json")


def _adjust(user, wf, *, restore=(), skip=(), version=None, reason="议罪并入终审"):
    seg = (restore or skip)[0].segment
    return officer_client(user).post(f"{WF}{wf.pk}/adjust/", {
        "restore_node_ids": [str(n.pk) for n in restore], "skip_node_ids": [str(n.pk) for n in skip],
        "reason": reason, "version": version or WorkflowSegment.objects.get(pk=seg.pk).version}, format="json")


def _run_local(w, wf):
    for _ in range(3):
        assert _decide(w.cn_judge, wf).status_code == 200


# ── 本域生成时选站 ───────────────────────────────────────────────────────


def test_the_judge_skips_stations_of_this_realm_when_the_flow_is_generated(w):
    soul, _case = plan.open_case(w.cn)
    response = officer_client(w.cn_mod).post(f"{WF}start/", {
        "soul": str(soul.pk), "case_type": "ROUTINE", "reason": "复核", "skip_node_orders": [2]}, format="json")
    assert response.status_code == 201, response.data
    wf = ApprovalWorkflow.objects.get(pk=response.data["id"])
    first, second, final = _nodes(wf, 1)
    assert (first.status, second.status, final.status) == (NodeStatus.PENDING, NodeStatus.SKIPPED, NodeStatus.PENDING)
    assert second.skip_kind == SkipKind.AT_PICK and second.skipped_by_id == w.cn_mod.pk
    assert final.is_required and not first.is_required and not second.is_required
    assert wf.current_node_id == first.pk
    # 跳过的那一站之后,流程从初审直接到终审。
    assert _decide(w.cn_judge, wf).status_code == 200
    wf.refresh_from_db()
    assert wf.current_node_id == final.pk


def test_the_final_review_cannot_be_skipped_at_generation(w):
    soul, _case = plan.open_case(w.cn)
    response = officer_client(w.cn_mod).post(f"{WF}start/", {
        "soul": str(soul.pk), "case_type": "ROUTINE", "reason": "复核", "skip_node_orders": [3]}, format="json")
    assert response.status_code == 400 and response.data["code"] == "final_required", response.data
    assert not ApprovalWorkflow.objects.filter(soul=soul).exists()


# ── 跨域审判并入 ─────────────────────────────────────────────────────────


def test_concluding_with_an_open_bench_generates_a_workflow_with_one_segment_per_realm(
        w, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        _soul, case, cj, wf = merged(w, [w.eg, w.eu])

    case.refresh_from_db()
    assert case.is_final
    segments = list(wf.segments.order_by("order"))
    assert [(s.order, s.tenant_id, s.state) for s in segments] == [
        (1, w.cn.pk, SegmentState.LOCAL_PICKED), (2, w.eg.pk, SegmentState.AWAITING_PICK),
        (3, w.eu.pk, SegmentState.AWAITING_PICK)]
    assert all(s.default_node_count == 3 for s in segments)
    # 各段的站按顺序接在后面,终审各自锁定;流程从本域第一站开始。
    orders = [n.node_order for s in segments for n in _nodes(wf, s.order)]
    assert orders == sorted(orders) and len(set(orders)) == 9
    assert [n.is_required for n in _nodes(wf, 2)] == [False, False, True]
    assert wf.current_node_id == _nodes(wf, 1)[0].pk
    assert cj.status == JudgmentStatus.ACTIVE
    # 每个外域同时收到「选站」待办;本域没有。
    told = {n.user.username for n in UserNotification.objects.filter(params__kind="workflow_pick_nodes")}
    assert told == {"b43_eg_judge", "b43_eu_judge"}


def test_pick_notifications_name_the_convener_by_its_civilization_per_language(
        w, django_capture_on_commit_callbacks):
    """`{{realm}}` 原来填租户展示名(库里是「Chinese Afterlife」),中文句子里露英文。现在带 `realm_civ`,按语言渲染。"""
    from apps.notifications import messages

    with django_capture_on_commit_callbacks(execute=True):
        merged(w, [w.eg])
    note = UserNotification.objects.get(params__kind="workflow_pick_nodes", user=w.eg_judge)
    assert note.params["realm_civ"] == "CHINESE"
    assert "中国发起" in note.message and w.cn.display_name not in note.message
    _title, en = messages.render("en", "workflow_pick_nodes", note.params)
    assert "from Chinese;" in en and w.cn.display_name not in en
    # 认不出文明时退回展示名。
    _title, odd = messages.render("zh-Hans", "workflow_pick_nodes", {**note.params, "realm_civ": "ATLANTEAN"})
    assert note.params["realm"] in odd


def test_the_flow_waits_at_an_unpicked_realm_and_goes_on_when_that_realm_picks(w):
    _soul, _case, _cj, wf = merged(w, [w.eg])
    _run_local(w, wf)

    wf.refresh_from_db()
    gate = _seg(wf, 2)
    assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS and wf.current_node_id is None
    assert gate.gate_reached_at is not None
    assert officer_client(w.cn_judge).get(f"{WF}{wf.pk}/").data["awaiting_segment"] == 2
    # 没选站的段里谁都不能决定:流程不站在那一站上。
    first, second, final = _nodes(wf, 2)
    refused = _decide(w.eg_judge, wf, node=first)
    assert refused.status_code == 409 and refused.data["code"] == "not_current", refused.data
    first.refresh_from_db()
    assert first.status == NodeStatus.PENDING

    picked = _pick(w.eg_judge, wf, 2, skip=[second])
    assert picked.status_code == 200, picked.data
    wf.refresh_from_db()
    second.refresh_from_db()
    assert wf.current_node_id == first.pk
    assert second.status == NodeStatus.SKIPPED and second.skip_kind == SkipKind.AT_PICK
    assert _seg(wf, 2).state == SegmentState.PICKED
    assert AuditLog.objects.filter(resource="workflow.pick", resource_id=str(wf.pk), tenant=w.eg).exists()


def test_a_pick_on_a_stale_version_is_refused_and_a_started_segment_cannot_be_repicked(w):
    _soul, _case, _cj, wf = merged(w, [w.eg])
    first, second, _final = _nodes(wf, 2)
    old = _seg(wf, 2).version
    assert _pick(w.eg_judge, wf, 2, skip=[second], version=old).status_code == 200
    stale = _pick(w.eg_mod, wf, 2, skip=[], version=old)
    assert stale.status_code == 409 and stale.data["code"] == "segment_changed", stale.data
    second.refresh_from_db()
    assert second.status == NodeStatus.SKIPPED  # the stale write changed nothing

    # 改选:开始之前可以。
    assert _pick(w.eg_mod, wf, 2, skip=[]).status_code == 200
    second.refresh_from_db()
    assert second.status == NodeStatus.PENDING
    # 开始之后不行。
    _run_local(w, wf)
    wf.refresh_from_db()
    assert wf.current_node_id == first.pk
    started = _pick(w.eg_judge, wf, 2, skip=[second])
    assert started.status_code == 409 and started.data["code"] == "segment_started", started.data


def test_the_final_review_of_a_realm_cannot_be_picked_away(w):
    _soul, _case, _cj, wf = merged(w, [w.eg])
    final = _nodes(wf, 2)[2]
    response = _pick(w.eg_judge, wf, 2, skip=[final])
    assert response.status_code == 400 and response.data["code"] == "final_required", response.data
    assert _seg(wf, 2).state == SegmentState.AWAITING_PICK


# ── 加减站 ───────────────────────────────────────────────────────────────


def test_adjust_changes_only_stations_after_the_current_one_and_keeps_the_final(w):
    _soul, _case, _cj, wf = merged(w, [w.eg], skip_orders=[2])
    first, second, final = _nodes(wf, 1)
    assert wf.current_node_id == first.pk

    locked = _adjust(w.cn_judge, wf, skip=[first])
    assert locked.status_code == 409 and locked.data["code"] == "node_locked", locked.data
    no_final = _adjust(w.cn_judge, wf, skip=[final])
    assert no_final.status_code == 400 and no_final.data["code"] == "final_required", no_final.data
    no_reason = _adjust(w.cn_judge, wf, restore=[second], reason="")
    assert no_reason.status_code == 400

    restored = _adjust(w.cn_judge, wf, restore=[second])
    assert restored.status_code == 200, restored.data
    second.refresh_from_db()
    assert second.status == NodeStatus.PENDING and second.skip_kind is None
    skipped = _adjust(w.cn_mod, wf, skip=[second])
    assert skipped.status_code == 200, skipped.data
    second.refresh_from_db()
    assert second.status == NodeStatus.SKIPPED and second.skip_kind == SkipKind.LATER
    assert second.skip_reason == "议罪并入终审"
    assert AuditLog.objects.filter(resource="workflow.adjust", resource_id=str(wf.pk)).count() == 2


def test_adjust_on_a_stale_version_is_refused(w):
    _soul, _case, _cj, wf = merged(w, [w.eg], skip_orders=[2])
    _first, second, _final = _nodes(wf, 1)
    old = _seg(wf, 1).version
    assert _adjust(w.cn_judge, wf, restore=[second], version=old).status_code == 200
    stale = _adjust(w.cn_mod, wf, skip=[second], version=old)
    assert stale.status_code == 409 and stale.data["code"] == "segment_changed", stale.data


def test_adjusting_a_realm_that_has_not_picked_is_refused(w):
    _soul, _case, _cj, wf = merged(w, [w.eg])
    second = _nodes(wf, 2)[1]
    response = _adjust(w.eg_mod, wf, skip=[second])
    assert response.status_code == 409 and response.data["code"] == "not_picked", response.data


# ── 按默认流程走 / 提醒 ───────────────────────────────────────────────────


def test_the_default_flow_waits_three_days_while_the_realm_has_a_picker(w):
    _soul, _case, _cj, wf = merged(w, [w.eg])
    _run_local(w, wf)
    early = officer_client(w.cn_mod).post(f"{WF}{wf.pk}/segments/2/use-default/", {"reason": "久等"}, format="json")
    assert early.status_code == 409 and early.data["code"] == "too_early", early.data
    not_convener = officer_client(w.eg_mod).post(f"{WF}{wf.pk}/segments/2/use-default/", {"reason": "x"},
                                                 format="json")
    assert not_convener.status_code in (403, 404)

    WorkflowSegment.objects.filter(workflow=wf, order=2).update(gate_reached_at=timezone.now() - timedelta(days=4))
    done = officer_client(w.cn_mod).post(f"{WF}{wf.pk}/segments/2/use-default/", {"reason": "久等"}, format="json")
    assert done.status_code == 200, done.data
    wf.refresh_from_db()
    assert _seg(wf, 2).state == SegmentState.PICKED
    assert all(n.status == NodeStatus.PENDING for n in _nodes(wf, 2))
    assert wf.current_node_id == _nodes(wf, 2)[0].pk
    assert AuditLog.objects.filter(resource="workflow.use_default", resource_id=str(wf.pk), tenant=w.cn).exists()


def test_the_default_flow_is_available_at_once_when_the_realm_has_no_picker(w):
    w.eu_judge.is_active = False  # the realm's only judge has left: nobody there can pick
    w.eu_judge.save(update_fields=["is_active"])
    _soul, _case, _cj, wf = merged(w, [w.eu])
    response = officer_client(w.cn_mod).post(f"{WF}{wf.pk}/segments/2/use-default/", {"reason": "该域无人"},
                                             format="json")
    assert response.status_code == 200, response.data
    assert _seg(wf, 2).state == SegmentState.PICKED


def test_a_reminder_goes_once_an_hour(w):
    _soul, _case, _cj, wf = merged(w, [w.eg])
    first = officer_client(w.cn_judge).post(f"{WF}{wf.pk}/segments/2/remind/")
    assert first.status_code == 200, first.data
    again = officer_client(w.cn_judge).post(f"{WF}{wf.pk}/segments/2/remind/")
    assert again.status_code == 429 and again.data["code"] == "remind_too_soon" and again.data["retry_after"] > 0


def test_the_daily_job_reminds_the_realm_and_tells_the_convener_after_three_days(w, django_capture_on_commit_callbacks):
    from apps.workflow import segments

    _soul, _case, _cj, wf = merged(w, [w.eg])
    _run_local(w, wf)
    long_ago = timezone.now() - timedelta(days=4)
    WorkflowSegment.objects.filter(workflow=wf, order=2).update(gate_reached_at=long_ago, last_reminded_at=long_ago)
    with django_capture_on_commit_callbacks(execute=True):
        assert segments.remind_due(w.cn) == {"reminded": 1, "overdue": 1}
        assert segments.remind_due(w.cn) == {"reminded": 0, "overdue": 0}  # same day, same segment: nothing more
    waiting = UserNotification.objects.filter(params__kind="workflow_pick_waiting")
    assert {n.user.username for n in waiting} == {"b43_eg_judge"}
    overdue = UserNotification.objects.filter(params__kind="workflow_pick_overdue")
    assert {n.user.username for n in overdue} == {"b43_cn_mod"}


# ── 跨域审判的两头 ───────────────────────────────────────────────────────


def test_completion_concludes_the_bench_pass_and_appends_its_stops(w):
    soul, _case, cj, wf = merged(w, [w.eg])
    _run_local(w, wf)
    assert _pick(w.eg_judge, wf, 2).status_code == 200
    for _ in range(3):
        assert _decide(w.eg_judge, wf).status_code == 200

    wf.refresh_from_db()
    cj.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert (cj.status, cj.conclusion_type) == (JudgmentStatus.CONCLUDED, "PASS")
    p = SentencePlan.all_objects.get(soul=soul)
    assert [(n.order, n.tenant_code, n.is_home) for n in p.nodes.order_by("order")] == [
        (1, "CN_DIYU", True), (2, "EG_DUAT", False)]


def test_rejection_concludes_the_bench_fail_and_adds_no_stops(w):
    soul, _case, cj, wf = merged(w, [w.eg])
    _run_local(w, wf)
    assert _pick(w.eg_judge, wf, 2).status_code == 200
    assert _decide(w.eg_judge, wf, verdict="FAILED").status_code == 200

    wf.refresh_from_db()
    cj.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert (cj.status, cj.conclusion_type) == (JudgmentStatus.CONCLUDED, "FAIL")
    assert [n.order for n in SentencePlan.all_objects.get(soul=soul).nodes.all()] == [1]


def test_a_bench_that_never_convened_is_convened_and_concluded_by_the_flow(w):
    _soul, _case, cj, wf = merged(w, [w.eg], convene=False)
    _run_local(w, wf)
    assert _pick(w.eg_judge, wf, 2).status_code == 200
    for _ in range(3):
        assert _decide(w.eg_judge, wf).status_code == 200
    cj.refresh_from_db()
    assert (cj.status, cj.conclusion_type) == (JudgmentStatus.CONCLUDED, "PASS")


def test_cancelling_the_bench_skips_the_unstarted_realms_and_the_flow_ends_after_this_realm(
        w, django_capture_on_commit_callbacks):
    _soul, _case, cj, wf = merged(w, [w.eg])
    with django_capture_on_commit_callbacks(execute=True):
        response = officer_client(w.cn_mod).post(f"{CJ}{cj.pk}/cancel/", {"reason": "原审判撤回"}, format="json")
    assert response.status_code == 200, response.data
    assert _seg(wf, 2).state == SegmentState.SKIPPED
    assert {(n.status, n.skip_kind) for n in _nodes(wf, 2)} == {(NodeStatus.SKIPPED, SkipKind.CANCELLED)}
    withdrawn = UserNotification.objects.filter(params__kind="workflow_pick_withdrawn")
    assert {n.user.username for n in withdrawn} == {"b43_eg_judge"}

    wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS  # this realm still runs
    _run_local(w, wf)
    wf.refresh_from_db()
    cj.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert cj.status == JudgmentStatus.CANCELLED  # not concluded by the flow


def test_cancelling_inside_a_realm_skips_its_rest_including_the_final_and_ends_the_flow(w):
    _soul, _case, cj, wf = merged(w, [w.eg])
    _run_local(w, wf)
    assert _pick(w.eg_judge, wf, 2).status_code == 200
    assert _decide(w.eg_judge, wf).status_code == 200
    first, second, final = _nodes(wf, 2)

    response = officer_client(w.cn_mod).post(f"{CJ}{cj.pk}/cancel/", {"reason": "撤回"}, format="json")
    assert response.status_code == 200, response.data
    wf.refresh_from_db()
    for n in (first, second, final):
        n.refresh_from_db()
    assert first.status == NodeStatus.APPROVED
    assert (second.status, second.skip_kind) == (NodeStatus.SKIPPED, SkipKind.CANCELLED)
    assert (final.status, final.skip_kind) == (NodeStatus.SKIPPED, SkipKind.CANCELLED)
    assert (wf.status, wf.end_reason, wf.current_node_id) == (ApprovalWorkflowStatus.COMPLETED, "CROSS_CANCELLED", None)


def test_the_realm_order_is_locked_once_the_workflow_exists(w):
    _soul, _case, cj, _wf = merged(w, [w.eg], convene=False)
    seat = cj.participants.get()
    response = officer_client(w.cn_judge).post(f"{CJ}{cj.pk}/order/", {"participants": [str(seat.pk)]},
                                               format="json")
    assert response.status_code == 409 and response.data["code"] == "order_locked", response.data
    detail = officer_client(w.cn_judge).get(f"{CJ}{cj.pk}/").data
    assert detail["order_locked"] is True
    assert detail["workflow"]["pending_realms"] == [w.eg.display_name]


# ── 没有分段的流程 ───────────────────────────────────────────────────────


def test_a_workflow_without_segments_runs_exactly_as_before(w):
    soul, _case = plan.open_case(w.cn)
    wf = ApprovalWorkflow.objects.create(soul=soul, workflow_name="旧流程", case_type="ROUTINE",
                                         status=ApprovalWorkflowStatus.IN_PROGRESS, tenant=w.cn)
    a, b = (ApprovalNode.objects.create(workflow=wf, node_name=name, node_order=i, approver_type="ROLE",
                                        approver_role="JUDGE", status=NodeStatus.PENDING)
            for i, name in ((1, "甲"), (2, "乙")))
    wf.current_node = a
    wf.save(update_fields=["current_node"])
    assert _decide(w.cn_judge, wf).status_code == 200
    wf.refresh_from_db()
    assert wf.current_node_id == b.pk
    detail = _decide(w.cn_judge, wf)
    assert detail.status_code == 200
    assert detail.data["segments"] == [] and detail.data["awaiting_segment"] is None
    wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.COMPLETED


# ── 跨租户 ───────────────────────────────────────────────────────────────


def test_a_realm_outside_the_bench_gets_404(w):
    _soul, _case, _cj, wf = merged(w, [w.eg])
    outsider = officer_client(w.eu_judge)
    assert outsider.get(f"{WF}{wf.pk}/").status_code == 404
    assert outsider.post(f"{WF}{wf.pk}/segments/2/pick/", {"skip_node_ids": [], "version": 1},
                         format="json").status_code == 404
    assert outsider.post(f"{WF}{wf.pk}/approve_node/", {"verdict": "PASSED"}, format="json").status_code == 404


def test_a_participating_realm_reads_the_flow_but_only_through_the_allowed_actions(w):
    _soul, _case, _cj, wf = merged(w, [w.eg])
    client = officer_client(w.eg_judge)
    assert client.get(f"{WF}{wf.pk}/").status_code == 200
    assert client.post(f"{WF}{wf.pk}/advance/").status_code == 404
    assert str(wf.pk) not in {row["id"] for row in client.get(WF).data["results"]}  # not in the list either


def test_a_participating_realm_cannot_act_on_another_realms_segment(w):
    _soul, _case, _cj, wf = merged(w, [w.eg, w.eu])
    local_first, local_second, _ = _nodes(wf, 1)
    # 本域那一站:外域的判官不是它的审批人(同角色也不行)。
    not_mine = _decide(w.eg_judge, wf, node=local_first)
    assert not_mine.status_code == 403, not_mine.data
    local_first.refresh_from_db()
    assert local_first.status == NodeStatus.PENDING
    # 本域的段:不能加减。
    adjust = _adjust(w.eg_mod, wf, skip=[local_second])
    assert adjust.status_code == 403 and adjust.data["code"] == "not_allowed", adjust.data
    # 第三个域的段:不能选。
    pick = _pick(w.eg_judge, wf, 3)
    assert pick.status_code == 403 and pick.data["code"] == "not_allowed", pick.data
    # 本域的段:不是外域段,不经选站。
    own = _pick(w.eg_judge, wf, 1)
    assert own.status_code == 400 and own.data["code"] == "not_foreign", own.data


def test_another_realm_sees_the_stations_but_not_the_people(w):
    _soul, _case, _cj, wf = merged(w, [w.eg])
    assert _decide(w.cn_judge, wf).status_code == 200
    decided = _nodes(wf, 1)[0]

    theirs = officer_client(w.eg_judge).get(f"{WF}{wf.pk}/").data
    node = next(n for n in theirs["nodes"] if n["id"] == str(decided.pk))
    assert node["status"] == NodeStatus.APPROVED and node["node_name"] == "初审"
    assert (node["approver"], node["approver_username"], node["approver_display_name"]) == (None, None, None)
    assert node["segment_order"] == 1 and node["order_in_segment"] == 1

    ours = officer_client(w.cn_judge).get(f"{WF}{wf.pk}/").data
    assert next(n for n in ours["nodes"] if n["id"] == str(decided.pk))["approver"] == w.cn_judge.pk


def test_the_pick_task_lands_in_the_realms_todo(w):
    _soul, _case, _cj, wf = merged(w, [w.eg])
    group = officer_client(w.eg_judge).get(TODO).data["pick_nodes"]
    assert group["count"] == 1
    item = group["items"][0]
    assert item["target"] == {"kind": "pick", "id": str(wf.pk)}
    assert (item["segment_order"], item["go"], item["total"], item["realm"]) == (2, 3, 3, "CN_DIYU")
    assert item["gate_days"] is None and item["stations_ahead"] == 3
    # 发起殿的名字由客户端按 `realm` 读冥界名,接上审判所在的殿;`hall`(租户展示名,库里的英文)只作退路。
    assert item["court"] == "第一殿"
    # 本域没有选站待办;别的域也没有。
    assert officer_client(w.cn_judge).get(TODO).data["pick_nodes"]["count"] == 0
    assert officer_client(w.eu_judge).get(TODO).data["pick_nodes"]["count"] == 0
    # 选了之后就不在了。
    assert _pick(w.eg_judge, wf, 2).status_code == 200
    assert officer_client(w.eg_judge).get(TODO).data["pick_nodes"]["count"] == 0


# ── W-1 选站列表:生成之前(`GET /workflows/flow-preview/`)───────────────────
#
# 列出的站序必须就是 `skip_node_orders` 认的那些,「必须走」必须就是生成之后 `is_required` 的那一站,外域段的顺序
# 与 `add_foreign` 建出来的一样 —— 都拿真生成的流程对一遍,而不是只看预览自己。

PREVIEW = f"{WF}flow-preview/"


def _open_cross(w, realms):
    soul, case = plan.open_case(w.cn)
    cj = CrossTenantJudgmentService.create("联审", "d", w.cn, None)
    cj.judgment = case
    cj.save(update_fields=["judgment"])
    for order, realm in enumerate(realms, start=2):
        seat = CrossTenantJudgmentService.add_participant(cj, realm, None, ParticipantRole.CO_JUDGE, node_order=order)
        CrossTenantJudgmentService.submit_sentence(seat, plan.stop_realm(realm), 5, "", None)
    CrossTenantJudgmentService.activate(cj)
    return soul, case


def test_the_preview_lists_what_the_conclusion_then_builds(w):
    _soul, case = _open_cross(w, [w.eu, w.eg])
    res = officer_client(w.cn_judge).get(PREVIEW, {"judgment": str(case.pk)})
    assert res.status_code == 200, res.content
    body = res.json()
    assert [s["node_order"] for s in body["stations"]] == [1, 2, 3]
    assert [s["is_required"] for s in body["stations"]] == [False, False, True]
    assert [(f["order"], f["tenant_code"], f["default_node_count"]) for f in body["foreign"]] == [
        (2, w.eu.code, 3), (3, w.eg.code, 3)]

    case.conclude("FAILED", "", skip_node_orders=[1])
    wf = ApprovalWorkflow.objects.get(judgment=case)
    local = ApprovalNode.objects.filter(segment__workflow=wf, segment__order=1).order_by("node_order")
    assert [n.is_required for n in local] == [False, False, True]
    assert [(s.order, s.tenant.code) for s in WorkflowSegment.objects.filter(workflow=wf, order__gt=1)
            .order_by("order")] == [(2, w.eu.code), (3, w.eg.code)]


def test_a_manual_start_previews_without_foreign_realms(w):
    soul, _case = plan.open_case(w.cn)
    res = officer_client(w.cn_judge).get(PREVIEW, {"soul": str(soul.pk), "case_type": "ROUTINE"})
    assert res.status_code == 200, res.content
    assert len(res.json()["stations"]) == 3
    assert res.json()["foreign"] == []


def test_another_halls_case_is_not_found(w):
    soul, case = _open_cross(w, [w.eg])
    assert officer_client(w.eg_judge).get(PREVIEW, {"judgment": str(case.pk)}).status_code == 404
    assert officer_client(w.eg_judge).get(PREVIEW, {"soul": str(soul.pk), "case_type": "ROUTINE"}).status_code == 404


def test_a_manual_start_needs_a_case_type_or_template(w):
    soul, _case = plan.open_case(w.cn)
    res = officer_client(w.cn_judge).get(PREVIEW, {"soul": str(soul.pk)})
    assert res.status_code == 400
    assert res.json()["code"] == "case_type_required"


# ── 驳回时会转到的站不能跳过(2026-10-19)───────────────────────────────────
#
# 初审驳回转到合议(`on_fail`,同希腊的分区审判 → Minos)。只要初审还要走,合议就锁着,像终审一样;
# 初审一并跳过时合议才能跳过。加减站加回初审而合议还跳过着:拒(不顺手加回合议)。

JUMPY = [("初审", "TRIAL", "n3"), ("复核", "EVALUATION", None), ("合议", "EVALUATION", None), ("终审", "FINAL", None)]


def _jumpy(tenant):
    WorkflowTemplate.objects.filter(tenant=tenant).update(nodes_json=[
        {"id": f"n{i}", "node_name": name, "node_type": kind, "court_code": tenant.code, "approver_type": "ROLE",
         "approver_role": "JUDGE", "node_order": i, **({"on_fail": jump} if jump else {})}
        for i, (name, kind, jump) in enumerate(JUMPY, start=1)
    ])


def _start(w, skip_orders):
    soul, _case = plan.open_case(w.cn)
    return soul, officer_client(w.cn_mod).post(f"{WF}start/", {
        "soul": str(soul.pk), "case_type": "ROUTINE", "reason": "复核", "skip_node_orders": skip_orders}, format="json")


def test_a_jump_target_cannot_be_skipped_at_generation_while_its_source_runs(w):
    _jumpy(w.cn)
    soul, response = _start(w, [3])
    assert response.status_code == 400 and response.data["code"] == "jump_target_required", response.data
    assert [(t["node_order"], t["node_name"], t["sources"]) for t in response.data["jump_targets"]] == [
        (3, "合议", ["初审"])]
    assert not ApprovalWorkflow.objects.filter(soul=soul).exists()


def test_skipping_the_source_with_its_jump_target_is_allowed(w):
    _jumpy(w.cn)
    _soul, response = _start(w, [1, 3])
    assert response.status_code == 201, response.data
    nodes = _nodes(ApprovalWorkflow.objects.get(pk=response.data["id"]), 1)
    assert [n.status for n in nodes] == [NodeStatus.SKIPPED, NodeStatus.PENDING, NodeStatus.SKIPPED, NodeStatus.PENDING]


def test_a_foreign_pick_cannot_skip_a_jump_target_while_its_source_runs(w):
    _jumpy(w.eg)
    _soul, _case, _cj, wf = merged(w, [w.eg])
    first, _second, third, _final = _nodes(wf, 2)
    refused = _pick(w.eg_judge, wf, 2, skip=[third])
    assert refused.status_code == 400 and refused.data["code"] == "jump_target_required", refused.data
    assert refused.data["jump_targets"][0]["sources"] == ["初审"]
    assert _seg(wf, 2).state == SegmentState.AWAITING_PICK
    third.refresh_from_db()
    assert third.status == NodeStatus.PENDING

    assert _pick(w.eg_judge, wf, 2, skip=[first, third]).status_code == 200
    third.refresh_from_db()
    assert third.status == NodeStatus.SKIPPED


def test_adjust_refuses_to_skip_a_jump_target_or_restore_its_source_alone(w):
    _jumpy(w.eg)
    _soul, _case, _cj, wf = merged(w, [w.eg])
    first, _second, third, _final = _nodes(wf, 2)
    assert _pick(w.eg_judge, wf, 2, skip=[first, third]).status_code == 200

    alone = _adjust(w.eg_mod, wf, restore=[first])
    assert alone.status_code == 400 and alone.data["code"] == "jump_target_required", alone.data
    first.refresh_from_db()
    assert first.status == NodeStatus.SKIPPED  # nothing written

    assert _adjust(w.eg_mod, wf, restore=[first, third]).status_code == 200
    target = _adjust(w.eg_mod, wf, skip=[third])
    assert target.status_code == 400 and target.data["code"] == "jump_target_required", target.data
    assert _adjust(w.eg_mod, wf, skip=[first, third]).status_code == 200


def test_the_preview_and_the_detail_name_the_stations_that_jump_to_a_target(w):
    _jumpy(w.cn)
    soul, _case = plan.open_case(w.cn)
    preview = officer_client(w.cn_judge).get(PREVIEW, {"soul": str(soul.pk), "case_type": "ROUTINE"}).json()
    assert [s["jump_target_of"] for s in preview["stations"]] == [
        [], [], [{"key": "1", "node_name": "初审", "via": "on_fail"}], []]

    _soul, response = _start(w, [])
    wf = ApprovalWorkflow.objects.get(pk=response.data["id"])
    first = _nodes(wf, 1)[0]
    detail = officer_client(w.cn_judge).get(f"{WF}{wf.pk}/").data
    rows = {n["node_order"]: n["jump_target_of"] for n in detail["nodes"]}
    assert rows == {1: [], 2: [], 3: [{"key": str(first.pk), "node_name": "初审", "via": "on_fail"}], 4: []}


# ── 没有可选的站(Design 第四十五批)────────────────────────────────────────
#
# 每一站都锁着(终审、自动节点、来源是自动节点的分支目标)时没有什么可选:本域的预览说 `nothing_to_pick`,
# 外域段建好就是 PICKED —— 不发选站待办,流程也不在它门口停。形状同希腊常规流程(按来处分流 → 一位判官 → 结束)。

def _routed(tenant):
    """n1 通知按来处分流:EUROPE → n2;其余 → n3(终审)。n2、n3 通过 → n4 结束;n2 驳回 → n3。"""
    base = {"court_code": tenant.code, "approver_type": "ROLE", "approver_role": "JUDGE"}
    WorkflowTemplate.objects.filter(tenant=tenant).update(nodes_json=[
        {**base, "id": "n1", "node_name": "分流", "node_type": "TRIAL", "node_order": 1, "kind": "NOTIFY",
         "approver_type": "SYSTEM", "on_pass": "n3", "branches": [
             {"id": "eu", "when": [{"fact": "origin_region", "op": "in", "value": ["EUROPE"]}], "target": "n2"}]},
        {**base, "id": "n2", "node_name": "分区", "node_type": "TRIAL", "node_order": 2, "on_pass": "n4",
         "on_fail": "n3"},
        {**base, "id": "n3", "node_name": "终裁", "node_type": "FINAL", "node_order": 3, "on_pass": "n4"},
        {**base, "id": "n4", "node_name": "结束", "node_type": "FINAL", "node_order": 4, "kind": "END",
         "approver_type": "SYSTEM"},
    ])


def test_a_local_flow_with_every_station_locked_previews_nothing_to_pick(w):
    soul, _case = plan.open_case(w.cn)
    plain = officer_client(w.cn_judge).get(PREVIEW, {"soul": str(soul.pk), "case_type": "ROUTINE"}).json()
    assert plain["nothing_to_pick"] is False  # absence: an ordinary flow still has stations to pick

    _routed(w.cn)
    preview = officer_client(w.cn_judge).get(PREVIEW, {"soul": str(soul.pk), "case_type": "ROUTINE"}).json()
    assert [s["node_order"] for s in preview["stations"]] == [2, 3]  # no routing step, no 结束
    assert preview["nothing_to_pick"] is True
    # Generation takes no skips: the branch target and the routing step are refused; none at all is fine.
    for orders, code in (([2], "jump_target_required"), ([1], "final_required")):
        _soul, refused = _start(w, orders)
        assert refused.status_code == 400 and refused.data["code"] == code, refused.data
    _soul, started = _start(w, [])
    assert started.status_code == 201, started.data
    wf = ApprovalWorkflow.objects.get(pk=started.data["id"])
    assert _seg(wf, 1).state == SegmentState.LOCAL_PICKED
    assert wf.current_node.node_name == "终裁"  # region 不详 → the default


def test_a_foreign_realm_with_nothing_to_pick_is_picked_from_the_start_and_never_gated(
        w, django_capture_on_commit_callbacks):
    _routed(w.eg)
    with django_capture_on_commit_callbacks(execute=True):
        _soul, _case, _cj, wf = merged(w, [w.eg, w.eu])
    seg = _seg(wf, 2)
    assert (seg.state, seg.picked_by_id, seg.picked_at) == (SegmentState.PICKED, None, None)
    assert _seg(wf, 3).state == SegmentState.AWAITING_PICK  # an ordinary realm still picks
    told = {n.user.username for n in UserNotification.objects.filter(params__kind="workflow_pick_nodes")}
    assert told == {"b43_eu_judge"}
    assert officer_client(w.eg_judge).get(TODO).data["pick_nodes"]["count"] == 0

    _run_local(w, wf)
    wf.refresh_from_db()
    # Not stopped at its gate: the routing step ran and the flow stands on that realm's final.
    route, _division, final, _end = _nodes(wf, 2)
    assert wf.current_node_id == final.pk
    assert ApprovalNode.objects.get(pk=route.pk).status == NodeStatus.TRAVERSED
    assert _seg(wf, 2).gate_reached_at is None


# ── 锁住的理由分两种(Design 第四十五批 W-6)────────────────────────────────
#
# 来源经条件分支转来(按出身地域分流的去处)写 `via: "branch"`,驳回转来写 `via: "on_fail"`;客户端据此写
# 「分流的去处」或「X驳回时会转到这里」。预览(按站序)与详情(按节点 id)两处一样。

def test_jump_sources_say_whether_they_come_by_a_branch_or_by_a_rejection(w):
    _routed(w.cn)
    soul, _case = plan.open_case(w.cn)
    preview = officer_client(w.cn_judge).get(PREVIEW, {"soul": str(soul.pk), "case_type": "ROUTINE"}).json()
    assert {s["node_order"]: s["jump_target_of"] for s in preview["stations"]} == {
        2: [{"key": "1", "node_name": "分流", "via": "branch"}],
        3: [{"key": "2", "node_name": "分区", "via": "on_fail"}],
    }

    _soul, started = _start(w, [])
    wf = ApprovalWorkflow.objects.get(pk=started.data["id"])
    route, division, _final, _end = _nodes(wf, 1)
    detail = officer_client(w.cn_judge).get(f"{WF}{wf.pk}/").data
    rows = {n["node_order"]: n["jump_target_of"] for n in detail["nodes"]}
    assert rows[2] == [{"key": str(route.pk), "node_name": "分流", "via": "branch"}]
    assert rows[3] == [{"key": str(division.pk), "node_name": "分区", "via": "on_fail"}]
    assert rows[1] == []  # absence: the routing step is nobody's target


def test_the_routing_step_is_not_counted_and_a_locked_foreign_realm_says_so(w):
    _routed(w.eg)
    _soul, case = _open_cross(w, [w.eg, w.eu])
    body = officer_client(w.cn_judge).get(PREVIEW, {"judgment": str(case.pk)}).json()
    assert [(f["tenant_code"], f["default_node_count"], f["nothing_to_pick"]) for f in body["foreign"]] == [
        (w.eg.code, 2, True), (w.eu.code, 3, False)]
