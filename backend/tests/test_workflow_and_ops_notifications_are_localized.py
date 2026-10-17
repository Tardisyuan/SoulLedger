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
