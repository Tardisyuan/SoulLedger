"""新书信推送:Synapse 模块在消息落库后回调后端,后端只推给收件方那一世的本世账号。

回调由**模块本身**发出(`tests/chat_support.deliver_hooks` 装载 config/synapse/soulledger_policy.py,
签名、POST 真实 URL);它与后端 `apps/chat/hook.py` 的签名算法一致,由第一条测试钉住。
"""
import time

import pytest

from apps.chat import hook
from apps.chat.models import Conversation
from apps.soul_push.models import PushDelivery, PushPreference
from tests.chat_support import (  # noqa: F401
    PUSH_URL,
    FakeEvent,
    FakeMatrix,
    deliver_hooks,
    follow,
    matrix,
    mutual,
    mxid,
    policy,
)
from tests.soul_account_support import officer_client, ready_soul
from tests.soul_push_support import TOKEN_A, TOKEN_B, register

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"
HOOK = "/api/v1/chat/hooks/new-message/"


def _pushes(account):
    return list(PushDelivery.objects.filter(account=account, kind="chat_message"))


@pytest.fixture
def pair(cn_tenant, matrix):  # noqa: F811
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    assert register(a_client, TOKEN_A).status_code == 201
    assert register(b_client, TOKEN_B).status_code == 201
    mutual(a, b)
    opened = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data
    return a, a_client, b, b_client, Conversation.objects.get(pk=opened["id"])


def test_the_module_signs_what_the_backend_verifies(matrix):  # noqa: F811
    """两份签名算法(模块里的 `_push_body`、后端的 `hook.sign`)逐字相同,且后端验得过模块签的。
    变异:模块签名串去掉 `push\\n` 前缀 → 后端验不过,红。"""
    module = pytest.importorskip("tests.chat_support").load_policy_module()
    now = int(time.time())
    body = module._push_body("s" * 40, "!r:x", "$e", "@a:x", now)
    assert body == hook.sign("s" * 40, "!r:x", "$e", "@a:x", now=now)
    assert hook.verify("s" * 40, body, now=now)


def test_a_new_message_is_pushed_to_the_other_side_only(pair, matrix):  # noqa: F811
    """互关房间里甲直接在 Matrix 里发(后端不在路径上):乙收到一条推送,甲自己不收。
    锁屏上没有正文、没有名字;数据只带 App 落地要的 screen 与 conversation_id。
    变异:`_recipient` 返回发送者自己的账号 → 甲收到、乙没收到,红。"""
    a, _, b, _, conversation = pair
    matrix.says(conversation.room_id, mxid(a), "今晚月色很好")
    api = deliver_hooks()

    assert [uri for uri, _ in api.posts] == [PUSH_URL] and not api.failures
    [push] = _pushes(b)
    assert push.data == {"screen": "Conversation", "conversation_id": str(conversation.id), "kind": "chat_message"}
    assert (push.title, push.body) == ("新书信", "你收到一封新书信,打开灵魂簿查看。")
    assert "今晚月色很好" not in f"{push.title}{push.body}{push.data}" and "甲" not in push.body
    assert _pushes(a) == []


