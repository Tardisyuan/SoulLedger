"""受刑计划的写路径与推进(docs/ARCHITECTURE-sentence-plan.md §3.3、§8)。

**锁序:`Soul` → `SentencePlan` → `SentenceNode` → `DispatchRecord` / `Disposition` / `Judgment`。**
每一条写路径都先锁灵魂行(调用方已持有则可重入),再锁计划,再锁节点。所有锁语句写
`select_for_update(of=("self",))`,关联对象在锁外另取(`apps/core/lock_join_guard.py`)。

入口:
* `create_from_conclusion` —— 原属审判结案:计划 + 原属节点(ACTIVE)+ 联审参与方节点(PENDING,只抄 PASS,Q15)。
* `on_disposition_executed` —— 节点的处置执行完:COMPLETED / WAITING / ETERNAL。
* `on_dispatch_executed` / `on_dispatch_refused` —— 搬运层(调拨记录)的两个结果。
* `on_residence_ended` —— 手动结束暂居:节点 ABORTED。
* `advance` —— 状态的纯函数:回原属地检查剩余节点,有则调往下一站,无则完成计划。
"""
import copy
import logging

from django.db import transaction
from django.utils import timezone

from apps.sentence_plan.models import (
    IN_PROGRESS_PLAN_STATUSES,
    OCCUPYING_NODE_STATUSES,
    SentenceNode,
    SentenceNodeStatus,
    SentencePlan,
    SentencePlanRequest,
    SentencePlanStatus,
    SentenceRequestStatus,
)

logger = logging.getLogger(__name__)

#: 「判官」= 持有这个码名的在职用户(ADMIN / JUDGE / MODERATOR),设计稿 §5.1。
JUDGE_PERMISSION = "judgment.execute"
#: `advance` 一次调用里最多走几步(每一步要么返回,要么把灵魂送回原属一次)。正常至多 2 步;
#: 上限只防一个未来的缺陷把它变成死循环。
MAX_ADVANCE_STEPS = 4


class CrossJudgmentOpenError(Exception):
    """原审判挂着一场未结束的联审(Q17),或那场联审的节点内容不再通过校验。结案什么都不写。"""

    code = "cross_judgment_open"

    def __init__(self, message, code=None):
        super().__init__(message)
        if code:
            self.code = code


# ── 通知与事件 ───────────────────────────────────────────────────────────


def judges_of(tenant_ids):
    """这些租户里持有 `judgment.execute` 的在职用户。ADMIN 只算**这些租户的**(同 `return_blocked_recipients`)。"""
    from apps.authentication.models import User
    from apps.perm.checker import check_permission

    candidates = User.objects.filter(tenant_id__in=set(tenant_ids), is_active=True).order_by("pk")
    return [u for u in candidates if check_permission(u, JUDGE_PERMISSION)]


def notify_judges(tenant_ids, kind, params, related_id, related_resource="SentencePlan"):
    """站内通知:存 zh-Hans(推送与兜底),读时按请求语言重渲染(apps/notifications/messages.py)。
    文案只带灵魂名、文明代码、节点序号 —— 不带审判 id、裁决、理由。"""
    from apps.events.services import EventService
    from apps.notifications import messages

    title, body = messages.render(messages.DEFAULT_LOCALE, kind, params)
    for user in judges_of(tenant_ids):
        EventService.notify_user(
            user, title=title, message=body, notification_type=kind.upper(),
            related_resource=related_resource, related_id=str(related_id), params=params,
        )


def record_event(soul, event_type, payload, *, tenant_id=None):
    """`SoulEvent`,默认写在灵魂**此刻所在**的租户:推送(`apps/soul_push`)只认「事件租户 = 灵魂租户」,
    原属租户经暂居只读例外也读得到。"""
    from apps.events.models import SoulEvent

    return SoulEvent.objects.create(
        tenant_id=tenant_id if tenant_id is not None else soul.tenant_id,
        soul_id=soul.pk, event_type=event_type, payload=payload, actor="system",
    )


def _tenant_id(code):
    from apps.tenants.models import Tenant

    return Tenant.objects.filter(code=code).values_list("pk", flat=True).first()


