"""聊天四条规则的服务端执行(2026-09-17 用户决定)。**全部经真实 URL,不直接调服务函数。**

1. 互关 → 自由私聊                          test_mutual_follows_get_a_free_room
2. 同文明非互关 → 请求,24 小时一条;          test_a_stranger_gets_one_request_per_24_hours
   对方回复 / 互关后解除                       test_a_reply_lifts_the_limit / test_following_back_lifts_the_limit
3. 殿司收件箱                                 tests/test_chat_officer_inbox.py
4. 跨文明拒绝                                 test_cross_civilization_is_refused

每条的变异证明写在测试的 docstring 里(改哪一行、哪条会红)。
"""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.chat.models import ChatIdentity, Conversation
from tests.chat_support import follow, matrix, mutual, room_of  # noqa: F401
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"


def _open(client, target):
    return client.post(CONVERSATIONS, {"target_soul": str(target.soul_id)}, format="json")


def _send(client, conversation_id, body="你好"):
    return client.post(f"{CONVERSATIONS}{conversation_id}/messages/", {"body": body}, format="json")


# ── 分界:只有灵魂令牌 ─────────────────────────────────────────────────────


def test_only_a_current_soul_token_opens_a_chat_session(cn_tenant, matrix):  # noqa: F811
    """变异:把 `ChatView` 的基类从 `SoulAPIView` 换成裸 `APIView`(带 AllowAny)→ 官员令牌与匿名都拿到 200,红。"""
    account, client = ready_soul(cn_tenant)
    officer = User.objects.create_user(username="pan", password="x", role="ADMIN", tenant=cn_tenant)

    assert APIClient().get("/api/v1/me/chat/session/").status_code == 401
    assert officer_client(officer).get("/api/v1/me/chat/session/").status_code == 403
    assert not matrix.users  # 两次拒绝都没碰 Synapse

    response = client.get("/api/v1/me/chat/session/")
    assert response.status_code == 200, response.data
    assert set(response.data) == {"homeserver", "user_id", "login_type", "token", "expires_in"}
    assert response.data["login_type"] == "org.matrix.login.jwt"
    assert response.data["homeserver"] == "https://matrix.test.soulledger/"
    identity = ChatIdentity.objects.get(account=account)
    assert response.data["user_id"] == identity.matrix_user_id

    # mxid 不含内部主键、灵魂编号、姓名 —— 断言它们**不在场**。
    mxid = identity.matrix_user_id
    for leaked in (str(account.pk), str(account.soul_id), account.soul.soul_code, account.soul.name):
        assert leaked.lower() not in mxid.lower(), leaked

    # 首登改密前:与 /me 其余接口同一道闸。
    account.must_change_password = True
    account.save()
    assert client.get("/api/v1/me/chat/session/").status_code == 403


def test_the_login_token_is_short_lived_and_names_only_this_soul(cn_tenant, matrix):  # noqa: F811
    import jwt

    account, client = ready_soul(cn_tenant)
    data = client.get("/api/v1/me/chat/session/").data
    claims = jwt.decode(data["token"], "jwt-secret-for-tests", algorithms=["HS256"], audience="synapse")
    identity = ChatIdentity.objects.get(account=account)
    assert claims["sub"] == identity.localpart
    assert claims["iss"] == "soulledger"
    assert claims["exp"] - claims["iat"] == data["expires_in"] <= 300


def test_chat_is_503_when_it_is_not_enabled(cn_tenant, settings):
    settings.MATRIX_ENABLED = False
    _, client = ready_soul(cn_tenant)
    response = client.get("/api/v1/me/chat/session/")
    assert response.status_code == 503
    assert response.data["code"] == "chat_not_configured"
    assert not ChatIdentity.objects.exists()


# ── 规则 1:互关 ───────────────────────────────────────────────────────────


