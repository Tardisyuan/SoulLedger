"""申诉:灵魂对已结案审判的异议,另一位官员复核(用户 2026-10-24 决定)。`JudgmentAppeal` 只在这里写。

规则
* 希腊不能申诉:米诺斯之上无可上诉(docs/02_希腊冥府审判与人物详解.md §5.2,用户 2026-10-27),拒绝码
  `no_appeal_above_minos`。
* 被阿米特吞噬(第二次死亡,docs/02_奥西里斯审判详解.md「不复存在」)之后不能申诉,拒绝码 `soul_devoured`;
  吞噬执行时还开着的申诉(连同它的申诉流程)当场作废(`VOID`,无补偿、不改判),见 `void_for_devoured`。
* 原审的审批流程还在走(PENDING / IN_PROGRESS)时不能申诉、也不能上诉,拒绝码 `origin_flow_open`(用户 2026-10-29);
  官员端手动发起的 APPEAL 流程同一个码(`WorkflowService.start_workflow`)。
* 灵魂只能对**自己本世**、**已结案**的**原审判**(ORIGINAL)申诉;结案后 30 天内;每件审判至多 2 次
  (撤回的也算一次);同一时刻至多一份没有结论的。
* 复核人不能是作出原判的官员:结案人(`Judgment.concluded_by`)或认领人(`claimed_by`)。
* 结论:维持(UPHELD)或改判(AMENDED)。改判时受刑计划未执行的部分改按新裁决
  (`apps/sentence_plan/requests.amend_for_appeal`),已执行的每一站记一笔补偿功德(`COMPENSATION`)。

上诉(用户 2026-10-27,docs/03_人物关系图.md、local-gates/流程退回规则草案.md「申诉审判流程」):一次复核**维持**之后,
灵魂可用剩下的次数把申诉送进本文明的多站申诉流程(`CaseType.APPEAL` 模板:地府 魏征 → 原殿 → 上级殿 → 酆都大帝,
杜阿特 Isis → Nephthys → Osiris,彼岸 受理 → Michael 呈上 → Christ 终审)。流程驳回 = 申诉不成立、维持原判(自动);
流程走完 = 申诉成立,终审那位官员成为复核人,照常 `decide`(改判的计划与补偿同一套)。流程跑着时不能认领、决定、撤回。

事件写在同一事务里(CLAUDE.md 事件日志一节);推送由事件经 `apps/soul_push` 在提交后发出。
拒绝一律 `AppealRefusedError`(稳定的 `code`),在任何写入之前抛出。
"""
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.judgment.claims import ClaimRefusedError
from apps.judgment.models import (
    APPEAL_MAX_ROUNDS,
    APPEAL_WINDOW_DAYS,
    OPEN_APPEAL_STATUSES,
    AppealStatus,
    Judgment,
    JudgmentAppeal,
    JudgmentKind,
)
from apps.souls.models import Civilization


class AppealRefusedError(ClaimRefusedError):
    """申诉此刻不接受这个动作。与认领同一形状(`code`、`status`、`as_payload`)。"""


def deadline(judgment):
    """30 days from the judgment's conclusion — or, for a second appeal, from the first appeal's decision
    (2026-10-24 user decision: a slow review must not eat the second chance)."""
    if not judgment.concluded_at:
        return None
    last = (JudgmentAppeal.all_objects.filter(judgment_id=judgment.pk, is_deleted=False, decided_at__isnull=False)
            .order_by("-decided_at").values_list("decided_at", flat=True).first())
    return max(judgment.concluded_at, last or judgment.concluded_at) + timedelta(days=APPEAL_WINDOW_DAYS)


def original_officers(judgment):
    """作出原判的官员:不能复核这件审判的申诉。"""
    return {pk for pk in (judgment.concluded_by_id, judgment.claimed_by_id) if pk is not None}


def _lock_judgment(pk):
    return Judgment.all_objects.select_for_update(of=("self",)).get(pk=pk)


def _lock_appeal(pk):
    appeal = JudgmentAppeal.all_objects.select_for_update(of=("self",)).filter(pk=pk, is_deleted=False).first()
    if appeal is None:
        raise AppealRefusedError("No such appeal.", "not_found", status=404)
    return appeal


