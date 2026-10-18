"""审批流程按域分段(第四十三批):选站、门口等待、加减站、按默认流程走、提醒,以及跨域审判并入后的两头 —— 流程走完 /
被驳回时结束跨域审判,跨域审判取消时跳过外域段。

**一段 = 一个域的默认流程。** 第 1 段是流程所属的殿(本域),生成时由判官选站(`skip_node_orders`);挂着未结束的
跨域审判时,每个参与域再接一段(按 `CrossTenantJudgmentParticipant.node_order`,没有序号的顾问按入席先后排在后面),
节点在生成时就按那个域的默认流程建好、等那个域的人选站(AWAITING_PICK)。各段依次走,不并行:流程走到一个还没选站的段,
停在门口(`ApprovalWorkflow._stop_at_gate`:没有当前节点、仍是 IN_PROGRESS),那个域选好后从该段第一站继续(`_resume`)。

**每段的终审(`is_required`)必须走**:选站、加减站都不能跳过它;唯一的例外是流程走到某个外域段中间时取消跨域审判,
那一段的当前站与之后的站(含终审)一并跳过(`on_cross_cancelled`)。

**谁能做什么,只看这一段的 `tenant`**(跨租户只经这里放行,见 `foreign_workflows` 与 `views.WorkflowPartyPermission`):
* 选站 / 改选:该段所属域的判官(JUDGE / ADMIN,有 `workflow.approve`)或殿管理员(ADMIN / MODERATOR);该段开始之前。
* 加减站:当前站的审批人(当前站就在这一段)或该段所属域的殿管理员;只动当前站之后的站(没开始的段:全部站)。
* 按默认流程走:召集殿(流程所属殿)的管理员;门口满 `OVERDUE_DAYS` 天,或该域没有能选站的人。
* 再提醒一次:召集殿的人,每段一小时一次。

每一次选站 / 加减站带该段的 `version`,与库里不同就拒(`segment_changed`),不覆盖别人刚做的选择。
状态改动都在调用方的事务里;通知与推送在 `transaction.on_commit` 之后发。
"""
import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.workflow.models import (
    AUTOMATIC_KINDS,
    RESTORABLE_SKIPS,
    TERMINAL_WORKFLOW_STATUSES,
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    NodeKind,
    NodeStatus,
    NodeType,
    SegmentState,
    SkipKind,
    WorkflowSegment,
)

logger = logging.getLogger(__name__)

#: 门口满几天没选:召集殿管理员可以「按默认流程走」,并收到一次 `workflow_pick_overdue`。
OVERDUE_DAYS = 3
#: 「再提醒一次」的最短间隔(第 4 条规则:限频)。
REMIND_INTERVAL = timedelta(hours=1)
#: 每日提醒:定时任务每天跑一次,留几个小时余量,跑得早一点也不会漏掉一天。
DAILY_REMINDER = timedelta(hours=20)

#: 能选站的人:有 `workflow.approve` 的判官 / 管理员。都没有 = 「没有能选站的人」,待办转给殿管理员。
PICKER_ROLES = ("JUDGE", "ADMIN")
#: 殿管理员(与 `CrossTenantJudgmentService.can_end` 同一组角色)。
HALL_ADMIN_ROLES = ("ADMIN", "MODERATOR")
#: 跨域审判取消让流程提前结束时写在 `end_reason` 上(不再去结束那场已取消的审判)。
END_REASON_CANCELLED = "CROSS_CANCELLED"
#: 外域的人经 `foreign_workflows` 能做的动作。列表、改、删、推进、越级都不在内。
FOREIGN_ACTIONS = ("retrieve", "approve_node", "pick", "adjust")


class SegmentRefused(Exception):
    """一次选站 / 加减站 / 默认 / 提醒被拒;什么都没写。视图原样转成 `{code, error, **extra}` 与 `status`。"""

    def __init__(self, message, code, status=400, **extra):
        super().__init__(message)
        self.code = code
        self.status = status
        self.extra = extra


class CrossConclusionRefused(Exception):
    """流程走完要结束跨域审判,而那场审判结束不了(参与方的站还没填等)。决定整体回滚。"""

    code = "cross_judgment_incomplete"


# ── 建 ──────────────────────────────────────────────────────────────────


def case_type_for(civilization, case_type):
    """外域那一段用哪种案件的默认流程:与本域相同的案件类型,该文明不收这种就用 ROUTINE。"""
    from apps.workflow.models import CaseType
    from apps.workflow.templates import VALID_CASE_TYPES_BY_CIVILIZATION

    return case_type if case_type in VALID_CASE_TYPES_BY_CIVILIZATION.get(civilization, ()) else CaseType.ROUTINE


def mark_required(segment):
    """这一段的终审:最后一个 FINAL 类型的人工节点,没有就最后一个人工节点。结束节点也不能被选掉。"""
    nodes = list(segment.nodes.order_by("node_order"))
    manual = [n for n in nodes if n.kind not in AUTOMATIC_KINDS]
    finals = [n for n in manual if n.node_type == NodeType.FINAL]
    required = {n.pk for n in nodes if n.kind == NodeKind.END}
    if finals or manual:
        required.add((finals or manual)[-1].pk)
    ApprovalNode.objects.filter(pk__in=required).update(is_required=True)


