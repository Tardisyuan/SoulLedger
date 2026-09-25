"""What a template graph must satisfy before it can be PUBLISHED.

Drafts are never validated: a half-drawn flow is a normal thing to save.
`versioning.publish` runs this and refuses with the list; the editor's
`workflowValidation.ts` runs the same rules client-side so 发布 can be disabled
before the round trip. The codes are the contract between the two — they are
the i18n keys' last segment on the frontend.

Each issue is ``{"node": <template node id or "">, "code": <code>, ...detail}``.
"""
from __future__ import annotations

from apps.workflow.node_shape import normalize_template_node


def _nodes(raw_nodes: list) -> list[dict]:
    return [
        normalize_template_node(n, position)
        for position, n in enumerate(raw_nodes or [], start=1)
        if isinstance(n, dict)
    ]


def validate_template_nodes(raw_nodes: list) -> list[dict]:
    nodes = _nodes(raw_nodes)
    issues: list[dict] = []
    if not nodes:
        return [{"node": "", "code": "no_nodes"}]

    ids = {str(n["id"]) for n in nodes if n.get("id")}
    order = {str(n["id"]): n["node_order"] for n in nodes if n.get("id")}
    for n in nodes:
        nid = str(n.get("id") or "")
        if not str(n["node_name"]).strip():
            issues.append({"node": nid, "code": "name_empty"})
        for field in ("on_pass", "on_fail", "reject_to"):
            target = n.get(field)
            if not target:
                continue
            if str(target) == nid:
                issues.append({"node": nid, "code": "self_route", "field": field})
            elif str(target) not in ids:
                issues.append({"node": nid, "code": "dangling_route", "field": field})
        issues.extend(_reject_to_issues(n, nid, order))
        issues.extend(_timeout_issues(n, nid))
    return issues


def _reject_to_issues(n: dict, nid: str, order: dict) -> list[dict]:
    """驳回到 must name an EARLIER node, and cannot share a FAIL with on_fail.

    `ApprovalWorkflow._return_to` ignores a target that is not earlier (the
    FAIL then ends the flow), so such a template would publish a 驳回到 that
    silently does nothing. And a node with both would take the return and
    never the route — one of the two the author drew would be dead.
    """
    target = n.get("reject_to")
    if not target or str(target) == nid or str(target) not in order:
        return []
    out = []
    if order[str(target)] >= n["node_order"]:
        out.append({"node": nid, "code": "reject_not_earlier"})
    if n.get("on_fail"):
        out.append({"node": nid, "code": "reject_and_fail_route"})
    return out


def _timeout_issues(n: dict, nid: str) -> list[dict]:
    """Hours and action come as a pair; 转交上级 needs somebody to go to."""
    hours, action = n.get("timeout_hours"), n.get("timeout_action")
    if not hours and not action:
        return []
    if not hours or not action:
        return [{"node": nid, "code": "timeout_incomplete"}]
    if action == "ESCALATE" and not n.get("timeout_role"):
        return [{"node": nid, "code": "timeout_role_missing"}]
    return []
