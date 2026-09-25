"""殿司收件箱的文件夹、未读、归档、草稿与回复模板(`apps/chat/inbox.py`)。

三件事分开测:

* **谁最后说话**(`Conversation.last_from`)是信的事实,三处写:灵魂经后端发、官员回复、Synapse
  回调 —— 回调按 Synapse 时间线的最新一封,不按回调到达的先后;
* **未读 / 归档 / 草稿**是每位官员自己的,A 的状态 B 看不见;
* 文件夹是一个划分:待回复与已回复不相交,归档与其余都不相交,计数与列表同一个数。
"""
import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.chat.models import Conversation, ConversationKind, InboxOfficerState, InboxReplyTemplate
from tests.chat_support import deliver_hooks, matrix, mxid  # noqa: F401
from tests.soul_account_support import dead_soul, officer_client, ready_soul

pytestmark = pytest.mark.django_db

INBOX = "/api/v1/chat/inbox/"
TEMPLATES = "/api/v1/chat/inbox-templates/"


def _write(client, body="阎王在上"):
    opened = client.post("/api/v1/me/chat/conversations/", {"kind": "OFFICER_INBOX"}, format="json")
    assert opened.status_code in (200, 201), opened.data
    sent = client.post(f"/api/v1/me/chat/conversations/{opened.data['id']}/messages/", {"body": body}, format="json")
    assert sent.status_code == 201, sent.data
    return opened.data["id"]


def _officer(tenant, username, role="MODERATOR"):
    return User.objects.create_user(username=username, password="x", role=role, tenant=tenant)


def _ids(api, **params):
    response = api.get(INBOX, params)
    assert response.status_code == 200, response.data
    return [r["id"] for r in response.data["results"]]


def _row(api, conversation_id):
    return next(r for r in api.get(INBOX).data["results"] if r["id"] == conversation_id)


def _grant(role_name, codename):
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name.title()})
    RolePermission.objects.get_or_create(role=role, permission=Permission.objects.get(codename=codename))
    invalidate_all_permissions()


# ── 谁最后说话 ───────────────────────────────────────────────────────────


def test_last_from_follows_both_sides_through_the_backend(cn_tenant, matrix):  # noqa: F811
    _, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)
    api = officer_client(_officer(cn_tenant, "m"))
    assert _row(api, cid)["last_from"] == "soul"
    assert api.post(f"{INBOX}{cid}/reply/", {"body": "已收到"}, format="json").status_code == 201
    assert _row(api, cid)["last_from"] == "hall"
    soul.post(f"/api/v1/me/chat/conversations/{cid}/messages/", {"body": "再问"}, format="json")
    assert _row(api, cid)["last_from"] == "soul"


def test_a_letter_written_straight_into_matrix_is_seen_through_the_hook(cn_tenant, matrix):  # noqa: F811
    """灵魂在收件箱房间里是 50 级,可以绕过 App 直接在 Matrix 里写。那一封只有回调看得见。
    变异:`notify_new_message` 里去掉 `record_inbox_event` → 仍是 `hall`,红。"""
    account, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)
    api = officer_client(_officer(cn_tenant, "m"))
    api.post(f"{INBOX}{cid}/reply/", {"body": "已收到"}, format="json")
    deliver_hooks()
    assert _row(api, cid)["last_from"] == "hall"

    matrix.says(Conversation.objects.get(pk=cid).room_id, mxid(account), "我直接写的")
    deliver_hooks()
    row = _row(api, cid)
    assert row["last_from"] == "soul"
    assert row["unread"] is True
    assert cid in _ids(api, folder="awaiting_reply")


def test_a_late_hook_does_not_overwrite_a_newer_reply(cn_tenant, matrix):  # noqa: F811
    """回调在 Synapse 的后台进程里跑,可能在殿司回复之后才到。它按时间线的**最新一封**定,
    不按「回调说的是灵魂」定。变异:`reconcile_inbox` 取 `timeline[-1]`(最旧)→ 红。"""
    _, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)                      # 灵魂那封的回调还没到
    api = officer_client(_officer(cn_tenant, "m"))
    api.post(f"{INBOX}{cid}/reply/", {"body": "已收到"}, format="json")
    deliver_hooks()                         # 现在两封的回调一起到
    assert _row(api, cid)["last_from"] == "hall"


