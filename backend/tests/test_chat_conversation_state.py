"""会话列表上 App 用来选界面的四个字段:`mutual` / `initiated_by_me` / `next_request_at` / `refusal`。

App 不自己推规则(`services.py` 的头注释:规则在后端)。它要知道的是「我此刻在这个会话里
处于哪一态」,而这四个字段都由服务端既有的判断算出 —— `refusal` 与发送时拒绝的是**同一个**
函数,所以列表说能说、发送却 403 的分歧不存在。全部经真实 URL。
"""
from datetime import timedelta

import pytest

from apps.chat.models import Conversation
from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.social import moderation
from tests.chat_support import follow, matrix, mutual  # noqa: F401
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"


def _row(client, conversation_id):
    rows = client.get(CONVERSATIONS).data
    return next(r for r in rows if r["id"] == str(conversation_id))


def test_a_request_says_who_asked_and_when_the_next_one_may_go(cn_tenant, matrix):  # noqa: F811
    """变异:`get_initiated_by_me` 不比 soul_id(恒为 `obj.throttled`)→ 收信方也被锁,红。
    变异:`get_next_request_at` 不加间隔(返回 last_request_at)→ 时刻错 24 小时,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    follow(a, b)
    opened = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data
    assert opened["initiated_by_me"] is True and opened["mutual"] is False
    assert opened["next_request_at"] is None  # 还没发过:第一封随时可发

    assert a_client.post(f"{CONVERSATIONS}{opened['id']}/messages/", {"body": "打扰"}, format="json").status_code == 201
    sent_at = Conversation.objects.get(pk=opened["id"]).last_request_at
    mine = _row(a_client, opened["id"])
    assert mine["next_request_at"] == sent_at + timedelta(hours=24)
    assert mine["refusal"] is None

    theirs = _row(b_client, opened["id"])
    assert theirs["initiated_by_me"] is False and theirs["next_request_at"] is None
    assert theirs["throttled"] is True and theirs["refusal"] is None


def test_mutual_rooms_say_so_and_are_nobodys_request(cn_tenant, matrix):  # noqa: F811
    """变异:`get_mutual` 恒 False → 红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    mutual(a, b)
    opened = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data
    for client in (a_client, b_client):
        row = _row(client, opened["id"])
        assert row["mutual"] is True and row["initiated_by_me"] is False and row["next_request_at"] is None


def test_refusal_is_the_same_judgement_the_send_path_makes(cn_tenant, eu_tenant, matrix, django_capture_on_commit_callbacks):  # noqa: F811
    """禁言:私聊答 `muted`,殿司收件箱照常可写(None);调走之后旧殿司答 `not_current_hall`。
    变异:`get_refusal` 恒 None → 红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    mutual(a, b)
    direct = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data
    inbox = a_client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json").data
    with django_capture_on_commit_callbacks(execute=True):
        moderation.mute_user(a.user, cn_tenant, 3, actor=None)
    assert _row(a_client, direct["id"])["refusal"] == "muted"
    assert _row(a_client, inbox["id"])["refusal"] is None

    record = DispatchRecord.objects.create(source_tenant=cn_tenant, target_tenant=eu_tenant, soul=a.soul,
                                           status=DispatchStatus.APPROVED, reason="受罚", tenant=cn_tenant)
    with django_capture_on_commit_callbacks(execute=True):
        DispatchService.execute(record, "executor")
    assert _row(a_client, inbox["id"])["refusal"] == "not_current_hall"
    # 同一个判断:发送也拒于同一个码。
    sent = a_client.post(f"{CONVERSATIONS}{inbox['id']}/messages/", {"body": "x"}, format="json")
    assert sent.status_code == 403 and sent.data["code"] == "not_current_hall"
