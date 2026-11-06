"""2026-11-01 审查里书信后端的五条(B1–B5),加 2026-11-02 用户定的两条回信规则。

B1 响应丢了的那一发:Synapse 已经存下、我们没收到响应,重试不能变成第二封,也不能多出一次 24 小时额度。
   `FakeMatrix` 按(房间、发送者、事务号)去重,与真 Synapse 同一条(`test_chat_synapse_integration.py` 对真服务钉住)。
B2「待回复」只有一个定义;灵魂调走之后不算,也不推送。
B3 不再够格的经办人按未指派算。
B4 账号注销时关会话在注销的事务里。
B5 发言权的写入在会话行锁下串行、重读事实,定时任务兜底。
"""
import threading
import time
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.db import connection, transaction
from django.utils import timezone

from apps.authentication.models import User
from apps.chat import inbox, services, tasks
from apps.chat.matrix import MatrixError
from apps.chat.models import ChatImage, Conversation, ConversationKind, InboxOfficerState
from apps.officer_app import todo
from apps.soul_accounts import services as accounts
from apps.souls.models import Soul
from apps.tenants.overview import hall_row
from tests.chat_support import FakeMatrix, can_speak, follow, matrix, mutual, mxid  # noqa: F401
from tests.soul_account_support import dead_soul, officer_client, ready_soul

SQLITE = connection.vendor == "sqlite"

CONVERSATIONS = "/api/v1/me/chat/conversations/"
INBOX = "/api/v1/chat/inbox/"


@pytest.fixture(autouse=True)
def _quiet_cache():
    cache.clear()
    yield
    cache.clear()


def _officer(tenant, username, role="ADMIN", display_name=""):
    return User.objects.create_user(username=username, password="x", role=role, tenant=tenant,
                                    display_name=display_name)


def _letter(tenant, name="甲", **fields):
    now = timezone.now()
    return Conversation.objects.create(
        kind=ConversationKind.OFFICER_INBOX, room_id=f"!{name}:x", soul_a=dead_soul(tenant, name=name), tenant=tenant,
        last_from="soul", last_soul_message_at=now, last_message_at=now, **fields,
    )


def _ids(api, **params):
    response = api.get(INBOX, params)
    assert response.status_code == 200, response.data
    return {r["id"] for r in response.data["results"]}


def _strangers(tenant):
    a, a_client = ready_soul(tenant, name="甲")
    b, b_client = ready_soul(tenant, name="乙")
    follow(a, b)
    opened = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json")
    assert opened.status_code == 201 and opened.data["throttled"] is True, opened.data
    return a, a_client, b, b_client, opened.data["id"]


def _friends(tenant):
    a, a_client = ready_soul(tenant, name="甲")
    b, b_client = ready_soul(tenant, name="乙")
    mutual(a, b)
    opened = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json")
    assert opened.status_code == 201, opened.data
    return a, a_client, b, b_client, opened.data["id"]


def _hall(client):
    opened = client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json")
    assert opened.status_code in (200, 201), opened.data
    return opened.data["id"]


def _say(client, cid, body="打扰", **extra):
    return client.post(f"{CONVERSATIONS}{cid}/messages/", {"body": body, **extra}, format="json")


def _bodies():
    return [m["body"] for _, m in FakeMatrix.sent]


def _response_lost(monkeypatch):
    """下一发:Synapse 存下了,响应在路上丢了(`SynapseClient._request` 把 RequestException 翻成的就是这个)。"""
    real = FakeMatrix.send_message
    lost = []

    def send(self, *args, **kwargs):
        event_id = real(self, *args, **kwargs)
        if not lost:
            lost.append(event_id)
            raise MatrixError("Synapse 无法访问:ReadTimeout")
        return event_id

    monkeypatch.setattr(FakeMatrix, "send_message", send)
    return lost


