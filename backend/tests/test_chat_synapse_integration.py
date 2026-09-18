"""对着**真 Synapse** 跑:`FakeMatrix` 照着拒绝的每一条,在这里由真服务拒绝。

默认跳过(CI 与本地全量都没有 Synapse)。本机起一个再跑 —— 只绑 127.0.0.1,跑完删容器:

    # homeserver.yaml = `generate` 产出的 + config/synapse/homeserver.soulledger.yaml
    # (把 ${...} 换成下面同样的值;本机测试再放宽 rc_* 限速)
    docker run -d --name soulchat-synapse-test -p 127.0.0.1:18008:8008 \\
      -v <data>:/data -v <repo>/config/synapse:/modules:ro -e PYTHONPATH=/modules \\
      matrixdotorg/synapse:v1.161.0
    SYNAPSE_TEST_URL=http://127.0.0.1:18008 SYNAPSE_TEST_SERVER_NAME=<server_name> \\
    SYNAPSE_TEST_JWT_SECRET=... SYNAPSE_TEST_SHARED_SECRET=... \\
      .venv/bin/python -m pytest tests/test_chat_synapse_integration.py --no-cov
    docker rm -f soulchat-synapse-test

2026-09-18 实跑:v1.161.0,2 passed。
"""
import os
import secrets
import time
import uuid

import pytest
import requests

from apps.chat.models import Conversation
from tests.chat_support import follow, mutual, mxid
from tests.soul_account_support import ready_soul

URL = os.getenv("SYNAPSE_TEST_URL", "")
pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(not URL, reason="没有 SYNAPSE_TEST_URL:本机没起 Synapse"),
]

CONVERSATIONS = "/api/v1/me/chat/conversations/"


@pytest.fixture
def synapse(settings):
    settings.MATRIX_ENABLED = True
    settings.MATRIX_CLIENT = "apps.chat.matrix.SynapseClient"
    settings.MATRIX_INTERNAL_URL = URL
    settings.MATRIX_PUBLIC_BASEURL = URL
    settings.MATRIX_SERVER_NAME = os.environ["SYNAPSE_TEST_SERVER_NAME"]
    settings.MATRIX_JWT_SECRET = os.environ["SYNAPSE_TEST_JWT_SECRET"]
    settings.MATRIX_REGISTRATION_SHARED_SECRET = os.environ["SYNAPSE_TEST_SHARED_SECRET"]
    settings.MATRIX_SERVICE_LOCALPART = "soulledger"
    # 每次一个新盐:同一台 Synapse 上重跑,mxid 不与上一次的撞。
    settings.MATRIX_USER_SALT = secrets.token_hex(8)
    return settings


def _matrix(method, path, token, **kwargs):
    response = requests.request(method, f"{URL}{path}", headers={"Authorization": f"Bearer {token}"},
                                timeout=10, **kwargs)
    return response.status_code, (response.json() if response.content else {})


def _login_as_the_app_would(client):
    """App 的路径:取 /me/chat/session/,拿里面的 JWT 去 Synapse 登录。"""
    session = client.get("/api/v1/me/chat/session/").data
    status, body = _matrix("POST", "/_matrix/client/v3/login", "", json={
        "type": session["login_type"], "token": session["token"]})
    assert status == 200, body
    assert body["user_id"] == session["user_id"]
    return body["access_token"]


def _say(token, room_id, body="hi"):
    return _matrix("PUT", f"/_matrix/client/v3/rooms/{room_id}/send/m.room.message/{uuid.uuid4().hex}",
                   token, json={"msgtype": "m.text", "body": body})


def _wait_until(check, seconds=10):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.2)
    return False


