"""退回规则(2026-10-19): returns counted and confined per segment, skipped targets, the Greek flow (Gorgias 524a:
routed by `origin_region` to one judge, Minos only in doubt), and the formal templates `seed_workflow_templates` writes.

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
from apps.workflow.segments import SegmentRefusedError, flow_preview
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
    # The ten courts are a graph since 2026-10-27 (C-1: 功过两平 → 第十殿), so every PASS edge is written and the
    # flow ends on a 结束 after court 10.
    assert _edges(ten, "on_pass") == {f"n{i}": f"n{i + 1}" for i in range(1, 11)}
    assert ten.nodes_json[10]["kind"] == "END"
    assert ten.nodes_json[0]["branches"][0]["target"] == "n10"


def test_the_greek_seed_row_routes_by_origin_and_ends_after_one_judge(halls):
    _seed()
    greek = _row(halls["GR_HADES"], "ROUTINE")
    assert [(n["id"], n.get("kind", "APPROVAL"), n.get("actor")) for n in greek.nodes_json] == [
        ("n1", "NOTIFY", None), ("n2", "APPROVAL", "Aeacus"), ("n3", "APPROVAL", "Rhadamanthus"),
        ("n4", "APPROVAL", "Minos"), ("n5", "END", None)]
    assert [n["node_type"] for n in greek.nodes_json][:4] == ["TRIAL", "TRIAL", "TRIAL", "FINAL"]
    assert _edges(greek, "on_pass") == {"n1": "n4", "n2": "n5", "n3": "n5", "n4": "n5"}
    assert _edges(greek, "on_fail") == {"n2": "n4", "n3": "n4"}  # in doubt → Minos; Minos's FAIL ends the flow
    assert _edges(greek, "reject_to") == {}
    branches = greek.nodes_json[0]["branches"]
    assert [(b["target"], b["when"]) for b in branches] == [
        ("n2", [{"fact": "origin_region", "op": "in", "value": ["EUROPE"]}]),
        ("n3", [{"fact": "origin_region", "op": "in", "value": ["ASIA"]}]),
    ]
    # Absence: no other node branches, and the routing step names nobody.
    assert [n["id"] for n in greek.nodes_json if n.get("branches")] == ["n1"]
    assert greek.nodes_json[0]["approver_type"] == "SYSTEM"


def test_the_seed_tells_the_editor_who_approves_each_station(halls):
    # The editor's 审批人 select reads `approver_type` and showed 职能角色 with no role for every seeded
    # station (seen on 115, 2026-10-19). A named actor is 指定人员; since 2026-10-27 (docs-others X-3) a station
    # naming nobody is the JUDGE role rather than 系统自动, and only a 通知 / 结束 step stays SYSTEM.
    _seed()
    for row in WorkflowTemplate.objects.all():
        for n in row.nodes_json:
            if n.get("actor"):
                expected = ("ACTOR", None)
            elif n.get("kind") in ("NOTIFY", "END"):
                expected = ("SYSTEM", None)
            else:
                expected = ("ROLE", "JUDGE")
            assert (n["approver_type"], n.get("approver_role")) == expected, (row.name, n["node_name"])
    ten = _row(halls["CN_DIYU"], "ROUTINE").nodes_json
    assert ten[9]["approver_type"] == "ACTOR" and ten[9]["actor"] == "转轮王"
    # 酆都大帝 has no Actor row: the default role decides it.
    assert _row(halls["CN_DIYU"], "APPEAL").nodes_json[3]["approver_role"] == "JUDGE"


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


def _judged(tenant, **soul_fields):
    soul = Soul.objects.create(name="正式模板魂", tenant=tenant, **soul_fields)
    judgment = Judgment.objects.create(
        soul=soul, civilization=soul.civilization, court="—", verdict="PASSED", is_final=True, tenant=tenant)
    return WorkflowService.create_from_judgment(judgment)


def test_the_ten_court_flow_from_the_seeded_row_returns_to_court_one_on_a_final_fail(halls):
    _seed()
    wf = _judged(halls["CN_DIYU"], merit_score=10)  # not 功过两平, which would skip to court 10
    nodes = list(wf.nodes.order_by("node_order"))
    assert len(nodes) == 11  # ten courts and the 结束 (C-1)
    assert wf.template_version_id == _row(halls["CN_DIYU"], "ROUTINE").published_version_id
    for node in nodes[:9]:
        _decide(wf, node, "PASSED")
    _decide(wf, nodes[9], "FAILED")
    assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS
    assert wf.current_node.node_name == "秦广王 · 分流"
    assert wf.return_count == 1


def _greek(halls, region=""):
    _seed()
    wf = _judged(halls["GR_HADES"], origin_region=region)
    return wf, list(wf.nodes.order_by("node_order"))


def test_a_european_soul_goes_to_aeacus_and_his_pass_completes_the_flow(halls):
    wf, (route, aeacus, rhadamanthus, minos, end) = _greek(halls, "EUROPE")
    assert _status(route) == NodeStatus.TRAVERSED
    assert wf.current_node_id == aeacus.pk
    _decide(wf, aeacus, "PASSED")
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert _status(end) == NodeStatus.TRAVERSED
    # Never both: neither the other judge nor Minos was reached.
    assert _status(rhadamanthus) == NodeStatus.SKIPPED
    assert _status(minos) == NodeStatus.SKIPPED
    assert ApprovalNode.objects.get(pk=minos.pk).decided_at is not None and not ApprovalNode.objects.get(
        pk=minos.pk).verdict


def test_an_asian_soul_goes_to_rhadamanthus(halls):
    wf, (_route, aeacus, rhadamanthus, minos, _end) = _greek(halls, "ASIA")
    assert wf.current_node_id == rhadamanthus.pk
    _decide(wf, rhadamanthus, "PASSED")
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert (_status(aeacus), _status(minos)) == (NodeStatus.SKIPPED, NodeStatus.SKIPPED)


def test_a_soul_of_unknown_origin_goes_straight_to_minos(halls):
    wf, (_route, aeacus, rhadamanthus, minos, _end) = _greek(halls)
    assert wf.current_node_id == minos.pk
    _decide(wf, minos, "PASSED")
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert (_status(aeacus), _status(rhadamanthus)) == (NodeStatus.SKIPPED, NodeStatus.SKIPPED)


def test_a_judge_in_doubt_hands_the_soul_to_minos_whose_pass_completes(halls):
    wf, (_route, aeacus, rhadamanthus, minos, _end) = _greek(halls, "EUROPE")
    _decide(wf, aeacus, "FAILED")
    assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS
    assert wf.current_node_id == minos.pk
    assert _status(rhadamanthus) == NodeStatus.PENDING  # not reached, not decided
    _decide(wf, minos, "PASSED")
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert _status(rhadamanthus) == NodeStatus.SKIPPED


def test_minos_fail_ends_the_flow_rejected(halls):
    wf, (_route, _aeacus, rhadamanthus, minos, end) = _greek(halls, "ASIA")
    _decide(wf, rhadamanthus, "FAILED")
    assert wf.current_node_id == minos.pk
    _decide(wf, minos, "FAILED")
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert wf.return_count == 0
    assert _status(end) == NodeStatus.PENDING  # the refusal ended it, not the 结束


def test_a_skipped_branch_target_ends_the_flow_rejected_instead_of_falling_to_minos(halls):
    # Pick refuses this (below); it can only happen when a station is skipped some other way.
    _seed()
    soul = Soul.objects.create(name="跳过魂", tenant=halls["GR_HADES"], origin_region="EUROPE")
    judgment = Judgment.objects.create(
        soul=soul, civilization=soul.civilization, court="—", verdict="PASSED", is_final=True, tenant=soul.tenant)
    wf = ApprovalWorkflow.objects.create(
        workflow_name="跳过", soul=soul, judgment=judgment, tenant=soul.tenant,
        status=ApprovalWorkflowStatus.PENDING)
    template = WorkflowService._resolve_template("GREEK", "ROUTINE", soul.tenant)[0]
    route = WorkflowService._create_nodes(wf, template, "GREEK", enter=False)
    aeacus = wf.nodes.get(node_order=2)
    _skip(aeacus, SkipKind.LATER)
    from django.utils import timezone

    wf._enter(route, timezone.now())
    wf.save()
    wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert wf.current_node is None
    assert _status(wf.nodes.get(node_order=4)) == NodeStatus.PENDING  # Minos was not entered


def test_picking_cannot_skip_a_branch_target_or_the_routing_step(halls):
    _seed()
    gr = halls["GR_HADES"]
    for orders, code in (([2], "jump_target_required"), ([3], "jump_target_required"), ([1], "final_required"),
                         ([4], "final_required")):
        soul = Soul.objects.create(name=f"选站魂{orders}", tenant=gr, origin_region="ASIA")
        judgment = Judgment.objects.create(
            soul=soul, civilization=soul.civilization, court="—", verdict="PASSED", is_final=True, tenant=gr)
        with pytest.raises(SegmentRefusedError) as refused:
            WorkflowService.create_from_judgment(judgment, skip_node_orders=orders)
        assert refused.value.code == code, orders
        assert not ApprovalWorkflow.objects.filter(soul=soul).exists()


def test_the_greek_preview_lists_the_three_judges_all_locked_and_nothing_to_pick(halls):
    _seed()
    soul = Soul.objects.create(name="预览魂", tenant=halls["GR_HADES"])
    template = WorkflowService._resolve_template("GREEK", "ROUTINE", soul.tenant)
    preview = flow_preview(soul, "ROUTINE", soul.tenant, template[0])
    # The routing step and the 结束 are not stations.
    assert [s["node_order"] for s in preview["stations"]] == [2, 3, 4]
    assert [s["is_required"] for s in preview["stations"]] == [False, False, True]
    assert [[j["key"] for j in s["jump_target_of"]] for s in preview["stations"]] == [["1"], ["1"], ["2", "3"]]
    assert preview["nothing_to_pick"] is True


# ── the same flows with nothing seeded (docs-others X-2 / X-3 / C-1, 2026-10-27) ─────────────


def test_an_unseeded_hall_gets_the_return_rules_from_the_code_default(halls):
    # No `_seed()`: a hall the global admin just created has no template rows.
    assert not WorkflowTemplate.objects.exists()
    wf = _judged(halls["CN_DIYU"], merit_score=10)
    nodes = list(wf.nodes.order_by("node_order"))
    assert nodes[-1].node_name == "结束 · 发往六道"
    for node in nodes[:9]:
        _decide(wf, node, "PASSED")
    _decide(wf, nodes[9], "FAILED")
    assert wf.current_node.node_name == "秦广王 · 分流" and wf.return_count == 1


def test_an_unseeded_european_and_greek_hall_get_their_regular_flows(halls):
    eu = [n.node_name for n in _judged(halls["EU_HEAVEN_HELL"]).nodes.order_by("node_order")]
    assert eu == ["Christ · 私审判", "Michael · 引领入光", "Christ · 公审判"]
    wf = _judged(halls["GR_HADES"], origin_region="ASIA")
    assert wf.current_node.node_name.startswith("Rhadamanthus")


def test_a_station_naming_nobody_is_the_judge_role_not_system(halls):
    soul = Soul.objects.create(name="申诉魂", tenant=halls["CN_DIYU"])
    judgment = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="—",
                                       verdict="FAILED", is_final=True, tenant=halls["CN_DIYU"])
    appeal = WorkflowService.create_from_judgment(judgment, is_appeal=True)
    by_name = {n.node_name: n for n in appeal.nodes.all()}
    for name in ("原殿阎王 · 复核", "上级殿阎王", "酆都大帝 · 终审"):
        assert (by_name[name].approver_type, by_name[name].approver_role) == ("ROLE", "JUDGE"), name
        assert by_name[name].designates_approver


def test_balanced_merit_and_demerit_go_from_court_one_straight_to_court_ten(halls):
    wf = _judged(halls["CN_DIYU"], merit_score=30, demerit_score=30)
    nodes = list(wf.nodes.order_by("node_order"))
    _decide(wf, nodes[0], "PASSED")
    assert wf.current_node.node_name == "转轮王 · 终审"
    _decide(wf, nodes[9], "PASSED")
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert all(_status(n) == NodeStatus.SKIPPED for n in nodes[1:9])


def test_an_unbalanced_soul_walks_all_ten_courts(halls):
    wf = _judged(halls["CN_DIYU"], merit_score=31, demerit_score=30)
    _decide(wf, wf.current_node, "PASSED")
    assert wf.current_node.node_name == "楚江王 · 初审"
