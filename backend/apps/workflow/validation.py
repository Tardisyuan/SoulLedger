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
    for n in nodes:
        nid = str(n.get("id") or "")
        if not str(n["node_name"]).strip():
            issues.append({"node": nid, "code": "name_empty"})
        for field in ("on_pass", "on_fail"):
            target = n.get(field)
            if not target:
                continue
            if str(target) == nid:
                issues.append({"node": nid, "code": "self_route", "field": field})
            elif str(target) not in ids:
                issues.append({"node": nid, "code": "dangling_route", "field": field})
    return issues
