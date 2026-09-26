"""驳回到 (reject-to), its loop cap, and per-node timeouts.

The cap is mutation-proved: with the `return_count >= MAX_REJECT_RETURNS` check
removed from `ApprovalWorkflow._return_to`, `test_the_return_cap_ends_the_loop`
goes red — the fourth FAIL sends the flow back again instead of ending it.
"""
import io
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.scheduler import registry
from apps.souls.models import Soul
from apps.workflow import timeouts, versioning
from apps.workflow.models import (
    MAX_REJECT_RETURNS,
    ApprovalNode,
    ApprovalWorkflowStatus,
    NodeStatus,
    WorkflowTemplate,
)
from apps.workflow.services import WorkflowService
from apps.workflow.validation import validate_template_nodes


def _node(i, name=None, **extra):
    base = {
        "id": f"n{i}", "node_name": name or f"第{i}审", "node_type": "TRIAL",
        "court_code": "", "approver_type": "ROLE", "approver_role": "JUDGE", "node_order": i,
    }
    base.update(extra)
    return base


def _workflow(tenant, nodes, *, validated=True):
    """Build a workflow from `nodes`. `validated=False` writes the graph straight
    into `nodes_json`, as an ORM fixture or a pre-versioning row would — the only
    way to reach the engine with a graph the publish validator refuses."""
    template = WorkflowTemplate.objects.create(
        name="回退测试", civilization="CHINESE", case_type="ROUTINE", tenant=tenant,
        nodes_json=[] if validated else nodes,
    )
    if validated:
        versioning.save_draft(template, nodes)
        versioning.publish(template)
    soul = Soul.objects.create(name="回退魂", tenant=tenant)
    judgment = Judgment.objects.create(
        soul=soul, civilization=soul.civilization, court="—",
        verdict="PASSED", is_final=True, tenant=tenant,
    )
    return WorkflowService.create_from_judgment(judgment)


def _decide(workflow, order, verdict):
    node = workflow.nodes.get(node_order=order)
    assert workflow.complete_node(node.id, verdict), f"node {order} refused {verdict}"
    workflow.refresh_from_db()
    return node


# ── 驳回到 ────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_a_fail_with_reject_to_reopens_the_range_and_goes_back(cn_tenant):
    wf = _workflow(cn_tenant, [_node(1), _node(2), _node(3, reject_to="n1"), _node(4)])
    _decide(wf, 1, "PASSED")
    _decide(wf, 2, "PASSED")
    _decide(wf, 3, "FAILED")

    assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS
    assert wf.current_node.node_order == 1
    assert wf.return_count == 1
    by_order = {n.node_order: n for n in wf.nodes.all()}
    for order in (1, 2, 3):
        n = by_order[order]
        assert n.status == NodeStatus.PENDING and n.verdict == "" and n.decided_at is None
        assert [h["round"] for h in n.decision_history] == [1]
    assert by_order[3].decision_history[0]["verdict"] == "FAILED"
    assert by_order[1].decision_history[0]["verdict"] == "PASSED"
    # Absence: node 4 was never reached and carries no history.
    assert by_order[4].decision_history == []

    for order in (1, 2, 3, 4):
        _decide(wf, order, "PASSED")
    assert wf.status == ApprovalWorkflowStatus.COMPLETED


@pytest.mark.django_db
def test_the_return_cap_ends_the_loop(cn_tenant):
    wf = _workflow(cn_tenant, [_node(1), _node(2, reject_to="n1"), _node(3)])
    decisions = 0
    for _ in range(MAX_REJECT_RETURNS):
        _decide(wf, 1, "PASSED")
        _decide(wf, 2, "FAILED")
        decisions += 2
        assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS
        assert wf.current_node.node_order == 1
    assert wf.return_count == MAX_REJECT_RETURNS

    _decide(wf, 1, "PASSED")
    _decide(wf, 2, "FAILED")
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert wf.end_reason == "RETURN_LIMIT"
    assert wf.current_node is None
    assert wf.return_count == MAX_REJECT_RETURNS
    # The refused node keeps its decision: the cap ends the flow, it does not reopen.
    assert wf.nodes.get(node_order=2).status == NodeStatus.REJECTED
    # And the terminal flow refuses further decisions.
    assert not wf.complete_node(wf.nodes.get(node_order=3).id, "PASSED")


@pytest.mark.django_db
def test_reject_to_a_later_node_is_ignored_and_the_fail_ends_the_flow(cn_tenant):
    wf = _workflow(cn_tenant, [_node(1, reject_to="n2"), _node(2)], validated=False)
    _decide(wf, 1, "FAILED")
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert wf.end_reason == ""
    assert wf.return_count == 0


