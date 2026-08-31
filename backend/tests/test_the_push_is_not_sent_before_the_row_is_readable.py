"""通知推送必须带 id,并且必须等事务提交后才发。

M27 修了顺序(NotificationHandler 先注册),但顺序只是三重原因中的一重。
2026-08-29 在 handler 里就地计数实测:

    rows before=0   at_WS_push=0   after=1
    push_payload_has_id=False      row_id=1
    WS 推送发生在一个尚未提交的事务内?  True

① 推送里没有 `id`,客户端无法按 id 去重、只能重拉列表;
② 推送发出时行还没写(顺序);
③ **推送在请求的 `atomic()` 内发出,此时那一行对任何其它数据库连接都不可见**,
   而处理客户端后续 `GET /notifications/` 的是另一条连接。

第 ③ 条是三条里最难看见的:即使顺序对了,只要还在事务里,收到推送的客户端去查
仍然可能查不到。`transaction.on_commit` 把推送挪到提交之后;不在事务里时
`on_commit` 立即执行,所以对不开事务的调用方没有行为变化。
"""
import pytest
from django.db import transaction

from apps.events.event_bus import EventEnvelope
from apps.events.handlers.notification_handler import NotificationHandler
from apps.events.handlers.websocket_handler import WebSocketHandler
from apps.notifications.models import UserNotification


@pytest.fixture
def user(db):
    from apps.authentication.models import User, UserRole
    from apps.tenants.models import Tenant

    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )
    return User.objects.create_user(
        username="notified", password="x", role=UserRole.VIEWER, tenant=tenant
    )


def _envelope(user):
    return EventEnvelope(
        domain="notification",
        event_type="NOTIFICATION_CREATED",
        payload={"user_id": user.id, "title": "t", "message": "m"},
        user_ids=[user.id],
        tenant_code="CN_DIYU",
    )


@pytest.mark.django_db
def test_the_payload_carries_the_row_id(user):
    envelope = _envelope(user)
    NotificationHandler().handle(envelope)
    row = UserNotification.objects.get(user=user)
    assert envelope.payload.get("id") == row.id, (
        f"推送 payload 里没有 id(有的是 {sorted(envelope.payload)});"
        f"客户端只能重拉列表去猜哪条是新的"
    )


@pytest.mark.django_db(transaction=True)
def test_the_push_waits_for_the_commit(user):
    """在一个显式事务里发布,推送必须落在提交之后。"""
    sent = []

    class _Layer:
        async def group_send(self, group, message):
            sent.append((group, message))

    envelope = _envelope(user)

    import channels.layers

    real = channels.layers.get_channel_layer
    channels.layers.get_channel_layer = lambda *a, **k: _Layer()
    try:
        with transaction.atomic():
            WebSocketHandler().handle(envelope)
            assert sent == [], (
                "推送在事务提交前就发出去了 —— 那一行此刻对其它连接不可见"
            )
        assert sent, "提交之后推送没有发出"
    finally:
        channels.layers.get_channel_layer = real


@pytest.mark.django_db(transaction=True)
def test_a_rolled_back_transaction_announces_nothing(user):
    """**断缺失也断存在。** 回滚掉的事务里没有可宣布的东西。"""
    sent = []

    class _Layer:
        async def group_send(self, group, message):
            sent.append((group, message))

    import channels.layers

    real = channels.layers.get_channel_layer
    channels.layers.get_channel_layer = lambda *a, **k: _Layer()
    try:
        class _RollbackError(Exception):
            pass

        with pytest.raises(_RollbackError), transaction.atomic():
            WebSocketHandler().handle(_envelope(user))
            raise _RollbackError
        assert sent == [], "事务回滚了,推送还是发了出去"
    finally:
        channels.layers.get_channel_layer = real
