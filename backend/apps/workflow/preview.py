"""Who a template node's approver resolves to — without building a workflow.

THIS DOES NOT DECIDE ANYTHING. It calls `WorkflowService._resolve_approver`, the
method `_create_nodes` calls, with the same arguments `_create_nodes` would pass,
and describes the answer. A second resolver here would be a second opinion that
could disagree with the first in silence — the preview would show 米诺斯 while
the workflow went to SYSTEM. `tests/test_workflow_approver_preview.py` builds the
workflow for real and asserts the two agree, node for node.

What is returned is names and roles only: no user ids, no actor ids. The editor
needs to say "this node will go to 秦广王 (JUDGE), whom two accounts act as" —
not hand out keys to rows it cannot otherwise read.
"""
from __future__ import annotations

from apps.workflow.node_shape import normalize_template_node

#: How many accounts to name per designation. The count is always exact; the
#: list is a sample, because a ROLE on a large tenant is hundreds of people.
USER_SAMPLE = 10


def _users(qs) -> tuple[list[dict], int]:
    qs = qs.filter(is_active=True).order_by("username")
    total = qs.count()
    sample = [
        {"display_name": u.display_name or u.username, "role": u.role}
        for u in qs[:USER_SAMPLE]
    ]
    return sample, total


def describe_assignment(assignment: dict, tenant) -> dict:
    """Describe the kwargs `_resolve_approver` returned, for a person to read."""
    from apps.authentication.models import User

    approver_type = assignment.get("approver_type", "SYSTEM")
    out = {
        "approver_type": approver_type,
        "actor": None,
        "role": None,
        "users": [],
        "user_count": 0,
    }
    if approver_type == "ACTOR":
        actor = assignment["approver_actor"]
        out["actor"] = {
            "name": actor.name,
            "name_zh": actor.name_zh,
            "role": actor.role,
        }
        out["users"], out["user_count"] = _users(User.objects.filter(actor_id=actor.pk))
    elif approver_type == "ROLE":
        role = assignment.get("approver_role") or ""
        out["role"] = role
        out["users"], out["user_count"] = _users(
            User.objects.filter(role=role, tenant=tenant)
        )
    return out


def preview_node(node_def: dict, civilization: str, tenant) -> dict:
    """What `_create_nodes` would assign for `node_def` in `tenant`/`civilization`."""
    from apps.workflow.services import WorkflowService

    node = normalize_template_node(node_def)
    kind = node.get("kind") or "APPROVAL"
    if kind == "END":
        # `_kind_columns` writes SYSTEM for 结束 whatever its label says.
        out = describe_assignment({"approver_type": "SYSTEM"}, tenant)
    else:
        assignment = WorkflowService._resolve_approver(node, civilization, tenant.pk)
        out = describe_assignment(assignment, tenant)
    out["kind"] = kind
    out["signers"] = []
    if kind == "COUNTERSIGN":
        # Each signer through the same resolver `_kind_columns` uses.
        for signer in node.get("signers") or []:
            if not isinstance(signer, dict):
                continue
            assignment = WorkflowService._resolve_approver(
                WorkflowService.signer_def(signer), civilization, tenant.pk
            )
            out["signers"].append(
                {"label": signer.get("label") or "", **describe_assignment(assignment, tenant)}
            )
    return out