def _event(soul, event_type, appeal, **extra):
    from apps.events.services import EventService

    EventService.log(soul, event_type, {
        "appeal_id": str(appeal.pk), "judgment_id": str(appeal.judgment_id), "round": appeal.round,
        "status": appeal.status, **extra,
    })


def devoured(soul_id):
    """被阿米特吞噬:有一笔已执行、去处是 `EG_ANNIHILATION` 的处置。"""
    from apps.disposition.models import Disposition
    from apps.disposition.services import DispositionService

    return Disposition.all_objects.filter(
        soul_id=soul_id, is_executed=True, is_deleted=False,
        destination_realm__realm_code=DispositionService.EG_ANNIHILATION).exists()


def void_for_devoured(soul):
    """吞噬执行时调(`DispositionService._mark_executed`,同一事务):还开着的申诉作废 —— 不补偿、不改判,
    事件照记;挂着的申诉流程随之结束(REJECTED,`end_reason=SOUL_DEVOURED`)。申诉先作废,
    所以流程结束时 `on_ladder_finished` 找不到开着的申诉,不会再按「维持原判」结一次。"""
    void_open_appeals(soul, because="soul_devoured", end_reason=END_REASON_DEVOURED)


def void_open_appeals(soul, *, because, end_reason, judgment_id=None):
    """作废这个灵魂(给了 `judgment_id` 就只那件审判)还开着的申诉,并结束它们挂着的申诉流程。调用方在事务里。

    锁序:申诉流程 → 申诉(2026-10-29)。审批一站走完时是流程先锁(`complete_node`),然后 `_finish` →
    `on_ladder_finished` 才锁申诉;这里原先反过来(申诉 → 流程),两边同时走就互相等 —— 死锁。所以先只读出
    要动的申诉流程,按主键顺序锁住,再锁申诉。灵魂行(调用方已锁)在两者之前,与审批那条路径不冲突:
    审批申诉流程不锁灵魂,原审流程驳回(`reweigh_after_rejection`)是 原审流程 → 灵魂 → 申诉流程 → 申诉。"""
    from apps.workflow.models import TERMINAL_WORKFLOW_STATUSES, ApprovalWorkflow, ApprovalWorkflowStatus

    open_appeals = JudgmentAppeal.all_objects.filter(soul_id=soul.pk, is_deleted=False,
                                                     status__in=OPEN_APPEAL_STATUSES)
    if judgment_id is not None:
        open_appeals = open_appeals.filter(judgment_id=judgment_id)
    flow_ids = sorted(open_appeals.exclude(workflow_id=None).values_list("workflow_id", flat=True))
    flows = {w.pk: w for w in ApprovalWorkflow.all_objects.select_for_update().filter(pk__in=flow_ids).order_by("pk")}
    now = timezone.now()
    for appeal in open_appeals.select_for_update(of=("self",)):
        appeal.status = AppealStatus.VOID
        appeal.decided_at = now
        appeal.save(update_fields=["status", "decided_at", "update_time", "update_user", "version"])
        _event(soul, "JUDGMENT_APPEAL_DECIDED", appeal, new_verdict=None, compensation_record_ids=[],
               voided_because=because)
        workflow = flows.get(appeal.workflow_id)
        if workflow is not None and workflow.status not in TERMINAL_WORKFLOW_STATUSES:
            workflow._finish(ApprovalWorkflowStatus.REJECTED, now, end_reason=end_reason)
            workflow.save()


#: 灵魂被吞噬而结束的申诉流程写在 `end_reason` 上。
END_REASON_DEVOURED = "SOUL_DEVOURED"
#: 原审流程被驳回、案子重开(`weighing.reweigh_after_rejection`)时,那件审判的申诉流程写在 `end_reason` 上。
END_REASON_REOPENED = "CASE_REOPENED"


# ── 灵魂 ────────────────────────────────────────────────────────────────


