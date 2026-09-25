"""会签 (countersign), 通知 (notify), 结束 (end), and declarative edge conditions.

Condition evaluation is mutation-proved: with `_holds`'s `lt` changed to `<=`,
`test_a_balance_condition_picks_the_branch` goes red on the soul whose balance
is exactly 0 (it takes the 「余额 < 0」 branch it must not take).
"""
import inspect

import pytest

from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.souls.models import Soul
from apps.workflow import conditions, countersign, versioning
from apps.workflow.models import (
    ApprovalWorkflowStatus,
    NodeKind,
    NodeStatus,
    WorkflowTemplate,
)
from apps.workflow.services import WorkflowService
from apps.workflow.validation import validate_template_nodes


def _node(i, name=None, **extra):
    base = {
        "id": f"n{i}", "node_name": name or f"第{i}步", "node_type": "TRIAL",
        "court_code": "", "approver_type": "ROLE", "approver_role": "JUDGE", "node_order": i,
    }
    base.update(extra)
    return base


def _signers(*roles):
    return [{"label": f"{r} 会签", "approver_type": "ROLE", "approver_role": r} for r in roles]


def _workflow(tenant, nodes, *, merit=0, demerit=0, verdict="PASSED"):
    template = WorkflowTemplate.objects.create(
        name="会签测试", civilization="CHINESE", case_type="ROUTINE", tenant=tenant,
    )
    versioning.save_draft(template, nodes)
    versioning.publish(template)
    soul = Soul.objects.create(
        name="待审魂", tenant=tenant, merit_score=merit, demerit_score=demerit,
    )
    judgment = Judgment.objects.create(
        soul=soul, civilization=soul.civilization, court="—",
        verdict=verdict, is_final=True, tenant=tenant,
    )
    return WorkflowService.create_from_judgment(judgment)


def _user(tenant, name, role):
    return User.objects.create_user(username=name, password="x", role=role, tenant=tenant)


# ── 会签 ──────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_countersign_waits_for_every_signer_by_default(cn_tenant):
    judge, mod = _user(cn_tenant, "cs_j", "JUDGE"), _user(cn_tenant, "cs_m", "MODERATOR")
    wf = _workflow(cn_tenant, [
        _node(1, kind="COUNTERSIGN", signers=_signers("JUDGE", "MODERATOR")), _node(2),
    ])
    node = wf.current_node
    assert node.kind == NodeKind.COUNTERSIGN and len(node.signers_json) == 2
    assert node.can_approve(judge) and node.can_approve(mod)

    assert wf.complete_node(node.id, "PASSED", user=judge)
    wf.refresh_from_db()
    node.refresh_from_db()
    assert node.status == NodeStatus.PENDING
    assert wf.current_node_id == node.id
    assert len(node.signatures_json) == 1
    # One person, one signature.
    assert not node.can_approve(judge)
    assert not wf.complete_node(node.id, "PASSED", user=judge)

    assert wf.complete_node(node.id, "PASSED", user=mod)
    wf.refresh_from_db()
    node.refresh_from_db()
    assert node.status == NodeStatus.APPROVED
    assert wf.current_node.node_order == 2


@pytest.mark.django_db
def test_countersign_fails_as_soon_as_the_threshold_is_out_of_reach(cn_tenant):
    judge = _user(cn_tenant, "cs_j2", "JUDGE")
    wf = _workflow(cn_tenant, [
        _node(1, kind="COUNTERSIGN", signers=_signers("JUDGE", "MODERATOR")), _node(2),
    ])
    assert wf.complete_node(wf.current_node.id, "FAILED", user=judge)
    wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.REJECTED


@pytest.mark.django_db
def test_a_threshold_of_one_passes_on_the_first_approval(cn_tenant):
    judge = _user(cn_tenant, "cs_j3", "JUDGE")
    wf = _workflow(cn_tenant, [
        _node(1, kind="COUNTERSIGN", signers=_signers("JUDGE", "MODERATOR"), threshold=1), _node(2),
    ])
    assert wf.complete_node(wf.current_node.id, "PASSED", user=judge)
    wf.refresh_from_db()
    assert wf.current_node.node_order == 2


