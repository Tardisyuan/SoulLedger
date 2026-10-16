"""官员 App(Design 第三十四批):`todo` 的 `unassigned_letters` 组,与详情 `facts.node.is_last` 的判定。"""
from types import SimpleNamespace

import pytest
from django.utils import timezone

from apps.authentication.models import User
from apps.chat.models import Conversation, ConversationKind
from apps.officer_app import facts, todo
from apps.workflow.models import NodeKind, NodeStatus
from tests.soul_account_support import dead_soul, officer_client

pytestmark = pytest.mark.django_db

TODO = "/api/v1/officer-app/todo/"


def _letter(tenant, name, assignee=None, last_from="soul", **fields):
    now = timezone.now()
    return Conversation.objects.create(
        kind=ConversationKind.OFFICER_INBOX, room_id=f"!{name}:x", soul_a=dead_soul(tenant, name=name),
        tenant=tenant, last_from=last_from, last_soul_message_at=now, last_message_at=now,
        assignee=assignee, **fields)


@pytest.fixture
def me(cn_tenant):
    return User.objects.create_user(username="cui", password="x", role="MODERATOR", tenant=cn_tenant)


def test_unassigned_group_lists_only_open_unanswered_unassigned_letters(cn_tenant, eu_tenant, me):
    other = User.objects.create_user(username="zhong", password="x", role="MODERATOR", tenant=cn_tenant)
    free = _letter(cn_tenant, "甲")
    _letter(cn_tenant, "乙", assignee=other)
    _letter(cn_tenant, "丙", assignee=me)
    _letter(cn_tenant, "丁", last_from="hall")
    _letter(cn_tenant, "戊", closed_at=timezone.now())
    _letter(eu_tenant, "己")
    group = officer_client(me).get(TODO).data["unassigned_letters"]
    assert group["count"] == 1
    (item,) = group["items"]
    assert item["title"] == "甲" and item["target"] == {"kind": "letter", "id": str(free.pk)}


def test_unassigned_group_has_its_own_page_and_is_not_in_the_total(cn_tenant, me):
    _letter(cn_tenant, "甲")
    assert todo.total(me) == 0
    page = officer_client(me).get(TODO, {"kind": "unassigned_letter", "offset": 0}).data
    assert page["count"] == 1


def test_without_the_reply_permission_the_unassigned_group_is_empty(cn_tenant):
    judge = User.objects.create_user(username="judge_only", password="x", role="JUDGE", tenant=cn_tenant)
    _letter(cn_tenant, "甲")
    assert officer_client(judge).get(TODO).data["unassigned_letters"] == {"count": 0, "items": []}


def _node(order, status=NodeStatus.PENDING, kind=NodeKind.APPROVAL, on_pass_id=None, branches=None):
    return SimpleNamespace(node_order=order, status=status, kind=kind, on_pass_id=on_pass_id,
                           branches_json=branches or [])


def test_is_last_follows_pending_human_nodes_only():
    current, done, auto = _node(2), _node(1, NodeStatus.APPROVED), _node(3, kind=NodeKind.END)
    assert facts._is_last(current, [done, current, auto]) is True
    assert facts._is_last(current, [done, current, _node(3)]) is False
    assert facts._is_last(_node(2, on_pass_id="x"), [done]) is False
    # 有条件分支:无从知道。
    assert facts._is_last(_node(2, branches=[{"when": []}]), [done]) is None