def appeal_refusal(judgment, account):
    """这个灵魂此刻能否对这件审判提出申诉:None,或拒绝它的 `AppealRefusedError`(不写任何东西)。
    灵魂端列表用它算 `can_appeal`,`file` 在锁下再问一遍。"""
    if judgment.cycle != account.cycle:
        return AppealRefusedError("A previous life's judgment is read only.", "past_life_read_only", status=403)
    if judgment.civilization == Civilization.GREEK:
        # Minos's judgment is the last word: nothing above it to appeal to (docs/02 希腊 §5.2; user 2026-10-27).
        return AppealRefusedError("Minos's judgment cannot be appealed.", "no_appeal_above_minos")
    if devoured(judgment.soul_id):
        return AppealRefusedError("A soul devoured by Ammit no longer exists to appeal.", "soul_devoured")
    if judgment.verdict is None or not judgment.is_final or judgment.is_deleted:
        return AppealRefusedError("This judgment has not been concluded.", "not_concluded")
    if judgment.kind != JudgmentKind.ORIGINAL:
        return AppealRefusedError("Only an original judgment can be appealed.", "not_appealable")
    from apps.judgment.weighing import origin_flow_open

    if origin_flow_open(judgment=judgment):
        # 原审的审批流程没走完,结论还不算定(用户 2026-10-29,审查 B):申诉与上诉都等它走完。
        return AppealRefusedError("The judgment's approval flow has not finished.", "origin_flow_open")
    rounds = JudgmentAppeal.all_objects.filter(judgment_id=judgment.pk, is_deleted=False)
    if rounds.filter(status__in=OPEN_APPEAL_STATUSES).exists():
        return AppealRefusedError("An appeal on this judgment is already open.", "appeal_open")
    if rounds.count() >= APPEAL_MAX_ROUNDS:
        return AppealRefusedError(f"A judgment can be appealed at most {APPEAL_MAX_ROUNDS} times.",
                                  "appeal_rounds_used")
    if timezone.now() > deadline(judgment):
        return AppealRefusedError(f"Appeals close {APPEAL_WINDOW_DAYS} days after the judgment.",
                                  "appeal_window_closed", deadline=deadline(judgment).isoformat())
    return None


def escalation_refusal(judgment, account):
    """能否上诉到多站申诉流程:先过 `appeal_refusal`,再要求上一轮是一次复核、且维持原判。"""
    refusal = appeal_refusal(judgment, account)
    if refusal is not None:
        return refusal
    last = (JudgmentAppeal.all_objects.filter(judgment_id=judgment.pk, is_deleted=False)
            .exclude(status=AppealStatus.WITHDRAWN).order_by("-round").first())
    if last is None or last.status != AppealStatus.UPHELD or last.workflow_id is not None:
        return AppealRefusedError("Only an appeal upheld on review can be taken up the appeal flow.",
                                  "not_escalatable")
    return None


def escalation_stations(judgment):
    """上诉确认页(Design 第五十五批 U-2)要列的站名:上诉时会建的那条 APPEAL 流程的人工节点名,按顺序。
    模板与 `_start_ladder` 同一个来源(`WorkflowService._resolve_template`)。"""
    from apps.workflow.models import AUTOMATIC_KINDS, CaseType
    from apps.workflow.node_shape import normalize_template_node
    from apps.workflow.services import WorkflowService

    template, _ = WorkflowService._resolve_template(judgment.civilization, CaseType.APPEAL, judgment.tenant)
    # Normalized first, as `WorkflowService` does: a hall's saved template stores `node_name` / `node_order`, the
    # built-in presets `name` / `order` (apps/workflow/node_shape.py) — reading `name` raised KeyError, a 500.
    nodes = sorted((normalize_template_node(n, i) for i, n in enumerate(template["nodes"], start=1)),
                   key=lambda n: n["node_order"])
    return [n["node_name"] for n in nodes if n.get("kind") not in AUTOMATIC_KINDS]


