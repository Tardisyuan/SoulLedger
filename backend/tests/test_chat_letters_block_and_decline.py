"""书信申请的拒绝与拉黑(2026-11-01 用户拍板 #3),以及同一轮审查 P3 的两条:
禁言告诉被禁言者(带理由)、灵魂调走后原殿司不能再回信。

拍板原文:接收方可拒绝单次申请,也可拉黑;被拉黑方只看到「无法送达」;设置里可解除。
全部经真实 URL;每条的变异证明写在 docstring 里。
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.authentication.models import User
from apps.chat import services as svc
from apps.chat.models import ChatBlock, Conversation, ConversationKind
from apps.social import moderation
from apps.soul_push.models import PushDelivery
from tests.chat_support import can_speak, follow, matrix, mutual, mxid  # noqa: F401
from tests.soul_account_support import officer_client, ready_soul
from tests.soul_push_support import TOKEN_B, register

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"
BLOCKS = "/api/v1/me/chat/blocks/"
INBOX = "/api/v1/chat/inbox/"


def _open(client, target):
    return client.post(CONVERSATIONS, {"target_user": target.user_id}, format="json")


def _send(client, conversation_id, body="打扰一下"):
    return client.post(f"{CONVERSATIONS}{conversation_id}/messages/", {"body": body}, format="json")


def _ids(client):
    return {row["id"]: row for row in client.get(CONVERSATIONS).data}


@pytest.fixture
def request_pair(cn_tenant, matrix):  # noqa: F811
    """甲(单向关注乙)向乙发了一封书信申请,乙还没回。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    follow(a, b)
    opened = _open(a_client, b)
    assert opened.status_code == 201 and opened.data["throttled"] is True
    assert _send(a_client, opened.data["id"]).status_code == 201
    return a, a_client, b, b_client, Conversation.objects.get(pk=opened.data["id"])


# ── 拒绝单次申请 ─────────────────────────────────────────────────────────


def test_the_receiver_declines_one_request(request_pair, django_capture_on_commit_callbacks):
    """拒绝:会话关闭、从拒绝方列表消失;发起方看到 `declined`、发不出;满一个请求间隔后才能再申请(新房间)。
    变异:`refusal` 里删掉 `declined_at` 那条 → 发起方列表上是 `closed`,红。
    变异:列表视图删掉 `exclude(declined…)` → 乙仍看见被拒的申请,红。
    变异:`open_direct` 删掉「被拒后等满间隔」→ 立刻再申请得 201,红。"""
    a, a_client, b, b_client, conversation = request_pair
    with django_capture_on_commit_callbacks(execute=True):
        declined = b_client.post(f"{CONVERSATIONS}{conversation.id}/decline/")
    assert declined.status_code == 204, declined.data
    conversation.refresh_from_db()
    assert conversation.declined_at is not None and conversation.closed_at is not None
    # 房间里双方都降到 0,并记下已降权。
    assert not can_speak(conversation.room_id, mxid(a)) and not can_speak(conversation.room_id, mxid(b))
    assert conversation.silenced_at is not None

    assert str(conversation.id) not in _ids(b_client)
    mine = _ids(a_client)[str(conversation.id)]
    assert mine["refusal"] == "declined"
    sent = _send(a_client, conversation.id, "再说一句")
    assert sent.status_code == 409 and sent.data["code"] == "declined"

    again = _open(a_client, b)
    assert again.status_code == 429 and again.data["code"] == "request_throttled" and "retry_at" in again.data

    Conversation.objects.filter(pk=conversation.pk).update(declined_at=timezone.now() - timedelta(hours=24, seconds=1))
    later = _open(a_client, b)
    assert later.status_code == 201 and later.data["id"] != str(conversation.id) and later.data["throttled"] is True


def test_only_the_receiver_of_an_unanswered_request_can_decline(cn_tenant, request_pair, matrix):  # noqa: F811
    """发起方自己、局外人、互关的会话:都不能「拒绝」。局外人与不存在答同一个 404。
    变异:`decline_request` 不查 `initiator_id` → 发起方能拒自己的申请,红。
    变异:不查 `has_account` → 局外人 204,红。"""
    a, a_client, b, b_client, conversation = request_pair
    own = a_client.post(f"{CONVERSATIONS}{conversation.id}/decline/")
    assert own.status_code == 409 and own.data["code"] == "not_a_request"
    _, c_client = ready_soul(cn_tenant, name="丙")
    assert c_client.post(f"{CONVERSATIONS}{conversation.id}/decline/").status_code == 404

    d, d_client = ready_soul(cn_tenant, name="丁")
    mutual(b, d)
    free = _open(b_client, d).data
    refused = d_client.post(f"{CONVERSATIONS}{free['id']}/decline/")
    assert refused.status_code == 409 and refused.data["code"] == "not_a_request"
    assert Conversation.objects.filter(declined_at__isnull=False).count() == 0


