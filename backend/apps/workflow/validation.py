"""What a template graph must satisfy before it can be PUBLISHED.

Drafts are never validated: a half-drawn flow is a normal thing to save.
`versioning.publish` runs this and refuses with the list; the editor's
`workflowValidation.ts` runs the same rules client-side so 发布 can be disabled
before the round trip. The codes are the contract between the two — they are
the i18n keys' last segment on the frontend.

Each issue is ``{"node": <template node id or "">, "code": <code>, ...detail}``.

LINEAR AND GRAPH TEMPLATES
--------------------------
The engine's default PASS successor is "the first PENDING node by order"
(`ApprovalWorkflow._pass_successor`, pinned by
`tests/test_workflow_conditional_routing.py`). Under that rule every node of a
linear template is reached on an all-pass run and every node has an exit —
the order itself — so "unreachable" and "no exit" cannot happen and are not
checked.

A template with a 结束 node or any condition branch is a GRAPH: it means "the
branch not taken does not run", which only holds if every path ends at a 结束
before the order-based default can pick the skipped nodes up. So in a graph:

* the order is not an edge. Every non-结束 node needs an explicit PASS exit
  (`on_pass`); without one the default would wander into another branch.
* `unreachable` — no explicit edge path from the entry (lowest `node_order`).
* `no_exit` — no `on_pass`, or no PASS path to any 结束.
* `no_end` — a graph with no 结束 at all.
"""
from __future__ import annotations

from apps.workflow import conditions
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
        issues.extend(_kind_issues(n, nid))
        issues.extend(_branch_issues(n, nid, ids))
    issues.extend(_graph_issues(nodes))
    return issues


def _kind(n: dict) -> str:
    return n.get("kind") or "APPROVAL"


def _kind_issues(n: dict, nid: str) -> list[dict]:
    kind = _kind(n)
    if kind == "COUNTERSIGN":
        signers = [s for s in n.get("signers") or [] if isinstance(s, dict)]
        if not signers:
            return [{"node": nid, "code": "countersign_no_signers"}]
        threshold = n.get("threshold")
        if threshold is not None and not 1 <= int(threshold) <= len(signers):
            return [{"node": nid, "code": "threshold_out_of_range"}]
    if kind == "END" and any(n.get(f) for f in ("on_pass", "on_fail", "reject_to", "branches")):
        return [{"node": nid, "code": "end_has_exit"}]
    return []


def _branch_issues(n: dict, nid: str, ids: set) -> list[dict]:
    """Each branch well-formed and satisfiable; no two branches of one node overlap.

    Overlap is decided exactly (`conditions.region` / `overlaps`): two branches
    overlap when one case could satisfy both, and then which one runs would
    depend on their order in a list nobody sees on the canvas.
    """
    out: list[dict] = []
    boxes: list[tuple[str, dict]] = []
    for index, branch in enumerate(n.get("branches") or []):
        if not isinstance(branch, dict):
            out.append({"node": nid, "code": "condition_invalid", "branch": str(index)})
            continue
        bid = str(branch.get("id") or index)
        target = branch.get("target")
        if not target or str(target) not in ids:
            out.append({"node": nid, "code": "dangling_route", "field": "branch", "branch": bid})
        elif str(target) == nid:
            out.append({"node": nid, "code": "self_route", "field": "branch", "branch": bid})
        when = branch.get("when") or []
        if not when:
            out.append({"node": nid, "code": "condition_empty", "branch": bid})
            continue
        errors = [conditions.clause_error(c) for c in when]
        if any(errors):
            out.append({"node": nid, "code": "condition_invalid", "branch": bid,
                        "reason": next(e for e in errors if e)})
            continue
        box = conditions.region(when)
        if box is None:
            out.append({"node": nid, "code": "condition_empty", "branch": bid,
                        "reason": "unsatisfiable"})
            continue
        for other_id, other in boxes:
            if conditions.overlaps(box, other):
                out.append({"node": nid, "code": "condition_overlap", "branches": [other_id, bid]})
        boxes.append((bid, box))
    return out


def _pass_targets(n: dict) -> list[str]:
    targets = [str(b.get("target")) for b in n.get("branches") or []
               if isinstance(b, dict) and b.get("target")]
    if n.get("on_pass"):
        targets.append(str(n["on_pass"]))
    return targets


def _graph_issues(nodes: list[dict]) -> list[dict]:
    is_graph = any(_kind(n) == "END" or n.get("branches") for n in nodes)
    if not is_graph:
        return []
    by_id = {str(n["id"]): n for n in nodes if n.get("id")}
    ends = {nid for nid, n in by_id.items() if _kind(n) == "END"}
    out: list[dict] = []
    if not ends:
        out.append({"node": "", "code": "no_end"})

    # Reachable from the entry over explicit edges only.
    entry = min(nodes, key=lambda n: n["node_order"])
    seen, stack = set(), [str(entry.get("id") or "")]
    while stack:
        nid = stack.pop()
        if nid in seen or nid not in by_id:
            continue
        seen.add(nid)
        n = by_id[nid]
        stack.extend(_pass_targets(n))
        stack.extend(str(n[f]) for f in ("on_fail", "reject_to") if n.get(f))

    # Can reach a 结束 over PASS edges (fixed point over the reverse graph).
    reaches_end = set(ends)
    changed = True
    while changed:
        changed = False
        for nid, n in by_id.items():
            if nid not in reaches_end and any(t in reaches_end for t in _pass_targets(n)):
                reaches_end.add(nid)
                changed = True

    for nid, n in by_id.items():
        if nid not in seen:
            out.append({"node": nid, "code": "unreachable"})
        if _kind(n) != "END" and (not n.get("on_pass") or nid not in reaches_end):
            out.append({"node": nid, "code": "no_exit"})
    return out


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