def test_a_request_through_the_backend_is_pushed_too(cn_tenant, matrix):  # noqa: F811
    """非互关的私聊请求(后端以发起方身份代发、带凭据):同样只推收件方。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    register(b_client, TOKEN_B)
    follow(a, b)
    opened = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data
    assert a_client.post(f"{CONVERSATIONS}{opened['id']}/messages/", {"body": "打扰"}, format="json").status_code == 201
    deliver_hooks()
    assert len(_pushes(b)) == 1


def test_a_hall_reply_is_pushed_but_a_letter_to_the_hall_is_not(cn_tenant, matrix):  # noqa: F811
    """殿司收件箱:官员回信(服务账号发)推给灵魂;灵魂写给殿司的不推(官员不用 App)。
    变异:`_recipient` 对收件箱不看发送者(恒返回 account_a)→ 灵魂自己的信也推给自己,红。"""
    from apps.authentication.models import User
    from apps.perm.models import Permission

    a, a_client = ready_soul(cn_tenant, name="甲")
    register(a_client, TOKEN_A)
    inbox = a_client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json").data
    assert a_client.post(f"{CONVERSATIONS}{inbox['id']}/messages/", {"body": "我要申诉"}, format="json").status_code == 201
    deliver_hooks()
    assert _pushes(a) == []

    officer = User.objects.create_user(username="cn_mod", password="x", role="ADMIN", tenant=cn_tenant)
    assert Permission.objects.filter(codename="soul_inbox.reply").exists()
    reply = officer_client(officer).post(f"/api/v1/chat/inbox/{inbox['id']}/reply/", {"body": "已收"}, format="json")
    assert reply.status_code == 201, reply.data
    deliver_hooks()
    [push] = _pushes(a)
    assert push.data["conversation_id"] == inbox["id"]


def test_the_letters_switch_turns_chat_pushes_off(pair, matrix):  # noqa: F811
    """偏好沿用 soul_push:关掉「书信」就不记;别的类别不受影响。
    变异:`record_chat_message` 的类别写成 "rebirth" → 关了书信仍推,红。"""
    a, _, b, b_client, conversation = pair
    assert b_client.patch("/api/v1/me/notification-settings/", {"chat": False}, format="json").data["chat"] is False
    assert PushPreference.objects.get(account=b).rebirth is True
    matrix.says(conversation.room_id, mxid(a), "在吗")
    deliver_hooks()
    assert _pushes(b) == []


def test_a_replayed_callback_does_not_push_twice(pair, matrix):  # noqa: F811
    a, _, b, _, conversation = pair
    matrix.says(conversation.room_id, mxid(a), "在吗")
    event = FakeMatrix.hooks[0]
    deliver_hooks()
    FakeMatrix.hooks.append(event)
    deliver_hooks()
    assert len(_pushes(b)) == 1


@pytest.mark.parametrize("who_is_reborn", ["recipient", "sender"])
def test_a_closed_conversation_gets_no_push(cn_tenant, pair, matrix, who_is_reborn,  # noqa: F811
                                            django_capture_on_commit_callbacks):
    """会话因转世关闭之后,回调才到(消息在关闭前落库):不推。收件方转世 —— 不推给它的任何一世;
    发送方转世 —— 收件方仍是本世、设备有效,但这段会话已止,也不推。
    变异:`notify_new_message` 不看 `closed_at` → 发送方转世那一例乙收到推送,红。"""
    from apps.soul_accounts.services import retire_account_for_rebirth

    a, _, b, _, conversation = pair
    matrix.says(conversation.room_id, mxid(a), "晚到的一封")
    reborn = b if who_is_reborn == "recipient" else a
    with django_capture_on_commit_callbacks(execute=True):
        retire_account_for_rebirth(reborn.soul, reborn.cycle)
    deliver_hooks()
    assert PushDelivery.objects.filter(kind="chat_message").count() == 0


def test_the_hook_only_takes_a_valid_fresh_signature(pair, matrix, client, settings):  # noqa: F811
    """不认令牌,只认签名:签错 / 过期 / 字段不全都是 403,什么都不写;冒充会话之外的发送者不推。
    变异:`hook.verify` 去掉时间窗 → 过期的那条被接受,红。"""
    a, _, b, _, conversation = pair
    secret = settings.MATRIX_JWT_SECRET
    good = hook.sign(secret, conversation.room_id, "$e1", mxid(a))
    assert client.post(HOOK, {**good, "mac": "0" * 64}, content_type="application/json").status_code == 403
    stale = hook.sign(secret, conversation.room_id, "$e1", mxid(a), now=int(time.time()) - 3600)
    assert client.post(HOOK, stale, content_type="application/json").status_code == 403
    assert client.post(HOOK, {"room_id": conversation.room_id}, content_type="application/json").status_code == 403
    assert client.post(HOOK, hook.sign("x" * 40, conversation.room_id, "$e1", mxid(a)),
                       content_type="application/json").status_code == 403
    assert PushDelivery.objects.count() == 0

    stranger = hook.sign(secret, conversation.room_id, "$e2", "@soul_nobody:test.soulledger")
    assert client.post(HOOK, stranger, content_type="application/json").json() == {"queued": 0}
    assert client.post(HOOK, good, content_type="application/json").json() == {"queued": 1}
    assert len(_pushes(b)) == 1


def test_the_hook_is_503_when_chat_is_off(client, settings):
    settings.MATRIX_ENABLED = False
    body = hook.sign("s" * 40, "!r:x", "$e", "@a:x")
    assert client.post(HOOK, body, content_type="application/json").status_code == 503


def test_a_failing_callback_never_touches_the_message(pair, matrix, monkeypatch):  # noqa: F811
    """后端挂了:消息早已落库(Synapse 在落库后才回调),模块把失败记日志、吞掉,不抛给 Synapse。
    变异:模块 `_push` 去掉 try/except → 异常冒到后台进程(`failures` 非空),红。"""
    from apps.chat import services

    a, _, _, _, conversation = pair

    def down(*args, **kwargs):
        raise RuntimeError("backend down")

    monkeypatch.setattr(services, "notify_new_message", down)
    event_id = matrix.says(conversation.room_id, mxid(a), "照常送达")
    from rest_framework.test import APIClient

    api = deliver_hooks(APIClient(raise_request_exception=False))
    assert api.posts and api.failures == []
    assert matrix.rooms[conversation.room_id]["messages"][-1]["event_id"] == event_id


def test_the_module_only_calls_back_for_new_messages(matrix):  # noqa: F811
    """状态事件、非消息事件、编辑(`m.new_content`)不回调;不配 push_url 就不注册回调。"""
    instance, api = policy()
    callback = api.callbacks["on_new_event"]
    from tests.chat_support import run_coroutine

    run_coroutine(callback(FakeEvent("!r", "$1", "@a:x", "m.room.power_levels", {}, state_key=""), {}))
    run_coroutine(callback(FakeEvent("!r", "$2", "@a:x", "m.reaction", {}), {}))
    run_coroutine(callback(FakeEvent("!r", "$3", "@a:x", "m.room.message", {"body": "*改", "m.new_content": {}}), {}))
    assert api.background == []
    run_coroutine(callback(FakeEvent("!r", "$4", "@a:x", "m.room.message", {"body": "新"}), {}))
    assert len(api.background) == 1

    _, bare = policy(push_url=None)
    assert "on_new_event" not in bare.callbacks
