"""
Dispatch service — handles cross-tenant soul dispatching logic.
"""
from django.db import transaction
from django.utils import timezone
from apps.dispatch.models import DispatchRecord, DispatchStatus, CrossTenantJudgment, CrossTenantJudgmentParticipant
from apps.souls.models import Soul, SoulState
from apps.events.models import SoulEvent, EventType
from apps.tenants.models import Notification


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

        # Check no active dispatch exists for this soul
        active_dispatch = DispatchRecord.objects.filter(
            soul=soul,
            status__in=[DispatchStatus.PROPOSED, DispatchStatus.APPROVED]
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

        return dispatch_record

    @staticmethod
    def _notify_target_tenant(dispatch_record):
        """Send notification to target tenant about incoming dispatch proposal."""
        from apps.authentication.models import User

        # Find users in target tenant
        target_users = User.objects.filter(tenant=dispatch_record.target_tenant, is_active=True)
        for user in target_users:
            Notification.objects.create(
                recipient=user,
                notification_type="DISPATCH_PROPOSED",
                title=f"Incoming Dispatch: {dispatch_record.soul.name}",
                message=f"A dispatch proposal for soul {dispatch_record.soul.name} from {dispatch_record.source_tenant.code} is pending your approval.",
                related_object_id=str(dispatch_record.id),
                related_object_type="DispatchRecord",
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
        if dispatch_record.status != DispatchStatus.PROPOSED:
            raise ValueError(f"Cannot approve dispatch in status: {dispatch_record.status}")

        dispatch_record.status = DispatchStatus.APPROVED
        dispatch_record.decided_at = timezone.now()
        dispatch_record.save()

        # Notify source tenant
        DispatchService._notify_approval(dispatch_record, approved=True)

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
        if dispatch_record.status != DispatchStatus.PROPOSED:
            raise ValueError(f"Cannot reject dispatch in status: {dispatch_record.status}")

        dispatch_record.status = DispatchStatus.REJECTED
        dispatch_record.decided_at = timezone.now()
        dispatch_record.reason = f"{dispatch_record.reason}\n\nRejection reason: {reason}"
        dispatch_record.save()

        # Notify source tenant
        DispatchService._notify_approval(dispatch_record, approved=False, reason=reason)

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

        for user in target_users:
            Notification.objects.create(
                recipient=user,
                notification_type=notification_type,
                title=title,
                message=message,
                related_object_id=str(dispatch_record.id),
                related_object_type="DispatchRecord",
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
        if dispatch_record.status != DispatchStatus.APPROVED:
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

            # Update dispatch record
            dispatch_record.status = DispatchStatus.EXECUTED
            dispatch_record.executed_at = timezone.now()
            dispatch_record.save()

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
        if dispatch_record.status not in [DispatchStatus.PROPOSED, DispatchStatus.APPROVED]:
            raise ValueError(f"Cannot cancel dispatch in status: {dispatch_record.status}")

        dispatch_record.status = DispatchStatus.CANCELLED
        dispatch_record.decided_at = timezone.now()
        dispatch_record.save()

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
        if judgment.status != "PROPOSED":
            raise ValueError("Can only add participants to proposed judgments")

        participant = CrossTenantJudgmentParticipant.objects.create(
            judgment=judgment,
            participant_tenant=participant_tenant,
            participant_actor=participant_actor,
            role=role,
            tenant=participant_tenant,
        )

        # Notify initiating tenant
        from apps.authentication.models import User
        from apps.tenants.models import Notification

        target_users = User.objects.filter(tenant=judgment.initiating_tenant, is_active=True)
        for user in target_users:
            Notification.objects.create(
                recipient=user,
                notification_type="CROSS_JUDGMENT_INVITED",
                title=f"Participant Joined: {judgment.title}",
                message=f"{participant_tenant.code} has joined as {role}.",
                related_object_id=str(judgment.id),
                related_object_type="CrossTenantJudgment",
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
        if judgment.status != "PROPOSED":
            raise ValueError(f"Cannot activate judgment in status: {judgment.status}")

        CrossTenantJudgment.objects.filter(id=judgment.id).update(status="ACTIVE")
        return CrossTenantJudgment.objects.get(id=judgment.id)

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
        if judgment.status != "ACTIVE":
            raise ValueError(f"Cannot conclude judgment in status: {judgment.status}")

        judgment.status = "CONCLUDED"
        judgment.concluded_at = timezone.now()
        judgment.conclusion_type = conclusion_type
        judgment.save()

        # Notify all participants
        from apps.authentication.models import User
        from apps.tenants.models import Notification

        for participant in judgment.participants.all():
            target_users = User.objects.filter(tenant=participant.participant_tenant, is_active=True)
            for user in target_users:
                Notification.objects.create(
                    recipient=user,
                    notification_type="JUDGMENT_CONCLUDED",
                    title=f"Judgment Concluded: {judgment.title}",
                    message=f"The cross-tenant judgment '{judgment.title}' has concluded with result: {conclusion_type}",
                    related_object_id=str(judgment.id),
                    related_object_type="CrossTenantJudgment",
                )

        return judgment