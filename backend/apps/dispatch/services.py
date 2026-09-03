"""
Dispatch service — handles cross-tenant soul dispatching logic.
"""
from django.db import transaction
from django.utils import timezone

from apps.dispatch.models import (
    CrossTenantJudgment,
    CrossTenantJudgmentParticipant,
    DispatchRecord,
    DispatchStatus,
    JudgmentStatus,
)
from apps.events.models import EventType, SoulEvent


class DispatchService:
    """
    Service for managing cross-tenant soul dispatch operations.
    """

    @staticmethod
    def propose(source_tenant, target_tenant, soul, dispatcher, reason):
        """
        Propose a cross-tenant dispatch.

        Args:
            source_tenant: Tenant the soul currently belongs to
            target_tenant: Tenant to receive the soul
            soul: Soul to dispatch
            dispatcher: User proposing the dispatch
            reason: Reason for dispatch

        Returns:
            DispatchRecord: The created dispatch record

        Raises:
            ValueError: If soul doesn't belong to source tenant or active dispatch exists
        """
        # Validate soul belongs to source tenant
        if str(soul.tenant_id) != str(source_tenant.id):
            raise ValueError("Soul does not belong to the specified source tenant")

        # Check no active dispatch exists for this soul.
        # _base_manager is the unfiltered manager, used here (not objects) so this
        # check works regardless of tenant contextvar state. A soft-deleted
        # dispatch should not count as active: the DB's own uniqueness guard
        # (unique_active_dispatch, see models.py) already scopes "active" to
        # is_deleted=False & status in [PROPOSED, APPROVED] — mirror that here
        # so this pre-check can't reject a create the DB constraint would allow.
        active_dispatch = DispatchRecord._base_manager.filter(
            soul=soul,
            status__in=[DispatchStatus.PROPOSED, DispatchStatus.APPROVED],
            is_deleted=False,
        ).exists()
        if active_dispatch:
            raise ValueError("An active dispatch already exists for this soul")

        with transaction.atomic():
            dispatch_record = DispatchRecord.objects.create(
                source_tenant=source_tenant,
                target_tenant=target_tenant,
                soul=soul,
                dispatched_by=dispatcher,
                status=DispatchStatus.PROPOSED,
                reason=reason,
                tenant=source_tenant,
            )

        # Notify target tenant
        DispatchService._notify_target_tenant(dispatch_record)

        # Log domain event
        SoulEvent.objects.create(
            tenant=source_tenant,
            soul=soul,
            event_type=EventType.STATE_CHANGED,
            payload={
                "action": "DISPATCH_PROPOSED",
                "dispatch_id": str(dispatch_record.id),
                "target_tenant": target_tenant.code,
                "reason": reason,
            },
            actor=str(dispatcher),
        )

        return dispatch_record

    @staticmethod
    def _notify_target_tenant(dispatch_record):
        """Tell the target tenant a proposal is waiting on them.

        Through `EventService.notify_user`, which is the path the notification
        API and the WebSocket consumer both read. The previous spelling built
        `apps.tenants.Notification` rows in bulk; nothing in this codebase ever
        selected from that table, so this message — the one that says a
        dispatch needs your approval — has never reached anybody.

        One event per user rather than one `bulk_create`. That is the cost of
        the change and it is deliberate: `bulk_create` emits no `post_save`, so
        a row written that way cannot reach the bus, the socket, or a webhook
        even if a reader were added later. Target tenants have operators, not
        populations.
        """
        from apps.authentication.models import User
        from apps.events.services import EventService

        target_users = User.objects.filter(tenant=dispatch_record.target_tenant, is_active=True)
        for user in target_users:
            EventService.notify_user(
                user,
                title=f"Incoming Dispatch: {dispatch_record.soul.name}",
                message=(
                    f"A dispatch proposal for soul {dispatch_record.soul.name} "
                    f"from {dispatch_record.source_tenant.code} is pending your approval."
                ),
                notification_type="DISPATCH_PROPOSED",
                related_resource="DispatchRecord",
                related_id=str(dispatch_record.id),
            )

    @staticmethod
    def approve(dispatch_record, approver):
        """
        Approve a proposed dispatch.

        Args:
            dispatch_record: DispatchRecord to approve
            approver: User approving the dispatch

        Returns:
            DispatchRecord: Updated dispatch record
        """
        if not dispatch_record.transition_to(DispatchStatus.APPROVED, decided_at=timezone.now()):
            raise ValueError(f"Cannot approve dispatch in status: {dispatch_record.status}")

        # Notify source tenant
        DispatchService._notify_approval(dispatch_record, approved=True)

        # Log domain event
        SoulEvent.objects.create(
            tenant=dispatch_record.source_tenant,
            soul=dispatch_record.soul,
            event_type=EventType.STATE_CHANGED,
            payload={"action": "DISPATCH_APPROVED", "dispatch_id": str(dispatch_record.id)},
            actor=str(approver),
        )

        return dispatch_record

    @staticmethod
    def reject(dispatch_record, rejector, reason=""):
        """
        Reject a proposed dispatch.

        Args:
            dispatch_record: DispatchRecord to reject
            rejector: User rejecting the dispatch
            reason: Reason for rejection

        Returns:
            DispatchRecord: Updated dispatch record
        """
        if not dispatch_record.transition_to(DispatchStatus.REJECTED, decided_at=timezone.now()):
            raise ValueError(f"Cannot reject dispatch in status: {dispatch_record.status}")
        dispatch_record.reason = f"{dispatch_record.reason}\n\nRejection reason: {reason}"
        dispatch_record.save(update_fields=["reason"])

        # Notify source tenant
        DispatchService._notify_approval(dispatch_record, approved=False, reason=reason)

        # Log domain event
        SoulEvent.objects.create(
            tenant=dispatch_record.source_tenant,
            soul=dispatch_record.soul,
            event_type=EventType.STATE_CHANGED,
            payload={"action": "DISPATCH_REJECTED", "dispatch_id": str(dispatch_record.id), "reason": reason},
            actor=str(rejector),
        )

        return dispatch_record

    @staticmethod
    def _notify_approval(dispatch_record, approved, reason=""):
        """Notify source tenant about dispatch approval/rejection."""
        from apps.authentication.models import User

        target_users = User.objects.filter(tenant=dispatch_record.source_tenant, is_active=True)
        notification_type = "DISPATCH_APPROVED" if approved else "DISPATCH_REJECTED"
        title = f"Dispatch {'Approved' if approved else 'Rejected'}: {dispatch_record.soul.name}"
        message = f"Your dispatch proposal for soul {dispatch_record.soul.name} to {dispatch_record.target_tenant.code} has been {'approved' if approved else 'rejected'}."
        if reason:
            message += f" Reason: {reason}"

        from apps.events.services import EventService

        for user in target_users:
            EventService.notify_user(
                user,
                title=title,
                message=message,
                notification_type=notification_type,
                related_resource="DispatchRecord",
                related_id=str(dispatch_record.id),
            )

    @staticmethod
    def execute(dispatch_record, executor):
        """
        Execute an approved dispatch: transfer soul to target tenant.

        Args:
            dispatch_record: DispatchRecord to execute
            executor: User executing the dispatch

        Returns:
            DispatchRecord: Updated dispatch record

        Raises:
            ValueError: If dispatch is not in APPROVED status
        """
        if not dispatch_record.can_transition_to(DispatchStatus.EXECUTED):
            raise ValueError(f"Cannot execute dispatch in status: {dispatch_record.status}")

        with transaction.atomic():
            # Transfer soul to target tenant
            soul = dispatch_record.soul
            old_tenant = soul.tenant
            soul.tenant = dispatch_record.target_tenant
            soul.save()

            # Create soul event
            SoulEvent.objects.create(
                tenant=dispatch_record.target_tenant,
                soul=soul,
                event_type=EventType.STATE_CHANGED,
                payload={
                    "action": "DISPATCH_EXECUTED",
                    "from_tenant": old_tenant.code,
                    "to_tenant": dispatch_record.target_tenant.code,
                    "dispatch_id": str(dispatch_record.id),
                },
                actor=str(executor),
            )

            # Update dispatch record via state machine
            dispatch_record.transition_to(DispatchStatus.EXECUTED, executed_at=timezone.now())

        return dispatch_record

    @staticmethod
    def cancel(dispatch_record, canceller):
        """
        Cancel a proposed dispatch.

        Args:
            dispatch_record: DispatchRecord to cancel
            canceller: User cancelling the dispatch

        Returns:
            DispatchRecord: Updated dispatch record
        """
        if not dispatch_record.transition_to(DispatchStatus.CANCELLED, decided_at=timezone.now()):
            raise ValueError(f"Cannot cancel dispatch in status: {dispatch_record.status}")

        return dispatch_record


