"""退回规则(2026-10-19): returns counted and confined per segment, skipped targets, the Greek on_fail
jump, and the formal templates `seed_workflow_templates` writes.

The engine tests build the workflow by hand — two segments of plain nodes — because what they pin is
`ApprovalWorkflow.complete_node`'s routing, not how a cross-realm judgment produces segments
(`tests/test_workflow_segments.py` has that). The template tests go through the real command and
`WorkflowService.create_from_judgment`.
"""
import io

import pytest
from django.core.management import call_command

from apps.judgment.models import Judgment
from apps.souls.models import CIVILIZATION_TENANT, Soul
from apps.workflow import versioning
from apps.workflow.models import (
    MAX_REJECT_RETURNS,
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    NodeStatus,
    SegmentState,
    SkipKind,
    WorkflowSegment,
    WorkflowTemplate,
)
from apps.workflow.services import WorkflowService
from tests import sentence_plan_support as plan

pytestmark = pytest.mark.django_db


# ── hand-built segments ─────────────────────────────────────────────────


def _build(*sizes):
    """One segment per size, nodes numbered on across segments; the flow stands on the first node.
    Returns the workflow and `nodes[segment][i]` (both 0-based)."""
    home = plan.tenant("CN_DIYU")
    soul = Soul.objects.create(name="退回魂", tenant=home)
    wf = ApprovalWorkflow.objects.create(
        workflow_name="退回", soul=soul, tenant=home, status=ApprovalWorkflowStatus.IN_PROGRESS)
    realms = [home, plan.tenant("EG_DUAT")]
    nodes, order = [], 0
    for index, size in enumerate(sizes):
        segment = WorkflowSegment.objects.create(
            workflow=wf, order=index + 1, tenant=realms[index % 2], civilization="CHINESE", name=f"段{index + 1}",
            state=SegmentState.LOCAL_PICKED if index == 0 else SegmentState.PICKED, default_node_count=size)
        row = []
        for _ in range(size):
            order += 1
            row.append(ApprovalNode.objects.create(
                workflow=wf, segment=segment, node_name=f"站{order}", node_order=order, node_type="TRIAL",
                status=NodeStatus.PENDING, approver_type="ROLE", approver_role="JUDGE"))
        nodes.append(row)
    wf.current_node = nodes[0][0]
    wf.save()
    return wf, nodes


def _route(node, **fields):
    for field, value in fields.items():
        setattr(node, field, value)
    node.save()


def _skip(node, kind=SkipKind.AT_PICK):
    ApprovalNode.objects.filter(pk=node.pk).update(status=NodeStatus.SKIPPED, skip_kind=kind)


def _decide(wf, node, verdict):
    assert wf.complete_node(node.pk, verdict), f"{node.node_name} refused {verdict}"
    wf.refresh_from_db()


def _status(node):
    return ApprovalNode.objects.get(pk=node.pk).status


def test_the_return_cap_is_per_segment(db):
    wf, (a, b) = _build(3, 3)
    _route(a[1], reject_to=a[0])
    _route(b[1], reject_to=b[0])
    for _ in range(MAX_REJECT_RETURNS):
        _decide(wf, a[0], "PASSED")
        _decide(wf, a[1], "FAILED")
        assert wf.current_node_id == a[0].pk
    for node in a:
        _decide(wf, node, "PASSED")
    assert wf.current_node_id == b[0].pk

    # The home segment spent all three; the next realm still has its own.
    _decide(wf, b[0], "PASSED")
    _decide(wf, b[1], "FAILED")
    assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS
    assert wf.end_reason == ""
    assert wf.current_node_id == b[0].pk
    assert wf.return_count == MAX_REJECT_RETURNS + 1
    # Absence: the return did not reach back into the home segment.
    assert all(_status(n) == NodeStatus.APPROVED for n in a)


def test_the_cap_still_ends_a_segment_that_spent_its_returns(db):
    wf, (a, b) = _build(2, 2)
    _route(b[1], reject_to=b[0])
    _decide(wf, a[0], "PASSED")
    _decide(wf, a[1], "PASSED")
    for _ in range(MAX_REJECT_RETURNS):
        _decide(wf, b[0], "PASSED")
        _decide(wf, b[1], "FAILED")
    _decide(wf, b[0], "PASSED")
    _decide(wf, b[1], "FAILED")
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert wf.end_reason == "RETURN_LIMIT"


def test_a_return_into_another_segment_is_no_target_and_the_fail_ends_the_flow(db):
    wf, (a, b) = _build(2, 2)
    _route(b[1], reject_to=a[0])
    for node in (a[0], a[1], b[0]):
        _decide(wf, node, "PASSED")
    _decide(wf, b[1], "FAILED")
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert wf.return_count == 0
    assert _status(a[0]) == NodeStatus.APPROVED