def test_opening_the_thread_repairs_a_missed_hook(cn_tenant, matrix):  # noqa: F811
    """回调没配、或丢了:官员打开线程时已经拿到了真实时间线,顺手对一遍。"""
    account, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)
    api = officer_client(_officer(cn_tenant, "m"))
    api.post(f"{INBOX}{cid}/reply/", {"body": "已收到"}, format="json")
    matrix.says(Conversation.objects.get(pk=cid).room_id, mxid(account), "我直接写的")
    matrix.hooks.clear()                    # 回调丢了
    assert _row(api, cid)["last_from"] == "hall"
    assert api.get(f"{INBOX}{cid}/messages/").status_code == 200
    assert _row(api, cid)["last_from"] == "soul"


def test_reconcile_inbox_command_backfills_existing_rows(cn_tenant, matrix):  # noqa: F811
    """迁移之前就有的会话:`last_from` 为空,两个文件夹都不收。命令按时间线补上。"""
    _, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)
    Conversation.objects.filter(pk=cid).update(last_from="", last_soul_message_at=None)
    api = officer_client(_officer(cn_tenant, "m"))
    assert cid not in _ids(api, folder="awaiting_reply")
    call_command("reconcile_inbox")
    assert cid in _ids(api, folder="awaiting_reply")


# ── 每位官员自己的状态 ─────────────────────────────────────────────────────


def test_read_archive_and_draft_are_per_officer(cn_tenant, matrix):  # noqa: F811
    """A 读过、归档、写了草稿;B 看到的仍是未读、未归档、没有草稿,也读不到 A 的草稿。
    变异:`annotate_for` 的子查询去掉 `user=user` → B 看见 A 的状态,红。"""
    _, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)
    a = officer_client(_officer(cn_tenant, "a"))
    b = officer_client(_officer(cn_tenant, "b"))

    assert a.post(f"{INBOX}{cid}/read/").status_code == 200
    assert a.put(f"{INBOX}{cid}/draft/", {"body": "A 的草稿"}, format="json").status_code == 200
    mine = _row(a, cid)
    assert (mine["unread"], mine["has_draft"]) == (False, True)
    assert a.post(f"{INBOX}{cid}/archive/").status_code == 200
    assert cid in _ids(a, folder="archived") and cid not in _ids(a)

    theirs = _row(b, cid)
    assert (theirs["unread"], theirs["has_draft"], theirs["archived"]) == (True, False, False)
    assert cid in _ids(b) and cid not in _ids(b, folder="archived") and cid not in _ids(b, folder="drafts")
    assert b.get(f"{INBOX}{cid}/draft/").data["draft"] == ""
    assert a.get(f"{INBOX}{cid}/draft/").data["draft"] == "A 的草稿"
    assert b.get(f"{INBOX}folders/").data["unread"] == 1
    assert a.get(f"{INBOX}folders/").data["unread"] == 0
    # B 清自己的草稿不动 A 的。
    assert b.delete(f"{INBOX}{cid}/draft/").status_code == 200
    assert a.get(f"{INBOX}{cid}/draft/").data["draft"] == "A 的草稿"


def test_unread_follows_the_souls_letters_not_the_halls(cn_tenant, matrix):  # noqa: F811
    _, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)
    a = officer_client(_officer(cn_tenant, "a"))
    b = officer_client(_officer(cn_tenant, "b"))
    assert _row(a, cid)["unread"] is True
    a.post(f"{INBOX}{cid}/read/")
    assert _row(a, cid)["unread"] is False
    # 同僚回复:不是来信,A 不因此变未读。
    b.post(f"{INBOX}{cid}/reply/", {"body": "B 回了"}, format="json")
    assert _row(a, cid)["unread"] is False
    # 回复的人读到了此刻。
    assert _row(b, cid)["unread"] is False
    soul.post(f"/api/v1/me/chat/conversations/{cid}/messages/", {"body": "再问"}, format="json")
    assert _row(a, cid)["unread"] is True and _row(b, cid)["unread"] is True