def _node_params(soul, node):
    return {"soul": soul.name, "order": node.order, "tenant": node.tenant_code}


# ── 查询 ────────────────────────────────────────────────────────────────


def in_progress_plan(soul, *, lock=False):
    qs = SentencePlan.all_objects.filter(soul_id=soul.pk, is_deleted=False, status__in=IN_PROGRESS_PLAN_STATUSES)
    if lock:
        qs = qs.select_for_update(of=("self",))
    return qs.first()


def _lock_soul(soul):
    from apps.souls.models import Soul

    return Soul.all_objects.select_for_update(of=("self",)).get(pk=soul.pk)


def _lock_plan(plan_id):
    return SentencePlan.all_objects.select_for_update(of=("self",)).get(pk=plan_id)


def _lock_nodes(plan):
    return list(
        SentenceNode.all_objects.select_for_update(of=("self",))
        .filter(plan_id=plan.pk, is_deleted=False).order_by("order")
    )


def _save(obj, *fields):
    obj.save(update_fields=[*fields, "update_time", "update_user", "version"])


def _route_home_realm(soul, verdict, judgment_method):
    """按**原属**文明路由的 realm。`DispositionService._route_to_realm` 读 `soul.civilization`(管辖),
    重开审判结案时灵魂可能还在外地,所以给它一份管辖 = 原属的副本(只读,不保存)。"""
    from apps.disposition.services import DispositionService

    home_view = copy.copy(soul)
    if soul.home_tenant_id is not None:
        home_view.tenant_id = soul.home_tenant_id
        home_view.tenant = soul.home_tenant
    return DispositionService._route_to_realm(home_view, verdict, judgment_method)