def test_mutual_follows_get_a_free_room(cn_tenant, matrix):  # noqa: F811
    """变异:`open_direct` 里把 `mutual = are_mutual_follows(...)` 换成 `mutual = False` → 红(throttled 为真、发起方 0 级)。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    mutual(a, b)

    response = _open(a_client, b)
    assert response.status_code == 201, response.data
    assert response.data["throttled"] is False
    assert response.data["peer_name"] == "乙"

    room = room_of(Conversation.objects.get())
    a_id = ChatIdentity.objects.get(account=a).matrix_user_id
    b_id = ChatIdentity.objects.get(account=b).matrix_user_id
    assert room["members"] == {a_id, b_id}
    levels = room["power_levels"]
    assert levels["events_default"] == 0
    assert levels["users"][a_id] == levels["users"][b_id] == 50
    # 房间的形状只有服务账号能改:状态事件与邀请都要 100,而灵魂只有 50。
    assert levels["state_default"] == levels["invite"] == 100
    assert max(v for k, v in levels["users"].items() if k != matrix().service_user) < 100

    # 同一对灵魂第二次:同一个房间,200 而不是 201。
    again = _open(a_client, b)
    assert again.status_code == 200 and again.data["id"] == response.data["id"]
    assert Conversation.objects.count() == 1


def test_one_room_per_pair_regardless_of_who_asks(cn_tenant, matrix):  # noqa: F811
    """变异:删掉 `_pair` 的排序(直接 `low, high = soul, target_soul`)→ 乙再发起时建出第二个房间,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    mutual(a, b)
    first = _open(a_client, b).data["id"]
    second = _open(b_client, a)
    assert second.status_code == 200 and second.data["id"] == first
    assert Conversation.objects.count() == 1


# ── 规则 2:非互关同文明 → 24 小时一条 ────────────────────────────────────


def test_a_stranger_gets_one_request_per_24_hours(cn_tenant, matrix):  # noqa: F811
    """变异:`send_request_message` 里把 `< interval` 改成 `< 0` → 第二条 201,红。
    变异:删掉 `members[mine.matrix_user_id] = 0` → 发起方 50 级,可以绕过后端直接发,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    follow(a, b)  # 单向关注不算互关

    opened = _open(a_client, b)
    assert opened.status_code == 201
    assert opened.data["throttled"] is True
    conversation = Conversation.objects.get()
    assert conversation.initiator_id == a.soul_id

    # 发起方在 Matrix 里发不出:events_default 50,它 0 级。对方 50 级、可以回。
    levels = room_of(conversation)["power_levels"]
    a_id = ChatIdentity.objects.get(account=a).matrix_user_id
    b_id = ChatIdentity.objects.get(account=b).matrix_user_id
    assert levels["events_default"] == 50
    assert levels["users"][a_id] == 0
    assert levels["users"][b_id] == 50

    first = _send(a_client, conversation.id, "打扰一下")
    assert first.status_code == 201, first.data
    second = _send(a_client, conversation.id, "在吗")
    assert second.status_code == 429, second.data
    assert second.data["code"] == "request_throttled"
    assert "retry_at" in second.data
    assert [m["body"] for _, m in matrix.sent] == ["打扰一下"]  # 第二条没有到达 Synapse

    # 24 小时之后:可以再发一条,且只有一条。
    Conversation.objects.filter(pk=conversation.pk).update(
        last_request_at=timezone.now() - timedelta(hours=24, seconds=1))
    assert _send(a_client, conversation.id, "第二天").status_code == 201
    assert _send(a_client, conversation.id, "又一条").status_code == 429


def test_a_reply_lifts_the_limit(cn_tenant, matrix):  # noqa: F811
    """变异:`refresh_throttle` 里删掉「对方发过消息」那一支 → 回复后仍 429,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    _open(a_client, b)
    conversation = Conversation.objects.get()
    assert _send(a_client, conversation.id).status_code == 201
    assert _send(a_client, conversation.id).status_code == 429

    # 乙在 Matrix 里回了一句 —— 后端不在那条路径上,是下一次甲发言时才知道。
    b_id = ChatIdentity.objects.get(account=b).matrix_user_id
    matrix.peer_says(conversation.room_id, b_id)

    assert _send(a_client, conversation.id, "谢谢回复").status_code == 201
    conversation.refresh_from_db()
    assert conversation.throttled is False and conversation.responded_at is not None
    a_id = ChatIdentity.objects.get(account=a).matrix_user_id
    assert room_of(conversation)["power_levels"]["users"][a_id] == 50  # 从此直接走 Matrix
    assert _send(a_client, conversation.id, "再一条").status_code == 201


