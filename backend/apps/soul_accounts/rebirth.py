"""转生申请:复用审批工作流。

状态机(RebirthApplication.status,是工作流状态的投影):

    提交 → UNDER_REVIEW ──工作流 COMPLETED──→ APPROVED
                        └─工作流 REJECTED ──→ REJECTED ──灵魂申诉(仅一次)──→ APPEALING
                                                         申诉工作流 COMPLETED → APPROVED
                                                         申诉工作流 REJECTED  → APPEAL_REJECTED

服务端强制:
* 同时只有一份进行中(UNDER_REVIEW / APPEALING)—— 锁账号行 + 部分唯一约束;
* 每份申请申诉一次 —— 只有 REJECTED 可申诉,申诉后状态离开 REJECTED 就回不来;
* 冷却 —— 最近一次**终局驳回**(REJECTED 或 APPEAL_REJECTED)之后
  `Tenant.settings["soul_rebirth_cooldown_days"]` 天(默认 30)内不能再提交新申请。
  简报只写了「申诉被驳回后」;未申诉的驳回也算,是更保守的读法 —— 否则
  「被驳回就换一份重新提交」可以绕过申诉与冷却(见报告「待用户确认」);
* 只有本世账号能提交 / 申诉;前世申请只读。

**受刑计划全部完成才开放**(Q6,docs/ARCHITECTURE-sentence-plan.md §6);暂居中的灵魂计划未完,不能申请。
**一律按原属文明**(2026-09-17:跨文明调拨是暂居);
工作流建在原属租户、由原属租户的判官与阎罗审批;冷却天数读原属租户的设置。
调拨前提交的申请照常可申诉 —— `can_appeal` 本来就不看租户。
"""
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.soul_accounts.models import (
    OPEN_APPLICATION_STATUSES,
    CooldownShorteningRequest,
    CooldownShorteningStatus,
    RebirthApplication,
    RebirthApplicationStatus,
    SoulAccount,
)
from apps.soul_accounts.services import SoulAccountError
from apps.tenants.models import REBIRTH_COOLDOWN_SETTING

DEFAULT_COOLDOWN_DAYS = 30
COOLDOWN_SETTING = REBIRTH_COOLDOWN_SETTING
FINAL_REJECTIONS = (RebirthApplicationStatus.REJECTED, RebirthApplicationStatus.APPEAL_REJECTED)

#: 节点按**角色**指定审批人,不按神祇:转生申请没有经典出处的审理殿,
#: 编一个等于替神话造人(apps/workflow/templates.py 对 TEMPLATE_NODES_WITHOUT_AN_APPROVER 的立场)。
#: MODERATOR 不在里面 —— 它刻意不持有 workflow.approve(apps/perm/models.py)。
REBIRTH_NODES = [
    ("判官初审", "EVALUATION", "JUDGE"),
    ("终审", "FINAL", "ADMIN"),
]
APPEAL_NODES = [
    ("申诉复核", "APPEAL", "JUDGE"),
    ("申诉终审", "FINAL", "ADMIN"),
]
#: 受刑计划完成时灵魂进 REINCARNATING(可转世文明,§3.3);计划完成才开放申请(Q6),所以是它。
#: 原属地永久刑期收尾的计划让灵魂进 SETTLED(永久 = 不转生,2026-09-29),于是这里答 `soul_state`。
#: **只有它**(2026-09-19 用户改定,设计稿决策记录 D12):DISPOSED 不再放行 —— 「ADMIN 修过数据、
#: 计划完成而灵魂没能转移」的形状也拒,要申请先把灵魂状态修对。
SOUL_STATES_THAT_MAY_APPLY = ("REINCARNATING",)


def cooldown_days(tenant) -> int:
    try:
        return max(0, int((tenant.settings or {}).get(COOLDOWN_SETTING, DEFAULT_COOLDOWN_DAYS)))
    except (TypeError, ValueError):
        return DEFAULT_COOLDOWN_DAYS