def test_a_reply_clears_the_repliers_draft(cn_tenant, matrix):  # noqa: F811
    _, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)
    a = officer_client(_officer(cn_tenant, "a"))
    a.put(f"{INBOX}{cid}/draft/", {"body": "来信收悉"}, format="json")
    assert cid in _ids(a, folder="drafts")
    a.post(f"{INBOX}{cid}/reply/", {"body": "来信收悉"}, format="json")
    assert cid not in _ids(a, folder="drafts")
    assert a.get(f"{INBOX}{cid}/draft/").data["draft"] == ""


def test_a_draft_never_leaves_our_database(cn_tenant, matrix):  # noqa: F811
    """草稿不进 Synapse、不进审计。"""
    _, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)
    a = officer_client(_officer(cn_tenant, "a"))
    secret = "还没想好怎么说的那一句"
    a.put(f"{INBOX}{cid}/draft/", {"body": secret}, format="json")
    assert InboxOfficerState.objects.filter(draft=secret).count() == 1, "断言的主体存在"
    assert all(secret not in m["body"] for _, m in matrix.sent)
    assert not AuditLog.objects.filter(description__contains=secret).exists()


def test_draft_validation(cn_tenant, matrix):  # noqa: F811
    _, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)
    a = officer_client(_officer(cn_tenant, "a"))
    assert a.put(f"{INBOX}{cid}/draft/", {"body": "x" * 4001}, format="json").status_code == 400
    assert a.put(f"{INBOX}{cid}/draft/", {"body": "x" * 4000}, format="json").status_code == 200
    # 原样存,包括末尾的换行。
    assert a.put(f"{INBOX}{cid}/draft/", {"body": "第一行\n"}, format="json").data["draft"] == "第一行\n"
    # 只有空白 = 清掉。
    assert a.put(f"{INBOX}{cid}/draft/", {"body": "  \n "}, format="json").data["draft"] == ""
    assert cid not in _ids(a, folder="drafts")


def test_a_closed_conversation_takes_no_draft(cn_tenant, matrix):  # noqa: F811
    """已关闭(灵魂已转世)只读:不能存草稿;读、归档、清掉旧草稿仍可。
    变异:去掉 `draft` 里的 `closed_at` 判断 → 200,红。"""
    _, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)
    a = officer_client(_officer(cn_tenant, "a"))
    a.put(f"{INBOX}{cid}/draft/", {"body": "旧草稿"}, format="json")
    Conversation.objects.filter(pk=cid).update(closed_at=timezone.now())

    refused = a.put(f"{INBOX}{cid}/draft/", {"body": "新草稿"}, format="json")
    assert refused.status_code == 409 and refused.data["code"] == "closed"
    assert a.get(f"{INBOX}{cid}/draft/").data["draft"] == "旧草稿"
    assert a.post(f"{INBOX}{cid}/read/").status_code == 200
    assert a.post(f"{INBOX}{cid}/archive/").status_code == 200
    assert a.delete(f"{INBOX}{cid}/draft/").data["draft"] == ""


# ── 文件夹 ──────────────────────────────────────────────────────────────