def test_the_countersign_rule_table():
    """passes at approvals ≥ k; fails at rejections > n − k; else open."""
    class N:
        def __init__(self, n, k, votes):
            self.signers_json = [{}] * n
            self.threshold = k
            self.signatures_json = [{"passed": v} for v in votes]

    assert countersign.outcome(N(3, None, [True, True])) == countersign.OPEN
    assert countersign.outcome(N(3, None, [True, True, True])) == countersign.PASSED
    assert countersign.outcome(N(3, None, [False])) == countersign.FAILED
    assert countersign.outcome(N(3, 2, [False])) == countersign.OPEN
    assert countersign.outcome(N(3, 2, [False, False])) == countersign.FAILED
    assert countersign.outcome(N(3, 2, [True, False, True])) == countersign.PASSED


@pytest.mark.django_db
def test_a_user_without_a_slot_is_refused_through_the_api(api_client, cn_tenant):
    outsider = _user(cn_tenant, "cs_out", "JUDGE")
    wf = _workflow(cn_tenant, [_node(1, kind="COUNTERSIGN", signers=_signers("MODERATOR", "GUARDIAN"))])
    api_client.force_authenticate(user=outsider)
    res = api_client.post(f"/api/v1/workflows/{wf.id}/approve_node/", {"verdict": "PASSED"}, format="json")
    assert res.status_code == 403
    assert wf.nodes.get().signatures_json == []


# ── 通知 / 结束 ───────────────────────────────────────────────────────


@pytest.mark.django_db
def test_notify_sends_and_moves_on(cn_tenant, django_capture_on_commit_callbacks, monkeypatch):
    told = []
    monkeypatch.setattr(
        "apps.events.services.EventService.notify_user",
        staticmethod(lambda **kw: told.append(kw["user"].username)),
    )
    _user(cn_tenant, "nt_guard", "GUARDIAN")
    wf = _workflow(cn_tenant, [
        _node(1), _node(2, "双方殿司", kind="NOTIFY", approver_role="GUARDIAN"), _node(3),
    ])
    with django_capture_on_commit_callbacks(execute=True):
        assert wf.complete_node(wf.current_node.id, "PASSED")
    wf.refresh_from_db()
    notify = wf.nodes.get(node_order=2)
    assert notify.status == NodeStatus.TRAVERSED and notify.verdict == "NOTIFIED"
    assert notify.approver_id is None
    assert wf.current_node.node_order == 3
    assert told == ["nt_guard"]
    assert not notify.can_approve(User.objects.get(username="nt_guard"))


@pytest.mark.django_db
def test_notify_as_the_last_node_completes_the_flow(cn_tenant):
    wf = _workflow(cn_tenant, [_node(1), _node(2, kind="NOTIFY")])
    wf.complete_node(wf.current_node.id, "PASSED")
    wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.COMPLETED


# ── 条件分支 ─────────────────────────────────────────────────────────


BRANCHED = [
    _node(1, "来源殿审批", on_pass="n2"),
    _node(2, "余额 < 0 ?", branches=[
        {"id": "neg", "when": [{"fact": "balance", "op": "lt", "value": 0}], "target": "n3"},
    ], on_pass="n4"),
    _node(3, "会签 · 两文明判官", on_pass="n5"),
    _node(4, "目标文明判官", on_pass="n5"),
    _node(5, "移交完成", kind="END"),
]


def _run_passes(wf):
    taken = []
    while wf.status == ApprovalWorkflowStatus.IN_PROGRESS:
        taken.append(wf.current_node.node_name)
        wf.complete_node(wf.current_node.id, "PASSED")
        wf.refresh_from_db()
    return taken


@pytest.mark.django_db
def test_a_balance_condition_picks_the_branch(cn_tenant):
    assert validate_template_nodes(BRANCHED) == []

    negative = _workflow(cn_tenant, BRANCHED, merit=1, demerit=5)
    assert _run_passes(negative) == ["来源殿审批", "余额 < 0 ?", "会签 · 两文明判官"]
    assert negative.status == ApprovalWorkflowStatus.COMPLETED
    # The branch not taken did not run: absence, not only presence.
    assert negative.nodes.get(node_order=4).status == NodeStatus.PENDING

    zero = _workflow(cn_tenant, BRANCHED, merit=3, demerit=3)
    assert _run_passes(zero) == ["来源殿审批", "余额 < 0 ?", "目标文明判官"]
    assert zero.nodes.get(node_order=3).status == NodeStatus.PENDING
    assert zero.nodes.get(node_order=5).status == NodeStatus.TRAVERSED