def build_local(workflow, template, civilization, skip_node_orders=(), user=None):
    """本域那一段:建段、建节点(不进入)、按 `skip_node_orders`(模板里的站序)跳过。返回模板的第一个节点。"""
    from apps.workflow.services import WorkflowService

    now = timezone.now()
    segment = WorkflowSegment.objects.create(
        workflow=workflow, order=1, tenant_id=workflow.tenant_id, civilization=civilization,
        name=template["name"], state=SegmentState.LOCAL_PICKED, picked_by=user, picked_at=now,
        default_node_count=len(template["nodes"]),
    )
    first = WorkflowService._create_nodes(workflow, template, civilization, segment=segment, enter=False)
    mark_required(segment)
    wanted = set(skip_node_orders or ())
    if wanted:
        nodes = {n.node_order: n for n in segment.nodes.all()}
        unknown = sorted(wanted - set(nodes))
        if unknown:
            raise SegmentRefused(f"No station {unknown} in this flow", "unknown_node", orders=unknown)
        required = sorted(o for o in wanted if nodes[o].is_required)
        if required:
            raise SegmentRefused("The final review cannot be skipped", "final_required", orders=required)
        ApprovalNode.objects.filter(pk__in=[nodes[o].pk for o in wanted]).update(
            status=NodeStatus.SKIPPED, skip_kind=SkipKind.AT_PICK, skipped_by=user, decided_at=now)
    return first


def open_cross_for(judgment):
    """挂在这份审判上、还没结束的跨域审判(PROPOSED / ACTIVE),或 None。"""
    from apps.dispatch.models import CrossTenantJudgment, JudgmentStatus

    if judgment is None:
        return None
    return CrossTenantJudgment._base_manager.filter(
        judgment_id=judgment.pk, is_deleted=False, status__in=(JudgmentStatus.PROPOSED, JudgmentStatus.ACTIVE),
    ).first()


def cross_of(workflow):
    """流程经它的审判挂着的跨域审判(任何状态),或 None。"""
    from apps.dispatch.models import CrossTenantJudgment

    if workflow.judgment_id is None:
        return None
    return CrossTenantJudgment._base_manager.filter(judgment_id=workflow.judgment_id, is_deleted=False).first()


def add_foreign(workflow, cross):
    """每个参与域一段,接在本域之后。顺序:`node_order`(入席时定的「各域顺序」),没有序号的(顾问)按入席先后排后面。
    同一个域入席两次只算一段;发起方自己的顾问席不另起一段。"""
    from apps.souls.models import TENANT_CIVILIZATION
    from apps.workflow.services import WorkflowService

    seats = (cross.participants.filter(is_deleted=False).select_related("participant_tenant")
             .order_by(F("node_order").asc(nulls_last=True), "joined_at", "pk"))
    seen = {workflow.tenant_id}
    order = 1
    for seat in seats:
        realm = seat.participant_tenant
        if realm.pk in seen:
            continue
        seen.add(realm.pk)
        order += 1
        civilization = TENANT_CIVILIZATION.get(realm.code, realm.code)
        template, _priority = WorkflowService._resolve_template(
            civilization, case_type_for(civilization, workflow.case_type), realm)
        segment = WorkflowSegment.objects.create(
            workflow=workflow, order=order, tenant=realm, civilization=civilization, name=template["name"],
            state=SegmentState.AWAITING_PICK, default_node_count=len(template["nodes"]),
        )
        offset = max(workflow.nodes.values_list("node_order", flat=True), default=0)
        WorkflowService._create_nodes(workflow, template, civilization, segment=segment, enter=False,
                                      order_offset=offset, tenant_id=realm.pk)
        mark_required(segment)


# ── 谁 ──────────────────────────────────────────────────────────────────


def pickers(tenant_id):
    """这个域能选站的人:在职、JUDGE / ADMIN、有 `workflow.approve`。"""
    from apps.authentication.models import User
    from apps.perm.checker import check_permission

    candidates = User.objects.filter(tenant_id=tenant_id, is_active=True, role__in=PICKER_ROLES).order_by("pk")
    return [u for u in candidates if check_permission(u, "workflow.approve")]


def hall_admins(tenant_id):
    from apps.authentication.models import User

    return list(User.objects.filter(tenant_id=tenant_id, is_active=True, role__in=HALL_ADMIN_ROLES).order_by("pk"))


def pick_recipients(tenant_id):
    """选站待办与提醒给谁:能选站的人;一个都没有时转给该域的殿管理员(第 6 条规则)。"""
    return pickers(tenant_id) or hall_admins(tenant_id)


def _user_tenant_id(user, request=None):
    tenant = getattr(request, "tenant", None) if request is not None else None
    return tenant.pk if tenant is not None else getattr(user, "tenant_id", None)


def can_pick(user, segment, request=None):
    if not getattr(user, "is_authenticated", False) or _user_tenant_id(user, request) != segment.tenant_id:
        return False
    if user.role in HALL_ADMIN_ROLES:
        return True
    from apps.perm.checker import check_permission

    return user.role in PICKER_ROLES and check_permission(user, "workflow.approve")


