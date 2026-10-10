"""官员 App:有书信分派给他、或已分派给他的会话来了灵魂的新信 —— 手机推送(`inbox.push_to_assignee`)。

只复用 `officer_app.push.notify_users`(同一个设备表、同一句「有 N 件待你处理」),所以
锁屏上没有灵魂名与信的内容;`data.target` = `{"kind": "letter", "id": 会话 id}`,App 落到该会话。
同一会话 `PUSH_QUIET_MINUTES` 内只推一次;分派 / 改派无视静默期。
"""
import pytest
from django.core.cache import cache

from apps.authentication.models import User
from apps.chat.models import Conversation
from apps.officer_app import push
from tests.chat_support import matrix  # noqa: F401
from tests.soul_account_support import officer_client, ready_soul
from tests.soul_push_support import FakeSender, push_on  # noqa: F401

pytestmark = pytest.mark.django_db

INBOX = "/api/v1/chat/inbox/"
TOKENS = {
    "cui": "ExponentPushToken[officer0000000000000a]",
    "zhong": "ExponentPushToken[officer0000000000000b]",
    "minos": "ExponentPushToken[officer0000000000000c]",
}


def _officer(tenant, username):
    user = User.objects.create_user(username=username, password="x", role="MODERATOR", tenant=tenant)
    push.register_device(user, TOKENS[username], "IOS")
    return user


@pytest.fixture(autouse=True)
def _quiet_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def sent(monkeypatch):
    calls = []
    monkeypatch.setattr(push.send_todo_push, "delay", lambda ids, target=None: calls.append((list(ids), target)))
    return calls


@pytest.fixture
def world(cn_tenant, eu_tenant, matrix):  # noqa: F811
    class W:
        pass

    w = W()
    w.cui, w.zhong = _officer(cn_tenant, "cui"), _officer(cn_tenant, "zhong")
    w.minos = _officer(eu_tenant, "minos")
    _, w.soul = ready_soul(cn_tenant, name="机密甲")
    opened = w.soul.post("/api/v1/me/chat/conversations/", {"kind": "OFFICER_INBOX"}, format="json")
    assert opened.status_code in (200, 201), opened.data
    w.cid = opened.data["id"]
    return w


def _soul_writes(w):
    res = w.soul.post(f"/api/v1/me/chat/conversations/{w.cid}/messages/", {"body": "阎王在上"}, format="json")
    assert res.status_code == 201, res.data


def _assign(w, who, by, capture):
    with capture(execute=True):
        res = officer_client(by).post(f"{INBOX}{w.cid}/assign/", {"user_id": who.pk}, format="json")
    assert res.status_code == 200, res.data


def _target(w):
    return {"kind": "letter", "id": str(w.cid)}


def test_assigning_pushes_the_assignee_only(world, sent, django_capture_on_commit_callbacks):
    _soul_writes(world)
    _soul_writes(world)  # 还没有经办人:不推
    assert sent == []
    _assign(world, world.zhong, world.cui, django_capture_on_commit_callbacks)
    assert sent == [([world.zhong.pk], _target(world))]


def test_taking_it_yourself_pushes_nothing(world, sent, django_capture_on_commit_callbacks):
    _soul_writes(world)
    _assign(world, world.cui, world.cui, django_capture_on_commit_callbacks)
    assert sent == []


def test_reassigning_pushes_the_new_assignee_even_inside_the_quiet_window(
        world, sent, django_capture_on_commit_callbacks):
    _soul_writes(world)
    _assign(world, world.zhong, world.cui, django_capture_on_commit_callbacks)
    _assign(world, world.cui, world.zhong, django_capture_on_commit_callbacks)
    assert sent == [([world.zhong.pk], _target(world)), ([world.cui.pk], _target(world))]


def test_a_new_letter_pushes_the_assignee_once_per_quiet_window(world, sent, django_capture_on_commit_callbacks):
    _soul_writes(world)
    Conversation.objects.filter(pk=world.cid).update(assignee=world.zhong)
    with django_capture_on_commit_callbacks(execute=True):
        _soul_writes(world)
    with django_capture_on_commit_callbacks(execute=True):
        _soul_writes(world)  # 静默期内
    assert sent == [([world.zhong.pk], _target(world))]

    cache.clear()  # 静默期过了
    with django_capture_on_commit_callbacks(execute=True):
        _soul_writes(world)
    assert len(sent) == 2


def test_nothing_is_pushed_once_the_hall_has_replied_or_the_conversation_is_closed(
        world, sent, django_capture_on_commit_callbacks):
    _soul_writes(world)
    Conversation.objects.filter(pk=world.cid).update(last_from="hall")
    _assign(world, world.zhong, world.cui, django_capture_on_commit_callbacks)  # 已回:不是「等他回」
    assert sent == []

    Conversation.objects.filter(pk=world.cid).update(last_from="soul", closed_at="2026-10-01T00:00:00Z")
    from apps.chat import inbox

    with django_capture_on_commit_callbacks(execute=True):
        inbox.push_to_assignee(Conversation.objects.get(pk=world.cid), force=True)
    assert sent == []


def test_another_halls_officer_gets_nothing(world, sent, django_capture_on_commit_callbacks):
    _soul_writes(world)
    Conversation.objects.filter(pk=world.cid).update(assignee=world.zhong)
    with django_capture_on_commit_callbacks(execute=True):
        _soul_writes(world)
    assert all(world.minos.pk not in ids for ids, _ in sent)


def test_the_lock_screen_text_names_neither_the_soul_nor_the_letter(world, push_on):  # noqa: F811
    _soul_writes(world)
    Conversation.objects.filter(pk=world.cid).update(assignee=world.zhong)
    assert push.send_to_user(world.zhong, sender=FakeSender(), target=_target(world)) == 1
    (message,) = FakeSender.batches[0]
    assert message["body"] == "有 1 件待你处理"
    assert message["data"] == {"category": "officer_todo", "target": _target(world)}
    assert "机密甲" not in str(message) and "阎王" not in str(message)
