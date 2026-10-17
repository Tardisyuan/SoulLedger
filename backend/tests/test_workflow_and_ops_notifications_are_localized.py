"""审批流(待处理 / 知会 / 超时)、跨域审判结案、定时任务告警三类站内通知按请求语言渲染。

此前这几处把标题 / 正文写成英文或中文字面量,读的时候原样返回 —— 三种语言的官员都会看到另一种语言。
现在存 zh-Hans 渲染加 `params`,读时按 `Accept-Language` 重渲染(`apps/notifications/messages.py`)。
旧行(没有 params,或只有 `category`)照存下来的原文返回,不露出占位符。
"""
import pytest
from rest_framework.test import APIRequestFactory

from apps.notifications import messages
from apps.notifications.models import UserNotification
from apps.notifications.serializers import UserNotificationListSerializer

pytestmark = pytest.mark.django_db


def _read(row, lang):
    request = APIRequestFactory().get("/", HTTP_ACCEPT_LANGUAGE=lang)
    data = UserNotificationListSerializer(row, context={"request": request}).data
    return data["title"], data["message"]


def _row(user, notification_type, params, title="原标题", message="原正文"):
    return UserNotification.objects.create(
        user=user, title=title, message=message, notification_type=notification_type, params=params,
    )


def test_workflow_assigned_and_its_variants_render_in_the_request_language(judge_user):
    base = {"soul": "孟婆之魂", "workflow": "十殿审批", "node": "初审", "hours": 24}
    assigned = _row(judge_user, "WORKFLOW_ASSIGNED", base)
    escalated = _row(judge_user, "WORKFLOW_ASSIGNED",
                     {**base, "kind": "workflow_timeout_escalated", "category": "approval_timeout"})
    assert _read(assigned, "en") == (
        "Approval waiting on you", "The approval flow 十殿审批 of soul 孟婆之魂 is waiting on you.")
    title, body = _read(escalated, "en")
    assert title == "Approval overdue" and "24 hours" in body and "passed to you" in body
    title, body = _read(escalated, "zh-Hans")
    assert title == "审批超时" and "已转交给你" in body and "请尽快处理" not in body


def test_an_old_row_with_only_a_category_keeps_its_stored_text(judge_user):
    old = _row(judge_user, "WORKFLOW_ASSIGNED", {"category": "approval_timeout"},
               title="审批超时: 十殿审批", message="节点「初审」已超过 24 小时未处理，请尽快处理。")
    assert _read(old, "en") == ("审批超时: 十殿审批", "节点「初审」已超过 24 小时未处理，请尽快处理。")
    legacy = _row(judge_user, "WORKFLOW_ASSIGNED", {}, title="Workflow Assigned: x", message="m")
    assert _read(legacy, "zh-Hans") == ("Workflow Assigned: x", "m")


def test_cross_judgment_conclusion_names_its_result(judge_user):
    passed = _row(judge_user, "JUDGMENT_CONCLUDED", {"title": "冥河之案"})
    failed = _row(judge_user, "JUDGMENT_CONCLUDED", {"title": "冥河之案", "kind": "cross_judgment_concluded_fail"})
    assert _read(passed, "zh-Hans")[1] == "跨域审判「冥河之案」已结案，结论：通过。"
    assert _read(failed, "en")[1] == "The cross-realm judgment 冥河之案 has concluded: rejected."


def test_system_rows_render_only_the_kinds_listed_for_system(judge_user):
    failed = _row(judge_user, "SYSTEM", {"kind": "scheduled_task_failed", "task": "nightly", "error": "boom"})
    assert _read(failed, "en") == ("Scheduled task failed", "Scheduled task nightly failed: boom")
    # 别的类型的文案键不能借 SYSTEM 行冒用;没写 kind 的 SYSTEM 行照原文。
    borrowed = _row(judge_user, "SYSTEM", {"kind": "dispatch_proposed", "soul": "s", "source": "x"})
    assert _read(borrowed, "en") == ("原标题", "原正文")
    assert messages.kind_for("SYSTEM", {}) is None


# ── 实时提示框 + 转生 / 冷却 / 开号失败 / 助手提醒 ────────────────────────────────────────────

