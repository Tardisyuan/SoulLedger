"""一个灵魂 24 小时内新开的请求房间有上限(流程走查 2026-11-12 F-CHAT-03)。

此前节流只按「每对 24 小时一条」:逐个 user_id 开房间没有上限,每间都把对方 force_join 进去、
在对方的会话列表里多一行「来信申请」。互关的私聊不是请求,不计。
"""
import pytest

from apps.chat.models import Conversation
from tests.chat_support import FakeMatrix, matrix, mutual  # noqa: F401
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db
CONVERSATIONS = "/api/v1/me/chat/conversations/"


def test_the_initiator_gets_n_request_rooms_a_day_and_mutual_chats_do_not_count(cn_tenant, matrix, settings):  # noqa: F811
    settings.CHAT_NEW_REQUESTS_PER_DAY = 2
    a, a_client = ready_soul(cn_tenant, name="甲")
    strangers = [ready_soul(cn_tenant, name=f"陌{i}")[0] for i in range(3)]
    friend, _ = ready_soul(cn_tenant, name="友")
    mutual(a, friend)

    for b in strangers[:2]:
        assert a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").status_code == 201
    rooms = len(FakeMatrix.rooms)
    refused = a_client.post(CONVERSATIONS, {"target_user": strangers[2].user_id}, format="json")
    assert refused.status_code == 429 and refused.data["code"] == "request_throttled", refused.data
    assert "retry_at" in refused.data
    assert len(FakeMatrix.rooms) == rooms  # 没建房、没把对方拉进去
    assert not Conversation.objects.filter(account_b=strangers[2]).exists() \
        and not Conversation.objects.filter(account_a=strangers[2]).exists()

    # 已有的请求房间照常回到;互关的私聊不受限。
    assert a_client.post(CONVERSATIONS, {"target_user": strangers[0].user_id}, format="json").status_code == 200
    assert a_client.post(CONVERSATIONS, {"target_user": friend.user_id}, format="json").status_code == 201