def test_the_folders_partition_the_inbox(cn_tenant, matrix):  # noqa: F811
    """待回复 ∩ 已回复 = ∅;归档与其余都不相交;待回复 ∪ 已回复 ∪ 其余两种 = 全部;
    计数 = 列表条数。变异:`folder_q("replied")` 去掉 `live &` → 归档的也进已回复,红;
    `folder_q("awaiting_reply")` 去掉 `closed_at__isnull=True` → 已关闭的进待回复,红。"""
    api = officer_client(_officer(cn_tenant, "a"))

    def letter(name, body="来信"):
        _, client = ready_soul(cn_tenant, name=name)
        return _write(client, body), client

    awaiting, _ = letter("待")
    replied, _ = letter("回")
    api.post(f"{INBOX}{replied}/reply/", {"body": "已回"}, format="json")
    archived, _ = letter("档")
    api.post(f"{INBOX}{archived}/archive/")
    # 归档的里面也要有一封殿司最后回的 —— 否则「已回复」漏掉 `archived=False` 也看不出来。
    archived_replied, _ = letter("档回")
    api.post(f"{INBOX}{archived_replied}/reply/", {"body": "已回"}, format="json")
    api.post(f"{INBOX}{archived_replied}/archive/")
    closed, _ = letter("闭")
    Conversation.objects.filter(pk=closed).update(closed_at=timezone.now())
    _, silent_client = ready_soul(cn_tenant, name="默")
    silent = silent_client.post("/api/v1/me/chat/conversations/", {"kind": "OFFICER_INBOX"},
                                format="json").data["id"]  # 开了收件箱,一封没写
    drafted, _ = letter("稿")
    api.put(f"{INBOX}{drafted}/draft/", {"body": "草"}, format="json")

    got = {folder: set(_ids(api, folder=folder))
           for folder in ("all", "awaiting_reply", "replied", "drafts", "archived")}
    assert got["awaiting_reply"] == {awaiting, drafted}
    assert got["replied"] == {replied}
    assert got["drafts"] == {drafted}
    assert got["archived"] == {archived, archived_replied}
    assert got["all"] == {awaiting, replied, closed, silent, drafted}
    assert not got["awaiting_reply"] & got["replied"]
    for folder in ("all", "awaiting_reply", "replied", "drafts"):
        assert not got[folder] & got["archived"], folder
    assert got["all"] - got["awaiting_reply"] - got["replied"] == {closed, silent}

    counts = api.get(f"{INBOX}folders/").data
    for folder, ids in got.items():
        assert counts[folder] == len(ids), folder
    assert (counts["open"], counts["closed"]) == (4, 1)
    assert counts["halls"] == [{"tenant": cn_tenant.pk, "hall_names": cn_tenant.hall_names, "count": 5}]
    assert set(_ids(api, status="closed")) == {closed}
    assert set(_ids(api, status="open")) == {awaiting, replied, silent, drafted}
    # 取消归档:回到默认文件夹。
    api.post(f"{INBOX}{archived}/unarchive/")
    assert archived in _ids(api, folder="awaiting_reply")


def test_awaiting_reply_is_oldest_first(cn_tenant, matrix):  # noqa: F811
    """设计稿 C · 09:待回复「最早在上」。其余文件夹最近在上。"""
    api = officer_client(_officer(cn_tenant, "a"))
    ids = []
    for name in ("先", "后"):
        _, client = ready_soul(cn_tenant, name=name)
        ids.append(_write(client))
    older, newer = ids
    Conversation.objects.filter(pk=older).update(last_soul_message_at=timezone.now() - timezone.timedelta(days=2))
    assert _ids(api, folder="awaiting_reply") == [older, newer]
    assert _ids(api)[:2] == [newer, older]


def test_bad_folder_is_a_400(cn_tenant, matrix):  # noqa: F811
    api = officer_client(_officer(cn_tenant, "a"))
    assert api.get(INBOX, {"folder": "spam"}).status_code == 400


def test_the_list_is_paginated(cn_tenant, matrix):  # noqa: F811
    for i in range(23):
        soul = dead_soul(cn_tenant, name=f"魂{i}")
        Conversation.objects.create(kind=ConversationKind.OFFICER_INBOX, room_id=f"!p{i}:x", soul_a=soul,
                                    tenant=cn_tenant, last_from="soul", last_soul_message_at=timezone.now())
    api = officer_client(_officer(cn_tenant, "a"))
    first = api.get(INBOX, {"folder": "awaiting_reply"}).data
    assert first["count"] == 23 and len(first["results"]) == 20 and first["next"]
    second = api.get(INBOX, {"folder": "awaiting_reply", "page": 2}).data
    assert len(second["results"]) == 3 and second["next"] is None
    assert not {r["id"] for r in first["results"]} & {r["id"] for r in second["results"]}
    assert api.get(f"{INBOX}folders/").data["awaiting_reply"] == 23


# ── 租户与权限 ──────────────────────────────────────────────────────────