# ── B1:响应丢了 ─────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_a_request_whose_response_was_lost_is_one_letter_and_one_quota(cn_tenant, matrix, monkeypatch):  # noqa: F811
    """没有 txn_id 也一样:被节流的房间里事务号按「这一次等待」算。
    变异:`_send_request` 不传 `txn_id` → 第二次重试存下第二封,红。"""
    _, a_client, _, _, cid = _strangers(cn_tenant)
    lost = _response_lost(monkeypatch)

    assert _say(a_client, cid).status_code == 503
    assert Conversation.objects.get(pk=cid).last_request_at is None  # 随异常回滚:这就是重试能进来的原因

    again = _say(a_client, cid, "换句话再试")
    assert again.status_code == 201, again.data
    assert again.data["event_id"] == lost[0]
    assert _bodies() == ["打扰"]  # 只有第一封,「换句话」那封不在
    assert Conversation.objects.get(pk=cid).last_request_at is not None

    third = _say(a_client, cid, "第三次")
    assert third.status_code == 429 and third.data["code"] == "request_throttled"
    assert _bodies() == ["打扰"]


@pytest.mark.django_db
def test_the_next_wait_is_a_new_letter(cn_tenant, matrix):  # noqa: F811
    """反面:事务号不能把下一次等待也吞掉。变异:事务号写死成不含 `last_request_at` → 第二天那封回第一封的 id,红。"""
    _, a_client, _, _, cid = _strangers(cn_tenant)
    first = _say(a_client, cid, "今天")
    Conversation.objects.filter(pk=cid).update(last_request_at=timezone.now() - timedelta(hours=24, seconds=1))
    second = _say(a_client, cid, "第二天")
    assert second.status_code == 201 and second.data["event_id"] != first.data["event_id"]
    assert _bodies() == ["今天", "第二天"]


@pytest.mark.django_db
def test_a_direct_message_retried_with_its_txn_id_is_one_letter(cn_tenant, matrix, monkeypatch):  # noqa: F811
    """变异:`send_direct_message` 不传 `txn_id` → 红。"""
    _, a_client, _, _, cid = _friends(cn_tenant)
    lost = _response_lost(monkeypatch)
    assert _say(a_client, cid, "在吗", txn_id="t1").status_code == 503
    again = _say(a_client, cid, "在吗", txn_id="t1")
    assert again.status_code == 201 and again.data["event_id"] == lost[0]
    assert _bodies() == ["在吗"]
    # 另一个号是另一封。
    assert _say(a_client, cid, "在吗", txn_id="t2").data["event_id"] != lost[0]
    assert _bodies() == ["在吗", "在吗"]


@pytest.mark.django_db
def test_a_hall_letter_retried_with_its_txn_id_is_one_letter(cn_tenant, matrix, monkeypatch):  # noqa: F811
    """变异:`send_inbox_message` 不传 `txn_id` → 红。"""
    _, client = ready_soul(cn_tenant, name="甲")
    cid = _hall(client)
    lost = _response_lost(monkeypatch)
    assert _say(client, cid, "阎王在上", txn_id="t1").status_code == 503
    again = _say(client, cid, "阎王在上", txn_id="t1")
    assert again.status_code == 201 and again.data["event_id"] == lost[0]
    assert _bodies() == ["阎王在上"]
    assert Conversation.objects.get(pk=cid).last_from == "soul"  # 第一次没写成的,重试写上


@pytest.mark.django_db
def test_an_officer_reply_retried_with_its_txn_id_is_one_letter(cn_tenant, matrix, monkeypatch):  # noqa: F811
    """变异:`officer_reply` 不传 `txn_id` → 红。两位官员碰巧同号是两封:变异:key 不含官员 → 红。"""
    _, client = ready_soul(cn_tenant, name="甲")
    cid = _hall(client)
    one, two = officer_client(_officer(cn_tenant, "cui")), officer_client(_officer(cn_tenant, "zhong"))
    url = f"{INBOX}{cid}/reply/"
    lost = _response_lost(monkeypatch)
    assert one.post(url, {"body": "已收", "txn_id": "same"}, format="json").status_code == 503
    again = one.post(url, {"body": "已收", "txn_id": "same"}, format="json")
    assert again.status_code == 201 and again.data["event_id"] == lost[0]
    assert _bodies() == ["已收"]
    other = two.post(url, {"body": "乙答", "txn_id": "same"}, format="json")
    assert other.status_code == 201 and other.data["event_id"] != lost[0]
    assert _bodies() == ["已收", "乙答"]