@pytest.mark.django_db
def test_enum_conditions_on_civilization_and_verdict(cn_tenant):
    nodes = [
        _node(1, branches=[
            {"id": "p", "when": [{"fact": "verdict", "op": "in", "value": ["PURGATORY"]},
                                 {"fact": "civilization", "op": "in", "value": ["CHINESE"]}],
             "target": "n2"},
        ], on_pass="n3"),
        _node(2, on_pass="n4"),
        _node(3, on_pass="n4"),
        _node(4, "终", kind="END"),
    ]
    assert validate_template_nodes(nodes) == []
    purgatory = _workflow(cn_tenant, nodes, verdict="PURGATORY")
    assert _run_passes(purgatory) == ["第1步", "第2步"]
    passed = _workflow(cn_tenant, nodes, verdict="PASSED")
    assert _run_passes(passed) == ["第1步", "第3步"]


def test_regions_are_exact_over_integers_and_sets():
    lt0 = conditions.region([{"fact": "balance", "op": "lt", "value": 0}])
    gt_m1 = conditions.region([{"fact": "balance", "op": "gt", "value": -1}])
    lte5 = conditions.region([{"fact": "balance", "op": "lte", "value": 5}])
    assert not conditions.overlaps(lt0, gt_m1)  # ≤ -1 and ≥ 0
    assert conditions.overlaps(lt0, lte5)
    cn = conditions.region([{"fact": "civilization", "op": "in", "value": ["CHINESE"]}])
    not_cn = conditions.region([{"fact": "civilization", "op": "not_in", "value": ["CHINESE"]}])
    assert not conditions.overlaps(cn, not_cn)
    # Different facts constrain independently, so they overlap.
    assert conditions.overlaps(lt0, cn)
    assert conditions.region([
        {"fact": "balance", "op": "lt", "value": 0}, {"fact": "balance", "op": "gt", "value": 5},
    ]) is None


def test_malformed_clauses_are_named():
    assert conditions.clause_error({"fact": "karma", "op": "lt", "value": 0}) == "unknown_fact"
    assert conditions.clause_error({"fact": "balance", "op": "in", "value": [1]}) == "bad_op"
    assert conditions.clause_error({"fact": "balance", "op": "lt", "value": "0"}) == "bad_value"
    assert conditions.clause_error({"fact": "balance", "op": "lt", "value": True}) == "bad_value"
    assert conditions.clause_error({"fact": "verdict", "op": "in", "value": ["MAYBE"]}) == "bad_value"
    assert conditions.clause_error({"fact": "verdict", "op": "in", "value": ["PASSED"]}) is None


def test_a_missing_fact_satisfies_nothing():
    assert not conditions.matches([{"fact": "verdict", "op": "not_in", "value": ["PASSED"]}],
                                  {"verdict": None})
    assert not conditions.matches([], {"balance": 0})


def test_nothing_in_the_condition_path_evaluates_code():
    source = inspect.getsource(conditions)
    for forbidden in ("eval(", "exec(", "compile(", "__import__"):
        assert forbidden not in source


# ── validation ────────────────────────────────────────────────────────


def _codes(nodes):
    return {(i["node"], i["code"]) for i in validate_template_nodes(nodes)}


def test_validation_rejects_unreachable_and_exitless_nodes():
    codes = _codes([
        _node(1, on_pass="n3"),
        _node(2, "孤岛", on_pass="n3"),      # nothing points here
        _node(3, "通知", kind="NOTIFY"),     # no on_pass
        _node(4, "结束", kind="END"),
    ])
    assert ("n2", "unreachable") in codes
    assert ("n3", "no_exit") in codes
    assert ("n1", "no_exit") in codes       # its only path runs into n3
    assert ("n4", "unreachable") in codes