def is_convener_admin(user, workflow, request=None):
    """召集殿(流程所属殿)的管理员;没有租户的全局 ADMIN 也算(同 `can_end`)。"""
    if not getattr(user, "is_authenticated", False) or user.role not in HALL_ADMIN_ROLES:
        return False
    tenant_id = _user_tenant_id(user, request)
    if tenant_id is None:
        return user.role == "ADMIN"
    return tenant_id == workflow.tenant_id


def can_adjust(user, workflow, segment, request=None):
    """当前站的审批人(当前站在这一段里),或这一段所属域的殿管理员。"""
    if not getattr(user, "is_authenticated", False) or _user_tenant_id(user, request) != segment.tenant_id:
        return False
    if user.role in HALL_ADMIN_ROLES:
        return True
    current = workflow.current_node
    return current is not None and current.segment_id == segment.pk and current.can_approve(user)


def started(segment, workflow):
    """这一段开始了没有:流程站在它里面,或它有一站已经被决定 / 经过 / 被路由跳过(选站与加减站的跳过不算)。"""
    current = workflow.current_node
    if current is not None and current.segment_id == segment.pk:
        return True
    return segment.nodes.exclude(status=NodeStatus.PENDING).exclude(skip_kind__isnull=False).exists()


def phase(segment, workflow):
    """给人看的状态:AWAITING_PICK / PICKED(还没开始)/ RUNNING / DONE / SKIPPED。"""
    if segment.state in (SegmentState.SKIPPED, SegmentState.AWAITING_PICK):
        return segment.state
    if not started(segment, workflow):
        return SegmentState.PICKED
    current = workflow.current_node
    return "RUNNING" if current is not None and current.segment_id == segment.pk else "DONE"


def at_gate(segment, workflow):
    return (segment.state == SegmentState.AWAITING_PICK and segment.gate_reached_at is not None
            and workflow.current_node_id is None and workflow.status == ApprovalWorkflowStatus.IN_PROGRESS)


def gate_days(segment, now=None):
    """「第 N 天」:到门口那天是第 1 天。"""
    if segment.gate_reached_at is None:
        return None
    return ((now or timezone.now()) - segment.gate_reached_at).days + 1


# ── 改 ──────────────────────────────────────────────────────────────────


def _locked(workflow_id, order=None):
    workflow = ApprovalWorkflow._base_manager.select_for_update().get(pk=workflow_id)
    if workflow.status in TERMINAL_WORKFLOW_STATUSES:
        raise SegmentRefused("This approval flow has ended", "workflow_closed", status=409)
    if order is None:
        return workflow, None
    segment = WorkflowSegment.objects.select_for_update().filter(workflow=workflow, order=order).first()
    if segment is None:
        raise SegmentRefused("No such segment", "segment_not_found", status=404)
    return workflow, segment


def _check_version(segment, version):
    if version is not None and version != segment.version:
        raise SegmentRefused("This segment was changed since you loaded it", "segment_changed", status=409,
                             version=segment.version,
                             changed_by=_name(segment.picked_by) if segment.picked_by_id else None,
                             changed_at=segment.picked_at.isoformat() if segment.picked_at else None)


def _name(user):
    return (user.display_name or user.username) if user is not None else None


def _audit(tenant_id, user, resource, workflow, description, changes):
    from apps.audit.models import AuditAction, AuditLog

    AuditLog.objects.create(
        tenant_id=tenant_id, user=user if getattr(user, "is_authenticated", False) else None,
        action=AuditAction.UPDATE, resource=resource, resource_id=str(workflow.pk),
        description=description[:500], changes=changes,
    )


def _resume(workflow, segment, now):
    """流程刚才站在这一段的门口(调用方在改状态之前问过 `at_gate`):从这一段第一个要走的站继续。"""
    entry = segment.nodes.filter(status=NodeStatus.PENDING).order_by("node_order").first()
    if entry is None:  # 不会发生:终审不能被选掉。防一手,让流程往下一段走而不是卡住
        entry = workflow.get_next_node()
        if entry is None:
            workflow._finish(ApprovalWorkflowStatus.COMPLETED, now)
            return True
    workflow._enter(entry, now)
    return True


