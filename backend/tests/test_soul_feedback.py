"""「帮助与反馈」(Design 第二十八批 S5):反馈就是一封写给殿司的书信,多一个类别标签。

不另开通道:灵魂照旧 `POST /me/chat/conversations/`(收件箱)再 `…/messages/` 发信,只是消息体多一个
`feedback_tag`;截图走书信图片原来的两步(传、发)。这里钉住:信到了殿司收件箱并带标签、标签只在列表上
(官员台 + 官员 App 待办)显示到有人回复为止、别的殿看不到、截图随信、不是反馈就没有标签。
"""
import io
import os

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.authentication.models import User
from apps.chat.models import ChatImage, Conversation
from tests.chat_support import FakeMatrix, matrix, mutual  # noqa: F401
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"
INBOX = "/api/v1/chat/inbox/"
TODO = "/api/v1/officer-app/todo/"


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")


def _hall(client):
    opened = client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json")
    assert opened.status_code in (200, 201), opened.data
    return opened.data["id"]


def _send(client, conversation_id, **body):
    return client.post(f"{CONVERSATIONS}{conversation_id}/messages/", body, format="json")


def _officer(tenant, username="cui"):
    return User.objects.create_user(username=username, password="x", role="MODERATOR", tenant=tenant)


def _row(api, conversation_id):
    rows = api.get(INBOX).data["results"]
    return next((r for r in rows if r["id"] == str(conversation_id)), None)


def test_a_feedback_letter_reaches_the_hall_inbox_with_its_tag(cn_tenant, matrix):  # noqa: F811
    _, client = ready_soul(cn_tenant, name="甲")
    conversation_id = _hall(client)

    sent = _send(client, conversation_id, body="登录总是失败", feedback_tag="account", txn_id="sl1.0")
    assert sent.status_code == 201, sent.data

    conversation = Conversation.objects.get(pk=conversation_id)
    assert conversation.feedback_tag == "account" and conversation.last_from == "soul"
    room_id, event = matrix.sent[-1]
    assert event["body"] == "登录总是失败"                      # 正文就是灵魂写的那句,没有被改
    assert event["feedback"] == "account"                         # 类别随事件走,别的 Matrix 客户端不受影响
    row = _row(officer_client(_officer(cn_tenant)), conversation_id)
    assert row["feedback_tag"] == "account" and row["last_from"] == "soul"


def test_the_tag_shows_in_the_officer_apps_todo_until_someone_replies(cn_tenant, matrix):  # noqa: F811
    _, client = ready_soul(cn_tenant, name="甲")
    conversation_id = _hall(client)
    _send(client, conversation_id, body="我的记录有误", feedback_tag="record")
    me = _officer(cn_tenant)
    Conversation.objects.filter(pk=conversation_id).update(assignee=me)
    api = officer_client(me)

    (item,) = api.get(TODO).data["letters"]["items"]
    assert item["feedback_tag"] == "record" and item["title"] == "甲"

    assert api.post(f"{INBOX}{conversation_id}/reply/", {"body": "已记下"}, format="json").status_code == 201
    assert Conversation.objects.get(pk=conversation_id).feedback_tag == ""
    assert _row(api, conversation_id)["feedback_tag"] == ""
    # 回了之后灵魂再写一封普通信:不是反馈,不带标签。
    _send(client, conversation_id, body="谢谢")
    assert Conversation.objects.get(pk=conversation_id).feedback_tag == ""
    (item,) = api.get(TODO).data["letters"]["items"]
    assert "feedback_tag" not in item


def test_an_ordinary_letter_has_no_tag_and_does_not_clear_a_pending_one(cn_tenant, matrix):  # noqa: F811
    _, client = ready_soul(cn_tenant, name="甲")
    conversation_id = _hall(client)
    assert _send(client, conversation_id, body="阎王在上").status_code == 201
    assert Conversation.objects.get(pk=conversation_id).feedback_tag == ""
    assert matrix.sent[-1][1]["feedback"] is None
    _send(client, conversation_id, body="登录总是失败", feedback_tag="app")
    _send(client, conversation_id, body="补一句")
    assert Conversation.objects.get(pk=conversation_id).feedback_tag == "app"