def test_the_initiators_own_message_does_not_count_as_a_reply(cn_tenant, matrix):  # noqa: F811
    """变异:`refresh_throttle` 里按「房间里有任何消息」而不是「对方的消息」判断 → 甲自己那条就解锁了,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    _open(a_client, b)
    conversation = Conversation.objects.get()
    assert _send(a_client, conversation.id).status_code == 201
    assert _send(a_client, conversation.id).status_code == 429
    conversation.refresh_from_db()
    assert conversation.throttled is True


def test_following_back_lifts_the_limit(cn_tenant, matrix):  # noqa: F811
    """变异:`refresh_throttle` 里删掉互关那一支 → 回关后仍 429,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    follow(a, b)
    _open(a_client, b)
    conversation = Conversation.objects.get()
    assert _send(a_client, conversation.id).status_code == 201
    assert _send(a_client, conversation.id).status_code == 429

    follow(b, a)  # 乙回关
    assert _send(a_client, conversation.id).status_code == 201
    conversation.refresh_from_db()
    assert conversation.throttled is False
    assert conversation.responded_at is None  # 解除的理由是互关,不是回复


def test_the_recipient_is_not_throttled(cn_tenant, matrix):  # noqa: F811
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    _open(a_client, b)
    conversation = Conversation.objects.get()
    response = _send(b_client, conversation.id)
    assert response.status_code == 409 and response.data["code"] == "not_initiator"


def test_a_soul_outside_the_conversation_cannot_post_into_it(cn_tenant, matrix):  # noqa: F811
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    _, c_client = ready_soul(cn_tenant, name="丙")
    _open(a_client, b)
    conversation = Conversation.objects.get()
    assert _send(c_client, conversation.id).status_code == 404
    assert not matrix.sent


# ── 规则 4:跨文明 ─────────────────────────────────────────────────────────


def test_cross_civilization_is_refused(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """变异:把 `open_direct` 的 `same_civilization` 判定删掉,同时把视图里按 tenant 过滤的
    `tenant_id=...` 删掉 → 201,红。两层各删一层都仍是 4xx(视图层 404,服务层 403)——
    `test_the_service_refuses_cross_civilization_on_its_own` 单独钉服务层那一层。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    mutual(a, b)  # 互关也不行:文明先于关系

    response = _open(a_client, b)
    assert response.status_code in (403, 404)
    assert not Conversation.objects.exists()
    assert not matrix.rooms


def test_the_service_refuses_cross_civilization_on_its_own(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """变异:删掉 `open_direct` 里的 `same_civilization` 判定 → 建出房间,红。"""
    from apps.chat import services as svc

    a, _ = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    with pytest.raises(svc.ChatError) as caught:
        svc.open_direct(a, b.soul)
    assert caught.value.status == 403 and caught.value.code == "cross_civilization"
    assert not matrix.rooms


def test_residence_counts_as_the_current_civilization(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """暂居:文明按**当前所在**算。乙原属欧洲、暂居中国 → 与甲同文明。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    b.soul.tenant = cn_tenant  # home_tenant 仍是 eu
    b.soul.save()
    assert _open(a_client, b).status_code == 201


def test_cannot_open_a_chat_with_yourself(cn_tenant, matrix):  # noqa: F811
    a, a_client = ready_soul(cn_tenant)
    assert _open(a_client, a).status_code == 400


# ── 审计:不含正文 ────────────────────────────────────────────────────────


def test_the_audit_trail_never_contains_a_message_body(cn_tenant, matrix):  # noqa: F811
    """变异:在 `send_request_message` 的 `audit(...)` 里把 description 改成带上 body → 红。
    断言是**不在场**:只断言「有审计行」的测试会在正文混进去时照样绿。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    secret = "只给你一个人看的话-7f3a9c"
    _open(a_client, b)
    conversation = Conversation.objects.get()
    assert _send(a_client, conversation.id, secret).status_code == 201

    rows = AuditLog.objects.filter(resource_id=str(conversation.id))
    assert rows.count() >= 2  # 建会话 + 发请求:审计确实写了
    for row in AuditLog.objects.all():
        assert secret not in row.description
        assert secret not in str(row.changes or "")
