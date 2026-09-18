"""殿司收件箱(规则 3)与转世停用。

灵魂 → **当前所在**殿司;官员在 `/api/v1/chat/inbox/` 看与回,权限码 `soul_inbox.read` /
`soul_inbox.reply`,租户隔离按会话的收件殿司。
"""
import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.chat.models import ChatIdentity, Conversation, ConversationKind
from tests.chat_support import can_speak, matrix, mxid, room_of  # noqa: F401
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

INBOX = "/api/v1/chat/inbox/"


def _write_to_hall(client, body="阎王在上"):
    opened = client.post("/api/v1/me/chat/conversations/", {"kind": "OFFICER_INBOX"}, format="json")
    assert opened.status_code in (200, 201), opened.data
    sent = client.post(f"/api/v1/me/chat/conversations/{opened.data['id']}/messages/",
                       {"body": body}, format="json")
    assert sent.status_code == 201, sent.data
    return opened.data


def _moderator(tenant, username):
    return User.objects.create_user(username=username, password="x", role="MODERATOR", tenant=tenant)


def test_a_soul_writes_to_the_hall_it_is_in_now(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """暂居:写给暂居地的殿司,而不是原属殿司。
    变异:`open_officer_inbox` 里把 `soul.tenant_id` 换成 `soul.home_tenant_id` → 红。"""
    account, client = ready_soul(eu_tenant, name="Beatrice")
    account.soul.tenant = cn_tenant  # 暂居中国
    account.soul.save()

    data = _write_to_hall(client)
    conversation = Conversation.objects.get(pk=data["id"])
    assert conversation.kind == ConversationKind.OFFICER_INBOX
    assert conversation.tenant_id == cn_tenant.pk
    assert data["hall"] == cn_tenant.display_name
    # 灵魂可以直接在 Matrix 里写;房间形状仍只有服务账号能改。
    assert can_speak(conversation.room_id, mxid(account))
    levels = room_of(conversation)["power_levels"]
    assert levels["state_default"] == 100 and levels["events"] == {}
    # 同一殿司再开一次:同一个会话。
    again = client.post("/api/v1/me/chat/conversations/", {"kind": "OFFICER_INBOX"}, format="json")
    assert again.status_code == 200 and again.data["id"] == data["id"]


def test_officers_only_see_their_own_halls_inbox(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """变异:`OfficerInboxViewSet.get_queryset` 里去掉 `scope_to_tenant` → 欧洲殿主看见中国的信,红。"""
    _, cn_client = ready_soul(cn_tenant, name="甲")
    _, eu_client = ready_soul(eu_tenant, name="Beatrice")
    cn_conv = _write_to_hall(cn_client)
    eu_conv = _write_to_hall(eu_client)

    cn_officer = officer_client(_moderator(cn_tenant, "cn_mod"))
    eu_officer = officer_client(_moderator(eu_tenant, "eu_mod"))

    cn_list = cn_officer.get(INBOX)
    assert cn_list.status_code == 200, cn_list.data
    assert [r["id"] for r in cn_list.data["results"]] == [cn_conv["id"]]
    eu_ids = [r["id"] for r in eu_officer.get(INBOX).data["results"]]
    assert eu_ids == [eu_conv["id"]]

    # 直接按 id 取别的殿司的:404,不是 403(不承认它存在)。消息与回复同样。
    assert eu_officer.get(f"{INBOX}{cn_conv['id']}/").status_code == 404
    assert eu_officer.get(f"{INBOX}{cn_conv['id']}/messages/").status_code == 404
    assert eu_officer.post(f"{INBOX}{cn_conv['id']}/reply/", {"body": "越界"}, format="json").status_code == 404
    assert all(m["body"] != "越界" for _, m in matrix.sent)


def test_the_hall_keeps_its_letters_after_the_soul_goes_home(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """暂居结束回归原文明后,当初写给暂居地殿司的信仍归暂居地殿司。
    变异:让 `get_queryset` 按 `soul_a__tenant` 而不是会话自己的 `tenant` 过滤 → 红。"""
    account, client = ready_soul(eu_tenant, name="Beatrice")
    account.soul.tenant = cn_tenant
    account.soul.save()
    data = _write_to_hall(client)
    account.soul.tenant = eu_tenant  # 回归
    account.soul.save()

    cn_officer = officer_client(_moderator(cn_tenant, "cn_mod"))
    eu_officer = officer_client(_moderator(eu_tenant, "eu_mod"))
    assert [r["id"] for r in cn_officer.get(INBOX).data["results"]] == [data["id"]]
    assert eu_officer.get(INBOX).data["results"] == []


def test_officer_reads_and_replies_through_the_backend(cn_tenant, matrix):  # noqa: F811
    _, client = ready_soul(cn_tenant, name="甲")
    data = _write_to_hall(client, "我想申诉")
    officer = _moderator(cn_tenant, "cn_mod")
    officer.first_name = "判官崔珏"
    officer.save()
    api = officer_client(officer)

    messages = api.get(f"{INBOX}{data['id']}/messages/")
    assert messages.status_code == 200
    assert [(m["from_officer"], m["sender_name"], m["body"]) for m in messages.data] == [(False, "甲", "我想申诉")]

    reply = api.post(f"{INBOX}{data['id']}/reply/", {"body": "已收到"}, format="json")
    assert reply.status_code == 201, reply.data
    room_id, sent = matrix.sent[-1]
    assert sent["sender"] == matrix().service_user  # 以殿司(服务账号)名义发出
    assert sent["officer"] == "判官崔珏"
    newest = api.get(f"{INBOX}{data['id']}/messages/").data[0]
    assert (newest["from_officer"], newest["sender_name"], newest["body"]) == (True, "判官崔珏", "已收到")

    # 审计:谁读了、谁回的都记下了,信里写了什么没有。
    rows = AuditLog.objects.filter(resource="chat_conversation", user=officer)
    assert sorted(rows.values_list("action", flat=True)) == ["EXECUTE", "READ", "READ"]
    for row in AuditLog.objects.all():
        assert "已收到" not in row.description and "我想申诉" not in row.description


def test_inbox_permission_codes(cn_tenant, matrix):  # noqa: F811
    """VIEWER 没有 soul_inbox.read;JUDGE 同样没有。reply 另要 soul_inbox.reply。
    变异:把 `extra_permissions["reply"]` 改成 `["soul_inbox.read"]`,再收回某角色的 reply → 红。"""
    _, client = ready_soul(cn_tenant, name="甲")
    data = _write_to_hall(client)
    viewer = officer_client(User.objects.create_user(username="v", password="x", role="VIEWER", tenant=cn_tenant))
    judge = officer_client(User.objects.create_user(username="j", password="x", role="JUDGE", tenant=cn_tenant))
    for api in (viewer, judge):
        assert api.get(INBOX).status_code == 403
        assert api.post(f"{INBOX}{data['id']}/reply/", {"body": "x"}, format="json").status_code == 403


def test_the_inbox_requires_an_officer_token(cn_tenant, matrix):  # noqa: F811
    _, client = ready_soul(cn_tenant, name="甲")
    assert client.get(INBOX).status_code == 403  # 灵魂令牌走错了门
    assert APIClient().get(INBOX).status_code == 401


def test_officers_are_never_members_of_soul_to_soul_rooms(cn_tenant, matrix):  # noqa: F811
    """规则 4 的后半句。私聊房间里只有两个灵魂和建房的服务账号;官员接口读不到私聊。"""
    from tests.chat_support import mutual

    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    mutual(a, b)
    a_client.post("/api/v1/me/chat/conversations/", {"target_user": b.user_id}, format="json")
    conversation = Conversation.objects.get(kind=ConversationKind.DIRECT)
    souls = set(ChatIdentity.objects.values_list("matrix_user_id", flat=True))
    # 服务账号是建房者,留在房间里改 power level;它不是任何官员,也没有任何官员接口读私聊。
    assert room_of(conversation)["members"] == souls | {matrix().service_user}
    # 私聊不在官员收件箱里出现。
    officer = officer_client(_moderator(cn_tenant, "cn_mod"))
    assert officer.get(INBOX).data["results"] == []
    assert officer.get(f"{INBOX}{conversation.id}/").status_code == 404


# ── 转世停用 ─────────────────────────────────────────────────────────────


def test_a_retired_account_loses_chat_and_its_matrix_user(cn_tenant, matrix, django_capture_on_commit_callbacks):  # noqa: F811
    """变异:删掉 `apps/chat/signals.py` 的 receiver → Matrix 用户仍是启用的,红。
    变异:把 `deactivate_identity` 里的 `client.deactivate_user(...)` 删掉 → 红。"""
    from apps.soul_accounts.services import retire_account_for_rebirth
    from tests.chat_support import mutual

    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    mutual(a, b)
    assert a_client.post("/api/v1/me/chat/conversations/", {"target_user": b.user_id},
                         format="json").status_code == 201
    identity = ChatIdentity.objects.get(account=a)
    conversation = Conversation.objects.get()
    assert identity.matrix_user_id in room_of(conversation)["members"]

    with django_capture_on_commit_callbacks(execute=True):
        retire_account_for_rebirth(a.soul, a.cycle)

    identity.refresh_from_db()
    assert identity.deactivated_at is not None
    assert matrix.users[identity.localpart]["deactivated"] is True
    assert identity.matrix_user_id not in room_of(conversation)["members"]
    # 账号本身也进不来了。
    assert a_client.get("/api/v1/me/chat/session/").status_code == 401


def test_retiring_an_account_that_never_chatted_touches_nothing(cn_tenant, matrix, django_capture_on_commit_callbacks):  # noqa: F811
    from apps.soul_accounts.services import retire_account_for_rebirth

    a, _ = ready_soul(cn_tenant, name="甲")
    with django_capture_on_commit_callbacks(execute=True):
        retire_account_for_rebirth(a.soul, a.cycle)
    assert not matrix.calls


# ── 菜单 ─────────────────────────────────────────────────────────────────


def _menu_names(user):
    response = officer_client(user).get("/api/v1/menus/tree/")
    assert response.status_code == 200, response.data
    out = set()

    def walk(items):
        for item in items:
            out.add(item["name"])
            walk(item.get("children") or [])

    walk(response.json().get("results", response.json()) if isinstance(response.json(), dict) else response.json())
    return out


def test_the_inbox_menu_follows_the_codename(cn_tenant):
    """menus/0018:`/soul-inbox` 挂在「灵魂业务」下,持有 soul_inbox.read 才看得见。
    变异:把迁移里的 permission 改成 `soul.read` → JUDGE 也看得见,红。"""
    from apps.menus.models import Menu

    menu = Menu.objects.get(path="/soul-inbox")
    assert (menu.parent.name, menu.permission) == ("灵魂业务", "soul_inbox.read")
    assert "殿司收件箱" in _menu_names(_moderator(cn_tenant, "cn_mod"))
    judge = User.objects.create_user(username="j", password="x", role="JUDGE", tenant=cn_tenant)
    names = _menu_names(judge)
    assert names, "断言的主体不空:JUDGE 看得见别的菜单"
    assert "殿司收件箱" not in names