def test_validation_rejects_overlapping_and_empty_conditions():
    codes = _codes([
        _node(1, branches=[
            {"id": "a", "when": [{"fact": "balance", "op": "lt", "value": 0}], "target": "n2"},
            {"id": "b", "when": [{"fact": "balance", "op": "lte", "value": 10}], "target": "n3"},
            {"id": "c", "when": [], "target": "n3"},
            {"id": "d", "when": [{"fact": "balance", "op": "gt", "value": 5},
                                 {"fact": "balance", "op": "lt", "value": 2}], "target": "n3"},
        ], on_pass="n4"),
        _node(2, on_pass="n4"), _node(3, on_pass="n4"), _node(4, kind="END"),
    ])
    assert ("n1", "condition_overlap") in codes
    assert ("n1", "condition_empty") in codes
    issues = validate_template_nodes([
        _node(1, branches=[
            {"id": "a", "when": [{"fact": "balance", "op": "lt", "value": 0}], "target": "n2"},
            {"id": "b", "when": [{"fact": "balance", "op": "gte", "value": 0}], "target": "n3"},
        ], on_pass="n4"),
        _node(2, on_pass="n4"), _node(3, on_pass="n4"), _node(4, kind="END"),
    ])
    # Absence: complementary conditions are not an overlap.
    assert issues == []


def test_validation_of_kinds():
    codes = _codes([
        _node(1, kind="COUNTERSIGN", signers=[], on_pass="n2"),
        _node(2, kind="COUNTERSIGN", signers=_signers("JUDGE"), threshold=2, on_pass="n3"),
        _node(3, kind="END", on_pass="n1"),
    ])
    assert ("n1", "countersign_no_signers") in codes
    assert ("n2", "threshold_out_of_range") in codes
    assert ("n3", "end_has_exit") in codes


def test_a_graph_needs_an_end_and_a_linear_template_does_not():
    branched_no_end = _codes([
        _node(1, branches=[{"id": "a", "when": [{"fact": "balance", "op": "lt", "value": 0}],
                            "target": "n2"}], on_pass="n2"),
        _node(2),
    ])
    assert ("", "no_end") in branched_no_end
    assert validate_template_nodes([_node(1), _node(2), _node(3)]) == []


@pytest.mark.django_db
def test_publish_refuses_an_overlapping_draft(api_client, admin_user):
    api_client.force_authenticate(user=admin_user)
    res = api_client.post("/api/v1/workflow/templates/", {
        "name": "重叠", "civilization": "CHINESE", "case_type": "ROUTINE",
        "nodes": [
            _node(1, branches=[
                {"id": "a", "when": [{"fact": "balance", "op": "lt", "value": 0}], "target": "n2"},
                {"id": "b", "when": [{"fact": "balance", "op": "lt", "value": 3}], "target": "n2"},
            ], on_pass="n2"),
            _node(2, kind="END"),
        ],
    }, format="json")
    assert res.status_code == 201, res.data
    stored = res.data["nodes"][0]["branches"]
    assert [b["id"] for b in stored] == ["a", "b"]
    pub = api_client.post(f"/api/v1/workflow/templates/{res.data['id']}/publish/")
    assert pub.status_code == 400
    assert any(i["code"] == "condition_overlap" for i in pub.data["issues"])


# ── preview of a 会签 ────────────────────────────────────────────────


@pytest.mark.django_db
def test_countersign_preview_equals_the_resolved_signers(api_client, admin_user, cn_tenant):
    wf = _workflow(cn_tenant, [_node(1, kind="COUNTERSIGN", signers=_signers("JUDGE", "MODERATOR"))])
    template = WorkflowTemplate.objects.get(tenant=cn_tenant)
    api_client.force_authenticate(user=admin_user)
    res = api_client.get(
        f"/api/v1/workflow/templates/{template.id}/approver-preview/",
        {"node": "n1", "tenant": cn_tenant.code},
    )
    assert res.status_code == 200, res.data
    assert res.data["kind"] == "COUNTERSIGN"
    previewed = [(s["approver_type"], s["role"]) for s in res.data["signers"]]
    stored = [(s["approver_type"], s["approver_role"]) for s in wf.nodes.get().signers_json]
    assert previewed == stored == [("ROLE", "JUDGE"), ("ROLE", "MODERATOR")]