def file(account, judgment_id, *, reason, evidence="", escalate=False):
    soul = account.soul
    with transaction.atomic():
        if not Judgment.all_objects.filter(pk=judgment_id, soul_id=soul.pk).exists():
            raise AppealRefusedError("No such judgment.", "not_found", status=404)
        judgment = _lock_judgment(judgment_id)
        refusal = (escalation_refusal if escalate else appeal_refusal)(judgment, account)
        if refusal is not None:
            raise refusal
        round_ = JudgmentAppeal.all_objects.filter(judgment_id=judgment.pk, is_deleted=False).count() + 1
        try:
            with transaction.atomic():
                appeal = JudgmentAppeal.objects.create(
                    judgment=judgment, soul=soul, tenant_id=judgment.tenant_id, round=round_, reason=reason,
                    evidence=evidence, original_verdict=judgment.verdict,
                )
        except IntegrityError:
            # 并发的第二份(行锁之外的路径,例如 SQLite 没有行锁):部分唯一约束挡住。
            raise AppealRefusedError("An appeal on this judgment is already open.", "appeal_open") from None
        if escalate:
            _start_ladder(appeal, judgment, soul)
        _event(soul, "JUDGMENT_APPEAL_FILED", appeal, escalated=escalate,
               workflow_id=str(appeal.workflow_id) if appeal.workflow_id else None)
    return appeal


def _start_ladder(appeal, judgment, soul):
    """建本文明的 APPEAL 流程(与「发起流程」同一个门:节点、WORKFLOW_CREATED 事件、提交后通知)并挂到申诉上。"""
    from apps.workflow.models import ApprovalWorkflow, CaseType
    from apps.workflow.services import WorkflowService

    workflow = WorkflowService.start_workflow(
        soul, case_type=CaseType.APPEAL, tenant=judgment.tenant, is_appeal=True,
        notes=f"{judgment.case_number} 第 {appeal.round} 次申诉:{appeal.reason}",
    )
    original = ApprovalWorkflow.all_objects.filter(judgment_id=judgment.pk).values_list("pk", flat=True).first()
    if original is not None:
        ApprovalWorkflow.all_objects.filter(pk=workflow.pk).update(original_workflow_id=original)
    appeal.workflow = workflow
    appeal.status = AppealStatus.IN_REVIEW
    appeal.save(update_fields=["workflow", "status", "update_time", "update_user", "version"])


def _ladder_running(appeal):
    from apps.workflow.models import TERMINAL_WORKFLOW_STATUSES, ApprovalWorkflow

    if appeal.workflow_id is None:
        return None
    wf_status = ApprovalWorkflow.all_objects.filter(pk=appeal.workflow_id).values_list("status", flat=True).first()
    if wf_status in TERMINAL_WORKFLOW_STATUSES:
        return None
    return AppealRefusedError("This appeal is still in the appeal flow.", "ladder_running",
                              workflow=str(appeal.workflow_id))


#: 站梯一站的状态(`ladder`)。
LADDER_STATES = ("PASSED", "REJECTED", "CURRENT", "AHEAD", "AWAITING_FINAL")