def _apply_pick(workflow, segment, user, skip_ids, reason, now, *, default):
    gate = at_gate(segment, workflow)  # before the state below changes
    nodes = {str(n.pk): n for n in segment.nodes.select_for_update()}
    unknown = sorted(skip_ids - set(nodes))
    if unknown:
        raise SegmentRefused("Not a station of this segment", "unknown_node", node_ids=unknown)
    required = sorted(i for i in skip_ids if nodes[i].is_required)
    if required:
        raise SegmentRefused("The final review cannot be skipped", "final_required", node_ids=required)
    # 改选:先把上一次选掉的全部放回,再按这一次的选。
    segment.nodes.filter(status=NodeStatus.SKIPPED, skip_kind=SkipKind.AT_PICK).update(
        status=NodeStatus.PENDING, skip_kind=None, skipped_by=None, skip_reason="", decided_at=None)
    if skip_ids:
        ApprovalNode.objects.filter(pk__in=skip_ids).update(
            status=NodeStatus.SKIPPED, skip_kind=SkipKind.AT_PICK, skipped_by=user, skip_reason=reason or "",
            decided_at=now)
    first_pick = segment.state == SegmentState.AWAITING_PICK
    segment.state = SegmentState.PICKED
    segment.picked_by = user if getattr(user, "is_authenticated", False) else None
    segment.picked_at = now
    segment.version += 1
    segment.save(update_fields=["state", "picked_by", "picked_at", "version"])
    skipped_names = [nodes[i].node_name for i in sorted(skip_ids, key=lambda i: nodes[i].node_order)]
    _audit(
        workflow.tenant_id if default else segment.tenant_id, user,
        "workflow.use_default" if default else "workflow.pick", workflow,
        f"{'按默认流程走' if default else '选站'}:{segment.tenant.display_name} 第 {segment.order} 段 — {reason or '-'}",
        {"kind": "default" if default else "picked", "segment": segment.order, "realm": segment.tenant.code,
         "skipped": skipped_names, "restored": [], "reason": reason or "", "first_pick": first_pick},
    )
    resumed = _resume(workflow, segment, now) if gate else False
    workflow.save()
    return resumed


def pick(workflow_id, order, user, *, skip_node_ids, version, reason="", request=None):
    """该段所属域的人为它选站(或在开始之前改选)。返回 (workflow, segment)。"""
    now = timezone.now()
    with transaction.atomic():
        workflow, segment = _locked(workflow_id, order)
        if segment.order == 1:
            raise SegmentRefused("This realm's own stations are picked when the flow is generated", "not_foreign")
        if not can_pick(user, segment, request):
            raise SegmentRefused("Only this realm's judges or hall admins pick its stations", "not_allowed", status=403)
        if segment.state == SegmentState.SKIPPED:
            raise SegmentRefused("This segment was skipped", "segment_closed", status=409)
        _check_version(segment, version)
        if segment.state == SegmentState.PICKED and started(segment, workflow):
            raise SegmentRefused("This segment has started; change stations instead", "segment_started", status=409)
        resumed = _apply_pick(workflow, segment, user, {str(i) for i in skip_node_ids}, reason, now, default=False)
        transaction.on_commit(lambda: _after_pick(workflow.pk, resumed))
    return workflow, segment


def use_default(workflow_id, order, user, reason, request=None):
    """召集殿管理员替一个外域选全部站并继续(第 6 条规则)。理由必填、记审计、通知那个域。"""
    if not (reason or "").strip():
        raise SegmentRefused("A reason is required", "reason_required")
    now = timezone.now()
    with transaction.atomic():
        workflow, segment = _locked(workflow_id, order)
        if not is_convener_admin(user, workflow, request):
            raise SegmentRefused("Only the convening hall's admins may do this", "not_allowed", status=403)
        if segment.state != SegmentState.AWAITING_PICK:
            raise SegmentRefused("This segment is not waiting for a pick", "not_awaiting", status=409)
        overdue = segment.gate_reached_at is not None and now - segment.gate_reached_at >= timedelta(days=OVERDUE_DAYS)
        if not overdue and pickers(segment.tenant_id):
            raise SegmentRefused(f"Allowed after {OVERDUE_DAYS} days at the gate, or when the realm has no picker",
                                 "too_early", status=409)
        resumed = _apply_pick(workflow, segment, user, set(), reason.strip(), now, default=True)
        recipients, params = pick_recipients(segment.tenant_id), {
            "soul": workflow.soul.name, "by": _name(user) or "-", "added": segment.nodes.count(), "skipped": 0,
            "reason": reason.strip()}

        def after():
            _tell(recipients, "workflow_nodes_adjusted", params, workflow, push=False)
            _after_pick(workflow.pk, resumed)

        transaction.on_commit(after)
    return workflow, segment