# ── 拉黑 ─────────────────────────────────────────────────────────────────


def test_a_blocked_soul_only_sees_undeliverable(cn_tenant, request_pair, matrix, django_capture_on_commit_callbacks):  # noqa: F811
    """被拉黑的一方:发不出、开不了新私聊,看到的只是「无法送达」—— 不出现「拉黑」两个字;查找照常(不留区分)。
    拉黑的一方:这个房间里同样不能说话(`peer_blocked`),名单里有对方;对方的名单里没有它。
    变异:`refusal` 删掉 `_block_refusal` → 甲仍能发 201,红。
    变异:`_block_refusal` 对 by_peer 也答 `peer_blocked` → 甲看到被拉黑,红。
    变异:`open_direct` 删掉拉黑检查 → 甲另开会话 200/201,红。"""
    a, a_client, b, b_client, conversation = request_pair
    with django_capture_on_commit_callbacks(execute=True):
        blocked = b_client.post(f"{CONVERSATIONS}{conversation.id}/block/")
    assert blocked.status_code == 201, blocked.data
    assert blocked.data["peer_user"] == a.user_id and blocked.data["peer_name"] == "甲"
    # 幂等:再拉一次是同一行。
    assert b_client.post(f"{CONVERSATIONS}{conversation.id}/block/").data["id"] == blocked.data["id"]
    assert ChatBlock.objects.count() == 1

    Conversation.objects.filter(pk=conversation.pk).update(last_request_at=None)  # 排除 24 小时限制的干扰
    sent = _send(a_client, conversation.id, "在吗")
    assert sent.status_code == 403 and sent.data["code"] == "undeliverable"
    assert "拉黑" not in sent.data["detail"] and sent.data["detail"] == "无法送达。"
    assert _ids(a_client)[str(conversation.id)]["refusal"] == "undeliverable"
    reopened = _open(a_client, b)
    assert reopened.status_code == 403 and reopened.data["code"] == "undeliverable"
    lookup = a_client.post("/api/v1/me/chat/lookup/", {"soul_code": b.soul.soul_code}, format="json")
    assert lookup.status_code == 200

    assert _ids(b_client)[str(conversation.id)]["refusal"] == "peer_blocked"
    assert not can_speak(conversation.room_id, mxid(a)) and not can_speak(conversation.room_id, mxid(b))

    assert [row["peer_user"] for row in b_client.get(BLOCKS).data] == [a.user_id]
    assert a_client.get(BLOCKS).data == []


def test_unblocking_in_settings_restores_the_conversation(request_pair, django_capture_on_commit_callbacks):
    """解除只认自己的那一行:被拉黑的一方拿到 id 也删不掉(404,与不存在同一句)。解除后双方恢复。
    变异:`unblock` 不带 `blocker=account` → 甲把乙的拉黑删掉,红。
    变异:`unblock` 不重算发言权 → 解除后乙在 Matrix 里仍说不了话,红。"""
    a, a_client, b, b_client, conversation = request_pair
    with django_capture_on_commit_callbacks(execute=True):
        block_id = b_client.post(f"{CONVERSATIONS}{conversation.id}/block/").data["id"]
    assert a_client.delete(f"{BLOCKS}{block_id}/").status_code == 404
    assert ChatBlock.objects.filter(pk=block_id).exists()

    with django_capture_on_commit_callbacks(execute=True):
        assert b_client.delete(f"{BLOCKS}{block_id}/").status_code == 204
    assert not ChatBlock.objects.exists()
    assert b_client.get(BLOCKS).data == []
    assert can_speak(conversation.room_id, mxid(b))
    assert _ids(a_client)[str(conversation.id)]["refusal"] is None
    assert b_client.delete(f"{BLOCKS}{block_id}/").status_code == 404