def ladder(appeal):
    """站梯(Design 第五十五批):上诉那条流程的各站,按顺序;一次复核为 None。只读预取好的节点
    (`workflow__nodes`),不另查。不带审批人(同申诉不说复核人)。

    一站 = 一个人工节点;自动节点(通知、结束)不是一站,被跳过的(SKIPPED)也不算 —— 没有人审,也不会再审。
    状态:CURRENT 流程正停在这站 · PASSED 已过(通过,或超时转交越过)· REJECTED 驳回 · AHEAD 还没到。
    流程已结束时剩下的 AHEAD 就是「不再审」(驳回截断,或灵魂被吞噬时流程被结束),由客户端照 `workflow_status` 写。
    终审站:最后一个 FINAL 类型的站,没有就最后一站(与 `segments.mark_required` 同一条规则)。
    AWAITING_FINAL(Design 第五十五批补充 U-6 / E-3「站梯走完 · 待终审」):只给终审站 —— 前面各站都已 PASSED,
    且终审站是当前站,或流程已走完(COMPLETED)而申诉还没有结论(`on_ladder_finished` 让终审官员成为复核人,
    等他 `decide`)。"""
    from apps.workflow.models import (
        AUTOMATIC_KINDS,
        TERMINAL_WORKFLOW_STATUSES,
        ApprovalWorkflowStatus,
        NodeStatus,
        NodeType,
    )

    if appeal.workflow_id is None:
        return None
    workflow = appeal.workflow
    nodes = sorted((n for n in workflow.nodes.all()
                    if n.kind not in AUTOMATIC_KINDS and n.status != NodeStatus.SKIPPED),
                   key=lambda n: n.node_order)
    running = workflow.status not in TERMINAL_WORKFLOW_STATUSES
    # ponytail: the first PENDING node stands in for an unset pointer, like `_fallback_current`, minus its
    # segment-awaiting-pick check (appeal flows have no segments).
    current_pk = (workflow.current_node_id or next((n.pk for n in nodes if n.status == NodeStatus.PENDING), None)
                  if running else None)
    finals = [n for n in nodes if n.node_type == NodeType.FINAL]
    final_pk = (finals or nodes)[-1].pk if nodes else None
    stations, current = [], None
    for position, node in enumerate(nodes, start=1):
        if node.pk == current_pk:
            state, current = "CURRENT", position
        elif node.status == NodeStatus.REJECTED:
            state = "REJECTED"
        elif node.status in (NodeStatus.APPROVED, NodeStatus.ESCALATED, NodeStatus.TRAVERSED):
            state = "PASSED"
        else:
            state = "AHEAD"
        stations.append({"order": position, "node": node.pk, "name": node.node_name, "is_final": node.pk == final_pk,
                         "state": state, "note": (node.notes or None) if state in ("PASSED", "REJECTED") else None})
    awaiting = (appeal.status in OPEN_APPEAL_STATUSES
                and (running or workflow.status == ApprovalWorkflowStatus.COMPLETED))
    for station in stations:
        if (awaiting and station["is_final"] and station["state"] in ("CURRENT", "PASSED")
                and all(s["state"] == "PASSED" for s in stations[:station["order"] - 1])):
            station["state"], station["note"] = "AWAITING_FINAL", None
    return {"current": current, "total": len(stations), "stations": stations}


def on_ladder_finished(workflow, status, end_reason=""):
    """`ApprovalWorkflow._finish` 调,同一事务。驳回(或被撤掉)= 维持原判,直接结;走完 = 申诉成立,
    终审那位官员成为复核人,申诉留在 IN_REVIEW 等他照常 `decide`。"""
    from apps.workflow.models import ApprovalWorkflowStatus

    appeal = JudgmentAppeal.all_objects.select_for_update(of=("self",)).filter(
        workflow_id=workflow.pk, is_deleted=False, status__in=OPEN_APPEAL_STATUSES).first()
    if appeal is None:
        return
    from apps.workflow.models import AUTOMATIC_KINDS, NodeStatus

    last = workflow.nodes.filter(decided_at__isnull=False).order_by("-decided_at").first()
    if status == ApprovalWorkflowStatus.COMPLETED and not end_reason:
        # 走完:复核人是最后一位**批准**的人工站审批人(2026-10-29)。此前取「最后决定的人」,那可能是越级推进
        # 越过终审站的人(节点 ESCALATED),或空;而结果是原判官员时同样不能复核(`original_officers`)——
        # 这两种都置空,申诉留在待认领队列里由别人认领。
        final = (workflow.nodes.filter(status=NodeStatus.APPROVED).exclude(kind__in=AUTOMATIC_KINDS)
                 .order_by("-decided_at").first())
        reviewer = final.approver_id if final is not None else None
        if reviewer in original_officers(Judgment.all_objects.get(pk=appeal.judgment_id)):
            reviewer = None
        appeal.reviewer_id = reviewer
        appeal.claimed_at = timezone.now() if reviewer is not None else None
        appeal.save(update_fields=["reviewer", "claimed_at", "update_time", "update_user", "version"])
        return
    appeal.reviewer_id = last.approver_id if last is not None else None
    appeal.claimed_at = timezone.now()
    appeal.save(update_fields=["reviewer", "claimed_at", "update_time", "update_user", "version"])
    _settle(appeal.soul, appeal, AppealStatus.UPHELD, (last.notes if last is not None else "") or "")