def adjust(workflow_id, user, *, restore_node_ids, skip_node_ids, reason, version, request=None):
    """加减站(第 5 条规则):只改一段、只改当前站之后的站;终审锁定;理由必填;记审计;通知被改到的站的审批人。"""
    restore, skip = {str(i) for i in restore_node_ids}, {str(i) for i in skip_node_ids}
    if not (reason or "").strip():
        raise SegmentRefused("A reason is required", "reason_required")
    if not restore and not skip:
        raise SegmentRefused("Nothing to change", "nothing_to_change")
    if restore & skip:
        raise SegmentRefused("A station cannot be both restored and skipped", "conflicting_change")
    now = timezone.now()
    with transaction.atomic():
        workflow, _ = _locked(workflow_id)
        nodes = {str(n.pk): n for n in ApprovalNode.objects.select_for_update().filter(
            workflow=workflow, pk__in=restore | skip)}
        if len(nodes) != len(restore | skip):
            raise SegmentRefused("Not a station of this flow", "unknown_node",
                                 node_ids=sorted((restore | skip) - set(nodes)))
        segment_ids = {n.segment_id for n in nodes.values()}
        if len(segment_ids) != 1 or None in segment_ids:
            raise SegmentRefused("Change one realm's stations at a time", "one_segment")
        segment = WorkflowSegment.objects.select_for_update().select_related("tenant").get(pk=segment_ids.pop())
        if not can_adjust(user, workflow, segment, request):
            raise SegmentRefused("Only the current approver or this realm's hall admins change stations",
                                 "not_allowed", status=403)
        _check_version(segment, version)
        if segment.state == SegmentState.AWAITING_PICK:
            raise SegmentRefused("This realm has not picked its stations yet", "not_picked", status=409)
        if segment.state == SegmentState.SKIPPED:
            raise SegmentRefused("This segment was skipped", "segment_closed", status=409)
        current = workflow.current_node
        here = current is not None and current.segment_id == segment.pk
        if not here and started(segment, workflow):
            raise SegmentRefused("This segment is done", "segment_done", status=409)
        locked = sorted(i for i in nodes if here and nodes[i].node_order <= current.node_order)
        if locked:
            raise SegmentRefused("Only stations after the current one can change", "node_locked", status=409,
                                 node_ids=locked)
        not_skipped = sorted(i for i in restore if nodes[i].status != NodeStatus.SKIPPED
                             or nodes[i].skip_kind not in RESTORABLE_SKIPS)
        not_pending = sorted(i for i in skip if nodes[i].status != NodeStatus.PENDING)
        if not_skipped or not_pending:
            raise SegmentRefused("A station is no longer in the state you saw", "node_changed", status=409,
                                 node_ids=not_skipped + not_pending)
        required = sorted(i for i in skip if nodes[i].is_required)
        if required:
            raise SegmentRefused("The final review cannot be skipped", "final_required", node_ids=required)

        ApprovalNode.objects.filter(pk__in=restore).update(
            status=NodeStatus.PENDING, skip_kind=None, skipped_by=None, skip_reason="", decided_at=None)
        ApprovalNode.objects.filter(pk__in=skip).update(
            status=NodeStatus.SKIPPED, skip_kind=SkipKind.LATER, skipped_by=user, skip_reason=reason.strip(),
            decided_at=now)
        segment.version += 1
        segment.save(update_fields=["version"])
        ordered = sorted(nodes.values(), key=lambda n: n.node_order)
        added = [n.node_name for n in ordered if str(n.pk) in restore]
        skipped = [n.node_name for n in ordered if str(n.pk) in skip]
        _audit(segment.tenant_id, user, "workflow.adjust", workflow,
               f"加减站:{segment.tenant.display_name} 第 {segment.order} 段 — {reason.strip()}",
               {"kind": "adjusted", "segment": segment.order, "realm": segment.tenant.code,
                "restored": added, "skipped": skipped, "reason": reason.strip()})
        workflow.save(update_fields=["updated_at"])

        from apps.workflow.services import WorkflowService

        told = {u.pk: u for n in ordered for u in WorkflowService.designated_users(n, workflow.tenant_id)}
        params = {"soul": workflow.soul.name, "by": _name(user) or "-", "added": ", ".join(added) or "-",
                  "skipped": ", ".join(skipped) or "-", "reason": reason.strip()}
        transaction.on_commit(lambda: _tell(told.values(), "workflow_nodes_adjusted", params, workflow, push=False))
    return workflow, segment


def remind(workflow_id, order, user, request=None):
    """「再提醒一次」:召集殿的人,每段每小时一次。"""
    from apps.core.tenant import is_tenant_exempt

    now = timezone.now()
    with transaction.atomic():
        workflow, segment = _locked(workflow_id, order)
        if not (is_tenant_exempt(user) or _user_tenant_id(user, request) == workflow.tenant_id):
            raise SegmentRefused("Only the convening hall sends reminders", "not_allowed", status=403)
        if segment.state != SegmentState.AWAITING_PICK:
            raise SegmentRefused("This segment is not waiting for a pick", "not_awaiting", status=409)
        if segment.last_reminded_at is not None and now - segment.last_reminded_at < REMIND_INTERVAL:
            wait = REMIND_INTERVAL - (now - segment.last_reminded_at)
            raise SegmentRefused("Reminded less than an hour ago", "remind_too_soon", status=429,
                                 retry_after=int(wait.total_seconds()) + 1)
        segment.last_reminded_at = now
        segment.save(update_fields=["last_reminded_at"])
        transaction.on_commit(lambda: notify_segment(workflow.pk, segment.pk))
    return segment


# ── 跨域审判的两头 ───────────────────────────────────────────────────────


def on_workflow_finished(workflow, status, end_reason=""):
    """`ApprovalWorkflow._finish` 调:并入了跨域审判的流程走完 = 审判以 PASS 结束,被驳回 = FAIL(第 7 条规则)。
    同一事务。PASS 照跑参与方的站的校验(没填完就拒,决定回滚);FAIL 不查 —— 否决用不到那些站。"""
    if status not in (ApprovalWorkflowStatus.COMPLETED, ApprovalWorkflowStatus.REJECTED):
        return
    if end_reason == END_REASON_CANCELLED or workflow.judgment_id is None:
        return
    if not workflow.segments.filter(order__gt=1).exists():
        return
    from apps.dispatch.models import JudgmentStatus
    from apps.dispatch.services import CrossTenantJudgmentService

    cross = cross_of(workflow)
    if cross is None or cross.status not in (JudgmentStatus.PROPOSED, JudgmentStatus.ACTIVE):
        return
    passed = status == ApprovalWorkflowStatus.COMPLETED
    try:
        if cross.status == JudgmentStatus.PROPOSED:
            CrossTenantJudgmentService.activate(cross)
        CrossTenantJudgmentService.conclude(cross, "PASS" if passed else "FAIL", None, check=passed)
    except ValueError as exc:
        raise CrossConclusionRefused(str(exc)) from exc