def test_state_and_counts_are_tenant_scoped(cn_tenant, eu_tenant, matrix):  # noqa: F811
    _, cn_soul = ready_soul(cn_tenant, name="甲")
    cid = _write(cn_soul)
    eu = officer_client(_officer(eu_tenant, "eu"))
    for method, path in (("post", "read/"), ("post", "archive/"), ("post", "unarchive/"),
                         ("get", "draft/"), ("put", "draft/"), ("delete", "draft/")):
        response = getattr(eu, method)(f"{INBOX}{cid}/{path}", {"body": "越界"}, format="json")
        assert response.status_code == 404, (method, path, response.status_code)
    assert not InboxOfficerState.objects.exists()
    counts = eu.get(f"{INBOX}folders/").data
    assert counts["all"] == 0 and counts["halls"] == []
    cn = officer_client(_officer(cn_tenant, "cn"))
    assert cn.get(f"{INBOX}folders/").data["all"] == 1, "断言的主体存在"


def test_inbox_state_permissions(cn_tenant, matrix):  # noqa: F811
    """VIEWER 什么都不行;只有 `soul_inbox.read` 的能读、标已读、归档,不能碰草稿与模板。"""
    _, soul = ready_soul(cn_tenant, name="甲")
    cid = _write(soul)
    viewer = officer_client(_officer(cn_tenant, "v", role="VIEWER"))
    for method, path in (("get", "folders/"), ("post", f"{cid}/read/"), ("post", f"{cid}/archive/"),
                         ("get", f"{cid}/draft/"), ("put", f"{cid}/draft/")):
        assert getattr(viewer, method)(f"{INBOX}{path}", {"body": "x"}, format="json").status_code == 403, path
    assert viewer.get(TEMPLATES).status_code == 403

    _grant("GUARDIAN", "soul_inbox.read")
    reader = officer_client(_officer(cn_tenant, "r", role="GUARDIAN"))
    assert reader.get(f"{INBOX}folders/").status_code == 200
    assert reader.post(f"{INBOX}{cid}/read/").status_code == 200
    assert reader.post(f"{INBOX}{cid}/archive/").status_code == 200
    for method in ("get", "put", "delete"):
        assert getattr(reader, method)(f"{INBOX}{cid}/draft/", {"body": "x"}, format="json").status_code == 403
    assert reader.get(TEMPLATES).status_code == 403
    assert reader.post(TEMPLATES, {"title": "t", "body": "b"}, format="json").status_code == 403

    anonymous = APIClient()
    assert anonymous.get(f"{INBOX}folders/").status_code == 401


# ── 回复模板 ────────────────────────────────────────────────────────────


def test_reply_templates_crud_and_placeholders(cn_tenant, eu_tenant):
    cn = officer_client(_officer(cn_tenant, "cn"))
    eu = officer_client(_officer(eu_tenant, "eu"))
    created = cn.post(TEMPLATES, {"title": "不予准许", "body": "{{soul_name}}:{{ hall_name }}已收悉。"},
                      format="json")
    assert created.status_code == 201, created.data
    tid = created.data["id"]
    assert InboxReplyTemplate.objects.get(pk=tid).tenant_id == cn_tenant.pk

    bad = cn.post(TEMPLATES, {"title": "坏", "body": "{{soul_code}} 你好"}, format="json")
    assert bad.status_code == 400 and "soul_code" in str(bad.data["body"])
    assert cn.post(TEMPLATES, {"title": "  ", "body": "x"}, format="json").status_code == 400
    assert cn.post(TEMPLATES, {"title": "长", "body": "x" * 4001}, format="json").status_code == 400

    assert [t["id"] for t in cn.get(TEMPLATES).data] == [tid]
    assert eu.get(TEMPLATES).data == []
    assert eu.patch(f"{TEMPLATES}{tid}/", {"title": "改"}, format="json").status_code == 404
    assert eu.delete(f"{TEMPLATES}{tid}/").status_code == 404

    assert cn.patch(f"{TEMPLATES}{tid}/", {"title": "准许"}, format="json").data["title"] == "准许"
    assert cn.delete(f"{TEMPLATES}{tid}/").status_code == 204
    assert not InboxReplyTemplate.objects.exists()
