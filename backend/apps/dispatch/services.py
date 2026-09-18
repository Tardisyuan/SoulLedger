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


class ResidenceReturnBlockedError(Exception):
    """灵魂还有未结案的审判,暂居不能结束(2026-09-18 用户决定)。

    不是 ValueError:`return_home` 把 ValueError 一律答 409 且不带 `code`,
    这一条要带 `code` 与未结案审判的 id,让官员知道该去结哪一案。
    """

    code = "open_judgment"

    def __init__(self, judgment_ids):
        self.judgment_ids = [str(pk) for pk in judgment_ids]
        super().__init__(
            "Soul has an open judgment; conclude or withdraw it before the residence can end"
        )


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
        # 暂居中的灵魂不再转调(保守默认,待用户确认)。调拨由原租户发起;暂居租户若能
        # 再把它送往第三个文明,「处置执行完毕回归原文明」就要回答「回到哪一站」,
        # 而暂居链上的每一站都会成为新的回归点。先回归,再由原租户发起下一段。
        if soul.is_residing:
            raise ValueError(
                "Soul is residing away from its home tenant; it must return home "
                "before its home tenant can dispatch it again"
            )

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
        Execute an approved dispatch: the soul starts residing in the target tenant.

        暂居开始。`soul.tenant` 切到目标租户 —— 目标文明的官员据此审判、执行处置,
        租户隔离沿用现状;`soul.home_tenant` 不动。回归见 `end_residence`。

        Raises:
            ValueError: If dispatch is not in APPROVED status, or the soul is no
                longer where the proposal found it.
        """
        from apps.souls.models import Soul

        if not dispatch_record.can_transition_to(DispatchStatus.EXECUTED):
            raise ValueError(f"Cannot execute dispatch in status: {dispatch_record.status}")

        with transaction.atomic():
            soul = Soul.all_objects.select_for_update(of=("self",)).get(pk=dispatch_record.soul_id)
            # 提议时 propose() 检查过这两条;批准到执行之间灵魂可能已经不在源租户
            # (例如被另一条路径调走又没回来)。在行锁下再问一次。
            if soul.tenant_id != dispatch_record.source_tenant_id or soul.is_residing:
                raise ValueError("Soul is no longer held by the source tenant at its home")
            old_tenant = soul.tenant
            soul.tenant = dispatch_record.target_tenant
            soul.save()
            dispatch_record.soul = soul

            # Create soul event
            SoulEvent.objects.create(
                tenant=dispatch_record.target_tenant,
                soul=soul,
                event_type=EventType.STATE_CHANGED,
                payload={
                    "action": "DISPATCH_EXECUTED",
                    "from_tenant": old_tenant.code,
                    "to_tenant": dispatch_record.target_tenant.code,
                    "home_tenant": soul.home_tenant.code,
                    "dispatch_id": str(dispatch_record.id),
                },
                actor=str(executor),
            )

            # Checked, not dropped (BD-16). `can_transition_to` above read the
            # caller's in-memory row; `transition_to` locks the DB row, which
            # may have been cancelled meanwhile. Raising inside the atomic
            # block rolls the soul's tenant change back with it.
            if not dispatch_record.transition_to(DispatchStatus.EXECUTED, executed_at=timezone.now()):
                raise ValueError(f"Cannot execute dispatch in status: {dispatch_record.status}")

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

    RETURN_ON_DISPOSITION = "DISPOSITION_EXECUTED"
    RETURN_MANUAL = "MANUAL"
    RETURN_ON_CASE_CLOSED = "JUDGMENT_CLOSED"

    @staticmethod
    def end_residence(soul, *, actor, trigger, reason=""):
        """暂居结束:`soul.tenant` 回到 `soul.home_tenant`,暂居记录 EXECUTED → RETURNED。

        两个调用方:`DispositionService.execute`(暂居租户的处置执行完毕,与之同一事务)
        与 `DispatchRecordViewSet.return_home`(原租户或 ADMIN 手动结束)。
        灵魂行在锁下读;SoulEvent 与 AuditLog 在同一事务里写,回滚一起回滚。

        暂居记录可能不存在(数据修正过的灵魂);那样仍然回归,返回 None。

        Raises:
            ValueError: 灵魂没有在暂居。
            ResidenceReturnBlockedError: 灵魂还有未结案的审判(任何租户的),什么都不写。
        """
        from apps.audit.models import AuditAction, AuditLog
        from apps.judgment.models import open_judgments
        from apps.souls.models import Soul

        with transaction.atomic():
            locked = Soul.all_objects.select_for_update(of=("self",)).get(pk=soul.pk)
            if not locked.is_residing:
                raise ValueError("Soul is not residing away from its home tenant")
            # 在灵魂行锁下问:与之竞争的「撤案后恢复回归」也走这里,两者串行。
            # ponytail: 开新审判不锁灵魂行,与回归并发时可能漏看一条刚创建的审判;
            # 需要时让 JudgmentViewSet.perform_create 也锁灵魂行。
            open_ids = list(open_judgments(locked).values_list("pk", flat=True))
            if open_ids:
                raise ResidenceReturnBlockedError(open_ids)
            residence = locked.tenant
            record = (
                DispatchRecord._base_manager.select_for_update(of=("self",))
                .filter(soul_id=locked.pk, status=DispatchStatus.EXECUTED,
                        target_tenant_id=locked.tenant_id, is_deleted=False)
                .order_by("-executed_at").first()
            )
            locked.tenant_id = locked.home_tenant_id
            locked.save()
            home = locked.home_tenant
            if record is not None and not record.transition_to(DispatchStatus.RETURNED, returned_at=timezone.now()):
                raise ValueError(f"Cannot return dispatch in status: {record.status}")

            payload = {
                "action": "DISPATCH_RETURNED",
                "trigger": trigger,
                "from_tenant": residence.code,
                "to_tenant": home.code,
                "dispatch_id": str(record.id) if record else None,
                "reason": reason,
            }
            SoulEvent.objects.create(
                tenant=home, soul=locked, event_type=EventType.STATE_CHANGED,
                payload=payload, actor=str(actor),
            )
            AuditLog.objects.create(
                tenant=home,
                user=actor if getattr(actor, "is_authenticated", False) else None,
                action=AuditAction.UPDATE,
                resource="dispatch_record",
                resource_id=str(record.id) if record else str(locked.pk),
                changes={"soul_tenant": [residence.code, home.code], "trigger": trigger},
                description=f"暂居结束({trigger}):{locked.name} {residence.code} → {home.code} {reason}"[:500],
            )

        # 给 `tenant_id` 赋新值时 Django 会丢掉调用方那份缓存的 `tenant` 对象。
        soul.tenant_id = locked.tenant_id
        return record

    @staticmethod
    def record_blocked_return(soul, blocked, disposition):
        """自动回归被未结案审判拦下:留一条 SoulEvent,官员从时间线上看得到为什么没回去。

        写在暂居租户(审判在那里);原属租户经只读例外也读得到这条事件。

        同时给两边的官员发站内通知(`_notify_return_blocked`),**每次暂居只发一次**:
        同一暂居里再有处置执行、再被拦,事件照写,通知不再发。「这次暂居发过没有」
        就是「这次暂居已经有 DISPATCH_RETURN_BLOCKED 事件没有」,不另建表;在灵魂行锁下问,
        两次并发的处置执行不会都看到「没有」。
        只在自动回归被拦时发:手动结束的 409 已经把未结案审判的 id 交给了点按钮的那位官员。
        """
        from apps.souls.models import Soul

        with transaction.atomic():
            # 调用方(`_execute_during_residence`)已持有这把锁;再取一次是可重入的,
            # 让「每次暂居只发一次」不依赖调用方记得先锁。
            locked = Soul.all_objects.select_for_update(of=("self",)).get(pk=soul.pk)
            record = (
                DispatchRecord._base_manager
                .filter(soul_id=locked.pk, status=DispatchStatus.EXECUTED, target_tenant_id=locked.tenant_id,
                        is_deleted=False)
                .order_by("-executed_at").first()
            )
            dispatch_id = str(record.pk) if record else None
            already_told = SoulEvent.all_objects.filter(
                soul_id=locked.pk, payload__action="DISPATCH_RETURN_BLOCKED", payload__dispatch_id=dispatch_id,
            ).exists()
            SoulEvent.objects.create(
                tenant_id=locked.tenant_id, soul=locked, event_type=EventType.STATE_CHANGED,
                payload={
                    "action": "DISPATCH_RETURN_BLOCKED",
                    "code": blocked.code,
                    "open_judgment_ids": blocked.judgment_ids,
                    "disposition_id": str(disposition.pk),
                    "dispatch_id": dispatch_id,
                },
                actor="system",
            )
            if not already_told:
                DispatchService._notify_return_blocked(locked, dispatch_id, len(blocked.judgment_ids))

    #: 「回归被拦下」通知的收件权限。选 `dispatch.read`(ADMIN / MODERATOR / GUARDIAN)而不是
    #: `dispatch.return`(只有 ADMIN / MODERATOR):通知链到调拨记录,收件人必须看得见它;
    #: 而解开它的动作是结案或撤案,不是「结束暂居」—— 那会同样被 409 拦下,所以持有
    #: `dispatch.return` 并不让谁更该知道。JUDGE / VIEWER 不持有 `dispatch.read`,不收。
    RETURN_BLOCKED_PERMISSION = "dispatch.read"

    @staticmethod
    def return_blocked_recipients(soul):
        """原属租户与暂居租户里持有 `dispatch.read` 的在职(is_active)官员。
        ADMIN 经 `check_permission` 的旁路自然在内,但**只限这两个租户的** ADMIN。
        灵魂账号(role=SOUL)`check_permission` 恒为 False,不收 —— 用户明确不推给灵魂。"""
        from apps.authentication.models import User
        from apps.perm.checker import check_permission

        candidates = User.objects.filter(
            tenant_id__in={soul.home_tenant_id, soul.tenant_id}, is_active=True,
        ).order_by("pk")
        return [u for u in candidates if check_permission(u, DispatchService.RETURN_BLOCKED_PERMISSION)]

    @staticmethod
    def _notify_return_blocked(soul, dispatch_id, open_count):
        """存下 zh-Hans 文本(WebSocket 推送与兜底),读时按请求语言重渲染(apps/notifications/messages.py)。
        只带灵魂名与未结案件数,**不带**审判 id、判决或任何案情。"""
        from apps.events.services import EventService
        from apps.notifications import messages

        params = {"soul": soul.name, "count": open_count}
        title, body = messages.render(messages.DEFAULT_LOCALE, "dispatch_return_blocked", params)
        for user in DispatchService.return_blocked_recipients(soul):
            EventService.notify_user(
                user, title=title, message=body, notification_type="DISPATCH_RETURN_BLOCKED",
                related_resource="DispatchRecord" if dispatch_id else "soul",
                related_id=dispatch_id or str(soul.pk), params=params,
            )

    @staticmethod
    def resume_return_after_case_closed(soul, *, judgment):
        """撤案之后,若暂居处置早已执行完毕,补上当时被拦下的回归。

        「暂居处置执行完毕」= 本次暂居开始(调拨记录 `executed_at`)以来,暂居租户对这个
        灵魂有一份**已执行、非永久**的处置,且没有还未执行的处置。后一条让「结案」不必
        单独挂钩:`conclude` 总会在暂居租户新建一份未执行的处置,回归随它执行发生
        (`DispositionService._execute_during_residence`,同一个 `end_residence`)。

        条件不满足、或回归仍被别的未结案审判拦着,就什么都不做,返回 None。
        """
        from apps.disposition.models import Disposition
        from apps.souls.models import Soul

        soul = Soul.all_objects.get(pk=soul.pk)
        if not soul.is_residing:
            return None
        record = (
            DispatchRecord._base_manager
            .filter(soul_id=soul.pk, status=DispatchStatus.EXECUTED, target_tenant_id=soul.tenant_id, is_deleted=False)
            .order_by("-executed_at").first()
        )
        if record is None or record.executed_at is None:
            return None
        residence = Disposition.all_objects.filter(soul_id=soul.pk, tenant_id=soul.tenant_id, is_deleted=False)
        served = residence.filter(is_executed=True, is_eternal=False, executed_at__gte=record.executed_at).exists()
        pending = residence.filter(is_executed=False, is_archived=False, created_at__gte=record.executed_at).exists()
        if not served or pending:
            return None
        try:
            return DispatchService.end_residence(
                soul, actor="system", trigger=DispatchService.RETURN_ON_CASE_CLOSED,
                reason=f"judgment {judgment.pk} closed",
            )
        except (ResidenceReturnBlockedError, ValueError):
            return None


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

        Does NOT activate the judgment. It used to (BD-06): the first
        participant flipped PROPOSED -> ACTIVE and the second was refused by
        the check below, so a "joint" judgment held one participant at most.
        The initiator convenes the bench explicitly through `activate`.
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

        return participant

    @staticmethod
    @transaction.atomic
    def activate(judgment):
        """
        Convene a cross-tenant judgment: PROPOSED -> ACTIVE.

        Refuses an empty bench. A hearing with no participant is not joint,
        and once ACTIVE no participant can be added (see add_participant), so
        activating early would strand the case.

        Args:
            judgment: CrossTenantJudgment to activate

        Returns:
            CrossTenantJudgment: Updated judgment
        """
        if not judgment.participants.exists():
            raise ValueError("Cannot activate a judgment with no participants")
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
