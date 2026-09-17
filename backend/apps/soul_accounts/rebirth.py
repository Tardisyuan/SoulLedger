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
"""
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.soul_accounts.models import (
    OPEN_APPLICATION_STATUSES,
    RebirthApplication,
    RebirthApplicationStatus,
    SoulAccount,
)
from apps.soul_accounts.services import SoulAccountError

DEFAULT_COOLDOWN_DAYS = 30
COOLDOWN_SETTING = "soul_rebirth_cooldown_days"
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
SOUL_STATES_THAT_MAY_APPLY = ("JUDGING", "DISPOSED")


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
    if soul.civilization not in REBIRTH_CAPABLE_CIVILIZATIONS:
        return False, "terminal_cosmology", None
    if soul.current_state not in SOUL_STATES_THAT_MAY_APPLY:
        return False, "soul_state", None
    mine = RebirthApplication.objects.filter(soul=soul)
    if mine.filter(status__in=OPEN_APPLICATION_STATUSES).exists():
        return False, "application_open", None
    if mine.filter(cycle=account.cycle, status=RebirthApplicationStatus.APPROVED).exists():
        return False, "application_approved", None
    last = mine.filter(status__in=FINAL_REJECTIONS, decided_at__isnull=False).order_by("-decided_at").first()
    if last is not None:
        until = last.decided_at + timedelta(days=cooldown_days(soul.tenant))
        if until > timezone.now():
            return False, "cooldown", until
    return True, None, None


REFUSALS = {
    "account_retired": "账号已停用。",
    "terminal_cosmology": "本文明没有转生。",
    "soul_state": "当前状态不能申请转生。",
    "application_open": "已有一份进行中的转生申请。",
    "application_approved": "本世的转生申请已获批准。",
    "cooldown": "驳回后的冷却期内不能重新申请。",
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
        original_workflow=original, tenant=soul.tenant,
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
    return SoulAccount.objects.select_for_update(of=("self",)).select_related("soul__tenant", "user").get(pk=account.pk)


def submit(account, desired_form, statement=""):
    from apps.events.services import EventService
    from apps.workflow.services import WorkflowService

    with transaction.atomic():
        account = _lock_account(account)
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


def decide_cross_civilization(application_id, user, value: bool):
    """判官初审决定是否跨文明。只在初审节点仍待决、且调用者正是该节点指定的审批人时可写。
    跨文明时只发事件 —— 本服务不去写目标文明的任何数据(分库约束)。"""
    from apps.events.services import EventService

    with transaction.atomic():
        application = (
            RebirthApplication.objects.select_for_update(of=("self",))
            .select_related("workflow__current_node", "soul__tenant").get(pk=application_id)
        )
        workflow = application.workflow
        first = workflow.nodes.order_by("node_order").first()
        if (
            application.status != RebirthApplicationStatus.UNDER_REVIEW
            or first is None or workflow.current_node_id != first.pk or first.status != "PENDING"
        ):
            raise SoulAccountError("初审已结束,不能再决定是否跨文明。", "not_in_initial_review", 409)
        if not first.can_approve(user):
            raise SoulAccountError("只有初审节点指定的审批人可以决定。", "not_the_approver", 403)
        application.cross_civilization = value
        application.save(update_fields=["cross_civilization", "updated_at"])
        workflow.cross_civilization = value
        workflow.save(update_fields=["cross_civilization"])
    EventService.log(application.soul, "REBIRTH_CROSS_CIV_DECIDED", {
        "application_id": str(application.pk), "cross_civilization": value,
        "desired_form": application.desired_form, "decided_by": user.username,
    })
    return application
