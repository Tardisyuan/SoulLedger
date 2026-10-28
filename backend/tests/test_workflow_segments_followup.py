"""第四十三批之后用户定的条目(2026-10-18):

1. 审批流程还在走时,召集人不能手动结束跨域审判(409 `workflow_running`);取消照旧可以。流程自己结束它照旧。
2. 流程还在走时可以入席:新域按自己的默认流程接在最后一段之后、收到选站待办;前一段走完停在它门口。
   重排、排进中间、流程结束之后再入席:409 `order_locked`。
(原第 3 条「跨域审判 PASS 时计划已刑满就重开」2026-10-29 删除:原审要等审批流程走完才执行,并入流程的联审
先于计划结束,那个情形不再出现。)

夹具与 tests/test_workflow_segments.py 相同(每个域一份三站模板,用户都不是 ADMIN)。
"""
import pytest

from apps.dispatch.models import CrossTenantJudgment, CrossTenantJudgmentParticipant, JudgmentStatus, ParticipantRole
from apps.dispatch.services import CrossTenantJudgmentService, OrderLockedError
from apps.notifications.models import UserNotification
from apps.sentence_plan.models import SentencePlan
from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus, SegmentState
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client
from tests.test_workflow_segments import CJ, World, _decide, _nodes, _pick, _run_local, _seg, _template, merged

pytestmark = pytest.mark.django_db


@pytest.fixture
def w():
    """Same world as tests/test_workflow_segments.py::w."""
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


def _cj(cj):
    return CrossTenantJudgment.all_objects.get(pk=cj.pk)


def _seat(cj, realm, node_order):
    seat = CrossTenantJudgmentService.add_participant(_cj(cj), realm, None, ParticipantRole.CO_JUDGE,
                                                      node_order=node_order)
    CrossTenantJudgmentService.submit_sentence(seat, plan.stop_realm(realm), 5, "", None)
    return seat


def _run_realm(user, wf, order):
    assert _pick(user, wf, order).status_code == 200
    for _ in range(3):
        assert _decide(user, wf).status_code == 200


# ── 1. 流程在走时不能手动结束 ─────────────────────────────────────────────


def test_the_convener_cannot_end_the_bench_by_hand_while_the_flow_runs_but_can_cancel_it(w):
    _soul, _case, cj, wf = merged(w, [w.eg])
    client = officer_client(w.cn_mod)

    refused = client.post(f"{CJ}{cj.pk}/conclude/", {"conclusion_type": "PASS", "note": "提前结束"}, format="json")
    assert refused.status_code == 409 and refused.data["code"] == "workflow_running", refused.data
    assert _cj(cj).status == JudgmentStatus.ACTIVE
    with pytest.raises(ValueError):
        CrossTenantJudgmentService.conclude(_cj(cj), "FAIL", w.cn_mod)  # the service refuses too, not just the view
    assert _cj(cj).status == JudgmentStatus.ACTIVE

    cancelled = client.post(f"{CJ}{cj.pk}/cancel/", {"reason": "原审判撤回"}, format="json")
    assert cancelled.status_code == 200, cancelled.data
    assert _cj(cj).status == JudgmentStatus.CANCELLED


def test_the_flow_still_ends_the_bench_itself(w):
    _soul, _case, cj, wf = merged(w, [w.eg])
    _run_local(w, wf)
    _run_realm(w.eg_judge, wf, 2)
    assert (_cj(cj).status, _cj(cj).conclusion_type) == (JudgmentStatus.CONCLUDED, "PASS")


def test_once_the_flow_has_ended_the_convener_concludes_as_before(w):
    _soul, _case, cj, wf = merged(w, [w.eg])
    ApprovalWorkflow.objects.filter(pk=wf.pk).update(status=ApprovalWorkflowStatus.REJECTED)  # ended, bench untouched
    response = officer_client(w.cn_mod).post(f"{CJ}{cj.pk}/conclude/", {"conclusion_type": "FAIL", "note": "x"},
                                             format="json")
    assert response.status_code == 200, response.data
    assert (_cj(cj).status, _cj(cj).conclusion_type) == (JudgmentStatus.CONCLUDED, "FAIL")


def test_a_bench_with_no_workflow_concludes_as_before(w):
    cj = CrossTenantJudgmentService.create("会审", "d", w.cn, None)
    CrossTenantJudgmentService.add_participant(cj, w.eg, None, ParticipantRole.ADVISOR)
    CrossTenantJudgmentService.activate(_cj(cj))
    CrossTenantJudgmentService.conclude(_cj(cj), "PASS", w.cn_mod)
    assert _cj(cj).status == JudgmentStatus.CONCLUDED