def test_the_websocket_push_carries_every_locale_for_a_localized_row(judge_user):
    params = {"kind": "scheduled_task_failed", "task": "nightly", "error": "boom"}
    all_locales = messages.render_all("SYSTEM", params)
    assert set(all_locales) == set(messages.MESSAGES)
    assert all_locales["en"] == {"title": "Scheduled task failed", "message": "Scheduled task nightly failed: boom"}
    # 旧行(没有 params / 缺参数 / 不分语言的类型)不带 i18n,前端用存下来的原文。
    assert messages.render_all("SYSTEM", {}) is None
    assert messages.render_all("WORKFLOW_ASSIGNED", {"category": "approval_timeout"}) is None
    assert messages.render_all("SYSTEM", {"kind": "dispatch_proposed", "soul": "s"}) is None


def test_the_notification_handler_puts_i18n_into_the_pushed_payload(judge_user):
    from apps.events.event_bus import EventEnvelope
    from apps.events.handlers.notification_handler import NotificationHandler

    params = {"kind": "assistant_reopened"}
    title, body = messages.render(messages.DEFAULT_LOCALE, "assistant_reopened", params)
    nested = {"notification": {"user_id": judge_user.id, "title": title, "message": body,
                               "notification_type": "SYSTEM", "params": params}}
    envelope = EventEnvelope(event_type="NOTIFICATION_CREATED", domain="notification", payload=nested)
    NotificationHandler().handle(envelope)
    pushed = nested["notification"]
    assert pushed["id"] and pushed["i18n"]["en"]["title"] == "Assistant switched back on: new month"
    assert pushed["i18n"]["zh-Hans"]["message"] == body


def test_rebirth_cooldown_provisioning_and_assistant_notices_are_localized(judge_user):
    cases = [
        ("rebirth_status_approved", {}, "转生申请状态更新", "您的转生申请状态:已批准。", "Your rebirth application was approved."),
        ("rebirth_status_appeal_rejected", {}, "转生申请状态更新", "您的转生申请状态:申诉被驳回。",
         "The appeal on your rebirth application was rejected."),
        ("cooldown_decided_rejected", {}, "缩短冷却申请有了结果", "您的缩短冷却申请:已驳回。",
         "Your request to shorten the cooldown was rejected."),
        ("soul_account_provisioning_failed", {"soul": "孟婆之魂", "command": "backfill_soul_accounts"}, "灵魂账号开通失败",
         "灵魂「孟婆之魂」已登记死亡,但灵魂账号没有开成。请运行 backfill_soul_accounts 补开。",
         "Soul 孟婆之魂 is registered as dead, but its soul account was not opened. Run backfill_soul_accounts to open it."),
        ("assistant_cap_closed", {"spent": "10.00", "cap": "10.00"}, "助手已自动关闭:本月花费到达上限",
         "本月估算花费 10.00 已到上限 10.00,助手总开关已自动关闭。次月 1 日早上 8 点(北京时间)会自动重开;也可以到「助手管理」页调高上限后手动打开。",
         "Estimated spend this month, 10.00, has reached the cap of 10.00, and the assistant master switch is off. "
         "It switches back on by itself on the 1st at 8:00 Beijing time, or raise the cap on the Assistant admin page "
         "and switch it on by hand."),
    ]
    for kind, extra, zh_title, zh_body, en_body in cases:
        row = _row(judge_user, "SYSTEM", {"kind": kind, **extra})
        assert _read(row, "zh-Hans") == (zh_title, zh_body), kind
        assert _read(row, "en")[1] == en_body, kind


def test_old_rows_of_these_notices_keep_their_stored_text(judge_user):
    old = _row(judge_user, "SYSTEM", {}, title="转生申请状态更新", message="您的转生申请状态:审批中。")
    assert _read(old, "en") == ("转生申请状态更新", "您的转生申请状态:审批中。")
    # 缺占位符参数的行(只有 kind)也照原文,不露出 `{{soul}}`。
    bare = _row(judge_user, "SYSTEM", {"kind": "soul_account_provisioning_failed"}, title="灵魂账号开通失败", message="旧文")
    assert _read(bare, "en") == ("灵魂账号开通失败", "旧文")
