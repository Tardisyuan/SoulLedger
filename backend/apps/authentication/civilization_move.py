"""Moving an account to another civilization (user decision 2026-11-16).

No ordinary edit path changes a user's civilization: the profile, `PATCH /users/{id}/` and the Django admin all
refuse or hide it (`UserUpdateSerializer.to_internal_value`, `UserAdmin.readonly_fields`). This is the one way,
for SYSTEM_ADMIN only (`POST /users/{id}/migrate-civilization/`, `manage.py migrate_account_civilization`).

A hall-bound account moves hall, organization and civilization in one save -- never a hall of one civilization
with a civilization of another. A civilization ADMIN (no hall) moves its `civilization` only. Soul accounts are
refused: a soul changes civilization only by cross-civilization dispatch. SYSTEM_ADMIN has no civilization.

Refused while the account holds open work (`OPEN_WORK`, derived from every foreign key to User whose row has an
open state; the keys left out are listed under it with the reason). On success every session ends (refresh
tokens blacklisted, `session_version` bumped) so the next token carries the new hall and the reads route to the
new civilization's shard (`apps/core/shard_reads.py::current_context`), and one audit row records who, from, to
and the reason.
"""
from django.db import transaction
from django.db.models import Q

from apps.souls.models import Civilization


class MoveRefusedError(Exception):
    def __init__(self, code, detail, status=400, **extra):
        super().__init__(detail)
        self.code, self.detail, self.status, self.extra = code, detail, status, extra


def _claimed_judgments(user):
    from apps.judgment.models import OPEN_Q, Judgment

    return Judgment.objects.filter(OPEN_Q, claimed_by=user, is_archived=False)


def _appeals_in_review(user):
    from apps.judgment.models import OPEN_APPEAL_STATUSES, JudgmentAppeal

    return JudgmentAppeal.objects.filter(reviewer=user, status__in=OPEN_APPEAL_STATUSES)


def _city_gods(user):
    from apps.judgment.models import CityGod

    return CityGod.objects.filter(officers=user)


def _tudi_gods(user):
    from apps.death_sync.models import TudiGod

    return TudiGod.objects.filter(officers=user)


def _letters(user):
    from apps.chat.models import Conversation, ConversationKind

    return Conversation.objects.filter(kind=ConversationKind.OFFICER_INBOX, assignee=user, closed_at__isnull=True)


def _approval_nodes(user):
    from apps.workflow.models import ApprovalNode, NodeStatus

    return ApprovalNode.objects.filter(approver=user, status=NodeStatus.PENDING)


def _dispatches(user):
    from apps.dispatch.models import DispatchRecord, DispatchStatus

    return DispatchRecord.objects.filter(
        dispatched_by=user, status__in=(DispatchStatus.DRAFT, DispatchStatus.PROPOSED, DispatchStatus.APPROVED))


def _cross_judgments(user):
    from apps.dispatch.models import CrossTenantJudgment, JudgmentStatus

    return CrossTenantJudgment.objects.filter(
        create_user=user, status__in=(JudgmentStatus.PROPOSED, JudgmentStatus.ACTIVE))


def _sentence_requests(user):
    """Pending requests it filed, and pending requests on a plan whose original judgment it concluded (the
    original judge decides them, `apps/sentence_plan/requests.py::_assert_may_decide_reopen`)."""
    from apps.judgment.models import Judgment
    from apps.sentence_plan.models import SentencePlanRequest, SentenceRequestStatus

    concluded = Judgment.all_objects.filter(concluded_by=user).values("pk")
    return SentencePlanRequest.objects.filter(status=SentenceRequestStatus.PENDING).filter(
        Q(create_user=user) | Q(plan__origin_judgment_id__in=concluded))


#: What counts as open work. From `_meta` of every model with a key to User (2026-11-16), those with an open state.
#: Checked and left out: `Judgment.deferred_by` / `reassign_requested_by` / `concluded_by` / `sent_on_by` (an act
#: done, not work held), `WorkflowSegment.picked_by` (a pick already made), `DispatchRecord.decided_by`,
#: `CrossTenantJudgment.ended_by`, `CrossTenantJudgmentParticipant.sentence_submitted_by`, `SentencePlanRequest.
#: decided_by`, `CooldownShorteningRequest.decided_by`, `social.Report.resolved_by` (decisions taken), `Disposition`
#: and `SentencePlan` / `SentenceNode` (no key to an officer but the audit columns), `AIDraft.created_by` (a draft
#: the officer may discard), and the per-user rows (sessions, devices, notifications, preferences, social).
OPEN_WORK = {
    "judgments": _claimed_judgments,
    "appeals": _appeals_in_review,
    "city_gods": _city_gods,
    "tudi_gods": _tudi_gods,
    "letters": _letters,
    "approval_nodes": _approval_nodes,
    "dispatches": _dispatches,
    "cross_judgments": _cross_judgments,
    "sentence_requests": _sentence_requests,
}