def test_a_return_into_another_segment_falls_through_to_on_fail(db):
    wf, (a, b) = _build(2, 3)
    _route(b[1], reject_to=a[0], on_fail=b[2])
    for node in (a[0], a[1], b[0]):
        _decide(wf, node, "PASSED")
    _decide(wf, b[1], "FAILED")
    assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS
    assert wf.current_node_id == b[2].pk
    assert wf.return_count == 0


def test_a_return_to_a_station_skipped_at_pick_lands_on_the_nearest_earlier_one(db):
    wf, (a,) = _build(4)
    _skip(a[1])
    _route(a[3], reject_to=a[1])
    _decide(wf, a[0], "PASSED")
    assert wf.current_node_id == a[2].pk
    _decide(wf, a[2], "PASSED")
    _decide(wf, a[3], "FAILED")
    assert wf.current_node_id == a[0].pk
    assert wf.return_count == 1
    # The skipped station stays skipped and is never the current one.
    assert _status(a[1]) == NodeStatus.SKIPPED
    assert [_status(n) for n in (a[0], a[2], a[3])] == [NodeStatus.PENDING] * 3


def test_a_return_to_a_skipped_station_with_nothing_before_it_ends_the_flow(db):
    wf, (a,) = _build(3)
    _skip(a[0], SkipKind.LATER)
    wf.current_node = a[1]
    wf.save()
    _route(a[2], reject_to=a[0])
    _decide(wf, a[1], "PASSED")
    _decide(wf, a[2], "FAILED")
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert wf.end_reason == ""
    assert wf.return_count == 0


def test_an_on_fail_jump_to_a_skipped_station_is_no_target_and_ends_the_flow(db):
    # Pick and adjust refuse this state (`jump_target_required`); it arises only when the template changed after
    # the flow started. The user ruled out falling through to the next station (2026-10-19).
    wf, (a,) = _build(4)
    _route(a[0], on_fail=a[2])
    _skip(a[2])
    _decide(wf, a[0], "FAILED")
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert wf.current_node is None
    # Absence: nothing after the skipped target was entered or jumped over.
    assert _status(a[3]) == NodeStatus.PENDING
    assert _status(a[1]) == NodeStatus.PENDING


def test_the_publish_validator_refuses_a_forward_reject_to(db):
    template = WorkflowTemplate.objects.create(
        name="前退", civilization="CHINESE", case_type="ROUTINE", tenant=plan.tenant("CN_DIYU"))
    versioning.save_draft(template, [
        {"id": "n1", "node_name": "一", "node_order": 1, "reject_to": "n2"},
        {"id": "n2", "node_name": "二", "node_order": 2},
    ])
    with pytest.raises(versioning.PublishRejectedError) as refused:
        versioning.publish(template)
    assert {"node": "n1", "code": "reject_not_earlier"} in refused.value.issues
    template.refresh_from_db()
    assert template.nodes_json == []


# ── the formal templates ───────────────────────────────────────────────


@pytest.fixture
def halls(db):
    return {code: plan.tenant(code) for code in CIVILIZATION_TENANT.values()}


def _seed(*args):
    out = io.StringIO()
    call_command("seed_workflow_templates", *args, stdout=out)
    return out.getvalue()


def _row(tenant, case_type):
    return WorkflowTemplate.objects.get(tenant=tenant, case_type=case_type)


def _edges(row, field):
    return {n["id"]: n[field] for n in row.nodes_json if n.get(field)}


