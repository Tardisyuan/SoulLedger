"""会话属于**一世**,不属于灵魂;关闭的会话留在那一世,只读,并在 Synapse 上把留下的一方降到 0。

全部走真实的写路径:`retire_account_for_rebirth`(转世停用,信号在提交后关会话、停 Matrix 用户)、
`provision_account`(新一世开号)、真实 URL。
"""
import pytest

from apps.chat.matrix import MatrixError
from apps.chat.models import Conversation, ConversationKind
from apps.soul_accounts import services as accounts
from apps.soul_accounts.models import AccountOrigin
from tests.chat_support import FakeMatrix, can_speak, matrix, mutual, mxid  # noqa: F401
from tests.soul_account_support import ready_soul, soul_client

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"


def _rows(client):
    response = client.get(CONVERSATIONS)
    assert response.status_code == 200, response.data
    return {row["id"]: row for row in response.data}


def _reborn(account, tenant, captured, *, name):
    """转世:停用这一世、开下一世(显示名换一个,好断言旧会话里的名字不跟着变)。"""
    from apps.reincarnation.models import Reincarnation

    with captured(execute=True):
        accounts.retire_account_for_rebirth(account.soul, account.cycle)
    Reincarnation.objects.create(soul=account.soul, cycle_count=account.cycle + 1, rebirth_form="HUMAN",
                                 target_realm="R0", tenant=tenant)
    new, created = accounts.provision_account(account.soul, AccountOrigin.OFFICER)
    assert created
    new.must_change_password = False
    new.save()
    new.user.display_name = name
    new.user.save(update_fields=["display_name"])
    return new, soul_client(new)


@pytest.fixture
def pair(cn_tenant, matrix):  # noqa: F811
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    a.user.display_name = "前世之甲"
    a.user.save(update_fields=["display_name"])
    mutual(a, b)
    opened = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json")
    assert opened.status_code == 201, opened.data
    return a, a_client, b, b_client, Conversation.objects.get(pk=opened.data["id"])


def test_a_conversation_records_which_life_each_side_was(pair):
    a, _, b, _, conversation = pair
    by_soul = {conversation.soul_a_id: conversation.account_a_id, conversation.soul_b_id: conversation.account_b_id}
    assert by_soul == {a.soul_id: a.pk, b.soul_id: b.pk}


def test_the_new_life_does_not_see_or_reach_the_old_conversation(cn_tenant, pair, django_capture_on_commit_callbacks):
    """变异:列表改回按灵魂筛(`soul_a_id=soul_id | soul_b_id=soul_id`)→ 新一世看见前世的会话,红。
    变异:发送口改回按灵魂认参与方 → 新一世对前世的会话答 409 `closed`(说出了它存在),红。"""
    a, _, _, _, old = pair
    _, new_client = _reborn(a, cn_tenant, django_capture_on_commit_callbacks, name="今生之甲")

    assert _rows(new_client) == {}
    response = new_client.post(f"{CONVERSATIONS}{old.id}/messages/", {"body": "还记得我吗"}, format="json")
    assert response.status_code == 404 and response.data["code"] == "not_found"


def test_the_one_left_keeps_the_closed_conversation_read_only_under_the_old_name(
        cn_tenant, pair, django_capture_on_commit_callbacks):
    """变异:列表里加回 `closed_at__isnull=True` → 留下的一方看不见已闭的会话,红。
    变异:`_peer` 改回取对方此刻的本世账号(`current_account_of`)→ 名字变成「今生之甲」,红。"""
    a, _, b, b_client, old = pair
    new_a, _ = _reborn(a, cn_tenant, django_capture_on_commit_callbacks, name="今生之甲")

    row = _rows(b_client)[str(old.id)]
    old.refresh_from_db()
    assert row["closed_at"] is not None and row["closed_at"] == old.closed_at.isoformat().replace("+00:00", "Z")
    assert row["refusal"] == "closed"
    assert row["peer_name"] == "前世之甲" and row["peer_user"] == a.user_id
    # 断言不在场:新一世的名字与 user_id 都不出现在这一行里。
    assert "今生之甲" not in str(row) and row["peer_user"] != new_a.user_id

    sent = b_client.post(f"{CONVERSATIONS}{old.id}/messages/", {"body": "你还在吗"}, format="json")
    assert sent.status_code == 409 and sent.data["code"] == "closed"


def test_the_new_life_chats_with_the_same_soul_in_a_new_room(cn_tenant, pair, django_capture_on_commit_callbacks):
    """两世两个会话:各自只在各自那一世的列表里。"""
    a, _, b, b_client, old = pair
    new_a, new_client = _reborn(a, cn_tenant, django_capture_on_commit_callbacks, name="今生之甲")
    opened = new_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json")
    assert opened.status_code == 201
    assert set(_rows(new_client)) == {opened.data["id"]}
    rows = _rows(b_client)
    assert set(rows) == {str(old.id), opened.data["id"]}
    assert rows[opened.data["id"]]["peer_name"] == "今生之甲" and rows[str(old.id)]["peer_name"] == "前世之甲"