@pytest.mark.django_db
def test_reject_to_is_copied_per_workflow_and_wired_to_its_own_nodes(cn_tenant):
    wf = _workflow(cn_tenant, [_node(1), _node(2, reject_to="n1")])
    n1, n2 = wf.nodes.get(node_order=1), wf.nodes.get(node_order=2)
    assert n2.reject_to_id == n1.id
    assert n1.reject_to_id is None


# ── validation ────────────────────────────────────────────────────────


def test_publish_validation_rejects_bad_reject_to_and_timeouts():
    issues = validate_template_nodes([
        _node(1, reject_to="n2"),
        _node(2, reject_to="n1", on_fail="n3"),
        _node(3, timeout_hours=4),
        _node(4, timeout_hours=4, timeout_action="ESCALATE"),
        _node(5, timeout_hours=4, timeout_action="ESCALATE", timeout_role="MODERATOR", reject_to="n4"),
    ])
    codes = {(i["node"], i["code"]) for i in issues}
    assert ("n1", "reject_not_earlier") in codes
    assert ("n2", "reject_and_fail_route") in codes
    assert ("n3", "timeout_incomplete") in codes
    assert ("n4", "timeout_role_missing") in codes
    # Absence: the fully-specified node is clean.
    assert not [i for i in issues if i["node"] == "n5"]


@pytest.mark.django_db
def test_the_template_api_keeps_reject_to_and_timeout_fields(api_client, admin_user):
    api_client.force_authenticate(user=admin_user)
    nodes = [_node(1), _node(2, reject_to="n1", timeout_hours=48, timeout_action="AUTO_REJECT")]
    res = api_client.post("/api/v1/workflow/templates/", {
        "name": "字段往返", "civilization": "CHINESE", "case_type": "ROUTINE", "nodes": nodes,
    }, format="json")
    assert res.status_code == 201, res.data
    got = api_client.get(f"/api/v1/workflow/templates/{res.data['id']}/").data["nodes"][1]
    assert (got["reject_to"], got["timeout_hours"], got["timeout_action"]) == ("n1", 48, "AUTO_REJECT")


# ── timeouts ──────────────────────────────────────────────────────────


def _age(node, hours):
    ApprovalNode.objects.filter(pk=node.pk).update(
        activated_at=timezone.now() - timedelta(hours=hours)
    )


@pytest.mark.django_db
def test_escalate_redesignates_the_node_once(cn_tenant, django_capture_on_commit_callbacks, monkeypatch):
    told = []
    monkeypatch.setattr(
        "apps.events.services.EventService.notify_user",
        staticmethod(lambda **kw: told.append(kw["user"].username)),
    )
    User.objects.create_user(username="tm_mod", password="x", role="MODERATOR", tenant=cn_tenant)
    wf = _workflow(cn_tenant, [
        _node(1, timeout_hours=2, timeout_action="ESCALATE", timeout_role="MODERATOR"), _node(2),
    ])
    node = wf.current_node
    assert node.activated_at is not None
    _age(node, 3)

    with django_capture_on_commit_callbacks(execute=True):
        counts = timeouts.process_due()
    assert counts["ESCALATE"] == 1
    node.refresh_from_db()
    assert (node.approver_type, node.approver_role, node.status) == ("ROLE", "MODERATOR", "PENDING")
    assert node.timed_out_at is not None
    assert node.decision_history[-1]["event"] == "timeout"
    assert node.can_approve(User.objects.get(username="tm_mod"))
    assert told == ["tm_mod"]

    # Once per activation.
    assert timeouts.process_due()["ESCALATE"] == 0


@pytest.mark.django_db
def test_a_node_not_yet_due_is_left_alone(cn_tenant):
    wf = _workflow(cn_tenant, [_node(1, timeout_hours=2, timeout_action="AUTO_REJECT")])
    _age(wf.current_node, 1)
    assert timeouts.process_due() == {"ESCALATE": 0, "AUTO_REJECT": 0, "NOTIFY": 0, "skipped": 0}
    wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS


@pytest.mark.django_db
def test_auto_reject_goes_through_complete_node_and_honours_reject_to(cn_tenant):
    wf = _workflow(cn_tenant, [
        _node(1), _node(2, reject_to="n1", timeout_hours=1, timeout_action="AUTO_REJECT"),
    ])
    _decide(wf, 1, "PASSED")
    _age(wf.current_node, 2)

    assert timeouts.process_due()["AUTO_REJECT"] == 1
    wf.refresh_from_db()
    assert wf.current_node.node_order == 1
    assert wf.return_count == 1
    history = wf.nodes.get(node_order=2).decision_history
    assert [h.get("event") for h in history] == ["timeout", None]
    assert history[1]["verdict"] == "FAILED" and history[1]["approver_id"] is None


