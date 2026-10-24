"""官员交接(2026-10-25 用户决定):殿管理员把一位官员手上的东西一次交给本殿另一位官员。

四类,各自复用原有的写入规则:
* 认领中的审判 —— `claims._apply_reassign`(与改派同一个函数);接手人要能办案(`claims.is_assignable`)。
* 复核中的申诉 —— 换复核人。接手人是那件审判的原判官员(`appeals.original_officers`)时不能接,
  那一件**退回待复核**(复核人清空,任何能复核的人都可以认领),在预览里单独计数。
* 城隍名下的官员 —— 交出人从每位城隍的 `officers` 里移走,接手人加进去。
* 经办的书信 —— 未关闭、经办人是交出人的会话改标给接手人;接手人要能回信(`soul_inbox.reply`,与「标给同僚」同一条规则)。

预览(`preview`)只数,不写;提交(`commit`)在一个事务里重新按行锁读一遍再写 —— 预览之后已结案、已被别人改派的不再动。
接手人不能办案而手上有审判 / 申诉,或不能回信而手上有书信,预览带 `problems`,提交 409 `handover_blocked`。
审计一行(谁交给谁、每类的 id);提交后给接手人一条站内通知(`JUDGMENT_CLAIM_CHANGED` 的 `officer_handover_received` 句)。
单件改派那样给交出人发的逐件通知不发:交接是管理员替他做的整体动作。
"""
from django.db import transaction
from django.utils import timezone

from apps.judgment import claims
from apps.judgment.appeals import original_officers
from apps.judgment.claims import ClaimRefusedError
from apps.judgment.models import OPEN_APPEAL_STATUSES, AppealStatus, CityGod, Judgment, JudgmentAppeal

LETTER_PERMISSION = "soul_inbox.reply"


class HandoverRefusedError(ClaimRefusedError):
    """交接此刻做不了。与认领同一形状。"""


def _assert_people(source, target, tenant_id):
    if target is None or source is None:
        raise HandoverRefusedError("No such officer in this hall.", "invalid_target", status=400)
    if source.pk == target.pk:
        raise HandoverRefusedError("Hand over to someone else.", "same_officer", status=400)
    if (target.tenant_id != tenant_id or not target.is_active or target.role == "SOUL"
            or getattr(target, "is_deleted", False)):
        raise HandoverRefusedError("No such officer in this hall.", "invalid_target", status=400)


def _open_judgments(source, tenant_id):
    return Judgment.objects.filter(tenant_id=tenant_id, claimed_by=source, verdict__isnull=True, is_final=False,
                                   is_archived=False)


def _open_appeals(source, tenant_id):
    return JudgmentAppeal.objects.filter(tenant_id=tenant_id, reviewer=source, status__in=OPEN_APPEAL_STATUSES)


def _city_gods(source, tenant_id):
    return CityGod.objects.filter(tenant_id=tenant_id, officers=source)


def _letters(source, tenant_id):
    from apps.chat.models import Conversation, ConversationKind

    return Conversation.objects.filter(tenant_id=tenant_id, kind=ConversationKind.OFFICER_INBOX, assignee=source,
                                       closed_at__isnull=True)


def _target_takes_appeal(appeal, target, can_judge) -> bool:
    return can_judge and target.pk not in original_officers(Judgment.all_objects.get(pk=appeal.judgment_id))


def preview(source, target, tenant_id) -> dict:
    _assert_people(source, target, tenant_id)
    can_judge = claims.is_assignable(target, tenant_id)
    can_reply = claims.is_assignable(target, tenant_id, LETTER_PERMISSION)
    judgments = _open_judgments(source, tenant_id).count()
    appeals = list(_open_appeals(source, tenant_id))
    returned = sum(1 for a in appeals if not _target_takes_appeal(a, target, can_judge))
    letters = _letters(source, tenant_id).count()
    problems = []
    if judgments and not can_judge:
        problems.append("target_cannot_judge")
    if letters and not can_reply:
        problems.append("target_cannot_reply")
    return {
        "judgments": judgments,
        "appeals": len(appeals) - returned,
        "appeals_returned_to_pool": returned,
        "city_gods": sorted(_city_gods(source, tenant_id).values_list("name", flat=True)),
        "letters": letters,
        "problems": problems,
    }