# ── 关闭时降权(第 3 项)─────────────────────────────────────────────────


def test_closing_silences_the_one_left_in_the_room(cn_tenant, pair, matrix, django_capture_on_commit_callbacks):  # noqa: F811
    """转世关会话时,留下的一方在 Synapse 上降到 0 —— 不只是后端不再代发,它拿自己的 token
    直接在 Matrix 里也发不出。
    变异:删掉 `deactivate_for_account` 里的 `silence_closed(ids)` → 乙仍能在房间里说话,红。"""
    a, _, b, _, old = pair
    assert can_speak(old.room_id, mxid(b))
    with django_capture_on_commit_callbacks(execute=True):
        accounts.retire_account_for_rebirth(a.soul, a.cycle)

    assert not can_speak(old.room_id, mxid(b))
    with pytest.raises(MatrixError):
        matrix.says(old.room_id, mxid(b), "还在吗")
    old.refresh_from_db()
    assert old.silenced_at is not None


def test_a_failed_silencing_is_made_up_by_the_next_sync(cn_tenant, pair, matrix, monkeypatch,  # noqa: F811
                                                       django_capture_on_commit_callbacks):
    """关闭那一刻 Synapse 不可达:转世照常,`silenced_at` 留空;留下的一方下次打开聊天时补上。
    变异:`sync_rooms` 的筛选去掉 `silenced_at__isnull=True` 那一支 → 补不上,乙一直能说话,红。
    变异:`silence_closed` 在写失败时也记 `silenced_at` → 下次同步不再重试,红。"""
    a, _, b, b_client, old = pair

    def unreachable(self, room_id, levels):
        raise MatrixError("Synapse 无法访问:ConnectionError")

    with monkeypatch.context() as patched:
        patched.setattr(FakeMatrix, "set_user_levels", unreachable)
        with django_capture_on_commit_callbacks(execute=True):
            accounts.retire_account_for_rebirth(a.soul, a.cycle)
    old.refresh_from_db()
    assert old.closed_at is not None and old.silenced_at is None
    assert can_speak(old.room_id, mxid(b))

    assert b_client.get("/api/v1/me/chat/session/").status_code == 200
    assert not can_speak(old.room_id, mxid(b))
    old.refresh_from_db()
    assert old.silenced_at is not None
    writes = matrix.rooms[old.room_id]["level_writes"]
    assert b_client.get("/api/v1/me/chat/session/").status_code == 200
    assert matrix.rooms[old.room_id]["level_writes"] == writes  # 补上之后不再每次重写


def test_closing_an_inbox_needs_no_silencing(cn_tenant, matrix, django_capture_on_commit_callbacks):  # noqa: F811
    """收件箱里只有灵魂自己(官员一侧是服务账号):它停用了,房间里没有要降的人。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    inbox = a_client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json").data
    with django_capture_on_commit_callbacks(execute=True):
        accounts.retire_account_for_rebirth(a.soul, a.cycle)
    row = Conversation.objects.get(pk=inbox["id"])
    assert row.kind == ConversationKind.OFFICER_INBOX and row.closed_at and row.silenced_at
    assert matrix.rooms[row.room_id]["level_writes"] == 0


# ── 存量迁移 ─────────────────────────────────────────────────────────────


def test_the_backfill_picks_the_life_that_was_live_when_the_room_was_made(
        cn_tenant, pair, django_capture_on_commit_callbacks):
    """chat/0003 的取法:建房时刻之前最后建的那个账号。对方已转世、有了新一世之后再补,
    前世的会话仍补成前世的账号。
    变异:`_account_at` 去掉 `created_at__lte=moment`(取最新的账号)→ 补成新一世,红。"""
    import importlib

    from django.apps import apps as live_apps

    backfill = importlib.import_module("apps.chat.migrations.0003_backfill_conversation_accounts").backfill
    a, _, b, _, old = pair
    new_a, new_client = _reborn(a, cn_tenant, django_capture_on_commit_callbacks, name="今生之甲")
    new_room = new_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data["id"]
    Conversation.objects.update(account_a=None, account_b=None)

    backfill(live_apps, None)
    backfill(live_apps, None)  # 幂等

    def lives(pk):
        row = Conversation.objects.get(pk=pk)
        return {row.soul_a_id: row.account_a_id, row.soul_b_id: row.account_b_id}

    assert lives(old.pk) == {a.soul_id: a.pk, b.soul_id: b.pk}
    assert lives(new_room) == {a.soul_id: new_a.pk, b.soul_id: b.pk}
