"""官员 App「待回书信」:`GET officer-app/todo/` 的 `letters` 组。

口径 = 官员台收件箱「待回复」∩「交给我的」(`inbox.folder_q("awaiting_reply")` + `assignee`),
并计入 `todo.total()`(推送里的数字读它)。租户隔离用非 ADMIN 测。
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.authentication.models import User
from apps.chat.models import Conversation, ConversationKind, InboxOfficerState
from apps.officer_app import push, todo
from tests.soul_account_support import dead_soul, officer_client
from tests.soul_push_support import FakeSender, push_on  # noqa: F401

pytestmark = pytest.mark.django_db

TODO = "/api/v1/officer-app/todo/"
TOKEN = "ExponentPushToken[officer0000000000000a]"


def _letter(tenant, name, assignee=None, last_from="soul", **fields):
    now = timezone.now()
    return Conversation.objects.create(
        kind=ConversationKind.OFFICER_INBOX, room_id=f"!{name}:x", soul_a=dead_soul(tenant, name=name),
        tenant=tenant, last_from=last_from, last_soul_message_at=now, last_message_at=now,
        assignee=assignee, **fields)


@pytest.fixture
def me(cn_tenant):
    return User.objects.create_user(username="cui", password="x", role="MODERATOR", tenant=cn_tenant)


def _letters(user):
    return officer_client(user).get(TODO).data["letters"]


def test_only_open_unanswered_letters_assigned_to_me_are_listed(cn_tenant, eu_tenant, me):
    other = User.objects.create_user(username="zhong", password="x", role="MODERATOR", tenant=cn_tenant)
    mine = _letter(cn_tenant, "甲", assignee=me)
    _letter(cn_tenant, "乙", assignee=other)  # 标给同僚
    _letter(cn_tenant, "丙")  # 没人认领
    _letter(cn_tenant, "丁", assignee=me, last_from="hall")  # 已回
    _letter(cn_tenant, "戊", assignee=me, closed_at=timezone.now())  # 已关闭
    archived = _letter(cn_tenant, "己", assignee=me)
    InboxOfficerState.objects.create(conversation=archived, user=me, archived_at=timezone.now())
    eu_officer = User.objects.create_user(username="minos", password="x", role="MODERATOR", tenant=eu_tenant)
    _letter(eu_tenant, "庚", assignee=eu_officer)  # 别的殿

    group = _letters(me)
    assert group["count"] == 1
    (item,) = group["items"]
    assert item["kind"] == "letter" and item["title"] == "甲"
    assert item["target"] == {"kind": "letter", "id": str(mine.pk)}
    # 别的殿的官员只看到自己殿的。
    assert [i["title"] for i in _letters(eu_officer)["items"]] == ["庚"]


def test_oldest_letter_first(cn_tenant, me):
    older = _letter(cn_tenant, "先来", assignee=me)
    Conversation.objects.filter(pk=older.pk).update(last_soul_message_at=timezone.now() - timedelta(days=2))
    _letter(cn_tenant, "后到", assignee=me)
    assert [i["title"] for i in _letters(me)["items"]] == ["先来", "后到"]


def test_without_the_reply_permission_the_group_is_empty(cn_tenant):
    judge = User.objects.create_user(username="judge_only", password="x", role="JUDGE", tenant=cn_tenant)
    _letter(cn_tenant, "甲", assignee=judge)
    assert _letters(judge) == {"count": 0, "items": []}


def test_a_reply_takes_the_letter_out_of_the_group_and_the_total(cn_tenant, me):
    convo = _letter(cn_tenant, "甲", assignee=me)
    assert todo.total(me) == 1
    Conversation.objects.filter(pk=convo.pk).update(last_from="hall")
    assert _letters(me)["count"] == 0 and todo.total(me) == 0


def test_the_push_count_includes_letters_and_names_none(cn_tenant, me, push_on):  # noqa: F811
    _letter(cn_tenant, "甲信", assignee=me)
    _letter(cn_tenant, "乙信", assignee=me)
    push.register_device(me, TOKEN, "IOS")
    assert push.send_to_user(me, sender=FakeSender()) == 1
    (message,) = FakeSender.batches[0]
    assert message["body"] == "有 2 件待你处理"
    assert "甲信" not in str(message)