def commit(source, target, tenant_id, *, actor, request=None) -> dict:
    from apps.audit.models import AuditAction, AuditLog
    from apps.core.client_ip import get_client_ip

    summary = preview(source, target, tenant_id)
    if summary["problems"]:
        raise HandoverRefusedError("The receiving officer cannot take everything.", "handover_blocked",
                                   problems=summary["problems"])
    can_judge = claims.is_assignable(target, tenant_id)
    moved = {"judgments": [], "appeals": [], "appeals_returned_to_pool": [], "city_gods": [], "letters": []}
    with transaction.atomic():
        pks = list(_open_judgments(source, tenant_id).values_list("pk", flat=True))
        for judgment in claims._lock_many(pks):
            if judgment.claimed_by_id != source.pk:
                continue  # 预览之后被别人改派 / 放回了
            try:
                claims._apply_reassign(judgment, target)
            except ClaimRefusedError:
                continue  # 预览之后结案、撤案了
            moved["judgments"].append(str(judgment.pk))

        now = timezone.now()
        for appeal in (JudgmentAppeal.all_objects.select_for_update(of=("self",))
                       .filter(pk__in=_open_appeals(source, tenant_id).values("pk")).order_by("pk")):
            if _target_takes_appeal(appeal, target, can_judge):
                appeal.reviewer, appeal.claimed_at = target, now
                moved["appeals"].append(str(appeal.pk))
            else:
                appeal.reviewer, appeal.claimed_at, appeal.status = None, None, AppealStatus.PENDING
                moved["appeals_returned_to_pool"].append(str(appeal.pk))
            appeal.save(update_fields=["reviewer", "claimed_at", "status", "update_time", "update_user", "version"])

        for god in _city_gods(source, tenant_id):
            god.officers.remove(source)
            god.officers.add(target)
            moved["city_gods"].append(str(god.pk))

        letters = list(_letters(source, tenant_id).select_for_update(of=("self",)))
        for conversation in letters:
            conversation.assignee, conversation.assigned_at = target, now
            conversation.save(update_fields=["assignee", "assigned_at"])
            moved["letters"].append(str(conversation.pk))

        AuditLog.objects.create(
            tenant_id=tenant_id, user=actor, action=AuditAction.EXECUTE, resource="officer_handover",
            resource_id=str(source.pk), description=f"officer handover {source.username} -> {target.username}",
            changes={"from": source.pk, "to": target.pk, **moved},
            ip_address=get_client_ip(request) if request is not None else None,
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else "",
        )
        _notify_after_commit(target, actor, source, moved)
    counts = {k: len(v) for k, v in moved.items()}
    return counts


def _notify_after_commit(target, actor, source, moved):
    total = sum(len(v) for k, v in moved.items() if k != "appeals_returned_to_pool")
    if not total or target.pk == actor.pk:
        return
    params = {"kind": "officer_handover_received", "by": actor.display_name or actor.username,
              "from": source.display_name or source.username, "judgments": len(moved["judgments"]),
              "appeals": len(moved["appeals"]), "city_gods": len(moved["city_gods"]),
              "letters": len(moved["letters"])}

    def send():
        from apps.events.services import EventService
        from apps.notifications import messages

        title, body = messages.render(messages.DEFAULT_LOCALE, "officer_handover_received", params)
        EventService.notify_user(target, title=title, message=body, notification_type="JUDGMENT_CLAIM_CHANGED",
                                 related_resource="", related_id="", params=params)

    transaction.on_commit(send)