@pytest.mark.django_db
def test_an_image_retried_after_a_lost_response_is_one_letter(cn_tenant, matrix, monkeypatch, settings, tmp_path):  # noqa: F811
    """图片的事务号按图,不需要客户端给号。变异:`_send_txn` 去掉 image 那一支 → 重试存下第二封,红。"""
    from tests.test_chat_images import uploaded

    settings.MEDIA_ROOT = str(tmp_path / "media")
    _, a_client, _, _, cid = _friends(cn_tenant)
    image_id = uploaded(a_client, cid)["id"]
    lost = _response_lost(monkeypatch)
    url = f"/api/v1/me/chat/images/{image_id}/send/"
    assert a_client.post(url).status_code == 503
    assert ChatImage.objects.get(pk=image_id).sent_at is None
    again = a_client.post(url)
    assert again.status_code == 201 and again.data["event_id"] == lost[0]
    assert ChatImage.objects.get(pk=image_id).event_id == lost[0]
    assert _bodies() == [services.IMAGE_LABEL]


def test_the_real_client_puts_the_given_txn_in_the_path_and_a_fresh_one_otherwise(settings):
    """测真客户端(只换 HTTP 那一层)。变异:`send_message` 忽略 `txn_id` → 路径里没有它,红。"""
    from apps.chat.matrix import SynapseClient

    settings.MATRIX_INTERNAL_URL = "http://synapse.invalid"
    settings.MATRIX_PUBLIC_BASEURL = "https://matrix.invalid/"
    settings.MATRIX_SERVER_NAME = "x"
    settings.MATRIX_JWT_SECRET = "jwt-secret-for-tests-0123456789abcdef"
    settings.MATRIX_REGISTRATION_SHARED_SECRET = "s"
    settings.MATRIX_USER_SALT = "salt"
    client = SynapseClient()
    paths = []
    client._token_for = lambda localpart: "token"
    client._request = lambda method, path, **kw: paths.append(path) or {"event_id": "$e"}
    client.send_message("!r:x", "hi", as_localpart="a", txn_id="abc")
    client.send_message("!r:x", "hi", as_localpart="a")
    client.send_message("!r:x", "hi", as_localpart="a")
    assert paths[0].endswith("/send/m.room.message/abc")
    assert len(set(paths)) == 3


# ── B2:「待回复」一个定义 ───────────────────────────────────────────────


@pytest.mark.django_db
def test_a_moved_souls_letter_is_not_awaiting_anywhere(cn_tenant, eu_tenant):
    """变异:`overview.py` 退回不看灵魂此刻所在 → 调走后仍是 1,红。"""
    letter = _letter(cn_tenant)
    assert hall_row(cn_tenant)["todo"]["letters_awaiting"] == 1
    Soul.objects.filter(pk=letter.soul_a_id).update(tenant=eu_tenant)
    assert hall_row(cn_tenant)["todo"]["letters_awaiting"] == 0
    assert hall_row(eu_tenant)["todo"]["letters_awaiting"] == 0  # 也不算到新殿头上:信是写给原殿司的


@pytest.mark.django_db
def test_the_query_and_the_row_answer_awaiting_the_same(cn_tenant, eu_tenant):
    """同一个问题的两种问法逐格对照。变异:任一边少一个条件 → 红。"""
    now = timezone.now()
    grid = [
        _letter(cn_tenant, "在等"),
        _letter(cn_tenant, "已回"),
        _letter(cn_tenant, "已关", closed_at=now),
        _letter(cn_tenant, "调走"),
        _letter(cn_tenant, "空信"),
    ]
    Conversation.objects.filter(room_id="!已回:x").update(last_from="hall")
    Conversation.objects.filter(room_id="!空信:x").update(last_from="")
    Soul.objects.filter(pk=grid[3].soul_a_id).update(tenant=eu_tenant)
    matched = set(Conversation.objects.filter(inbox.AWAITING_REPLY).values_list("room_id", flat=True))
    assert matched == {"!在等:x"}
    for row in Conversation.objects.select_related("soul_a"):
        assert inbox.awaiting_reply(row) is (row.room_id in matched), row.room_id


@pytest.fixture
def pushed(monkeypatch):
    calls = []
    monkeypatch.setattr("apps.officer_app.push.notify_users", lambda users, target=None: calls.append(list(users)))
    return calls


