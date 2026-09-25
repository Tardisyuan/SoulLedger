"""会签 (countersign): N signers, a threshold, and when the node is decided.

A countersign node carries `signers_json` — each signer resolved by
`WorkflowService._resolve_approver` at creation, exactly as a single approver
would be — and `threshold`, the number of approvals that pass it (null: all of
them). Each signer is a *slot*; a user signs the first open slot that
designates them, once.

THE RULE, stated once so the code below can be checked against it:

    n = number of signers, k = threshold (1 ≤ k ≤ n; null means n)
    passes  as soon as approvals  ≥ k
    fails   as soon as rejections > n − k   (k approvals are then impossible)
    otherwise the node stays PENDING and the flow stays on it

So with the default k = n every signer must approve and any one refusal fails
the node; with k = 1 any one approval passes it and it fails only when all
have refused. The node is decided the moment the outcome is certain — nobody
waits for signatures that cannot change it.
"""
from __future__ import annotations

OPEN = "OPEN"
PASSED = "PASSED"
FAILED = "FAILED"


def _threshold(node) -> int:
    n = len(node.signers_json or [])
    k = node.threshold or n
    return max(1, min(k, n)) if n else 0


def _matches(slot: dict, user) -> bool:
    if slot.get("approver_type") == "ACTOR":
        actor_id = slot.get("approver_actor_id")
        return actor_id is not None and str(getattr(user, "actor_id", None)) == str(actor_id)
    if slot.get("approver_type") == "ROLE":
        role = slot.get("approver_role")
        return bool(role) and getattr(user, "role", None) == role
    return False


def designates_anybody(node) -> bool:
    return any(s.get("approver_type") in ("ACTOR", "ROLE") and (
        s.get("approver_actor_id") or s.get("approver_role")) for s in node.signers_json or [])


def open_slot(node, user) -> int | None:
    """The index of the first unsigned slot `user` fills, or None.

    A user who has already signed any slot of this node gets None: one person
    is one signature, even when two slots name the same role.
    """
    signed = {s["signer"] for s in node.signatures_json or []}
    if any(str(s.get("user_id")) == str(user.pk) for s in node.signatures_json or []):
        return None
    for index, slot in enumerate(node.signers_json or []):
        if index not in signed and _matches(slot, user):
            return index
    return None


def outcome(node) -> str:
    n = len(node.signers_json or [])
    k = _threshold(node)
    approvals = sum(1 for s in node.signatures_json or [] if s.get("passed"))
    rejections = sum(1 for s in node.signatures_json or [] if not s.get("passed"))
    if n and approvals >= k:
        return PASSED
    if rejections > n - k:
        return FAILED
    return OPEN


def sign(node, user, verdict: str, notes: str, now) -> str | None:
    """Record `user`'s signature on `node` (in memory) and return the outcome.

    None when the user holds no open slot — the caller refuses the decision.
    The caller saves `signatures_json`; this function does not touch the DB.
    """
    slot = open_slot(node, user)
    if slot is None:
        return None
    node.signatures_json = [
        *(node.signatures_json or []),
        {
            "signer": slot,
            "user_id": user.pk,
            "user_name": getattr(user, "display_name", "") or user.username,
            "verdict": verdict,
            "passed": verdict in ("PASSED", "CONFIRMED"),
            "notes": notes,
            "at": now.isoformat(),
        },
    ]
    return outcome(node)