def eligibility(account):
    """`(can_apply, reason_code, cooldown_until)`。App 用它决定是否显示「提交」。"""
    from apps.ledger.constants import REBIRTH_CAPABLE_CIVILIZATIONS

    soul = account.soul
    if account.retired_at is not None:
        return False, "account_retired", None
    if soul.home_civilization not in REBIRTH_CAPABLE_CIVILIZATIONS:
        return False, "terminal_cosmology", None
    # Q6:受刑计划**全部完成**才开放(docs/ARCHITECTURE-sentence-plan.md §6)。本世最新的那份计划;
    # 没有计划 = 本世还没结过案,同样不开放。已提交的申请照常可申诉(`can_appeal` 不看这里)。
    from apps.sentence_plan.models import SentencePlan, SentencePlanStatus

    plan = (
        SentencePlan.all_objects.filter(soul_id=soul.pk, cycle=account.cycle, is_deleted=False)
        .order_by("-create_time").first()
    )
    # CANCELLED = 撤销,即赦免剩余刑期、视为完成(2026-09-19 用户决定),同样开放。
    served = plan is not None and plan.status in (SentencePlanStatus.COMPLETED, SentencePlanStatus.CANCELLED)
    if soul.current_state not in SOUL_STATES_THAT_MAY_APPLY:
        # 计划期间灵魂保持 DISPOSED(§3.3):那时答「受刑未完」比答「状态不对」说得清楚。
        # 计划已完成而灵魂仍是 DISPOSED(ADMIN 修过数据)→ soul_state,不放行(D12)。
        if soul.current_state == "DISPOSED" and not served:
            return False, "sentence_in_progress", None
        return False, "soul_state", None
    if not served:
        return False, "sentence_in_progress", None
    mine = RebirthApplication.objects.filter(soul=soul)
    if mine.filter(status__in=OPEN_APPLICATION_STATUSES).exists():
        return False, "application_open", None
    if mine.filter(cycle=account.cycle, status=RebirthApplicationStatus.APPROVED).exists():
        return False, "application_approved", None
    last = cooldown_application(soul)
    if last is not None:
        until = cooldown_until(last)
        if until is not None:
            return False, "cooldown", until
    return True, None, None


def cooldown_application(soul):
    """最近一次终局驳回的申请 —— 冷却期(若还在)由它起算。"""
    return (
        RebirthApplication.objects.filter(soul=soul, status__in=FINAL_REJECTIONS, decided_at__isnull=False)
        .order_by("-decided_at").first()
    )


def _cooldown_end(application):
    """这份申请的终局驳回引起的冷却截止时刻,不看现在几点。殿规截止与「批准缩短」取较早者;
    殿的设置本身不动(`Tenant.settings`),所以殿规后来调短也照样生效。"""
    until = application.decided_at + timedelta(days=cooldown_days(application.soul.home_tenant))
    shortening = CooldownShorteningRequest.objects.filter(
        application=application, status=CooldownShorteningStatus.APPROVED, decided_at__isnull=False,
    ).first()
    if shortening is not None:
        until = min(until, shortening.decided_at + timedelta(days=shortening.approved_days or 0))
    return until