def test_a_soul_cannot_reshape_rooms_with_its_own_token(cn_tenant, eu_tenant, synapse):
    """Synapse 模块与 power level:灵魂拿着自己的 token 不能建房、不能邀请、不能改房间。
    变异:homeserver.yaml 去掉 `modules` 那一段 → createRoom 200,红(2026-09-18 未做,
    因为要重启容器;模块的每个回调都由下面的一条断言覆盖)。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    beatrice, eu_client = ready_soul(eu_tenant, name="Beatrice")
    mutual(a, b)
    a_token = _login_as_the_app_would(a_client)
    _login_as_the_app_would(eu_client)

    # 自己建房去和别的文明的灵魂说话:模块拒绝。
    status, body = _matrix("POST", "/_matrix/client/v3/createRoom", a_token,
                           json={"preset": "private_chat", "invite": [mxid(beatrice)]})
    assert status == 403 and body["errcode"] == "M_FORBIDDEN", body

    opened = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json")
    assert opened.status_code == 201, opened.data
    room_id = opened.data["room_id"]
    # 往私聊里拉第三个人:模块拒绝。
    status, _ = _matrix("POST", f"/_matrix/client/v3/rooms/{room_id}/invite", a_token,
                        json={"user_id": mxid(beatrice)})
    assert status == 403
    # 改房间名、改 power level:power level 拒绝(`events: {}` 让它们都落到 100)。
    status, _ = _matrix("PUT", f"/_matrix/client/v3/rooms/{room_id}/state/m.room.name", a_token,
                        json={"name": "改名"})
    assert status == 403
    status, _ = _matrix("PUT", f"/_matrix/client/v3/rooms/{room_id}/state/m.room.power_levels", a_token,
                        json={"users": {mxid(a): 100}})
    assert status == 403
    # 互关房间里直接说话:可以。
    assert _say(a_token, room_id)[0] == 200


def test_the_request_rule_the_mute_and_retirement_against_synapse(cn_tenant, synapse, django_capture_on_commit_callbacks):
    from apps.social import moderation
    from apps.soul_accounts.services import retire_account_for_rebirth

    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    follow(a, b)  # 单向:私聊请求
    a_token, b_token = _login_as_the_app_would(a_client), _login_as_the_app_would(b_client)

    opened = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json")
    assert opened.status_code == 201 and opened.data["throttled"] is True
    room_id, conversation_id = opened.data["room_id"], opened.data["id"]
    send = f"{CONVERSATIONS}{conversation_id}/messages/"

    # 发起方直接在 Matrix 里发:Synapse 拒绝。
    status, body = _say(a_token, room_id)
    assert status == 403 and body["errcode"] == "M_FORBIDDEN", body
    # 经后端发:一条到达,是服务账号转发、标着替谁发。第二条 429,没有到达。
    assert a_client.post(send, {"body": "打扰一下"}, format="json").status_code == 201
    assert a_client.post(send, {"body": "在吗"}, format="json").status_code == 429
    _, history = _matrix("GET", f"/_matrix/client/v3/rooms/{room_id}/messages", b_token,
                         params={"dir": "b", "limit": 20})
    texts = [e for e in history["chunk"] if e["type"] == "m.room.message"]
    assert [e["content"]["body"] for e in texts] == ["打扰一下"]
    assert texts[0]["sender"] == f"@soulledger:{synapse.MATRIX_SERVER_NAME}"
    assert texts[0]["content"]["io.soulledger.on_behalf_of"] == mxid(a)

    # 乙回了一句;甲下一次经后端发言时解除,从此甲直接在 Matrix 里说话。
    assert _say(b_token, room_id, "你好")[0] == 200
    assert a_client.post(send, {"body": "谢谢"}, format="json").status_code == 201
    assert Conversation.objects.get(pk=conversation_id).throttled is False
    assert _say(a_token, room_id, "直接说")[0] == 200

    # 禁言:甲在 Matrix 里说不了话;解禁后恢复。
    with django_capture_on_commit_callbacks(execute=True):
        mute = moderation.mute_user(a.user, cn_tenant, 1, actor=None)
    assert _say(a_token, room_id)[0] == 403
    with django_capture_on_commit_callbacks(execute=True):
        moderation.lift_mute(mute, actor=None)
    assert _say(a_token, room_id)[0] == 200

    # 转世:Matrix 用户停用、token 作废、离开房间(Synapse 后台异步做完)。
    with django_capture_on_commit_callbacks(execute=True):
        retire_account_for_rebirth(a.soul, a.cycle)
    assert _say(a_token, room_id)[0] == 401

    def a_left():
        _, members = _matrix("GET", f"/_matrix/client/v3/rooms/{room_id}/joined_members", b_token)
        return mxid(a) not in members.get("joined", {})

    assert _wait_until(a_left)