@pytest.mark.django_db
def test_auto_reject_without_reject_to_ends_the_flow(cn_tenant):
    wf = _workflow(cn_tenant, [_node(1, timeout_hours=1, timeout_action="AUTO_REJECT"), _node(2)])
    _age(wf.current_node, 2)
    timeouts.process_due()
    wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert wf.nodes.get(node_order=1).notes == "超时自动驳回"


@pytest.mark.django_db
def test_notify_reminds_and_leaves_the_node_pending(cn_tenant, django_capture_on_commit_callbacks, monkeypatch):
    told = []
    monkeypatch.setattr(
        "apps.events.services.EventService.notify_user",
        staticmethod(lambda **kw: told.append(kw["user"].username)),
    )
    User.objects.create_user(username="tm_judge", password="x", role="JUDGE", tenant=cn_tenant)
    wf = _workflow(cn_tenant, [_node(1, timeout_hours=1, timeout_action="NOTIFY")])
    _age(wf.current_node, 2)
    with django_capture_on_commit_callbacks(execute=True):
        assert timeouts.process_due()["NOTIFY"] == 1
    node = wf.nodes.get(node_order=1)
    assert node.status == NodeStatus.PENDING and node.approver_role == "JUDGE"
    assert told == ["tm_judge"]


@pytest.mark.django_db
def test_a_return_restarts_the_clock(cn_tenant):
    wf = _workflow(cn_tenant, [
        _node(1, timeout_hours=1, timeout_action="NOTIFY"), _node(2, reject_to="n1"),
    ])
    first = wf.current_node
    _age(first, 2)
    timeouts.process_due()
    first.refresh_from_db()
    assert first.timed_out_at is not None

    _decide(wf, 1, "PASSED")
    _decide(wf, 2, "FAILED")
    first.refresh_from_db()
    assert first.timed_out_at is None
    assert timezone.now() - first.activated_at < timedelta(minutes=1)


@pytest.mark.django_db
def test_the_command_runs_the_same_processor(cn_tenant):
    wf = _workflow(cn_tenant, [_node(1, timeout_hours=1, timeout_action="AUTO_REJECT")])
    out = io.StringIO()
    later = (timezone.now() + timedelta(hours=2)).isoformat()
    call_command("process_workflow_timeouts", "--now", later, stdout=out)
    assert "AUTO_REJECT=1" in out.getvalue()
    wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.REJECTED


def test_the_timeout_task_is_scheduled_per_tenant_every_five_minutes():
    """Flipped 2026-09-26: this used to assert the task was NOT registered.
    timeouts.py's docstring and the editor's hint changed in the same commit."""
    spec = registry.get("workflow.process_timeouts_for_tenant")
    assert spec is not None and spec.scope == registry.TENANT
    assert spec.cron == "*/5 * * * *"
    assert "workflow.process_timeouts" not in {s.key for s in registry.REGISTRY}  # the old all-tenant name


@pytest.mark.django_db
def test_the_scheduled_run_fires_only_its_own_tenant_and_records_success(cn_tenant, eu_tenant):
    """Through celery's tracer and the scheduler task base (`apply()`), the way
    beat's message would run: a TaskRun row, SUCCESS, the counts as result."""
    from apps.scheduler.models import RunStatus, TaskRun
    from apps.scheduler.services import sync_schedules
    from apps.workflow.tasks import process_timeouts_for_tenant

    sync_schedules()
    mine = _workflow(cn_tenant, [_node(1, timeout_hours=1, timeout_action="AUTO_REJECT")])
    # `_workflow`'s template is CHINESE, so an EU soul falls through to the
    # hardcoded flow, which has no timeout: set one on its node directly.
    theirs = _workflow(eu_tenant, [_node(1)])
    ApprovalNode.objects.filter(pk=theirs.current_node_id).update(timeout_hours=1, timeout_action="AUTO_REJECT")
    _age(mine.current_node, 2)
    _age(theirs.current_node, 2)

    result = process_timeouts_for_tenant.apply(kwargs={"tenant_id": str(cn_tenant.pk)}, task_id="wf-timeout-run")
    assert result.successful(), result.traceback
    assert result.get()["AUTO_REJECT"] == 1

    run = TaskRun.objects.get(celery_task_id="wf-timeout-run")
    assert run.status == RunStatus.SUCCESS
    assert run.job is not None and run.job.tenant_id == cn_tenant.pk
    mine.refresh_from_db()
    theirs.refresh_from_db()
    assert mine.status == ApprovalWorkflowStatus.REJECTED
    assert theirs.status == ApprovalWorkflowStatus.IN_PROGRESS
    # ...and it was due: its own tenant's run fires it. Without this the line
    # above would also hold for a node that was never eligible.
    assert timeouts.process_due(tenant_id=eu_tenant.pk)["AUTO_REJECT"] == 1