def test_a_letter_that_slips_in_before_the_levels_sync_is_not_pushed(cn_tenant, matrix):  # noqa: F811
    """拉黑之后、Synapse 降权之前漏进来的一条:后端照样不推。
    变异:`_recipient` 删掉 `block_between` → 拉黑后仍有推送,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    assert register(b_client, TOKEN_B).status_code == 201
    mutual(a, b)
    conversation = Conversation.objects.get(pk=_open(a_client, b).data["id"])
    first = matrix.says(conversation.room_id, mxid(a), "一")
    assert svc.notify_new_message(conversation.room_id, first, mxid(a))  # 拉黑前:推

    ChatBlock.objects.create(blocker=b, blocked=a)  # 不经视图:Synapse 那边还没降权
    second = matrix.says(conversation.room_id, mxid(a), "二")
    assert svc.notify_new_message(conversation.room_id, second, mxid(a)) == []
    assert PushDelivery.objects.filter(account=b, kind="chat_message").count() == 1


# ── P3:调走后原殿司不能再回 ──────────────────────────────────────────────


def test_the_hall_a_soul_has_left_cannot_write_into_its_old_letter(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """此前灵魂调走之后原殿司仍能回,而灵魂回不了(`not_current_hall`)。现在两边同一条规则:双方只读,回来后恢复。
    变异:`officer_reply` 删掉 `hall_can_reply` → 调走后回信 201,红。"""
    account, client = ready_soul(cn_tenant, name="甲")
    opened = client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json").data
    assert _send(client, opened["id"], "我想申诉").status_code == 201
    officer = officer_client(User.objects.create_user(username="cn_mod", password="x", role="MODERATOR",
                                                      tenant=cn_tenant))
    assert officer.get(f"{INBOX}{opened['id']}/").data["can_reply"] is True
    assert officer.get(f"{INBOX}folders/").data["awaiting_reply"] == 1

    account.soul.tenant = eu_tenant  # 调走
    account.soul.save()
    before = len(matrix.sent)
    refused = officer.post(f"{INBOX}{opened['id']}/reply/", {"body": "已收到"}, format="json")
    assert refused.status_code == 409 and refused.data["code"] == "not_current_hall"
    assert len(matrix.sent) == before  # 没有发进 Synapse
    assert officer.get(f"{INBOX}{opened['id']}/").data["can_reply"] is False
    # 回不了的信不留在「待回复」里催人(官员端待办读的是同一个文件夹)。变异:`folder_q` 删掉 tenant 条件 → 1,红。
    assert officer.get(f"{INBOX}folders/").data["awaiting_reply"] == 0

    account.soul.tenant = cn_tenant  # 回归
    account.soul.save()
    assert officer.get(f"{INBOX}folders/").data["awaiting_reply"] == 1
    assert officer.post(f"{INBOX}{opened['id']}/reply/", {"body": "已收到"}, format="json").status_code == 201
    assert Conversation.objects.filter(kind=ConversationKind.OFFICER_INBOX).count() == 1


# ── P3:禁言告诉被禁言者,带理由 ─────────────────────────────────────────


def test_a_mute_is_pushed_to_the_soul_with_its_reason(cn_tenant, matrix, django_capture_on_commit_callbacks):  # noqa: F811
    """变异:`mute_user` 删掉 `record_social_muted` → 没有推送,红。
    变异:不分有无理由、一律用 `social_muted` → 带理由那条正文里没有理由,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    with django_capture_on_commit_callbacks(execute=True):
        moderation.mute_user(a.user, cn_tenant, 3, actor=None, reason="在评论区辱骂他人")
        moderation.mute_user(b.user, cn_tenant, 1, actor=None)

    told = PushDelivery.objects.get(account=a)
    assert told.kind == "social_muted_reason"
    assert "在评论区辱骂他人" in told.body and "3" in told.body
    plain = PushDelivery.objects.get(account=b)
    assert plain.kind == "social_muted" and "{{" not in plain.body and "1" in plain.body

    status = a_client.get("/api/v1/me/social/status/").json()
    assert status["muted_reason"] == "在评论区辱骂他人"


def test_muting_an_officer_pushes_nothing(cn_tenant, matrix):  # noqa: F811
    officer = User.objects.create_user(username="cn_mod", password="x", role="MODERATOR", tenant=cn_tenant)
    moderation.mute_user(officer, cn_tenant, 3, actor=None, reason="x")
    assert not PushDelivery.objects.exists()
