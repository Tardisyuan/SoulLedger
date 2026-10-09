"""加签 (add a co-signer to the CURRENT node) -- distinct from 会签 (`countersign.py`).

A 会签 node is born with its signers. 加签 is done to a node that already has one
designated approver (an actor or a role): that approver adds a colleague, and the
colleague must also sign before the approver's own approval counts (前加签).

THE RULE, stated once:

    * only the node's designated approver adds, only while the node is PENDING
      and of kind APPROVAL (a 会签 node's signers ARE its designation);
    * the co-signer is an active, non-soul user of the SAME hall, not the adder,
      holding `workflow.approve`, not already a co-signer, and not someone who
      could already decide the node alone (a same-role colleague on a ROLE node);
    * a co-signer's approval is recorded and the node stays PENDING; a co-signer's
      refusal refuses the node, as any refusal does;
    * the designated approver's approval is refused (`cosigners_pending`) until
      every co-signer has signed. A refusal is never blocked.

Entries of `ApprovalNode.cosigners_json`:
    {user_id, user_name, added_by_id, added_at, signed_at}   (signed_at null = owed)
"""
from __future__ import annotations

from django.utils import timezone

NOT_ALLOWED = "not_allowed"
NOT_ELIGIBLE = "not_eligible"
DUPLICATE = "duplicate"


class CosignRefusedError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail or code


def _slot(node, user):
    for entry in node.cosigners_json or []:
        if str(entry.get("user_id")) == str(user.pk):
            return entry
    return None


def is_pending_cosigner(node, user) -> bool:
    entry = _slot(node, user)
    return entry is not None and not entry.get("signed_at")


def owes_signatures(node) -> bool:
    return any(not e.get("signed_at") for e in node.cosigners_json or [])


def sign(node, user) -> None:
    """Record `user`'s approval as co-signer (in memory; the caller saves)."""
    entry = _slot(node, user)
    entry["signed_at"] = timezone.now().isoformat()


def blocks_approval(node, user, passed: bool) -> bool:
    """True when `user` is the designated approver trying to pass a node that still owes co-signatures."""
    return bool(passed and owes_signatures(node) and _slot(node, user) is None)


def add(node, adder, candidate) -> dict:
    """Validate and append `candidate` as a co-signer of `node`. Raises CosignRefusedError.

    The caller holds the node lock and saves `cosigners_json`.
    """
    from apps.perm.checker import check_permission
    from apps.workflow.models import NodeKind, NodeStatus

    if node.status != NodeStatus.PENDING or node.kind != NodeKind.APPROVAL:
        raise CosignRefusedError(NOT_ALLOWED, "co-signers can only be added to a pending approval node")
    if _slot(node, adder) is not None or not node.can_approve(adder):
        raise CosignRefusedError(NOT_ALLOWED, "only the node's designated approver can add a co-signer")
    if (
        candidate.pk == adder.pk
        or not candidate.is_active
        or candidate.role == "SOUL"
        or candidate.tenant_id is None
        or candidate.tenant_id != adder.tenant_id
        or not check_permission(candidate, "workflow.approve")
    ):
        raise CosignRefusedError(NOT_ELIGIBLE, "the co-signer must be another active officer of this hall who may approve")
    if _slot(node, candidate) is not None or node.can_approve(candidate):
        raise CosignRefusedError(DUPLICATE, "already a co-signer, or already able to decide this node")
    entry = {
        "user_id": candidate.pk,
        "user_name": candidate.display_name or candidate.username,
        "added_by_id": adder.pk,
        "added_at": timezone.now().isoformat(),
        "signed_at": None,
    }
    node.cosigners_json = [*(node.cosigners_json or []), entry]
    return entry
