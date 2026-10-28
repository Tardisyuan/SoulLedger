"""跨殿总览(2026-10-25 用户决定):全局管理员一眼看每个殿积压了什么。`GET /tenants/overview/`(ADMIN)。

每个殿一行,只有数,没有灵魂名:
* `todo` —— 殿里等人处理的事:审批中的流程、调到本殿等批的提案、待决的缩短冷却申请、灵魂最后一封还没回的书信。
  是**殿级**的数,不是某位官员的「待我处理」(那个在 `apps/officer_app/todo.py`,按人、按权限)。
* `judgments` —— 未结案审判按此刻在哪儿分四格,互不相交:在城隍处 → 候着(`held_until` 未到,或埃及案到不了殿)→ 有人认领 → 无人认领。
* `rebirth_quota` —— 本月转世配额用量,与 `GET /reincarnation/quota/` 同一个函数。
* `open_appeals` —— 待复核与复核中的申诉。

停用的殿也列(数据都还在),带 `is_active`。
"""
from django.db.models import Count, Q
from django.utils import timezone


def hall_row(tenant) -> dict:
    from apps.chat.models import Conversation, ConversationKind
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.judgment.models import (
        AT_CITY_GOD,
        DUAT_BARRED,
        OPEN_APPEAL_STATUSES,
        Judgment,
        JudgmentAppeal,
        JudgmentKind,
    )
    from apps.reincarnation.services import quota_usage
    from apps.soul_accounts.models import CooldownShorteningRequest, CooldownShorteningStatus
    from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus

    todo = {
        "approvals": ApprovalWorkflow.objects.filter(
            tenant=tenant, status__in=(ApprovalWorkflowStatus.PENDING, ApprovalWorkflowStatus.IN_PROGRESS)).count(),
        "dispatch_proposals": DispatchRecord.objects.filter(
            target_tenant=tenant, status=DispatchStatus.PROPOSED).count(),
        "cooldowns": CooldownShorteningRequest.objects.filter(
            soul__home_tenant=tenant, status=CooldownShorteningStatus.PENDING).count(),
        "letters_awaiting": Conversation.objects.filter(
            tenant=tenant, kind=ConversationKind.OFFICER_INBOX, closed_at__isnull=True, last_from="soul").count(),
    }
    todo["total"] = sum(todo.values())

    today = timezone.localdate()
    at_god = Q(city_god_status__in=AT_CITY_GOD)
    # 候着的:枉死城、埃及木乃伊 70 天(都看 `held_until`),以及到不了殿的埃及案(无名、葬仪不当,永远候着),
    # 以及滞留阿刻戎岸边的希腊原审(未葬 / 无渡资,`claims._assert_not_held`)—— 未葬满百年的已得渡,不算。
    from apps.souls import acheron

    is_held = (Q(held_until__gt=today) | Q(duat_stage__in=DUAT_BARRED)
               | (Q(civilization="GREEK", kind=JudgmentKind.ORIGINAL) & ~Q(soul__ferry_passage="")
                  & ~acheron.crossed_q(today, prefix="soul__")))
    held = ~at_god & is_held
    claimed = ~at_god & ~is_held & Q(claimed_by__isnull=False)
    unclaimed = ~at_god & ~is_held & Q(claimed_by__isnull=True)
    judgments = Judgment.objects.filter(tenant=tenant, verdict__isnull=True, is_final=False, is_archived=False).aggregate(
        at_city_god=Count("pk", filter=at_god), held=Count("pk", filter=held),
        claimed=Count("pk", filter=claimed), unclaimed=Count("pk", filter=unclaimed),
    )

    return {
        "code": tenant.code,
        "hall_names": tenant.hall_names,
        "civilization": tenant.civilization,
        "is_active": tenant.is_active,
        "todo": todo,
        "judgments": judgments,
        "rebirth_quota": [{"rebirth_form": form, **row} for form, row in quota_usage(tenant).items()],
        "open_appeals": JudgmentAppeal.objects.filter(tenant=tenant, status__in=OPEN_APPEAL_STATUSES).count(),
    }


def overview(tenants) -> list[dict]:
    return [hall_row(t) for t in tenants]