def test_the_seed_writes_one_row_per_hall_and_case_type_with_the_approved_edges(halls):
    _seed()
    _seed()  # idempotent
    assert WorkflowTemplate.objects.count() == 11
    assert all(r.is_active and r.published_version_id and r.nodes_json for r in WorkflowTemplate.objects.all())
    assert all(r.versions.count() == 1 for r in WorkflowTemplate.objects.all())

    cn, eg, eu, gr = (halls[c] for c in ("CN_DIYU", "EG_DUAT", "EU_HEAVEN_HELL", "GR_HADES"))
    ten = _row(cn, "ROUTINE")
    assert ten.name == "十殿审判流程"
    assert _edges(ten, "reject_to") == {**{f"n{i}": f"n{i - 1}" for i in range(2, 10)}, "n10": "n1"}
    assert _edges(_row(cn, "APPEAL"), "reject_to") == {"n2": "n1", "n3": "n2"}  # n4 (终审) ends
    assert _edges(_row(cn, "CROSS_REALM"), "reject_to") == {"n2": "n1", "n3": "n2", "n4": "n3"}
    # The heart is weighed once: no returns in either weighing row.
    assert _edges(_row(eg, "ROUTINE"), "reject_to") == {}
    assert _edges(_row(eg, "HEART_WEIGHING"), "reject_to") == {}
    assert _edges(_row(eg, "APPEAL"), "reject_to") == {"n2": "n1"}
    assert _edges(_row(eu, "ROUTINE"), "reject_to") == {}
    assert [n["node_name"] for n in _row(eu, "ROUTINE").nodes_json] == [
        "Christ · 私审判", "Michael · 引领入光", "Christ · 公审判"]
    assert _edges(_row(eu, "APPEAL"), "reject_to") == {}
    assert _edges(_row(eu, "CANONIZATION"), "reject_to") == {"n2": "n1", "n3": "n2"}
    assert _edges(_row(eu, "PURGATORY_REVIEW"), "reject_to") == {"n2": "n1", "n3": "n2"}
    # One spelling for the one European court (2026-10-19): the appeal row says 天堂 like the 末日审判 row.
    for case_type in ("ROUTINE", "APPEAL"):
        assert {n["court_code"] for n in _row(eu, case_type).nodes_json} == {"天堂"}
    assert not any(n["court_code"] == "Heaven" for r in WorkflowTemplate.objects.all() for n in r.nodes_json)
    greek = _row(gr, "ROUTINE")
    assert _edges(greek, "on_fail") == {"n1": "n3", "n2": "n3"}
    # The default pass path is written out so the editor draws it (only rows with an on_fail jump).
    assert _edges(greek, "on_pass") == {"n1": "n2", "n2": "n3"}
    assert _edges(ten, "on_pass") == {}
    assert _edges(greek, "reject_to") == {}
    assert [n["node_type"] for n in greek.nodes_json] == ["TRIAL", "TRIAL", "FINAL"]


def test_the_seed_tells_the_editor_who_approves_each_station(halls):
    # The editor's 审批人 select reads `approver_type` and showed 职能角色 with no role for every seeded
    # station (seen on 115, 2026-10-19). A named actor is 指定人员, a station naming nobody is 系统自动.
    _seed()
    for row in WorkflowTemplate.objects.all():
        for n in row.nodes_json:
            assert n["approver_type"] == ("ACTOR" if n.get("actor") else "SYSTEM"), (row.name, n["node_name"])
    ten = _row(halls["CN_DIYU"], "ROUTINE").nodes_json
    assert ten[9]["approver_type"] == "ACTOR" and ten[9]["actor"] == "转轮王"
    assert _row(halls["CN_DIYU"], "APPEAL").nodes_json[3]["approver_type"] == "SYSTEM"  # 酆都大帝 has no Actor row


def test_the_seed_leaves_another_live_template_of_the_pair_alone(halls):
    cn = halls["CN_DIYU"]
    mine = WorkflowTemplate.objects.create(
        name="本殿自定", civilization="CHINESE", case_type="ROUTINE", tenant=cn,
        nodes_json=[{"id": "n1", "node_name": "一", "node_order": 1}])
    _seed()
    assert list(WorkflowTemplate.objects.filter(tenant=cn, case_type="ROUTINE")) == [mine]
    assert WorkflowTemplate.objects.count() == 11  # 本殿自定 1 份 + 种子建的其余 10 份


def test_the_seed_overwrites_a_changed_row_only_with_update(halls):
    _seed()
    row = _row(halls["CN_DIYU"], "APPEAL")
    WorkflowTemplate.objects.filter(pk=row.pk).update(nodes_json=row.nodes_json[:2])
    _seed()
    row.refresh_from_db()
    assert len(row.nodes_json) == 2
    _seed("--update")
    row.refresh_from_db()
    assert len(row.nodes_json) == 4
    assert row.versions.count() == 2


def _judged(tenant):
    soul = Soul.objects.create(name="正式模板魂", tenant=tenant)
    judgment = Judgment.objects.create(
        soul=soul, civilization=soul.civilization, court="—", verdict="PASSED", is_final=True, tenant=tenant)
    return WorkflowService.create_from_judgment(judgment)


def test_the_ten_court_flow_from_the_seeded_row_returns_to_court_one_on_a_final_fail(halls):
    _seed()
    wf = _judged(halls["CN_DIYU"])
    nodes = list(wf.nodes.order_by("node_order"))
    assert len(nodes) == 10
    assert wf.template_version_id == _row(halls["CN_DIYU"], "ROUTINE").published_version_id
    for node in nodes[:9]:
        _decide(wf, node, "PASSED")
    _decide(wf, nodes[9], "FAILED")
    assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS
    assert wf.current_node.node_name == "秦广王 · 分流"
    assert wf.return_count == 1


def test_the_greek_division_fail_goes_to_minos_and_skips_rhadamanthus(halls):
    _seed()
    wf = _judged(halls["GR_HADES"])
    aeacus, rhadamanthus, minos = wf.nodes.order_by("node_order")
    _decide(wf, aeacus, "FAILED")
    assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS
    assert wf.current_node_id == minos.pk
    assert _status(rhadamanthus) == NodeStatus.SKIPPED
    _decide(wf, minos, "PASSED")
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