def cooldown_span(application):
    """`(原截止, 现截止, 总天数, 已过天数)`:官员台的「已过 a / 共 b 天」用。

    原截止 = 殿规截止(不含批准的缩短);现截止 = `_cooldown_end`(含缩短,可能已过去)。
    总天数以**现截止**起算,所以批准后进度线仍然是满刻度:`past ≤ total`。
    没有终局驳回的申请(`decided_at` 为空)返回 `None`。
    """
    if application.status not in FINAL_REJECTIONS or application.decided_at is None:
        return None
    original = application.decided_at + timedelta(days=cooldown_days(application.soul.home_tenant))
    end = _cooldown_end(application)
    total = max(0, -(-int((end - application.decided_at).total_seconds()) // 86400))
    past = max(0, min(total, int((timezone.now() - application.decided_at).total_seconds() // 86400)))
    return original, end, total, past


REFUSALS = {
    "account_retired": "账号已停用。",
    "terminal_cosmology": "本文明没有转生。",
    "soul_state": "当前状态不能申请转生。",
    "application_open": "已有一份进行中的转生申请。",
    "application_approved": "本世的转生申请已获批准。",
    "cooldown": "驳回后的冷却期内不能重新申请。",
    "sentence_in_progress": "受刑计划尚未完成,完成后才能申请转生。",
    # 缩短冷却申请(下面 request_cooldown_shortening)
    "not_in_cooldown": "只有在转生冷却期内才能申请缩短冷却。",
    "shortening_pending": "已有一份待决的缩短冷却申请。",
    "shortening_used": "这段冷却期已经申请过一次缩短。",
}


def _create_workflow(soul, nodes, *, name, original=None):
    from apps.workflow.models import (
        ApprovalNode,
        ApprovalWorkflow,
        ApprovalWorkflowStatus,
        CaseType,
        NodeStatus,
    )

    workflow = ApprovalWorkflow.objects.create(
        soul=soul, workflow_name=name, case_type=CaseType.REBIRTH_APPLICATION,
        status=ApprovalWorkflowStatus.PENDING, is_appeal=original is not None,
        original_workflow=original, tenant=soul.home_tenant,
    )
    created = [
        ApprovalNode.objects.create(
            workflow=workflow, node_name=node_name, node_order=order, node_type=node_type,
            court_code="转生申请", approver_type="ROLE", approver_role=role, status=NodeStatus.PENDING,
            required_verdicts=["PASSED", "FAILED", "CONFIRMED", "REJECTED"],
        )
        for order, (node_name, node_type, role) in enumerate(nodes, start=1)
    ]
    workflow.current_node = created[0]
    workflow.status = ApprovalWorkflowStatus.IN_PROGRESS
    workflow.save(update_fields=["current_node", "status"])
    return workflow


def _lock_account(account):
    return SoulAccount.objects.select_for_update(of=("self",)).select_related("soul__tenant", "soul__home_tenant", "user").get(pk=account.pk)


def submit(account, desired_form, statement=""):
    from apps.events.services import EventService
    from apps.souls.models import Soul
    from apps.workflow.services import WorkflowService

    with transaction.atomic():
        account = _lock_account(account)
        # 锁序 账号 → 灵魂:受刑计划在灵魂行锁下完成(`SentencePlanService.advance`),
        # 资格要在同一把锁下读,才不会读到一份正在变的计划(设计稿 §8 PG 测试 4)。
        Soul.all_objects.select_for_update(of=("self",)).get(pk=account.soul_id)
        can, code, _ = eligibility(account)
        if not can:
            raise SoulAccountError(REFUSALS[code], code, 409)
        soul = account.soul
        try:
            with transaction.atomic():
                workflow = _create_workflow(soul, REBIRTH_NODES, name=f"转生申请: {soul.soul_code}")
                application = RebirthApplication.objects.create(
                    soul=soul, account=account, cycle=account.cycle, desired_form=desired_form,
                    statement=statement, status=RebirthApplicationStatus.UNDER_REVIEW, workflow=workflow,
                )
        except IntegrityError:
            raise SoulAccountError(REFUSALS["application_open"], "application_open", 409) from None
    WorkflowService.announce(workflow, created=True)
    EventService.log(soul, "REBIRTH_APPLICATION_SUBMITTED", {
        "application_id": str(application.pk), "cycle": application.cycle,
        "desired_form": desired_form, "workflow_id": str(workflow.pk),
    })
    return application


def appeal(account, application_id, statement=""):
    from apps.workflow.services import WorkflowService

    with transaction.atomic():
        account = _lock_account(account)
        application = (
            RebirthApplication.objects.select_for_update()
            .filter(pk=application_id, soul=account.soul).first()
        )
        if application is None:
            raise SoulAccountError("申请不存在。", "not_found", 404)
        if application.cycle != account.cycle:
            raise SoulAccountError("前世的申请只读。", "past_life_read_only", 403)
        if application.appeal_workflow_id is not None:
            raise SoulAccountError("每份申请只能申诉一次。", "appeal_used", 409)
        if application.status != RebirthApplicationStatus.REJECTED:
            raise SoulAccountError("只有被驳回的申请可以申诉。", "not_appealable", 409)
        if RebirthApplication.objects.filter(soul=account.soul, status__in=OPEN_APPLICATION_STATUSES).exists():
            raise SoulAccountError(REFUSALS["application_open"], "application_open", 409)
        workflow = _create_workflow(
            account.soul, APPEAL_NODES, name=f"转生申请申诉: {account.soul.soul_code}",
            original=application.workflow,
        )
        old = application.status
        application.appeal_workflow = workflow
        application.appeal_statement = statement
        application.status = RebirthApplicationStatus.APPEALING
        # 首次驳回留档,再清空「最近一次决定」两列给申诉结论用(见模型上的注释)。
        application.first_rejection_reason = application.rejection_reason
        application.first_decided_at = application.decided_at
        application.rejection_reason = ""
        application.decided_at = None
        application.save()
    WorkflowService.announce(workflow, created=True)
    _announce_status(application, old)
    return application


def _project(application):
    """两个工作流的状态 → 申请状态。"""
    if application.appeal_workflow_id is not None:
        status = application.appeal_workflow.status
        if status == "COMPLETED":
            return RebirthApplicationStatus.APPROVED
        if status == "REJECTED":
            return RebirthApplicationStatus.APPEAL_REJECTED
        return RebirthApplicationStatus.APPEALING
    status = application.workflow.status
    if status == "COMPLETED":
        return RebirthApplicationStatus.APPROVED
    if status == "REJECTED":
        return RebirthApplicationStatus.REJECTED
    return RebirthApplicationStatus.UNDER_REVIEW


def active_workflow(application):
    return application.appeal_workflow if application.appeal_workflow_id else application.workflow


# ── 两边序列化器共用的派生字段(/me 与官员侧必须给出同一个答案)──────────────


def current_step(application):
    """当前节点的类型与**角色**;不含审批人是谁。申请已终结时为 None。"""
    if application.status not in OPEN_APPLICATION_STATUSES:
        return None
    node = active_workflow(application).current_node
    if node is None:
        return None
    return {"node_type": node.node_type, "approver_role": node.approver_role,
            "is_appeal": application.appeal_workflow_id is not None}


def can_appeal(application, account) -> bool:
    """本世的、被驳回的、还没申诉过的申请。`account` 是当前(未停用)账号。"""
    return bool(
        account is not None and account.retired_at is None and application.cycle == account.cycle
        and application.status == RebirthApplicationStatus.REJECTED and application.appeal_workflow_id is None
    )


def cooldown_until(application):
    """这份申请的终局驳回引起的冷却截止时刻;不在冷却中为 None。批准的缩短已算在内。"""
    if application.status not in FINAL_REJECTIONS or application.decided_at is None:
        return None
    until = _cooldown_end(application)
    return until if until > timezone.now() else None


# ── 缩短冷却申请 ─────────────────────────────────────────────────────────
#
# 与申诉同形:灵魂在账号行锁下提交;每段冷却(= 每份终局驳回的申请)只能申请一次,驳回后不能再提;
# 官员在申请行锁下决定。批准写 `approved_days`(自决定时刻起还要等的天数,< 当时的剩余天数),
# `_cooldown_end` 据此把这份申请的冷却截止提前;**殿的设置不动**。


def remaining_cooldown_days(until, now=None) -> int:
    """到 `until` 还有几天,向上取整;已过为 0。批准的天数必须小于它。"""
    seconds = (until - (now or timezone.now())).total_seconds()
    return max(0, -(-int(seconds) // 86400))


def cooldown_shortening_eligibility(account):
    """`(can_request, reason_code, application)`。App 用它决定是否显示「申请缩短冷却」。"""
    can, code, _ = eligibility(account)
    if can or code != "cooldown":
        return False, "not_in_cooldown", None
    application = cooldown_application(account.soul)
    existing = CooldownShorteningRequest.objects.filter(application=application).first()
    if existing is not None:
        code = "shortening_pending" if existing.status == CooldownShorteningStatus.PENDING else "shortening_used"
        return False, code, application
    return True, None, application


def current_cooldown_shortening(account):
    """本世最近一份缩短冷却申请(给 /me 列表):没有为 None。"""
    return CooldownShorteningRequest.objects.filter(soul=account.soul, cycle=account.cycle).first()


def request_cooldown_shortening(account, reason):
    with transaction.atomic():
        account = _lock_account(account)
        can, code, application = cooldown_shortening_eligibility(account)
        if not can:
            raise SoulAccountError(REFUSALS[code], code, 409)
        try:
            with transaction.atomic():
                shortening = CooldownShorteningRequest.objects.create(
                    soul=account.soul, account=account, application=application, cycle=account.cycle,
                    reason=reason,
                )
        except IntegrityError:
            raise SoulAccountError(REFUSALS["shortening_pending"], "shortening_pending", 409) from None
    return shortening


def decide_cooldown_shortening(request_id, user, *, approve: bool, approved_days=None, note="", request=None):
    """官员批准或驳回。行锁下再读一次状态(与 decide_cross_civilization 同形):
    两个官员同时决定,只有先拿到锁的那个算数。"""
    from apps.events.services import EventService
    from apps.soul_accounts.services import audit

    with transaction.atomic():
        shortening = (
            CooldownShorteningRequest.objects.select_for_update(of=("self",))
            .select_related("application__soul__home_tenant", "account__user").get(pk=request_id)
        )
        if shortening.status != CooldownShorteningStatus.PENDING:
            raise SoulAccountError("这份申请已经决定过了。", "already_decided", 409)
        until = cooldown_until(shortening.application)
        if until is None:
            raise SoulAccountError("冷却期已经结束或已作废,无需决定。", "cooldown_over", 409)
        now = timezone.now()
        if approve:
            remaining = remaining_cooldown_days(until, now)
            if approved_days is None or not 0 <= approved_days < remaining:
                raise SoulAccountError(f"批准的天数须在 0 到 {remaining - 1} 之间(剩余 {remaining} 天)。",
                                       "invalid_days", 400)
            shortening.status = CooldownShorteningStatus.APPROVED
            shortening.approved_days = approved_days
        else:
            if not note.strip():
                raise SoulAccountError("驳回必须写给灵魂看的理由。", "note_required", 400)
            shortening.status = CooldownShorteningStatus.REJECTED
        shortening.decision_note = note
        shortening.decided_by = user
        shortening.decided_at = now
        shortening.save()
        soul = shortening.application.soul
        audit("EXECUTE", soul, f"{'批准' if approve else '驳回'}缩短转生冷却申请"
              + (f"(剩余 {approved_days} 天)" if approve else ""),
              actor=user, request=request, resource_id=shortening.pk, resource="cooldown_shortening",
              changes={"status": ["PENDING", shortening.status], "approved_days": [None, shortening.approved_days]})
    EventService.log(soul, "COOLDOWN_SHORTENING_DECIDED", {
        "request_id": str(shortening.pk), "application_id": str(shortening.application_id),
        "status": shortening.status, "decided_by": user.username,
    })
    EventService.notify_user(
        user=shortening.account.user,
        title="缩短冷却申请有了结果",
        message=f"您的缩短冷却申请:{shortening.get_status_display()}。",
        notification_type="SYSTEM",
        related_resource="cooldown_shortening",
        related_id=str(shortening.pk),
    )
    return shortening


def sync_from_workflow(workflow_id):
    """工作流任何一次保存提交之后调用(signals.py)。状态没变什么也不做。"""
    with transaction.atomic():
        application = (
            RebirthApplication.objects.select_for_update()
            .filter(Q(workflow_id=workflow_id) | Q(appeal_workflow_id=workflow_id)).first()
        )
        if application is None:
            return None
        application.refresh_from_db()  # 丢掉 select_related 缓存的工作流,读提交后的状态
        new = _project(application)
        if new == application.status:
            return application
        old = application.status
        application.status = new
        if new in (RebirthApplicationStatus.APPROVED, *FINAL_REJECTIONS):
            application.decided_at = timezone.now()
        # 驳回理由不在这里取:它是审批人另填的「给灵魂的理由」,由 approve_node 在同一事务里
        # 写进 rejection_reason(record_reason_for_soul)。节点 notes 是内部备注,灵魂看不到。
        application.save()
    _announce_status(application, old)
    return application


PASSING_VERDICTS = ("PASSED", "CONFIRMED")


def requires_reason_for_soul(workflow, verdict) -> bool:
    """这次决定是不是在驳回一份转生申请(complete_node 把非 PASSED/CONFIRMED 都当驳回)。"""
    from apps.workflow.models import CaseType

    return workflow.case_type == CaseType.REBIRTH_APPLICATION and verdict not in PASSING_VERDICTS


def record_reason_for_soul(workflow, reason):
    RebirthApplication.objects.filter(Q(workflow=workflow) | Q(appeal_workflow=workflow)).update(
        rejection_reason=reason[:2000]
    )


def _announce_status(application, old_status):
    from apps.events.services import EventService

    soul = application.soul
    EventService.log(soul, "REBIRTH_STATUS_CHANGED", {
        "application_id": str(application.pk), "old_status": old_status, "new_status": application.status,
    })
    EventService.notify_user(
        user=application.account.user,
        title="转生申请状态更新",
        message=f"您的转生申请状态:{application.get_status_display()}。",
        notification_type="SYSTEM",
        related_resource="rebirth_application",
        related_id=str(application.pk),
    )


def cross_civilization_refusal(application, user):
    """`user` 此刻能不能决定这份申请是否跨文明。None = 能;否则是拒绝它的 SoulAccountError。

    **唯一一处判定。** `decide_cross_civilization`(`cross-civilization/` 端点)在行锁下调用它,
    官员侧序列化器的 `can_decide_cross_civilization` 也调用它 —— 前端按钮只读那个字段,
    不再自己拼「node_type == EVALUATION 且角色相同」。两处各写一份,就会有一天按钮亮着而端点 403。
    """
    from apps.perm.checker import check_permission

    workflow = application.workflow
    first = workflow.nodes.order_by("node_order").first()
    if (
        application.status != RebirthApplicationStatus.UNDER_REVIEW or application.appeal_workflow_id is not None
        or first is None or workflow.current_node_id != first.pk or first.status != "PENDING"
    ):
        return SoulAccountError("初审已结束,不能再决定是否跨文明。", "not_in_initial_review", 409)
    if not check_permission(user, "workflow.approve"):
        return SoulAccountError("没有审批权限。", "missing_permission", 403)
    if not first.can_approve(user):
        return SoulAccountError("只有初审节点指定的审批人可以决定。", "not_the_approver", 403)
    return None


def decide_cross_civilization(application_id, user, value: bool):
    """判官初审决定是否跨文明。只在初审节点仍待决、且调用者正是该节点指定的审批人时可写。
    跨文明时只发事件 —— 本服务不去写目标文明的任何数据(分库约束)。"""
    from apps.events.services import EventService

    with transaction.atomic():
        application = (
            RebirthApplication.objects.select_for_update(of=("self",))
            .select_related("workflow__current_node", "soul__tenant").get(pk=application_id)
        )
        refusal = cross_civilization_refusal(application, user)
        if refusal is not None:
            raise refusal
        workflow = application.workflow
        application.cross_civilization = value
        application.save(update_fields=["cross_civilization", "updated_at"])
        workflow.cross_civilization = value
        workflow.save(update_fields=["cross_civilization"])
    EventService.log(application.soul, "REBIRTH_CROSS_CIV_DECIDED", {
        "application_id": str(application.pk), "cross_civilization": value,
        "desired_form": application.desired_form, "decided_by": user.username,
    })
    return application