def lock_workflow_of(cross):
    """跨域审判这一头先锁流程行(锁序:流程 → 跨域审判,与审批那一头相同)。"""
    if cross.judgment_id is None:
        return None
    return ApprovalWorkflow._base_manager.select_for_update().filter(judgment_id=cross.judgment_id).first()


def on_cross_cancelled(workflow, cross, user, reason):
    """跨域审判取消(第 7 条规则):还没开始的外域段全部跳过(CANCELLED),撤回未选站的待办;流程正在某个外域段里时,
    那一段当前站与之后的站(含终审)也跳过,流程随即结束。在取消的事务里,调用方已锁流程行。"""
    if workflow is None or workflow.status in TERMINAL_WORKFLOW_STATUSES:
        return
    now = timezone.now()
    current = workflow.current_node
    end_now = False
    withdrawn = []
    for segment in workflow.segments.select_for_update().filter(order__gt=1).order_by("order"):
        if current is not None and current.segment_id == segment.pk:
            end_now = True
        elif started(segment, workflow):
            continue
        if segment.state == SegmentState.AWAITING_PICK:
            withdrawn.append(segment.tenant_id)
        segment.nodes.filter(status=NodeStatus.PENDING).update(
            status=NodeStatus.SKIPPED, skip_kind=SkipKind.CANCELLED, skipped_by=user if getattr(
                user, "is_authenticated", False) else None, skip_reason=reason or "", decided_at=now)
        segment.state = SegmentState.SKIPPED
        segment.version += 1
        segment.save(update_fields=["state", "version"])
    if end_now:
        workflow._finish(ApprovalWorkflowStatus.COMPLETED, now, end_reason=END_REASON_CANCELLED)
    elif workflow.current_node_id is None:
        # 正站在某个外域段门口(已跳过):往下走;后面没有了就结束。
        nxt = workflow.get_next_node()
        if nxt is None:
            workflow._finish(ApprovalWorkflowStatus.COMPLETED, now, end_reason=END_REASON_CANCELLED)
        else:
            workflow._enter(nxt, now)
    workflow.save()
    if withdrawn:
        params = {"soul": workflow.soul.name, "title": cross.title}

        def after():
            for tenant_id in withdrawn:
                _tell(pick_recipients(tenant_id), "workflow_pick_withdrawn", params, workflow, push=False)

        transaction.on_commit(after)


# ── 通知 ────────────────────────────────────────────────────────────────


def _tell(users, kind, params, workflow, push=True):
    """站内通知(WORKFLOW_ASSIGNED 的一个变体,读时按语言重渲染)+ 官员端推送(落到「待我选站」)。提交之后调。"""
    from apps.events.services import EventService
    from apps.notifications import messages

    users = list(users)
    params = {**params, "kind": kind}
    title, body = messages.render(messages.DEFAULT_LOCALE, kind, params)
    for user in users:
        EventService.notify_user(user, title=title, message=body, notification_type="WORKFLOW_ASSIGNED",
                                 related_resource="workflow", related_id=str(workflow.pk), params=params)
    if push and users:
        from apps.officer_app.push import notify_users

        notify_users(users, target={"kind": "pick", "id": str(workflow.pk)})


def _realm(tenant):
    return tenant.display_name or tenant.code


def notify_pick_tasks(workflow_id):
    """流程发起:每个外域同时收到「选站」待办(`workflow_pick_nodes`)。"""
    workflow = ApprovalWorkflow._base_manager.select_related("soul", "tenant").get(pk=workflow_id)
    for segment in workflow.segments.filter(state=SegmentState.AWAITING_PICK).select_related("tenant"):
        _tell(pick_recipients(segment.tenant_id), "workflow_pick_nodes",
              {"soul": workflow.soul.name, "realm": _realm(workflow.tenant), "order": segment.order}, workflow)


def notify_segment(workflow_id, segment_id):
    """提醒一个外域:流程已在它门口时用 `workflow_pick_waiting`(走完的是前一段的域),还没到时重发 `workflow_pick_nodes`。"""
    workflow = ApprovalWorkflow._base_manager.select_related("soul", "tenant").get(pk=workflow_id)
    segment = WorkflowSegment.objects.select_related("tenant").get(pk=segment_id)
    if segment.state != SegmentState.AWAITING_PICK:
        return
    if segment.gate_reached_at is None:
        _tell(pick_recipients(segment.tenant_id), "workflow_pick_nodes",
              {"soul": workflow.soul.name, "realm": _realm(workflow.tenant), "order": segment.order}, workflow)
        return
    before = workflow.segments.filter(order__lt=segment.order).select_related("tenant").order_by("-order").first()
    _tell(pick_recipients(segment.tenant_id), "workflow_pick_waiting",
          {"soul": workflow.soul.name, "realm": _realm(before.tenant if before else workflow.tenant)}, workflow)