# ── 2. 流程在走时入席 ────────────────────────────────────────────────────


def test_a_realm_seated_mid_flow_is_appended_last_and_the_flow_stops_at_its_gate(
        w, django_capture_on_commit_callbacks):
    soul, _case, cj, wf = merged(w, [w.eg])
    _run_local(w, wf)
    assert _pick(w.eg_judge, wf, 2).status_code == 200
    assert _decide(w.eg_judge, wf).status_code == 200
    assert _decide(w.eg_judge, wf).status_code == 200
    eg_final = _nodes(wf, 2)[2]
    wf.refresh_from_db()
    assert wf.current_node_id == eg_final.pk  # standing on the last stop of the last segment

    with django_capture_on_commit_callbacks(execute=True):
        _seat(cj, w.eu, 3)  # the bench is ACTIVE: still accepted while the flow runs
    appended = _seg(wf, 3)
    assert (appended.tenant_id, appended.state) == (w.eu.pk, SegmentState.AWAITING_PICK)
    assert max(n.node_order for n in _nodes(wf, 2)) < min(n.node_order for n in _nodes(wf, 3))
    assert [n.is_required for n in _nodes(wf, 3)] == [False, False, True]
    told = {n.user.username for n in UserNotification.objects.filter(params__kind="workflow_pick_nodes")}
    assert told == {"b43_eu_judge"}  # only the new realm; the realms already told are not told again

    # Passing the old last stop does not finish the flow: it waits at the new realm's gate.
    assert _decide(w.eg_judge, wf).status_code == 200
    wf.refresh_from_db()
    assert (wf.status, wf.current_node_id) == (ApprovalWorkflowStatus.IN_PROGRESS, None)
    assert _seg(wf, 3).gate_reached_at is not None
    assert _cj(cj).status == JudgmentStatus.ACTIVE
    assert all(n.status == "PENDING" for n in _nodes(wf, 3))

    _run_realm(w.eu_judge, wf, 3)
    wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert (_cj(cj).status, _cj(cj).conclusion_type) == (JudgmentStatus.CONCLUDED, "PASS")
    p = SentencePlan.all_objects.get(soul=soul)
    assert [(n.order, n.tenant_code) for n in p.nodes.order_by("order")] == [
        (1, "CN_DIYU"), (2, "EG_DUAT"), (3, "EU_HEAVEN_HELL")]


def test_a_realm_seated_while_the_flow_is_in_the_local_segment_still_waits_its_turn(w):
    _soul, _case, cj, wf = merged(w, [w.eg])
    _seat(cj, w.eu, 3)
    assert [s.order for s in wf.segments.order_by("order")] == [1, 2, 3]
    _run_local(w, wf)
    wf.refresh_from_db()
    assert wf.current_node_id is None and _seg(wf, 2).gate_reached_at is not None  # EG first, then EU
    assert _seg(wf, 3).gate_reached_at is None


def test_reordering_or_seating_into_the_middle_is_refused_while_the_flow_runs(w):
    _soul, _case, cj, wf = merged(w, [w.eg], convene=False)  # PROPOSED: the order endpoint's own status rule passes
    eg_seat = cj.participants.get()
    reorder = officer_client(w.cn_judge).post(f"{CJ}{cj.pk}/order/", {"participants": [str(eg_seat.pk)]},
                                              format="json")
    assert reorder.status_code == 409 and reorder.data["code"] == "order_locked", reorder.data

    CrossTenantJudgmentParticipant.all_objects.filter(pk=eg_seat.pk).update(node_order=4)
    with pytest.raises(OrderLockedError):
        CrossTenantJudgmentService.add_participant(_cj(cj), w.eu, None, ParticipantRole.CO_JUDGE, node_order=3)
    assert not cj.participants.filter(participant_tenant=w.eu).exists()
    assert not wf.segments.filter(tenant=w.eu).exists()


def test_seating_after_the_flow_has_ended_is_refused(w):
    _soul, _case, cj, wf = merged(w, [w.eg], convene=False)
    ApprovalWorkflow.objects.filter(pk=wf.pk).update(status=ApprovalWorkflowStatus.COMPLETED)
    nodes_before = ApprovalNode.objects.filter(workflow=wf).count()
    with pytest.raises(OrderLockedError):
        CrossTenantJudgmentService.add_participant(_cj(cj), w.eu, None, ParticipantRole.CO_JUDGE, node_order=3)
    assert not cj.participants.filter(participant_tenant=w.eu).exists()
    assert wf.segments.count() == 2 and ApprovalNode.objects.filter(workflow=wf).count() == nodes_before