def withdraw(account, appeal_id):
    with transaction.atomic():
        cycle = (JudgmentAppeal.all_objects.filter(pk=appeal_id, soul_id=account.soul_id, is_deleted=False)
                 .values_list("judgment__cycle", flat=True).first())
        if cycle is None:
            raise AppealRefusedError("No such appeal.", "not_found", status=404)
        # 前世的判决只读,它的申诉也不能撤(与 `appeal_refusal` 同一条;RBAC 严查 2026-10-29 L6)。
        if cycle != account.cycle:
            raise AppealRefusedError("A previous life's judgment is read only.", "past_life_read_only", status=403)
        appeal = _lock_appeal(appeal_id)
        if appeal.status not in OPEN_APPEAL_STATUSES:
            raise AppealRefusedError(f"This appeal is {appeal.status}.", "appeal_closed")
        if appeal.workflow_id is not None:
            raise AppealRefusedError("An appeal in the appeal flow cannot be withdrawn.", "ladder_running")
        appeal.status = AppealStatus.WITHDRAWN
        appeal.decided_at = timezone.now()
        appeal.save(update_fields=["status", "decided_at", "update_time", "update_user", "version"])
        _event(account.soul, "JUDGMENT_APPEAL_WITHDRAWN", appeal)
    return appeal


# ── 官员 ────────────────────────────────────────────────────────────────


def claim(appeal_id, user):
    """认领复核。原判官员 → 403 `original_judge`;别人已认领 → 409 `already_claimed`;重复认领自己的 → 不写。"""
    with transaction.atomic():
        appeal = _lock_appeal(appeal_id)
        if appeal.status not in OPEN_APPEAL_STATUSES:
            raise AppealRefusedError(f"This appeal is {appeal.status}.", "appeal_closed")
        if (running := _ladder_running(appeal)) is not None:
            raise running
        if user.pk in original_officers(Judgment.all_objects.get(pk=appeal.judgment_id)):
            raise AppealRefusedError("The officer who decided the judgment cannot review its appeal.",
                                     "original_judge", status=403)
        if appeal.reviewer_id == user.pk:
            return appeal
        if appeal.reviewer_id is not None:
            raise AppealRefusedError("Another officer is reviewing this appeal.", "already_claimed",
                                     reviewer=appeal.reviewer_id)
        appeal.reviewer = user
        appeal.claimed_at = timezone.now()
        appeal.status = AppealStatus.IN_REVIEW
        appeal.save(update_fields=["reviewer", "claimed_at", "status", "update_time", "update_user", "version"])
    return appeal


def decide(appeal_id, user, *, outcome, note, verdict=None, keep_foreign_stops=None):
    """维持或改判。只有认领了它的复核人能决定(403 `not_reviewer`)。

    锁序:灵魂 → 申诉 → 计划 → 节点 → 处置 → 审判。改判的事务里:审判换成新裁决、计划改按新裁决、
    已执行的每一站一笔补偿、推进计划、事件 —— 任何一步拒绝,整笔回滚。"""
    from apps.sentence_plan.services import _lock_soul

    if outcome not in (AppealStatus.UPHELD, AppealStatus.AMENDED):
        raise AppealRefusedError("outcome is UPHELD or AMENDED.", "invalid_outcome", status=400)
    with transaction.atomic():
        row = JudgmentAppeal.all_objects.filter(pk=appeal_id, is_deleted=False).first()
        if row is None:
            raise AppealRefusedError("No such appeal.", "not_found", status=404)
        soul = _lock_soul(row.soul)
        appeal = _lock_appeal(appeal_id)
        if appeal.status not in OPEN_APPEAL_STATUSES:
            raise AppealRefusedError(f"This appeal is {appeal.status}.", "appeal_closed")
        if (running := _ladder_running(appeal)) is not None:
            raise running
        if appeal.reviewer_id != user.pk:
            raise AppealRefusedError("Only the officer reviewing this appeal can decide it; claim it first.",
                                     "not_reviewer", status=403, reviewer=appeal.reviewer_id)
        _settle(soul, appeal, outcome, note, verdict, keep_foreign_stops)
    return appeal