@pytest.mark.django_db
def test_a_moved_souls_letter_pushes_nobody(cn_tenant, eu_tenant, pushed):
    """变异:`push_to_assignee` 不看 `awaiting_reply` → 红。"""
    officer = _officer(cn_tenant, "cui")
    letter = _letter(cn_tenant, assignee=officer)
    inbox.push_to_assignee(letter, force=True)
    assert pushed == [[officer]]

    pushed.clear()
    Soul.objects.filter(pk=letter.soul_a_id).update(tenant=eu_tenant)
    inbox.push_to_assignee(Conversation.objects.get(pk=letter.pk), force=True)
    assert pushed == []


# ── B3:不再够格的经办人 ─────────────────────────────────────────────────


def _unqualify(how, officer, other_tenant):
    fields = {"inactive": {"is_active": False}, "no_reply": {"role": "VIEWER"}, "moved": {"tenant": other_tenant}}[how]
    User.objects.filter(pk=officer.pk).update(**fields)


UNQUALIFIED = ["inactive", "no_reply", "moved"]


@pytest.mark.django_db
@pytest.mark.parametrize("how", UNQUALIFIED)
def test_a_letter_held_by_an_unqualified_officer_is_in_the_unassigned_pool(cn_tenant, eu_tenant, how):
    """变异:`_letters` 退回 `assignee__isnull=True` → 红。"""
    me = _officer(cn_tenant, "cui")
    held = _officer(cn_tenant, "zhong")
    letter = _letter(cn_tenant, assignee=held)
    assert todo.build(me)["unassigned_letters"]["count"] == 0  # 他还够格:不在池里

    _unqualify(how, held, eu_tenant)
    group = todo.build(me)["unassigned_letters"]
    assert [i["target"]["id"] for i in group["items"]] == [str(letter.pk)]
    assert Conversation.objects.get(pk=letter.pk).assignee_id == held.pk  # 读时判断,库里不动


@pytest.mark.django_db
@pytest.mark.parametrize("how", UNQUALIFIED)
def test_an_unqualified_officer_gets_no_push(cn_tenant, eu_tenant, pushed, how):
    """变异:`push_to_assignee` 直接用 `conversation.assignee` → 红。"""
    held = _officer(cn_tenant, "zhong")
    letter = _letter(cn_tenant, assignee=held)
    inbox.push_to_assignee(letter, force=True)
    assert pushed == [[held]]

    pushed.clear()
    _unqualify(how, held, eu_tenant)
    inbox.push_to_assignee(Conversation.objects.get(pk=letter.pk), force=True)
    assert pushed == []


@pytest.mark.django_db
def test_the_inbox_shows_an_unqualified_assignee_as_nobody(cn_tenant, eu_tenant):
    """变异:去掉 `OfficerInboxSerializer.to_representation` → assignee 仍是他,红。"""
    me = _officer(cn_tenant, "cui")
    held = _officer(cn_tenant, "zhong", display_name="钟馗")
    letter = _letter(cn_tenant, assignee=held, assigned_at=timezone.now())
    url = f"{INBOX}{letter.pk}/"
    api = officer_client(me)
    data = api.get(url).data
    assert data["assignee"] == {"user_id": held.pk, "display_name": "钟馗"} and data["assigned_at"] is not None

    _unqualify("inactive", held, eu_tenant)
    data = api.get(url).data
    assert data["assignee"] is None and data["assigned_at"] is None


@pytest.mark.django_db
def test_assigned_to_me_is_empty_once_i_cannot_reply(cn_tenant):
    """变异:`annotate_for` 不问自己的权限 → 仍在「交给我的」,红。"""
    held = _officer(cn_tenant, "zhong")
    letter = _letter(cn_tenant, assignee=held)
    assert _ids(officer_client(held), folder="assigned_to_me") == {str(letter.pk)}
    _letter(cn_tenant, "没人经办")
    User.objects.filter(pk=held.pk).update(role="VIEWER")
    # 现成的角色里读与回是一起给的,只读靠单独授予:这里直接问查询,不经路由权限。
    rows = inbox.annotate_for(Conversation.objects.all(), User.objects.get(pk=held.pk))
    assert not rows.filter(inbox.folder_q("assigned_to_me")).exists()  # 也没把没人经办的那封算成他的


# ── B4:注销时关会话 ─────────────────────────────────────────────────────