def notify_waiting(workflow_id, segment_id):
    """到门口时提醒一次(`ApprovalWorkflow._stop_at_gate`,提交之后)。"""
    notify_segment(workflow_id, segment_id)


def _after_pick(workflow_id, resumed):
    """选站之后:流程若因此从门口继续,告诉新的当前站的审批人。"""
    if not resumed:
        return
    from apps.workflow.services import WorkflowService

    WorkflowService.announce(ApprovalWorkflow._base_manager.get(pk=workflow_id))


def remind_due(tenant, now=None):
    """定时任务(每天):本殿发起、停在外域门口的流程 —— 每天提醒那个域一次;满 `OVERDUE_DAYS` 天告诉本殿管理员一次。
    条件写在 UPDATE 里,两次运行重叠也只发一次。返回 {reminded, overdue}。"""
    now = now or timezone.now()
    counts = {"reminded": 0, "overdue": 0}
    rows = (WorkflowSegment.objects.filter(
        workflow__tenant=tenant, workflow__status=ApprovalWorkflowStatus.IN_PROGRESS,
        workflow__current_node__isnull=True, state=SegmentState.AWAITING_PICK, gate_reached_at__isnull=False,
    ).select_related("workflow__soul", "tenant"))
    for segment in rows:
        if segment.last_reminded_at is None or now - segment.last_reminded_at >= DAILY_REMINDER:
            if WorkflowSegment.objects.filter(pk=segment.pk, last_reminded_at=segment.last_reminded_at).update(
                    last_reminded_at=now):
                notify_segment(segment.workflow_id, segment.pk)
                counts["reminded"] += 1
        if segment.overdue_notified_at is None and now - segment.gate_reached_at >= timedelta(days=OVERDUE_DAYS):
            if WorkflowSegment.objects.filter(pk=segment.pk, overdue_notified_at__isnull=True).update(
                    overdue_notified_at=now):
                workflow = segment.workflow
                _tell(hall_admins(workflow.tenant_id), "workflow_pick_overdue",
                      {"soul": workflow.soul.name, "realm": _realm(segment.tenant), "n": gate_days(segment, now)},
                      workflow, push=False)
                counts["overdue"] += 1
    return counts


# ── 读 ──────────────────────────────────────────────────────────────────


def foreign_workflows(qs, scope):
    """`qs` 里本租户作为参与域有一段的流程。**跨租户读审批流只经这里**:成员关系就是 `WorkflowSegment.tenant`,
    而外域段只由 `add_foreign` 按跨域审判的参与方建。全局 ADMIN 本来就看得到全部,这里给空集。"""
    from apps.core.tenant import is_tenant_exempt

    user = getattr(scope, "user", None)
    tenant = getattr(scope, "tenant", None)
    if user is None or not getattr(user, "is_authenticated", False) or is_tenant_exempt(user) or tenant is None:
        return qs.none()
    return qs.filter(pk__in=WorkflowSegment.objects.filter(tenant=tenant).values("workflow_id"))


def is_party(workflow, tenant):
    return tenant is not None and WorkflowSegment.objects.filter(workflow=workflow, tenant=tenant).exists()


def viewer_tenant_id(request, workflow):
    """读详情的人属于哪个域:None = 全局 ADMIN(都看得到)。没有请求(服务内部序列化)按流程所属殿看。"""
    from apps.core.tenant import is_tenant_exempt

    if request is None:
        return workflow.tenant_id
    user = getattr(request, "user", None)
    if is_tenant_exempt(user):
        return None
    return _user_tenant_id(user, request)


def segment_row(segment, workflow, request=None, now=None):
    """`WorkflowSegmentSerializer` 的那一行。别的域的选站人名字不给(外域人员信息不外露)。"""
    now = now or timezone.now()
    viewer = viewer_tenant_id(request, workflow)
    user = getattr(request, "user", None)
    nodes = list(segment.nodes.all())
    gate = at_gate(segment, workflow)
    no_picker = segment.state == SegmentState.AWAITING_PICK and not pickers(segment.tenant_id)
    overdue = gate and now - segment.gate_reached_at >= timedelta(days=OVERDUE_DAYS)
    current = workflow.current_node
    return {
        "order": segment.order,
        "is_local": segment.order == 1,
        "tenant_code": segment.tenant.code,
        "realm_name": _realm(segment.tenant),
        "civilization": segment.civilization,
        "name": segment.name,
        "state": phase(segment, workflow),
        "go": sum(1 for n in nodes if n.status != NodeStatus.SKIPPED),
        "total": len(nodes),
        "default_node_count": segment.default_node_count,
        "version": segment.version,
        "picked_at": segment.picked_at,
        "picked_by_name": (_name(segment.picked_by)
                           if segment.picked_by_id and (viewer is None or viewer == segment.tenant_id) else None),
        "at_gate": gate,
        "gate_days": gate_days(segment, now) if gate else None,
        "no_picker": no_picker,
        "current_order_in_segment": (
            sum(1 for n in nodes if n.node_order <= current.node_order)
            if current is not None and current.segment_id == segment.pk else None),
        "can_pick": bool(user) and segment.order > 1 and segment.state != SegmentState.SKIPPED
        and workflow.status not in TERMINAL_WORKFLOW_STATUSES and can_pick(user, segment, request)
        and (segment.state == SegmentState.AWAITING_PICK or not started(segment, workflow)),
        "can_use_default": bool(user) and segment.state == SegmentState.AWAITING_PICK
        and is_convener_admin(user, workflow, request) and (no_picker or overdue),
        "can_remind": bool(user) and segment.state == SegmentState.AWAITING_PICK
        and viewer in (None, workflow.tenant_id),
    }