class CrossTenantJudgmentService:
    """
    Service for managing cross-tenant judgments.
    """

    @staticmethod
    @transaction.atomic
    def create(title, description, initiating_tenant, creator):
        """
        Create a new cross-tenant judgment.

        Args:
            title: Judgment title
            description: Judgment description
            initiating_tenant: Tenant initiating the judgment
            creator: User creating the judgment

        Returns:
            CrossTenantJudgment: Created judgment
        """
        judgment = CrossTenantJudgment.objects.create(
            title=title,
            description=description,
            initiating_tenant=initiating_tenant,
            status="PROPOSED",
            tenant=initiating_tenant,
        )

        return judgment

    @staticmethod
    @transaction.atomic
    def add_participant(judgment, participant_tenant, participant_actor, role):
        """
        Add a participant to a cross-tenant judgment.

        Args:
            judgment: CrossTenantJudgment
            participant_tenant: Tenant to add as participant
            participant_actor: Actor representing the participant
            role: Participant role (ADVISOR, CO_JUDGE, CHAIRMAN)

        Returns:
            CrossTenantJudgmentParticipant: Created participant record
        """
        if judgment.status != JudgmentStatus.PROPOSED:
            raise ValueError("Can only add participants to proposed judgments")

        participant = CrossTenantJudgmentParticipant.objects.create(
            judgment=judgment,
            participant_tenant=participant_tenant,
            participant_actor=participant_actor,
            role=role,
            tenant=participant_tenant,
        )

        # Notify initiating tenant, through the bus so the row lands in the
        # model the notification API actually serves.
        from apps.authentication.models import User
        from apps.events.services import EventService

        target_users = User.objects.filter(tenant=judgment.initiating_tenant, is_active=True)
        for user in target_users:
            EventService.notify_user(
                user,
                title=f"Participant Joined: {judgment.title}",
                message=f"{participant_tenant.code} has joined as {role}.",
                notification_type="CROSS_JUDGMENT_INVITED",
                related_resource="CrossTenantJudgment",
                related_id=str(judgment.id),
            )

        # Activate judgment after participant joins
        CrossTenantJudgmentService.activate(judgment)
        return participant

    @staticmethod
    @transaction.atomic
    def activate(judgment):
        """
        Activate a cross-tenant judgment (after participants join).

        Args:
            judgment: CrossTenantJudgment to activate

        Returns:
            CrossTenantJudgment: Updated judgment
        """
        if not judgment.transition_to(JudgmentStatus.ACTIVE):
            raise ValueError(f"Cannot activate judgment in status: {judgment.status}")
        return judgment

    @staticmethod
    @transaction.atomic
    def conclude(judgment, conclusion_type, conclude_by):
        """
        Conclude a cross-tenant judgment.

        Args:
            judgment: CrossTenantJudgment to conclude
            conclusion_type: PASS or FAIL
            conclude_by: User concluding the judgment

        Returns:
            CrossTenantJudgment: Updated judgment
        """
        if not judgment.transition_to(JudgmentStatus.CONCLUDED, concluded_at=timezone.now(), conclusion_type=conclusion_type):
            raise ValueError(f"Cannot conclude judgment in status: {judgment.status}")

        # Notify all participants, through the bus for the same reason.
        from apps.authentication.models import User
        from apps.events.services import EventService

        for participant in judgment.participants.all():
            target_users = User.objects.filter(
                tenant=participant.participant_tenant, is_active=True
            )
            for user in target_users:
                EventService.notify_user(
                    user,
                    title=f"Judgment Concluded: {judgment.title}",
                    message=(
                        f"The cross-tenant judgment '{judgment.title}' has concluded "
                        f"with result: {conclusion_type}"
                    ),
                    notification_type="JUDGMENT_CONCLUDED",
                    related_resource="CrossTenantJudgment",
                    related_id=str(judgment.id),
                )

        return judgment