@pytest.mark.django_db
def test_conversations_close_in_the_retiring_transaction(cn_tenant, matrix, monkeypatch,  # noqa: F811
                                                         django_capture_on_commit_callbacks):
    """提交之前就关了;Synapse 那一半提交之后才入队。变异:关会话挪回 on_commit → with 里那条断言红。"""
    a, _, _, _, cid = _friends(cn_tenant)
    queued = []
    monkeypatch.setattr(tasks.deactivate_matrix_task, "delay", lambda *args: queued.append(args))
    with django_capture_on_commit_callbacks(execute=True):
        accounts.retire_account_for_rebirth(a.soul, a.cycle)
        assert Conversation.objects.get(pk=cid).closed_at is not None
        assert queued == []
    assert queued == [(a.pk, [Conversation.objects.get(pk=cid).pk])]


@pytest.mark.django_db
def test_a_rolled_back_retirement_closes_nothing_and_touches_no_matrix_user(cn_tenant, matrix,  # noqa: F811
                                                                            django_capture_on_commit_callbacks):
    a, _, _, _, cid = _friends(cn_tenant)

    class RollbackError(Exception):
        pass

    with django_capture_on_commit_callbacks(execute=True), pytest.raises(RollbackError), transaction.atomic():
        accounts.retire_account_for_rebirth(a.soul, a.cycle)
        raise RollbackError
    assert Conversation.objects.get(pk=cid).closed_at is None
    assert not [c for c in matrix.calls if c[0] == "deactivate_user"]


@pytest.mark.django_db
def test_a_failed_enqueue_leaves_the_conversations_closed(cn_tenant, matrix, monkeypatch,  # noqa: F811
                                                          django_capture_on_commit_callbacks):
    """注销不被 Synapse 那一半拖累。留下的一方由 `sync_rooms` 补降权(`silenced_at` 仍为空)。"""
    a, _, _, _, cid = _friends(cn_tenant)

    def broken(*args):
        raise ConnectionError("broker down")

    monkeypatch.setattr(tasks.deactivate_matrix_task, "delay", broken)
    with django_capture_on_commit_callbacks(execute=True):
        accounts.retire_account_for_rebirth(a.soul, a.cycle)
    row = Conversation.objects.get(pk=cid)
    assert row.closed_at is not None and row.silenced_at is None


# ── B5:发言权串行与兜底 ─────────────────────────────────────────────────


@pytest.mark.django_db
def test_a_sync_reads_the_facts_again_under_the_lock(cn_tenant, matrix):  # noqa: F811
    """手里是旧副本,行已经关了:写进 Synapse 的要是此刻的事实。变异:`sync_levels` 用传进来的对象算 → 红。"""
    _, _, b, _, cid = _friends(cn_tenant)
    stale = Conversation.objects.get(pk=cid)
    Conversation.objects.filter(pk=cid).update(closed_at=timezone.now())
    assert stale.closed_at is None
    locked = services.sync_levels(stale)
    assert locked.closed_at is not None
    assert not can_speak(stale.room_id, mxid(b))


@pytest.mark.skipif(SQLITE, reason="select_for_update 在 SQLite 上不排队;串行版 test_a_sync_reads_the_facts_again_under_the_lock")
@pytest.mark.django_db(transaction=True)
def test_two_syncs_of_one_room_write_levels_one_at_a_time(cn_tenant, matrix, monkeypatch):  # noqa: F811
    """变异:`sync_levels` 去掉行锁 → 两个线程同时在 `set_user_levels` 里,peak 是 2,红。"""
    _, _, _, _, cid = _friends(cn_tenant)
    real = FakeMatrix.set_user_levels
    guard = threading.Lock()
    inside, peak, errors = [0], [0], []

    def slow(self, room_id, levels):
        with guard:
            inside[0] += 1
            peak[0] = max(peak[0], inside[0])
        time.sleep(0.3)
        with guard:
            inside[0] -= 1
        return real(self, room_id, levels)

    monkeypatch.setattr(FakeMatrix, "set_user_levels", slow)

    def run():
        try:
            services.sync_levels(Conversation.objects.get(pk=cid))
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            connection.close()

    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    assert peak[0] == 1


def _mute_with_a_dead_queue(user, tenant, monkeypatch, capture):
    from apps.social import moderation

    def broken(*args):
        raise ConnectionError("broker down")

    with monkeypatch.context() as patched:
        patched.setattr(tasks.sync_rooms_task, "delay", broken)
        with capture(execute=True):
            moderation.mute_user(user, tenant, 3, actor=None)


