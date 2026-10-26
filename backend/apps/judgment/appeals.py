"""申诉:灵魂对已结案审判的异议,另一位官员复核(用户 2026-10-24 决定)。`JudgmentAppeal` 只在这里写。

规则
* 希腊不能申诉:米诺斯之上无可上诉(docs/02_希腊冥府审判与人物详解.md §5.2,用户 2026-10-27),拒绝码
  `no_appeal_above_minos`。
* 灵魂只能对**自己本世**、**已结案**的**原审判**(ORIGINAL)申诉;结案后 30 天内;每件审判至多 2 次
  (撤回的也算一次);同一时刻至多一份没有结论的。
* 复核人不能是作出原判的官员:结案人(`Judgment.concluded_by`)或认领人(`claimed_by`)。
* 结论:维持(UPHELD)或改判(AMENDED)。改判时受刑计划未执行的部分改按新裁决
  (`apps/sentence_plan/requests.amend_for_appeal`),已执行的每一站记一笔补偿功德(`COMPENSATION`)。

事件写在同一事务里(CLAUDE.md 事件日志一节);推送由事件经 `apps/soul_push` 在提交后发出。
拒绝一律 `AppealRefusedError`(稳定的 `code`),在任何写入之前抛出。
"""
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.judgment.claims import ClaimRefusedError
from apps.souls.models import Civilization
from apps.judgment.models import (
    APPEAL_MAX_ROUNDS,
    APPEAL_WINDOW_DAYS,
    OPEN_APPEAL_STATUSES,
    AppealStatus,
    Judgment,
    JudgmentAppeal,
    JudgmentKind,
)


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


# ── 灵魂 ────────────────────────────────────────────────────────────────


def appeal_refusal(judgment, account):
    """这个灵魂此刻能否对这件审判提出申诉:None,或拒绝它的 `AppealRefusedError`(不写任何东西)。
    灵魂端列表用它算 `can_appeal`,`file` 在锁下再问一遍。"""
    if judgment.cycle != account.cycle:
        return AppealRefusedError("A previous life's judgment is read only.", "past_life_read_only", status=403)
    if judgment.civilization == Civilization.GREEK:
        # Minos's judgment is the last word: nothing above it to appeal to (docs/02 希腊 §5.2; user 2026-10-27).
        return AppealRefusedError("Minos's judgment cannot be appealed.", "no_appeal_above_minos")
    if judgment.verdict is None or not judgment.is_final or judgment.is_deleted:
        return AppealRefusedError("This judgment has not been concluded.", "not_concluded")
    if judgment.kind != JudgmentKind.ORIGINAL:
        return AppealRefusedError("Only an original judgment can be appealed.", "not_appealable")
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


def file(account, judgment_id, *, reason, evidence=""):
    soul = account.soul
    with transaction.atomic():
        if not Judgment.all_objects.filter(pk=judgment_id, soul_id=soul.pk).exists():
            raise AppealRefusedError("No such judgment.", "not_found", status=404)
        judgment = _lock_judgment(judgment_id)
        refusal = appeal_refusal(judgment, account)
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
        _event(soul, "JUDGMENT_APPEAL_FILED", appeal)
    return appeal


def withdraw(account, appeal_id):
    with transaction.atomic():
        if not JudgmentAppeal.all_objects.filter(pk=appeal_id, soul_id=account.soul_id, is_deleted=False).exists():
            raise AppealRefusedError("No such appeal.", "not_found", status=404)
        appeal = _lock_appeal(appeal_id)
        if appeal.status not in OPEN_APPEAL_STATUSES:
            raise AppealRefusedError(f"This appeal is {appeal.status}.", "appeal_closed")
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
    from apps.sentence_plan import requests as plan_requests
    from apps.sentence_plan.services import SentencePlanService, _lock_soul

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
        if appeal.reviewer_id != user.pk:
            raise AppealRefusedError("Only the officer reviewing this appeal can decide it; claim it first.",
                                     "not_reviewer", status=403, reviewer=appeal.reviewer_id)
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
    return appeal


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