def _settle(soul, appeal, outcome, note, verdict=None, keep_foreign_stops=None):
    """结论落库:`decide` 与流程驳回(`on_ladder_finished`)共用。调用方已在事务里、已锁申诉。"""
    from apps.sentence_plan import requests as plan_requests
    from apps.sentence_plan.services import SentencePlanService

    compensations = []
    if outcome == AppealStatus.AMENDED:
        judgment = Judgment.all_objects.get(pk=appeal.judgment_id)
        if not verdict:
            raise AppealRefusedError("An amended verdict is required.", "verdict_required", status=400)
        if verdict == judgment.verdict:
            raise AppealRefusedError("The new verdict is the one already given; uphold instead.",
                                     "verdict_unchanged", status=400)
        try:
            executed = plan_requests.amend_for_appeal(soul, judgment, verdict, keep_foreign=keep_foreign_stops)
        except plan_requests.PlanChangeRefusedError as exc:
            raise AppealRefusedError(str(exc), exc.code, status=exc.status, **exc.extra) from None
        judgment = _lock_judgment(appeal.judgment_id)
        judgment.verdict = verdict
        judgment.save(update_fields=["verdict", "update_time", "update_user", "version"])
        compensations = _compensate(soul, judgment, appeal, executed)
        appeal.new_verdict = verdict
        SentencePlanService.advance(soul)
    appeal.status = outcome
    appeal.decision_note = note
    appeal.decided_at = timezone.now()
    appeal.save(update_fields=["status", "new_verdict", "decision_note", "decided_at",
                               "update_time", "update_user", "version"])
    _event(soul, "JUDGMENT_APPEAL_DECIDED", appeal, new_verdict=appeal.new_verdict,
           compensation_record_ids=[str(r.pk) for r in compensations])


#: 已执行刑期折补偿:每多少年折 1 点功德,按处置所在的文明(2026-10-24 用户决定按文明分别折算)。
#: 刑期的量级差得多:地府、炼狱以十年、百年计,希腊厄尔神话是千年一轮,埃及的处置多不记年数。
#: 取值是起点，不是考据结论;改这张表即可。永久刑期一律记上限 100(SoulRecord.weight 是 1–100)。
YEARS_PER_COMPENSATION_POINT = {"CHINESE": 10, "EUROPEAN": 10, "GREEK": 100, "EGYPTIAN": 1}


def compensation_weight(disposition):
    if disposition.is_eternal:
        return 100
    civ = disposition.tenant.known_civilization if disposition.tenant_id else None
    per_point = YEARS_PER_COMPENSATION_POINT.get(getattr(civ, "value", civ), 1)
    return min(100, max(1, round((disposition.sentence_years or 0) / per_point)))


def _compensate(soul, judgment, appeal, executed):
    """已执行的每一站一笔 MERIT / COMPENSATION,记在灵魂当前这一世(计入当前账本余额)。"""
    from apps.souls.record_models import EvidenceSource, RecordCategory, RecordType, SoulRecord

    rows = []
    for node, disposition in executed:
        where = f"第 {node.order} 站({node.tenant_code})" if node is not None else "原处置"
        rows.append(SoulRecord.objects.create(
            soul=soul, record_type=RecordType.MERIT, category=RecordCategory.COMPENSATION,
            description=f"申诉改判补偿:{judgment.case_number} {where},原判 {appeal.original_verdict} → "
                        f"{judgment.verdict}",
            weight=compensation_weight(disposition), evidence_source=EvidenceSource.REGISTRY,
            evidence_json={"appeal_id": str(appeal.pk), "judgment_id": str(judgment.pk),
                           "disposition_id": str(disposition.pk), "node_id": str(node.pk) if node else None,
                           "station_order": node.order if node else None},
        ))
    return rows


def compensation_records(appeal):
    from apps.souls.record_models import RecordCategory, SoulRecord

    return SoulRecord.objects.filter(soul_id=appeal.soul_id, category=RecordCategory.COMPENSATION,
                                     evidence_json__appeal_id=str(appeal.pk)).order_by("recorded_at")
