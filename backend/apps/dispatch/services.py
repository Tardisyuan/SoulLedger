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
    ParticipantRole,
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
        # 暂居中的灵魂不再转调。原是保守默认;受刑计划落地后它就是用户的原话(设计稿
        # docs/ARCHITECTURE-sentence-plan.md §0):「完成后回到 A,检查还有嘛,有 C,那就去 C」——
        # 每一站执行完先回原属,再由原属(计划推进,`SentencePlanService.advance`)发起下一段。
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
            # 受刑计划推进由系统发起(`dispatcher=None`,设计稿 §2.4)。
            actor=str(dispatcher) if dispatcher is not None else "system",
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
        with transaction.atomic():
            # 锁序 灵魂 → 计划 → 节点 → 调拨记录(docs/ARCHITECTURE-sentence-plan.md §8)。
            soul = DispatchService._lock_soul(dispatch_record.soul_id)
            if not dispatch_record.transition_to(DispatchStatus.REJECTED, decided_at=timezone.now()):
                raise ValueError(f"Cannot reject dispatch in status: {dispatch_record.status}")
            dispatch_record.reason = f"{dispatch_record.reason}\n\nRejection reason: {reason}"
            dispatch_record.save(update_fields=["reason"])
            # 系统为受刑计划发起的调拨被拒(Q4):节点退回 PENDING,通知原属判官。
            from apps.sentence_plan.services import SentencePlanService
            SentencePlanService.on_dispatch_refused(soul, dispatch_record)

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
            # 行程拓扑:离开源租户里所在的那一站。到达的那一站(若有)由下面
            # `on_dispatch_executed` 建处置时记;手动调拨没有目的界域,只记离开。
            from apps.realms.path import SoulPathService
            SoulPathService.leave(soul)
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
            # 受刑计划的这一站:节点 DISPATCHING → ACTIVE,按节点内容建处置(同一事务)。
            from apps.sentence_plan.services import SentencePlanService
            SentencePlanService.on_dispatch_executed(soul, dispatch_record)

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
        with transaction.atomic():
            soul = DispatchService._lock_soul(dispatch_record.soul_id)
            if not dispatch_record.transition_to(DispatchStatus.CANCELLED, decided_at=timezone.now()):
                raise ValueError(f"Cannot cancel dispatch in status: {dispatch_record.status}")
            from apps.sentence_plan.services import SentencePlanService
            SentencePlanService.on_dispatch_refused(soul, dispatch_record)

        return dispatch_record

    @staticmethod
    def _lock_soul(soul_id):
        from apps.souls.models import Soul

        return Soul.all_objects.select_for_update(of=("self",)).get(pk=soul_id)

    RETURN_ON_DISPOSITION = "DISPOSITION_EXECUTED"
    RETURN_MANUAL = "MANUAL"
    RETURN_ON_CASE_CLOSED = "JUDGMENT_CLOSED"
    #: 受刑计划被撤销(赦免剩余刑期,2026-09-19 用户决定):与计划完成同一条回归路径。
    RETURN_ON_PLAN_CANCELLED = "PLAN_CANCELLED"

    @staticmethod
    def end_residence(soul, *, actor, trigger, reason=""):
        """暂居结束:`soul.tenant` 回到 `soul.home_tenant`,暂居记录 EXECUTED → RETURNED。

        调用方:`SentencePlanService.advance`(受刑计划这一站刑满)、`DispositionService.execute`
        (无计划的暂居,处置执行完毕)与 `DispatchRecordViewSet.return_home`(原租户或 ADMIN 手动结束)。
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
            # 在灵魂行锁下问。开新审判(`JudgmentViewSet.perform_create`)也锁灵魂行(G7),两者串行。
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
            # 行程拓扑:离开暂居地的那一站(已随处置执行关掉时这里什么都不写)。
            from apps.realms.path import SoulPathService
            SoulPathService.leave(locked)
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
            if trigger == DispatchService.RETURN_MANUAL:
                # 手动结束:这一站的节点 ABORTED,然后推进(设计稿 §3.3 调用点表)。自动回归由
                # `SentencePlanService.advance` 发起,它自己接着推进,这里不再调。
                from apps.sentence_plan.services import SentencePlanService
                SentencePlanService.on_residence_ended_by_hand(locked, record)
                SentencePlanService.advance(locked)

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
    #: 暂居地还通知能结案或撤案的人(2026-09-18 用户决定):`JudgmentViewSet` 的 `conclude` 与
    #: `destroy`(撤案)都要 `judgment.execute`(ADMIN / JUDGE / MODERATOR)。**只限暂居地**:
    #: 案子在那里审;原属地的判官不收。
    RETURN_BLOCKED_CASE_PERMISSION = "judgment.execute"

    @staticmethod
    def return_blocked_recipients(soul):
        """原属租户与暂居租户里持有 `dispatch.read` 的在职(is_active)官员,加上暂居租户里持有
        `judgment.execute` 的在职官员(判官)。
        ADMIN 经 `check_permission` 的旁路自然在内,但**只限这两个租户的** ADMIN。
        灵魂账号(role=SOUL)`check_permission` 恒为 False,不收 —— 用户明确不推给灵魂。"""
        from apps.authentication.models import User
        from apps.perm.checker import check_permission

        candidates = User.objects.filter(
            tenant_id__in={soul.home_tenant_id, soul.tenant_id}, is_active=True,
        ).order_by("pk")
        return [
            u for u in candidates
            if check_permission(u, DispatchService.RETURN_BLOCKED_PERMISSION)
            or (u.tenant_id == soul.tenant_id and check_permission(u, DispatchService.RETURN_BLOCKED_CASE_PERMISSION))
        ]

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


def _seat_actor_roles():
    from apps.actors.models import ActorRole

    return {
        ParticipantRole.CO_JUDGE: (ActorRole.JUDGE,),
        ParticipantRole.CHAIRMAN: (ActorRole.JUDGE,),
        ParticipantRole.ADVISOR: tuple(ActorRole.values),
    }


#: 席位角色 → 可坐这种席位的神祇角色(设计稿决策记录 D13,2026-09-20 用户确认)。
SEAT_ACTOR_ROLES = _seat_actor_roles()


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
    def add_participant(judgment, participant_tenant, participant_actor, role, node_order=None):
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
        if participant_actor is not None and not CrossTenantJudgmentService.seatable_actors(
                participant_tenant, role).filter(pk=participant_actor.pk).exists():
            raise ValueError(f"That actor cannot hold a {role} seat for {participant_tenant.code}")
        CrossTenantJudgmentService._check_node_order(judgment, participant_tenant, role, node_order)

        participant = CrossTenantJudgmentParticipant.objects.create(
            judgment=judgment,
            participant_tenant=participant_tenant,
            participant_actor=participant_actor,
            role=role,
            tenant=participant_tenant,
            node_order=node_order,
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
    def seatable_actors(tenant, seat_role):
        """被邀文明里**可担任这种席位**的神祇(2026-09-20 用户决定:入席时就选席位上的神祇)。

        共同条件:属该租户、在任(`is_active`)、未软删。再按席位角色(`SEAT_ACTOR_ROLES`,设计稿 D13):
        * CO_JUDGE / CHAIRMAN:只有 `role == JUDGE` —— 这两种席位要定处置、带一站,
          而 `ActorRole` 里坐审判席的只有 JUDGE(OVERSEER 是管界域,见 actors_greek.py 里 Minos 那段)。
        * ADVISOR(2026-09-20 用户放开):`ActorRole` 全部五种。顾问不带站、不定处置,只提意见;
          管界域的(OVERSEER)、守门的(GUARDIAN)、引路的(CONDUIT)、行刑的(EXECUTOR)都各有
          判官不具备的第一手知识,没有一种「明显不适合坐席」。
        不认识的席位角色 → 空集(调用方先校验)。
        `all_objects` 而不是 `objects`:后者按**当前请求的租户**过滤,而这里要的恰是另一个租户的行。
        这是 `ActorViewSet` 之外唯一一处跨租户读神祇的地方,只经联审的
        `seatable-actors` 动作(发起方、PROPOSED)与 `participate` 的校验使用。
        """
        from apps.actors.models import Actor

        allowed = SEAT_ACTOR_ROLES.get(seat_role, ())
        return Actor.all_objects.filter(
            tenant=tenant, is_active=True, is_deleted=False, role__in=allowed,
        ).order_by("role", "name")

    @staticmethod
    def _check_node_order(judgment, participant_tenant, role, node_order):
        """`node_order` 的规则(docs/ARCHITECTURE-sentence-plan.md §2.1、§2.3、§11 N3)。

        没挂审判的联审是存量那种会议:不收 `node_order`,其余照旧。挂了审判的:
        ADVISOR 不带节点;其他角色必须带,且不能是发起方自己(原属节点恒为 1,由原审判产出);
        同一场联审里序号不重复(数据库约束 `unique_cross_judgment_node_order` 兜底并发)。
        """
        if judgment.judgment_id is None:
            if node_order is not None:
                raise ValueError("node_order only applies to a cross-tenant judgment attached to a judgment")
            return
        if role == ParticipantRole.ADVISOR:
            if node_order is not None:
                raise ValueError("An ADVISOR carries no sentence node")
            return
        if node_order is None:
            raise ValueError("node_order is required for a CO_JUDGE or CHAIRMAN")
        if participant_tenant.pk == judgment.initiating_tenant_id:
            raise ValueError("The initiating tenant's own node is node 1, set by the judgment itself")
        # 锁联审行:两次 seat 并发查不到对方的序号。约束兜底,锁让它答 400 而不是 500。
        CrossTenantJudgment._base_manager.select_for_update(of=("self",)).get(pk=judgment.pk)
        if judgment.participants.filter(node_order=node_order, is_deleted=False).exists():
            raise ValueError(f"node_order {node_order} is already taken")

    @staticmethod
    @transaction.atomic
    def reorder_nodes(judgment, participant_ids):
        """发起方重排各站顺序(设计稿 §2.2「发起方 seat 时给,ACTIVE 前可改」)。

        `participant_ids` 是**全部**带节点的席位(非 ADVISOR)按新顺序排好的 id,依次得 2、3……
        只在 PROPOSED:开庭之后各方按顺序填了处置,再改顺序就改了别人签过的那一站。
        Q5 在这里先拦一次:已填的永久刑期只能排最后(结束时 `check_bench_sentences` 再拦一次)。
        """
        locked = CrossTenantJudgment._base_manager.select_for_update(of=("self",)).get(pk=judgment.pk)
        if locked.judgment_id is None:
            raise ValueError("This cross-tenant judgment is not attached to a judgment; it has no sentence nodes")
        if locked.status != JudgmentStatus.PROPOSED:
            raise ValueError("The order can only be changed before the bench is convened")
        seats = {
            str(p.pk): p for p in locked.participants.filter(is_deleted=False).exclude(role=ParticipantRole.ADVISOR)
        }
        wanted = [str(pk) for pk in participant_ids]
        if sorted(wanted) != sorted(seats):
            raise ValueError("The new order must list every seat that carries a node, once each")
        eternal = [i for i, pk in enumerate(wanted) if seats[pk].sentence_is_eternal and seats[pk].sentence_submitted_at]
        if any(i != len(wanted) - 1 for i in eternal):
            raise ValueError("An eternal sentence must be the last node")
        # 先全部腾空再依次写:`unique_cross_judgment_node_order` 是逐条语句检查的,直接对调两个序号会撞。
        locked.participants.filter(pk__in=list(seats)).update(node_order=None)
        for order, pk in enumerate(wanted, start=2):
            CrossTenantJudgmentParticipant.all_objects.filter(pk=pk).update(node_order=order)
        return locked

    @staticmethod
    @transaction.atomic
    def submit_sentence(participant, realm_code, sentence_years, notes, user):
        """参与方填自己文明那一站的处置内容。联审结束前可重填。

        `realm_code` 必须属于参与方的文明(不跨宇宙观,同 `StatuteCitationService.resolve`);
        `is_eternal` / `memory_reset` 抄自 realm,与 `DispositionService.create_from_judgment` 同一抄法。
        """
        from apps.realms.models import Realm
        from apps.souls.models import TENANT_CIVILIZATION

        # 锁序 联审 → 参与方,与 `conclude` 相同:结束与填写并发时,要么填写在校验之前落地,
        # 要么看到 CONCLUDED 被拒 —— 不会有「校验通过之后才改」的节点内容。
        judgment = CrossTenantJudgment._base_manager.select_for_update(of=("self",)).get(pk=participant.judgment_id)
        locked = CrossTenantJudgmentParticipant.all_objects.select_for_update(of=("self",)).get(pk=participant.pk)
        if judgment.judgment_id is None:
            raise ValueError("This cross-tenant judgment is not attached to a judgment; it has no sentence nodes")
        if judgment.status not in (JudgmentStatus.PROPOSED, JudgmentStatus.ACTIVE):
            raise ValueError(f"Cannot submit a sentence to a judgment in status: {judgment.status}")
        if locked.role == ParticipantRole.ADVISOR:
            raise ValueError("An ADVISOR carries no sentence node")
        civilization = TENANT_CIVILIZATION.get(participant.participant_tenant.code)
        realm = Realm.all_objects.filter(realm_code=realm_code, is_deleted=False).first()
        if realm is None or civilization is None or realm.civilization != civilization:
            raise ValueError(f"Realm {realm_code!r} is not a realm of {participant.participant_tenant.code}")

        locked.sentence_realm_code = realm.realm_code
        locked.sentence_years = sentence_years
        locked.sentence_is_eternal = realm.is_eternal
        locked.sentence_memory_reset = realm.memory_reset_mechanism
        locked.sentence_notes = notes
        locked.sentence_submitted_at = timezone.now()
        locked.sentence_submitted_by = user
        locked.save()
        # 发起方的判官(§5.1 `cross_sentence_submitted`):只带灵魂名、文明代码、节点序号。
        from apps.judgment.models import Judgment
        from apps.sentence_plan.services import notify_judges

        soul_name = Judgment.all_objects.filter(pk=judgment.judgment_id).values_list("soul__name", flat=True).first()
        notify_judges(
            {judgment.initiating_tenant_id}, "cross_sentence_submitted",
            {"soul": soul_name or "", "order": locked.node_order, "tenant": participant.participant_tenant.code},
            judgment.pk, related_resource="CrossTenantJudgment",
        )
        return locked

    @staticmethod
    def check_bench_sentences(judgment):
        """挂了审判的联审结束前的校验(§2.3;Q5)。数据库表达不了,所以在这里。

        返回错误信息列表,空 = 通过。没挂审判的联审不校验(存量会议,行为不变)。
        """
        from apps.souls.models import TENANT_CIVILIZATION

        if judgment.judgment_id is None:
            return []
        seats = list(
            judgment.participants.filter(is_deleted=False).exclude(role=ParticipantRole.ADVISOR)
            .select_related("participant_tenant").order_by("node_order")
        )
        errors = []
        missing = [p.participant_tenant.code for p in seats if p.sentence_submitted_at is None]
        if missing:
            errors.append(f"Sentence not submitted by: {', '.join(missing)}")
        orders = [p.node_order for p in seats]
        if orders != list(range(2, 2 + len(seats))):
            errors.append(f"node_order must run 2..{1 + len(seats)} without gaps; got {orders}")
        if seats:
            last = max((p.node_order or 0) for p in seats)
            early = [p.node_order for p in seats if p.sentence_is_eternal and p.node_order != last]
            if early:
                errors.append(f"An eternal sentence must be the last node; eternal at {early}")
        from apps.realms.models import Realm

        realms = dict(
            Realm.all_objects.filter(
                realm_code__in=[p.sentence_realm_code for p in seats], is_deleted=False,
            ).values_list("realm_code", "civilization")
        )
        foreign = [
            p.participant_tenant.code for p in seats
            if p.sentence_submitted_at is not None
            and realms.get(p.sentence_realm_code) != TENANT_CIVILIZATION.get(p.participant_tenant.code)
        ]
        if foreign:
            errors.append(f"Realm is not of the participant's civilization: {', '.join(foreign)}")
        return errors

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
        CrossTenantJudgment._base_manager.select_for_update(of=("self",)).get(pk=judgment.pk)
        errors = CrossTenantJudgmentService.check_bench_sentences(judgment)
        if errors:
            raise ValueError("; ".join(errors))
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