def test_the_tag_must_be_one_of_the_four_and_only_the_hall_takes_it(cn_tenant, matrix):  # noqa: F811
    me, client = ready_soul(cn_tenant, name="甲")
    friend, _ = ready_soul(cn_tenant, name="乙")
    mutual(me, friend)
    conversation_id = _hall(client)
    assert _send(client, conversation_id, body="x", feedback_tag="login").status_code == 400
    assert _send(client, conversation_id, body="x", feedback_tag="").status_code == 400
    assert Conversation.objects.get(pk=conversation_id).feedback_tag == ""
    direct = client.post(CONVERSATIONS, {"target_user": friend.user_id}, format="json").data["id"]
    refused = _send(client, direct, body="x", feedback_tag="other")
    assert refused.status_code == 400 and refused.data["code"] == "feedback_to_hall_only"
    assert not Conversation.objects.filter(pk=direct).exclude(feedback_tag="").exists()
    assert all(m.get("feedback") is None for _, m in matrix.sent)


def test_a_retried_feedback_posts_once_and_keeps_its_tag(cn_tenant, matrix):  # noqa: F811
    """发件箱断网重发:同一个 txn_id 回第一次的 event_id,不发第二条(反馈走书信原来的幂等)。"""
    _, client = ready_soul(cn_tenant, name="甲")
    conversation_id = _hall(client)
    first = _send(client, conversation_id, body="登录总是失败", feedback_tag="account", txn_id="sl9.0")
    again = _send(client, conversation_id, body="登录总是失败", feedback_tag="account", txn_id="sl9.0")
    assert first.data == again.data and len(matrix.sent) == 1


def test_another_hall_cannot_see_the_feedback_or_its_tag(cn_tenant, eu_tenant, matrix):  # noqa: F811
    _, client = ready_soul(cn_tenant, name="甲")
    conversation_id = _hall(client)
    _send(client, conversation_id, body="登录总是失败", feedback_tag="account")
    eu_api = officer_client(_officer(eu_tenant, "minos"))
    assert eu_api.get(INBOX).data["results"] == []
    assert eu_api.get(f"{INBOX}{conversation_id}/").status_code == 404
    assert "account" not in str(eu_api.get(INBOX).data)
    # 本殿官员却看得到。
    assert _row(officer_client(_officer(cn_tenant)), conversation_id)["feedback_tag"] == "account"


def _png(noise=False):
    img = Image.frombytes("RGB", (32, 24), os.urandom(32 * 24 * 3)) if noise else Image.new("RGB", (32, 24), (9, 90, 200))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def test_screenshots_ride_the_existing_letter_image_path_and_land_in_the_same_conversation(cn_tenant, matrix):  # noqa: F811
    me, client = ready_soul(cn_tenant, name="甲")
    conversation_id = _hall(client)
    _send(client, conversation_id, body="页面是空白的", feedback_tag="app")
    for n in range(3):  # 最多 3 张是 App 的挑选上限;服务端的上限是 4 张未发出
        up = client.post(f"{CONVERSATIONS}{conversation_id}/images/",
                         {"file": SimpleUploadedFile(f"s{n}.png", _png(noise=True), content_type="image/png")},
                         format="multipart")
        assert up.status_code == 201, up.content
        assert client.post(f"/api/v1/me/chat/images/{up.json()['id']}/send/").status_code == 201
    assert ChatImage.objects.filter(conversation_id=conversation_id, uploader=me, sent_at__isnull=False).count() == 3
    # 官员在同一个线程里读到文字和三张图;标签仍是反馈那一封带来的。
    api = officer_client(_officer(cn_tenant))
    messages = api.get(f"{INBOX}{conversation_id}/messages/").data
    assert sum(1 for m in messages if m["image"]) == 3
    assert any(m["body"] == "页面是空白的" for m in messages)
    assert _row(api, conversation_id)["feedback_tag"] == "app"
    assert FakeMatrix.rooms[Conversation.objects.get(pk=conversation_id).room_id]["messages"][0]["feedback"] == "app"
