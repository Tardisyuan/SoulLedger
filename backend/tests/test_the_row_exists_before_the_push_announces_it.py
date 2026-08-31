"""通知行必须先写进去,WS 推送才能发出去。

`event_bus.py::configure_default_handlers` 的 dispatch 顺序**就是注册顺序**。
notification domain 曾经是 Audit → **WebSocket** → **Notification** → Webhook,
于是 `rt_user_{id}` 在 `UserNotification.objects.create()` 跑之前就收到了
NOTIFICATION_CREATED。

**一个收到推送就去重取 `/notifications/` 的客户端,会拿不到刚被告知的那一行。**
这个竞态不报错,唯一的症状是通知晚一次刷新才出现 —— 也就是最容易被记成
「偶发」的那种。

这里不断言「注册列表长这样」(那是把实现抄一遍),而是断言**顺序关系**:
在 notification 这一域上,NotificationHandler 排在 WebSocketHandler 前面。
"""
import pytest

from apps.events.handlers.notification_handler import NotificationHandler
from apps.events.handlers.registry import handler_registry
from apps.events.handlers.websocket_handler import WebSocketHandler


@pytest.fixture
def notification_handlers():
    from apps.events.event_bus import configure_default_handlers

    configure_default_handlers()
    return handler_registry.get_domain_handlers("notification")


def _index_of(handlers, cls):
    for i, handler in enumerate(handlers):
        if isinstance(handler, cls):
            return i
    return None


def test_both_handlers_are_actually_registered(notification_handlers):
    """守卫的守卫:少了任何一个,下面那条比较就没有意义。"""
    assert _index_of(notification_handlers, NotificationHandler) is not None
    assert _index_of(notification_handlers, WebSocketHandler) is not None


def test_the_notification_row_is_written_before_the_socket_is_told(
    notification_handlers,
):
    row = _index_of(notification_handlers, NotificationHandler)
    push = _index_of(notification_handlers, WebSocketHandler)
    assert row < push, (
        f"WebSocketHandler 排在第 {push} 位,NotificationHandler 在第 {row} 位 —— "
        f"推送会早于它宣布的那一行。handlers:"
        f"{[type(h).__name__ for h in notification_handlers]}"
    )