def segment_rows(workflow, request=None):
    now = timezone.now()
    return [segment_row(s, workflow, request, now)
            for s in workflow.segments.select_related("tenant", "picked_by").prefetch_related("nodes").order_by("order")]


def can_adjust_any(workflow, request):
    """详情页「加减站」入口:请求者能改某一段、且那一段还有可改的站。"""
    user = getattr(request, "user", None)
    if user is None or workflow.status in TERMINAL_WORKFLOW_STATUSES:
        return False
    for segment in workflow.segments.exclude(state__in=(SegmentState.AWAITING_PICK, SegmentState.SKIPPED)):
        current = workflow.current_node
        here = current is not None and current.segment_id == segment.pk
        if (here or not started(segment, workflow)) and can_adjust(user, workflow, segment, request):
            return True
    return False


def history(workflow, request=None):
    """「选站」「加减站」两类记录(审计行),时间顺序。别的域的人名不给。"""
    from apps.audit.models import AuditLog

    viewer = viewer_tenant_id(request, workflow)
    rows = (AuditLog.objects.filter(resource__in=("workflow.pick", "workflow.adjust", "workflow.use_default"),
                                    resource_id=str(workflow.pk))
            .select_related("user").order_by("timestamp"))
    out = []
    for row in rows:
        changes = row.changes or {}
        out.append({
            "kind": changes.get("kind", ""),
            "segment": changes.get("segment"),
            "realm": changes.get("realm", ""),
            "actor": _name(row.user) if viewer is None or viewer == row.tenant_id else None,
            "at": row.timestamp,
            "restored": changes.get("restored", []),
            "skipped": changes.get("skipped", []),
            "reason": changes.get("reason", ""),
        })
    return out


def cross_summary(workflow, request=None):
    """跨域审判页顶部那一条(W-4):走到哪一域哪一站、已定 / 已走几站、哪些域还没选站。"""
    current = workflow.current_node
    segments = list(workflow.segments.select_related("tenant").order_by("order"))
    nodes = list(workflow.nodes.all())
    picked = {s.pk for s in segments if s.state in (SegmentState.LOCAL_PICKED, SegmentState.PICKED)}
    by_pk = {s.pk: s for s in segments}
    gate = next((s for s in segments if at_gate(s, workflow)), None)
    at = None
    if current is not None and current.segment_id in by_pk:
        seg = by_pk[current.segment_id]
        at = {"segment": seg.order, "realm_name": _realm(seg.tenant), "node_name": current.node_name,
              "hall": current.court_code}
    return {
        "id": str(workflow.pk),
        "number": workflow.number,
        "status": workflow.status,
        "at": at,
        "at_gate": {"segment": gate.order, "realm_name": _realm(gate.tenant), "days": gate_days(gate)} if gate else None,
        "fixed": sum(1 for n in nodes if n.segment_id in picked and n.status != NodeStatus.SKIPPED),
        "done": sum(1 for n in nodes if n.status in (NodeStatus.APPROVED, NodeStatus.TRAVERSED, NodeStatus.ESCALATED)),
        "pending_realms": [_realm(s.tenant) for s in segments if s.state == SegmentState.AWAITING_PICK],
        "segments": [segment_row(s, workflow, request) for s in segments],
    }


def pick_tasks(scope, now=None):
    """「待我选站」:本域还没选站的外域段(流程没结束),给能选站的人(没有时给殿管理员)。在门口等的排最前。"""
    tenant, user = getattr(scope, "tenant", None), scope.user
    if tenant is None or user.pk not in {u.pk for u in pick_recipients(tenant.pk)}:
        return []
    now = now or timezone.now()
    rows = (WorkflowSegment.objects.filter(
        tenant=tenant, state=SegmentState.AWAITING_PICK,
        workflow__status__in=(ApprovalWorkflowStatus.PENDING, ApprovalWorkflowStatus.IN_PROGRESS),
    ).select_related("workflow__soul", "workflow__tenant").prefetch_related("nodes")
        .order_by(F("gate_reached_at").asc(nulls_last=True), "created_at"))
    out = []
    for segment in rows:
        workflow = segment.workflow
        gate = at_gate(segment, workflow)
        out.append({
            "segment": segment,
            "workflow": workflow,
            "go": sum(1 for n in segment.nodes.all() if n.status != NodeStatus.SKIPPED),
            "total": len(segment.nodes.all()),
            "gate_days": gate_days(segment, now) if gate else None,
            "stations_ahead": None if gate else workflow.nodes.filter(
                status=NodeStatus.PENDING, segment__order__lt=segment.order).count(),
        })
    return out