#: The four rows the dialog shows (Design batch 54 H1): each kind folds into the nearest. Letters assigned to it and
#: its seats on a city god / tudi god are things in its hands, like a claimed case; a pending sentence-plan request
#: waits on its decision, like an approval step.
GROUPS = {
    "claimed": ("judgments", "appeals", "letters", "city_gods", "tudi_gods"),
    "approvals": ("approval_nodes", "sentence_requests"),
    "dispatch": ("dispatches",),
    "cross": ("cross_judgments",),
}


def open_work(user) -> dict:
    """{kind: count} of the open work `user` holds, only the kinds with any."""
    counts = {name: rows(user).count() for name, rows in OPEN_WORK.items()}
    return {k: v for k, v in counts.items() if v}


def grouped(work) -> dict:
    """`open_work` as the four rows of the dialog, zeros included."""
    return {group: sum(work.get(k, 0) for k in kinds) for group, kinds in GROUPS.items()}


def civilization_of(user):
    """The civilization an account belongs to: its hall's, or a hall-less ADMIN's own `civilization`."""
    if user.tenant_id is not None:
        return user.tenant.known_civilization
    return user.civilization or None


def migrate(user, *, civilization, hall=None, organization=None, reason, actor, request=None):
    """Move `user` to `civilization`. Raises `MoveRefusedError` naming the condition that failed; returns the audit row."""
    from apps.audit.models import AuditAction
    from apps.audit.signals import explicit_audit_for, write_audit_row
    from apps.core.client_ip import get_client_ip
    from apps.core.tenant import is_tenant_exempt
    from apps.events.realtime import close_user_sockets

    from .passwords import end_push_registrations, end_sessions

    if actor is None or not is_tenant_exempt(actor):
        raise MoveRefusedError("system_admin_only", "Only the system administrator moves an account to another "
                          "civilization.", status=403)
    reason = (reason or "").strip()
    if not reason:
        raise MoveRefusedError("reason_required", "Give a reason; it is kept in the audit log.")
    if civilization not in Civilization.values:
        raise MoveRefusedError("civilization_invalid", f"{civilization!r} is not a civilization.")
    if user.role == "SOUL":
        raise MoveRefusedError("soul_account", "A soul changes civilization only by a cross-civilization dispatch.",
                          status=409)
    if user.role == "SYSTEM_ADMIN":
        raise MoveRefusedError("system_admin_account", "The system administrator belongs to no civilization.", status=409)
    before = civilization_of(user)
    if before == civilization:
        raise MoveRefusedError("same_civilization", f"The account is already of {civilization}.")
    hall_less_admin = user.role == "ADMIN" and user.tenant_id is None
    if hall_less_admin:
        if hall is not None:
            raise MoveRefusedError("hall_not_allowed", "A civilization administrator has no hall.")
    else:
        if hall is None:
            raise MoveRefusedError("hall_required", "Give a hall of the new civilization for this account.")
        if hall.known_civilization != civilization:
            raise MoveRefusedError("hall_of_another_civilization", f"{hall.code} is not a hall of {civilization}.")
        if not hall.is_active:
            raise MoveRefusedError("hall_inactive", f"{hall.code} is closed.")
    if organization is not None and (hall is None or organization.tenant_id != hall.pk):
        raise MoveRefusedError("organization_of_another_hall", "The organization must belong to the new hall.")
    work = open_work(user)
    if work:
        raise MoveRefusedError("account_has_open_work", "The account still holds open work; finish it or hand it over first.",
                          status=409, open_work=grouped(work), open_work_kinds=work)

    old = {"civilization": before, "tenant": user.tenant.code if user.tenant_id else None,
           "organization": user.organization_id}
    with transaction.atomic():
        if hall_less_admin:
            user.civilization = civilization
            fields = ["civilization"]
        else:
            from .serializers import default_officer_organization

            user.tenant = hall
            user.organization = default_officer_organization(hall, user.role, organization)
            user.civilization = None
            fields = ["tenant", "organization", "civilization"]
        with explicit_audit_for(user):
            user.save(update_fields=fields)
        end_sessions(user)
        end_push_registrations(user)
        close_user_sockets(user.pk)
        new = {"civilization": civilization, "tenant": hall.code if hall is not None else None,
               "organization": user.organization_id}
        return write_audit_row(
            tenant=hall, user=actor, action=AuditAction.UPDATE, resource="user", resource_id=str(user.pk),
            description=f"civilization moved {before} -> {civilization}: {reason}"[:500],
            changes={k: [old[k], new[k]] for k in old if old[k] != new[k]} | {"reason": reason},
            ip_address=get_client_ip(request) if request is not None else None,
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else "",
        )