@pytest.mark.django_db
def test_the_daily_sync_makes_up_a_mute_whose_enqueue_failed(cn_tenant, matrix, monkeypatch,  # noqa: F811
                                                             django_capture_on_commit_callbacks):
    """入队失败只记日志;这一条就是「下一次」不必等当事人打开聊天。变异:`sync_all_rooms` 什么也不做 → 甲仍能说话,红。"""
    a, _, _, _, cid = _friends(cn_tenant)
    room = Conversation.objects.get(pk=cid).room_id
    _mute_with_a_dead_queue(a.user, cn_tenant, monkeypatch, django_capture_on_commit_callbacks)
    assert can_speak(room, mxid(a))  # 没同步到

    assert services.sync_all_rooms(FakeMatrix()) == (1, {})
    assert not can_speak(room, mxid(a))


@pytest.mark.django_db
def test_the_daily_sync_marks_a_closed_room_silenced_and_skips_a_finished_one(cn_tenant, matrix):  # noqa: F811
    """变异:`_sync_room` 不记 `silenced_at` → 红。已关且已降权的不再问 Synapse:变异:去掉筛选 → done 是 2,红。"""
    _, _, b, _, cid = _friends(cn_tenant)
    Conversation.objects.filter(pk=cid).update(closed_at=timezone.now())
    assert services.sync_all_rooms(FakeMatrix()) == (1, {})
    assert Conversation.objects.get(pk=cid).silenced_at is not None
    assert not can_speak(Conversation.objects.get(pk=cid).room_id, mxid(b))
    assert services.sync_all_rooms(FakeMatrix()) == (0, {})


@pytest.mark.django_db
def test_one_unreachable_room_does_not_stop_the_daily_sync(cn_tenant, matrix, monkeypatch):  # noqa: F811
    a, a_client, _, _, cid = _friends(cn_tenant)
    c, _ = ready_soul(cn_tenant, name="丙")
    mutual(a, c)
    assert a_client.post(CONVERSATIONS, {"target_user": c.user_id}, format="json").status_code == 201
    bad = Conversation.objects.get(pk=cid).room_id
    real = FakeMatrix.set_user_levels

    def flaky(self, room_id, levels):
        if room_id == bad:
            raise MatrixError("nope")
        return real(self, room_id, levels)

    monkeypatch.setattr(FakeMatrix, "set_user_levels", flaky)
    done, failed = services.sync_all_rooms(FakeMatrix())
    assert done == 1 and set(failed) == {bad}


def _scheduled_run(task_id):
    from apps.scheduler.models import TaskRun
    from apps.scheduler.services import sync_schedules

    sync_schedules()
    result = tasks.sync_all_rooms.apply(task_id=task_id, throw=False)
    return result, TaskRun.objects.select_related("job").get(celery_task_id=task_id)


@pytest.mark.django_db
def test_the_scheduled_sync_records_success_and_failure(cn_tenant, matrix, monkeypatch):  # noqa: F811
    _friends(cn_tenant)
    result, run = _scheduled_run("chat-sync-ok")
    assert result.get() == {"synced": 1} and run.status == "SUCCESS"

    def down(self, room_id, levels):
        raise MatrixError("nope")

    monkeypatch.setattr(FakeMatrix, "set_user_levels", down)
    _, run = _scheduled_run("chat-sync-bad")
    assert run.status == "FAILURE"


@pytest.mark.django_db
def test_the_scheduled_sync_skips_quietly_without_chat(settings):
    settings.MATRIX_ENABLED = False
    result, run = _scheduled_run("chat-sync-off")
    assert result.get() == {"skipped": "chat_not_configured"} and run.status == "SUCCESS"


# ── 回信规则(2026-11-02 用户定)────────────────────────────────────────


@pytest.fixture
def hall(cn_tenant, matrix):  # noqa: F811
    class Hall:
        pass

    h = Hall()
    _, soul = ready_soul(cn_tenant, name="甲")
    h.cid = _hall(soul)
    assert _say(soul, h.cid, "阎王在上").status_code == 201
    h.url = f"{INBOX}{h.cid}/reply/"
    h.me = _officer(cn_tenant, "cui", display_name="崔珏")
    h.colleague = _officer(cn_tenant, "zhong", display_name="钟馗")
    h.api = officer_client(h.me)
    h.colleague_api = officer_client(h.colleague)
    return h


