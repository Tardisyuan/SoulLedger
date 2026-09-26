"""Per-node timeouts (「超时」): find the nodes whose clock has run out, act once.

    ESCALATE     the node is re-designated to `timeout_role` (「转交上级」) and
                 stays PENDING; everyone holding that role in the tenant is told.
    AUTO_REJECT  the node is decided FAILED through `complete_node`, on nobody's
                 behalf — so the node's 驳回到 and the return cap apply exactly
                 as they would to a person's FAIL.
    NOTIFY       whoever the node designates is reminded; it stays PENDING.

THESE ONLY FIRE WHEN SOMETHING RUNS `process_due`. That is the scheduled job
`workflow.process_timeouts_for_tenant` (`apps/workflow/tasks.py`, registered in
`apps/scheduler/registry.py`: every 5 minutes, one row per active tenant) or,
by hand, the management command `process_workflow_timeouts`. Both go through
`process_due_for_tenant`. The job runs only where celery beat and a worker run;
without them a node past its deadline simply waits — the editor says so under
the timeout field. So a timeout fires up to one period (5 minutes) late.

A node's clock starts at `activated_at` (set whenever it becomes current,
`ApprovalWorkflow._make_current`) and the action fires once per activation
(`timed_out_at`). Each workflow is handled under its row lock and re-checked
there, so two runs overlapping cannot fire one timeout twice.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    NodeStatus,
    TimeoutAction,
)

logger = logging.getLogger(__name__)

AUTO_REJECT_VERDICT = "FAILED"


def _due(node: ApprovalNode, now) -> bool:
    return (
        node.status == NodeStatus.PENDING
        and node.timeout_hours
        and node.timeout_action
        and node.activated_at is not None
        and node.timed_out_at is None
        and node.activated_at + timedelta(hours=node.timeout_hours) <= now
    )


def candidates(tenant_id=None):
    qs = ApprovalWorkflow._base_manager.filter(
        status=ApprovalWorkflowStatus.IN_PROGRESS,
        current_node__status=NodeStatus.PENDING,
        current_node__timeout_hours__isnull=False,
        current_node__activated_at__isnull=False,
        current_node__timed_out_at__isnull=True,
    ).exclude(current_node__timeout_action="")
    if tenant_id is not None:
        qs = qs.filter(tenant_id=tenant_id)
    return qs.select_related("current_node")


def process_due(now=None, tenant_id=None) -> dict:
    """Fire every due timeout. Returns counts per action, plus `skipped`."""
    now = now or timezone.now()
    counts = {TimeoutAction.ESCALATE: 0, TimeoutAction.AUTO_REJECT: 0, TimeoutAction.NOTIFY: 0, "skipped": 0}
    for workflow in candidates(tenant_id):
        if not _due(workflow.current_node, now):
            continue
        action = _fire(workflow.pk, now)
        counts[action or "skipped"] += 1
    return {str(k): v for k, v in counts.items()}


def process_due_for_tenant(tenant, now=None) -> dict:
    """`process_due` for one tenant, under that tenant's contextvar so the audit
    rows an AUTO_REJECT writes (apps.audit.signals) carry the tenant — celery
    has no TenantMiddleware. The `_tell` on_commit callbacks fire inside it too."""
    from apps.tenants.managers import clear_current_tenant, set_current_tenant

    set_current_tenant(tenant)
    try:
        return process_due(now=now, tenant_id=tenant.pk)
    finally:
        clear_current_tenant()


def _fire(workflow_pk, now) -> str | None:
    """Handle one workflow's current node under its lock; return the action taken."""
    with transaction.atomic():
        workflow = ApprovalWorkflow._base_manager.select_for_update().get(pk=workflow_pk)
        if workflow.status != ApprovalWorkflowStatus.IN_PROGRESS or workflow.current_node_id is None:
            return None
        node = ApprovalNode.objects.select_for_update().get(pk=workflow.current_node_id)
        if not _due(node, now):
            return None

        action = node.timeout_action
        node.timed_out_at = now
        entry = {"event": "timeout", "action": action, "at": now.isoformat()}
        if action == TimeoutAction.ESCALATE:
            entry["from"] = {
                "approver_type": node.approver_type,
                "approver_actor_id": str(node.approver_actor_id) if node.approver_actor_id else None,
                "approver_role": node.approver_role,
            }
            node.approver_type = "ROLE"
            node.approver_role = node.timeout_role
            node.approver_actor = None
            # 会签: the slots still unsigned go to the role; signed ones stand.
            signed = {sig["signer"] for sig in node.signatures_json or []}
            node.signers_json = [
                slot if index in signed else {
                    **slot, "approver_type": "ROLE", "approver_actor_id": None,
                    "approver_role": node.timeout_role,
                }
                for index, slot in enumerate(node.signers_json or [])
            ]
        node.decision_history = [*(node.decision_history or []), entry]
        node.save(update_fields=[
            "timed_out_at", "decision_history", "approver_type", "approver_role", "approver_actor",
            "signers_json",
        ])

        if action == TimeoutAction.AUTO_REJECT:
            try:
                workflow.complete_node(node.pk, AUTO_REJECT_VERDICT, notes="超时自动驳回")
            except ValueError:
                # A hand-built node whose `required_verdicts` excludes FAILED.
                # The timeout is recorded (timed_out_at) and the node waits,
                # rather than a verdict the node refuses being forced on it.
                logger.warning("auto-reject refused by node %s's required_verdicts", node.pk)
                return action
            node.refresh_from_db()

        transaction.on_commit(lambda: _tell(workflow, node, action))
    return action


def _tell(workflow, node, action) -> None:
    from apps.workflow.services import WorkflowService

    if action == TimeoutAction.AUTO_REJECT:
        workflow.refresh_from_db()
        WorkflowService.announce(workflow, node=node)
        return
    WorkflowService.notify_designated(
        workflow,
        node,
        title=f"审批超时: {workflow.workflow_name}",
        message=(
            f"节点「{node.node_name}」已超过 {node.timeout_hours} 小时未处理"
            + ("，已转交给你。" if action == TimeoutAction.ESCALATE else "，请尽快处理。")
        ),
    )
