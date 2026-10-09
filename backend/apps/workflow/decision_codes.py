"""Stable machine codes for "why can't this user decide this node right now".

One answer, asked by both `approve_node` (to label its refusals) and the
officer app's item detail (to say whether the buttons should be there at all).

    already_handled     the node is no longer PENDING; `handled_by` names who
    deadline_passed     the node's timeout fired (auto-rejected, or re-routed)
    permission_changed  the node is still open but this user no longer fills it
"""
from __future__ import annotations


def person(user) -> dict | None:
    if user is None:
        return None
    return {"id": user.pk, "name": getattr(user, "display_name", "") or user.username}


def handled_by(node) -> dict | None:
    """Who decided `node`. A countersign node answers with its latest signer."""
    if node.approver_id:
        return person(node.approver)
    signatures = node.signatures_json or []
    if signatures:
        last = signatures[-1]
        return {"id": last.get("user_id"), "name": last.get("user_name", "")}
    return None


def block_for(node, user) -> tuple[str, dict] | None:
    """None when `user` may decide `node`; else `(code, extra_fields)`."""
    from apps.perm.checker import check_permission
    from apps.workflow.models import NodeStatus

    if node.status != NodeStatus.PENDING:
        if node.timed_out_at is not None and node.approver_id is None:
            return "deadline_passed", {}
        return "already_handled", {"handled_by": handled_by(node)}
    if check_permission(user, "workflow.approve") and node.can_approve(user):
        return None
    if node.timed_out_at is not None:
        return "deadline_passed", {}
    return "permission_changed", {}