def _assign_to(h, user):
    Conversation.objects.filter(pk=h.cid).update(assignee=user, assigned_at=timezone.now())


@pytest.mark.django_db
def test_a_letter_assigned_to_a_colleague_cannot_be_answered(hall):
    """变异:`officer_reply` 删掉 `assigned_to_other` → 201,红。"""
    _assign_to(hall, hall.colleague)
    refused = hall.api.post(hall.url, {"body": "我来"}, format="json")
    assert refused.status_code == 409
    assert refused.data["code"] == "assigned_to_other" and refused.data["assignee_name"] == "钟馗"
    assert "我来" not in _bodies()
    assert Conversation.objects.get(pk=hall.cid).last_from == "soul"

    # 转给自己之后可以。
    assert hall.api.post(f"{INBOX}{hall.cid}/assign/", {"user_id": hall.me.pk}, format="json").status_code == 200
    assert hall.api.post(hall.url, {"body": "我来"}, format="json").status_code == 201
    assert "我来" in _bodies()


@pytest.mark.django_db
def test_the_assignee_can_answer_and_stays_the_assignee(hall):
    _assign_to(hall, hall.me)
    assert hall.api.post(hall.url, {"body": "已收"}, format="json").status_code == 201
    assert Conversation.objects.get(pk=hall.cid).assignee_id == hall.me.pk


@pytest.mark.django_db
def test_an_unassigned_letter_can_be_answered_and_is_not_assigned_by_it(hall):
    assert hall.api.post(hall.url, {"body": "已收"}, format="json").status_code == 201
    assert Conversation.objects.get(pk=hall.cid).assignee_id is None


@pytest.mark.django_db
def test_an_admin_gets_no_exception(hall, cn_tenant):
    """变异:按 role 放行 ADMIN → 201,红。"""
    _assign_to(hall, hall.colleague)
    admin = officer_client(_officer(cn_tenant, "boss", role="ADMIN"))
    refused = admin.post(hall.url, {"body": "我来"}, format="json")
    assert refused.status_code == 409 and refused.data["code"] == "assigned_to_other"


@pytest.mark.django_db
def test_an_unqualified_assignee_does_not_hold_the_letter(hall):
    """变异:判断用 `conversation.assignee` 而不是 `live_assignee` → 停用的人挡住所有人,红。"""
    _assign_to(hall, hall.colleague)
    User.objects.filter(pk=hall.colleague.pk).update(is_active=False)
    assert hall.api.post(hall.url, {"body": "我来"}, format="json").status_code == 201


@pytest.mark.django_db
def test_replying_takes_it_out_of_my_archive_only(hall):
    """变异:`after_reply` 不清 `archived_at` → 仍在我的归档里,红;清成所有人的 → 同僚那条红。"""
    assert hall.api.post(f"{INBOX}{hall.cid}/archive/").status_code == 200
    assert hall.colleague_api.post(f"{INBOX}{hall.cid}/archive/").status_code == 200
    assert hall.cid in _ids(hall.api, folder="archived")

    assert hall.api.post(hall.url, {"body": "已收"}, format="json").status_code == 201

    assert hall.cid not in _ids(hall.api, folder="archived") and hall.cid in _ids(hall.api)
    assert hall.cid in _ids(hall.colleague_api, folder="archived")


@pytest.mark.django_db
def test_a_refused_reply_keeps_the_letter_archived(hall):
    assert hall.api.post(f"{INBOX}{hall.cid}/archive/").status_code == 200
    _assign_to(hall, hall.colleague)
    assert hall.api.post(hall.url, {"body": "我来"}, format="json").status_code == 409
    state = InboxOfficerState.objects.get(conversation_id=hall.cid, user=hall.me)
    assert state.archived_at is not None


@pytest.mark.django_db
def test_a_reply_that_never_got_through_keeps_the_letter_archived(hall, monkeypatch):
    def down(self, *args, **kwargs):
        raise MatrixError("Synapse 无法访问")

    assert hall.api.post(f"{INBOX}{hall.cid}/archive/").status_code == 200
    monkeypatch.setattr(FakeMatrix, "send_message", down)
    assert hall.api.post(hall.url, {"body": "已收"}, format="json").status_code == 503
    assert hall.cid in _ids(hall.api, folder="archived")