class SentencePlanService:
    # ── 结案 ────────────────────────────────────────────────────────────

    @staticmethod
    def check_cross_judgment(judgment):
        """原审判结案前(Q17、§2.3):挂着的联审必须已结束;PASS 的再跑一遍节点校验。

        返回要抄节点的那场联审(PASS),或 None(没挂、已取消、FAIL —— Q15:FAIL 不抄)。
        """
        from apps.dispatch.models import CrossTenantJudgment, JudgmentStatus
        from apps.dispatch.services import CrossTenantJudgmentService

        cross = CrossTenantJudgment._base_manager.filter(judgment_id=judgment.pk, is_deleted=False).first()
        if cross is None or cross.status == JudgmentStatus.CANCELLED:
            return None
        if cross.status != JudgmentStatus.CONCLUDED:
            raise CrossJudgmentOpenError(
                f"The cross-tenant judgment attached to this judgment is {cross.status}; "
                "conclude or cancel it before concluding the judgment"
            )
        if cross.conclusion_type != "PASS":
            return None
        errors = CrossTenantJudgmentService.check_bench_sentences(cross)
        if errors:
            raise CrossJudgmentOpenError("; ".join(errors), code="cross_judgment_invalid")
        return cross

    @staticmethod
    def create_from_conclusion(judgment, disposition, cross=None):
        """原属审判(ORIGINAL)结案 → 一份计划 + 原属节点(ACTIVE,挂着刚建的处置)
        + 联审参与方的节点(PENDING,内容抄自参与方;只有 PASS 的联审,Q15)。

        `judgment.kind != ORIGINAL` 不建(加减项 / 重开审判改计划,不建计划)。
        灵魂已有进行中的计划则**不建、记 warning、返回 None**(阶段 1 的约定,见 git 历史)。
        """
        from apps.dispatch.models import CrossTenantJudgmentParticipant, ParticipantRole
        from apps.events.models import EventType
        from apps.judgment.models import JudgmentKind

        if judgment.kind != JudgmentKind.ORIGINAL:
            return None
        soul = judgment.soul
        home = soul.home_tenant if soul.home_tenant_id is not None else soul.tenant
        if home is None or judgment.tenant_id != home.pk:
            return None
        if cross is not None and disposition.is_eternal:
            # Q5 同一条校验,原属节点也跑(2026-09-19 用户决定):原属处置是永久刑期,后面却还有联审
            # 抄来的节点 —— 那些节点永远执行不到。结案整体回滚。错误码沿用 Q5 在请求路径上的
            # `eternal_not_last`(同一条规则,一个码)。
            from apps.dispatch.models import CrossTenantJudgmentParticipant, ParticipantRole

            seats = CrossTenantJudgmentParticipant.all_objects.filter(
                judgment_id=cross.pk, is_deleted=False,
            ).exclude(role=ParticipantRole.ADVISOR).count()
            if seats:
                raise CrossJudgmentOpenError(
                    f"The home sentence ({disposition.destination_realm.realm_code if disposition.destination_realm_id else '?'}) "
                    f"is eternal, but the joint judgment adds {seats} node(s) after it; an eternal sentence must be the last node",
                    code="eternal_not_last",
                )
        existing = in_progress_plan(soul)
        if existing is not None:
            logger.warning(
                "sentence_plan: soul %s already has in-progress plan %s; judgment %s creates none",
                soul.pk, existing.pk, judgment.pk,
            )
            return None
        from apps.dispatch.models import CrossTenantJudgment

        # 挂着的联审一律记下(FAIL 的也记,阶段 1 起如此);节点只从 PASS 的那场抄(`cross`)。
        cross_id = CrossTenantJudgment._base_manager.filter(
            judgment_id=judgment.pk, is_deleted=False,
        ).values_list("pk", flat=True).first()
        plan = SentencePlan.objects.create(
            soul=soul, tenant=home, cycle=judgment.cycle, status=SentencePlanStatus.ACTIVE,
            origin_judgment_id=judgment.pk, cross_judgment_id=cross_id,
        )
        home_node = SentenceNode.objects.create(
            plan=plan, order=1, tenant_code=home.code, is_home=True, status=SentenceNodeStatus.ACTIVE,
            realm_code=disposition.destination_realm.realm_code if disposition.destination_realm_id else "",
            sentence_years=disposition.sentence_years, is_eternal=disposition.is_eternal,
            memory_reset=disposition.memory_reset, disposition_id=disposition.pk,
            added_by_judgment_id=judgment.pk, activated_at=timezone.now(),
        )
        disposition.sentence_node_id = home_node.pk
        disposition.save(update_fields=["sentence_node_id"])
        if cross is not None:
            seats = (
                CrossTenantJudgmentParticipant.all_objects.filter(judgment_id=cross.pk, is_deleted=False)
                .exclude(role=ParticipantRole.ADVISOR).select_related("participant_tenant").order_by("node_order")
            )
            for seat in seats:
                SentenceNode.objects.create(
                    plan=plan, order=seat.node_order, tenant_code=seat.participant_tenant.code,
                    status=SentenceNodeStatus.PENDING, realm_code=seat.sentence_realm_code,
                    sentence_years=seat.sentence_years, is_eternal=seat.sentence_is_eternal,
                    memory_reset=seat.sentence_memory_reset or "NONE", added_by_judgment_id=judgment.pk,
                    reason=seat.sentence_notes,
                )
        record_event(soul, EventType.SENTENCE_PLAN_CREATED, {
            "sentence_plan_id": str(plan.pk), "judgment_id": str(judgment.pk),
            "nodes": plan.nodes.count(),
        })
        return plan

    # ── 处置执行 ────────────────────────────────────────────────────────

    @staticmethod
    def node_for_disposition(disposition):
        return SentenceNode.all_objects.filter(disposition_id=disposition.pk, is_deleted=False).first()

    @staticmethod
    def on_disposition_executed(soul, disposition):
        """挂着这份处置的 ACTIVE 节点结束:`is_eternal` → ETERNAL(计划 HELD);否则有未结案审判
        → WAITING(刑满暂留,Q7),没有 → COMPLETED。**不推进**:调用方随后 `advance`。

        调用方已持有灵魂行锁。这里 计划 → 节点(§8;阶段 1 是 节点 → 计划,已改回)。
        """
        from apps.events.models import EventType
        from apps.judgment.models import open_judgments

        found = SentencePlanService.node_for_disposition(disposition)
        if found is None:
            return None
        plan = _lock_plan(found.plan_id)
        node = SentenceNode.all_objects.select_for_update(of=("self",)).get(pk=found.pk)
        if node.status != SentenceNodeStatus.ACTIVE:
            return None
        now = timezone.now()
        if disposition.is_eternal:
            node.status = SentenceNodeStatus.ETERNAL
            node.completed_at = now
            _save(node, "status", "completed_at")
            # 外地的永久刑期:灵魂留在那里,计划 HELD(今天「永久刑期不自动回归」)。
            # 原属地的永久刑期:后面不会有节点 —— 原审判结案(`create_from_conclusion`)与重开审判结案
            # (`requests._assert_eternal_last`)都按 Q5 拒绝「永久之后还有节点」(2026-09-19 用户决定),
            # 所以灵魂本来就在家,计划照常完成(终局文明 → SETTLED)。
            if not node.is_home and plan.status in (SentencePlanStatus.ACTIVE, SentencePlanStatus.RETRIAL):
                plan.status = SentencePlanStatus.HELD
                _save(plan, "status")
            SentencePlanService._node_finished(soul, plan, node)
        elif open_judgments(soul).exists():
            node.status = SentenceNodeStatus.WAITING
            _save(node, "status")
            record_event(soul, EventType.SENTENCE_NODE_WAITING, {
                "sentence_plan_id": str(plan.pk), "node_id": str(node.pk), "order": node.order,
                "tenant_code": node.tenant_code,
            })
            notify_judges({_tenant_id(node.tenant_code), plan.tenant_id}, "sentence_node_waiting",
                          _node_params(soul, node), plan.pk)
        else:
            node.status = SentenceNodeStatus.COMPLETED
            node.completed_at = now
            _save(node, "status", "completed_at")
            SentencePlanService._node_finished(soul, plan, node)
        return node

    @staticmethod
    def _node_finished(soul, plan, node):
        """COMPLETED / ETERNAL / ABORTED:一条事件、通知原属判官。"""
        from apps.events.models import EventType

        record_event(soul, EventType.SENTENCE_NODE_COMPLETED, {
            "sentence_plan_id": str(plan.pk), "node_id": str(node.pk), "order": node.order,
            "tenant_code": node.tenant_code, "status": node.status,
        })
        notify_judges({plan.tenant_id}, "sentence_node_done", _node_params(soul, node), plan.pk)

    # ── 搬运层 ─────────────────────────────────────────────────────────

    @staticmethod
    def on_dispatch_executed(soul, record):
        """灵魂到达执行地(调拨 EXECUTED):节点 DISPATCHING → ACTIVE,同一事务按节点内容建处置。

        处置**不走** `_route_to_realm`:内容在联审(或请求)时由执行地的判官定了(Q1)。
        调用方(`DispatchService.execute`)已持有灵魂行锁。
        """
        from apps.disposition.models import Disposition, MemoryResetMechanism
        from apps.events.models import EventType
        from apps.realms.models import Realm

        found = SentenceNode.all_objects.filter(dispatch_record_id=record.pk, is_deleted=False).first()
        if found is None:
            return None
        plan = _lock_plan(found.plan_id)
        node = SentenceNode.all_objects.select_for_update(of=("self",)).get(pk=found.pk)
        if node.status != SentenceNodeStatus.DISPATCHING:
            return None
        realm = Realm.all_objects.filter(realm_code=node.realm_code, is_deleted=False).first()
        disposition = Disposition.objects.create(
            soul_id=soul.pk, tenant_id=record.target_tenant_id, destination_realm=realm,
            sentence_years=node.sentence_years, is_eternal=node.is_eternal,
            memory_reset=node.memory_reset or MemoryResetMechanism.NONE, sentence_node_id=node.pk,
            notes=f"受刑计划 {plan.pk} 节点 {node.order}",
        )
        # 行程拓扑:这一站的处置建好,灵魂就在这一站的界域里(同一事务)。
        from apps.realms.path import SoulPathService
        SoulPathService.enter(soul, realm, tenant_id=disposition.tenant_id)
        node.status = SentenceNodeStatus.ACTIVE
        node.disposition_id = disposition.pk
        node.activated_at = timezone.now()
        _save(node, "status", "disposition_id", "activated_at")
        record_event(soul, EventType.SENTENCE_NODE_ACTIVATED, {
            "sentence_plan_id": str(plan.pk), "node_id": str(node.pk), "order": node.order,
            "tenant_code": node.tenant_code, "disposition_id": str(disposition.pk),
        }, tenant_id=record.target_tenant_id)
        notify_judges({record.target_tenant_id}, "sentence_node_active", _node_params(soul, node), plan.pk)
        return node

    @staticmethod
    def on_dispatch_refused(soul, record):
        """系统发起的调拨被拒绝 / 取消(Q4):节点退回 PENDING,通知原属判官。**不自动重试。**"""
        from apps.events.models import EventType

        found = SentenceNode.all_objects.filter(dispatch_record_id=record.pk, is_deleted=False).first()
        if found is None:
            return None
        plan = _lock_plan(found.plan_id)
        node = SentenceNode.all_objects.select_for_update(of=("self",)).get(pk=found.pk)
        if node.status != SentenceNodeStatus.DISPATCHING:
            return None
        node.status = SentenceNodeStatus.PENDING
        node.dispatch_record_id = None
        _save(node, "status", "dispatch_record_id")
        record_event(soul, EventType.SENTENCE_NODE_REFUSED, {
            "sentence_plan_id": str(plan.pk), "node_id": str(node.pk), "order": node.order,
            "tenant_code": node.tenant_code, "dispatch_id": str(record.pk), "dispatch_status": record.status,
        })
        notify_judges({plan.tenant_id}, "sentence_node_refused", _node_params(soul, node), plan.pk)
        return node

    @staticmethod
    def on_residence_ended_by_hand(soul, record):
        """手动结束暂居(return-home):挂在这次调拨上的节点 → ABORTED;永久节点结束时计划 HELD → ACTIVE。
        调用方(`end_residence`)已持有灵魂行锁;随后它 `advance`。"""
        if record is None:
            return None
        found = SentenceNode.all_objects.filter(dispatch_record_id=record.pk, is_deleted=False).first()
        if found is None:
            return None
        plan = _lock_plan(found.plan_id)
        node = SentenceNode.all_objects.select_for_update(of=("self",)).get(pk=found.pk)
        if node.status not in (SentenceNodeStatus.ACTIVE, SentenceNodeStatus.WAITING, SentenceNodeStatus.ETERNAL):
            return None
        was_eternal = node.status == SentenceNodeStatus.ETERNAL
        node.status = SentenceNodeStatus.ABORTED
        node.completed_at = timezone.now()
        _save(node, "status", "completed_at")
        if was_eternal and plan.status == SentencePlanStatus.HELD:
            plan.status = SentencePlanStatus.ACTIVE
            _save(plan, "status")
        SentencePlanService._node_finished(soul, plan, node)
        return node

    # ── 推进 ───────────────────────────────────────────────────────────

    @staticmethod
    def advance(soul):
        """设计稿 §3.3。状态的纯函数:同样的状态再调一次什么都不写。

        在灵魂行锁下(可重入)。回原属地之后再看一遍(循环,不递归),所以一次调用可能
        「送回原属」再「调往下一站」。
        """
        with transaction.atomic():
            for _ in range(MAX_ADVANCE_STEPS):
                if not SentencePlanService._step(soul):
                    return

    @staticmethod
    def _step(soul):
        """走一步。返回 True = 灵魂刚被送回原属,要再看一遍。"""
        from apps.dispatch.models import DispatchRecord, DispatchStatus
        from apps.dispatch.services import DispatchService
        from apps.judgment.models import open_judgments

        locked = _lock_soul(soul)
        found = in_progress_plan(locked)
        if found is None:
            return False
        plan = _lock_plan(found.pk)
        if plan.status not in (SentencePlanStatus.ACTIVE, SentencePlanStatus.RETRIAL):
            return False
        has_open = open_judgments(locked).exists()
        if plan.status == SentencePlanStatus.RETRIAL and not has_open:
            # 重开审判结案或撤案:重审结束。
            plan.status = SentencePlanStatus.ACTIVE
            _save(plan, "status")
        nodes = _lock_nodes(plan)
        has_pending_request = SentencePlanRequest.all_objects.filter(
            plan_id=plan.pk, is_deleted=False, status=SentenceRequestStatus.PENDING,
        ).exists()

        if locked.is_residing:
            record = (
                DispatchRecord._base_manager
                .filter(soul_id=locked.pk, status=DispatchStatus.EXECUTED, target_tenant_id=locked.tenant_id,
                        is_deleted=False)
                .order_by("-executed_at").values_list("pk", flat=True).first()
            )
            here = next((n for n in nodes if record is not None and n.dispatch_record_id == record), None)
            if here is None:
                return False
            released = False
            if here.status == SentenceNodeStatus.WAITING and not has_open:
                here.status = SentenceNodeStatus.COMPLETED
                here.completed_at = timezone.now()
                _save(here, "status", "completed_at")
                SentencePlanService._node_finished(locked, plan, here)
                released = True
            # ACTIVE 在执行、WAITING 在等、ETERNAL 永久:都等。PENDING 请求:灵魂留在 X 直到原属决定(§4.2)。
            if here.status != SentenceNodeStatus.COMPLETED or has_open or has_pending_request:
                return False
            DispatchService.end_residence(
                locked, actor="system",
                trigger=DispatchService.RETURN_ON_CASE_CLOSED if released else DispatchService.RETURN_ON_DISPOSITION,
                reason=f"sentence plan {plan.pk} node {here.order} served",
            )
            soul.tenant_id = locked.home_tenant_id
            return True

        # 在原属地:① 无未结案审判 ② 无待决请求 ③ 有无未执行节点(图 1 下的三项检查)。
        if has_open or has_pending_request:
            return False
        occupying = [n for n in nodes if n.status in OCCUPYING_NODE_STATUSES]
        if occupying:
            node = occupying[0]
            if not (node.status == SentenceNodeStatus.WAITING and node.is_home):
                return False  # DISPATCHING 等执行地执行;ACTIVE 在受刑
            node.status = SentenceNodeStatus.COMPLETED
            node.completed_at = timezone.now()
            _save(node, "status", "completed_at")
            SentencePlanService._node_finished(locked, plan, node)
        nxt = next((n for n in nodes if n.status == SentenceNodeStatus.PENDING), None)
        if nxt is None:
            SentencePlanService._complete(locked, plan, nodes)
            return False
        if nxt.is_home:
            SentencePlanService._activate_home_node(locked, plan, nxt)
            return False
        SentencePlanService._dispatch(locked, plan, nxt)
        return False

    @staticmethod
    def _complete(soul, plan, nodes, *, pardoned=False):
        """计划完成:今天原属处置执行做的那次转移(`DispositionService.execute` 原属分支),挪到这里。
        可转世 → REINCARNATING(并记 REINCARNATION_TRIGGERED,原来在 `disposition/views.py`);否则 → SETTLED。

        `pardoned=True`:撤销计划(2026-09-19 用户决定:撤销 = 赦免剩余刑期,视为完成)走**同一条路径**,
        只是终态记 CANCELLED、事件 SENTENCE_PLAN_CANCELLED、通知 / 推送用「撤销」的文案。
        返回灵魂是否移动了;没移动时什么都不写(调用方决定是否当作拒绝)。"""
        from apps.disposition.models import Disposition
        from apps.events.models import EventType
        from apps.ledger.services import REBIRTH_CAPABLE_CIVILIZATIONS
        from apps.reincarnation.services import ReincarnationService
        from apps.souls.models import SoulState

        home_disposition_id = next(
            (n.disposition_id for n in reversed(nodes) if n.is_home and n.disposition_id is not None), None,
        )
        home_disposition = (
            Disposition.all_objects.filter(pk=home_disposition_id).first() if home_disposition_id else None
        )
        rebirth = soul.home_civilization in REBIRTH_CAPABLE_CIVILIZATIONS
        if rebirth and home_disposition is not None:
            moved = ReincarnationService.execute(home_disposition)
        elif rebirth:
            moved = soul.transition_to(SoulState.REINCARNATING, f"Sentence plan {plan.pk} completed")
        else:
            moved = soul.transition_to(
                SoulState.SETTLED, f"Sentence plan {plan.pk} completed; this cosmology has no next life",
            )
        if not moved:
            # 灵魂不在 DISPOSED(例如 ADMIN 修过数据):计划照样不能说自己完成了。什么都不写。
            logger.warning("sentence_plan: plan %s cannot complete; soul %s is %s",
                           plan.pk, soul.pk, soul.current_state)
            return False
        plan.status = SentencePlanStatus.CANCELLED if pardoned else SentencePlanStatus.COMPLETED
        plan.completed_at = timezone.now()
        _save(plan, "status", "completed_at")
        record_event(soul, EventType.SENTENCE_PLAN_CANCELLED if pardoned else EventType.SENTENCE_PLAN_COMPLETED, {
            "sentence_plan_id": str(plan.pk), "rebirth_open": rebirth,
        })
        notify_judges({plan.tenant_id}, "sentence_plan_cancelled" if pardoned else "sentence_plan_completed",
                      {"soul": soul.name}, plan.pk)
        return True

    @staticmethod
    def _activate_home_node(soul, plan, node):
        """原属地的 PENDING 节点(重开审判加的,N1=(a)):按节点内容建原属处置,节点 ACTIVE。"""
        from apps.disposition.models import Disposition, MemoryResetMechanism
        from apps.events.models import EventType
        from apps.judgment.models import Judgment
        from apps.realms.models import Realm

        realm = Realm.all_objects.filter(realm_code=node.realm_code, is_deleted=False).first()
        judgment = None
        if node.added_by_judgment_id is not None:
            candidate = Judgment.all_objects.filter(pk=node.added_by_judgment_id, tenant_id=plan.tenant_id).first()
            if candidate is not None and not Disposition.all_objects.filter(judgment=candidate).exists():
                judgment = candidate
        disposition = Disposition.objects.create(
            soul_id=soul.pk, tenant_id=plan.tenant_id, judgment=judgment, destination_realm=realm,
            sentence_years=node.sentence_years, is_eternal=node.is_eternal,
            memory_reset=node.memory_reset or MemoryResetMechanism.NONE, sentence_node_id=node.pk,
            notes=f"受刑计划 {plan.pk} 节点 {node.order}",
        )
        # 行程拓扑:这一站的处置建好,灵魂就在这一站的界域里(同一事务)。
        from apps.realms.path import SoulPathService
        SoulPathService.enter(soul, realm, tenant_id=disposition.tenant_id)
        node.status = SentenceNodeStatus.ACTIVE
        node.disposition_id = disposition.pk
        node.activated_at = timezone.now()
        _save(node, "status", "disposition_id", "activated_at")
        record_event(soul, EventType.SENTENCE_NODE_ACTIVATED, {
            "sentence_plan_id": str(plan.pk), "node_id": str(node.pk), "order": node.order,
            "tenant_code": node.tenant_code, "disposition_id": str(disposition.pk),
        })
        notify_judges({plan.tenant_id}, "sentence_node_active", _node_params(soul, node), plan.pk)

    @staticmethod
    def _dispatch(soul, plan, node):
        """下一站在外地:系统发起调拨(`dispatched_by=None`),节点 DISPATCHING。"""
        from apps.dispatch.services import DispatchService
        from apps.tenants.models import Tenant

        target = Tenant.objects.filter(code=node.tenant_code).first()
        if target is None:
            logger.warning("sentence_plan: node %s names unknown tenant %s", node.pk, node.tenant_code)
            return
        try:
            record = DispatchService.propose(
                soul.tenant, target, soul, None, f"受刑计划 {plan.pk} 节点 {node.order}",
            )
        except ValueError as exc:
            # 例如一条存量的手动调拨还在 PROPOSED:不抢它,等它结束后的下一次推进。
            logger.warning("sentence_plan: plan %s node %s not dispatched: %s", plan.pk, node.pk, exc)
            return
        node.status = SentenceNodeStatus.DISPATCHING
        node.dispatch_record_id = record.pk
        _save(node, "status", "dispatch_record_id")
