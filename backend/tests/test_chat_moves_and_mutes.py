"""聊天跟着别处的事实变:朋友圈禁言、调拨与回归、转世。

发言权的唯一出处是 `services._speaking_levels`;这些测试从**真实的写路径**触发
(`apps/social/moderation.py` 的禁言 / 解禁、`DispatchService.execute` / `end_residence`、
`retire_account_for_rebirth`),断言 Synapse 那一侧的房间变成了什么样。
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.chat.matrix import MatrixError
from apps.chat.models import Conversation, ConversationKind
from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.social import moderation
from apps.social.models import SocialMute
from tests.chat_support import can_speak, matrix, mutual, mxid  # noqa: F401
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"


def _open(client, target):
    return client.post(CONVERSATIONS, {"target_user": target.user_id}, format="json")


def _send(client, conversation_id, body="你好"):
    return client.post(f"{CONVERSATIONS}{conversation_id}/messages/", {"body": body}, format="json")


@pytest.fixture
def pair(cn_tenant, matrix):  # noqa: F811
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    mutual(a, b)
    assert _open(a_client, b).status_code == 201
    return a, a_client, b, b_client, Conversation.objects.get(kind=ConversationKind.DIRECT)


# ── 禁言 ─────────────────────────────────────────────────────────────────


def test_a_mute_silences_the_soul_in_every_direct_room_and_lifting_restores_it(
        cn_tenant, pair, matrix, django_capture_on_commit_callbacks):  # noqa: F811
    """变异:删掉 `apps/chat/signals.py` 的 `_mute_changed` → 禁言后仍能在 Matrix 里说话,红。
    变异:删掉 `refusal` 里的 `active_mute` 判定 → 同上,红。"""
    a, a_client, b, _, conversation = pair
    with django_capture_on_commit_callbacks(execute=True):
        mute = moderation.mute_user(a.user, cn_tenant, 3, actor=None)
    assert not can_speak(conversation.room_id, mxid(a))
    assert can_speak(conversation.room_id, mxid(b))  # 只禁被禁言的那一个
    with pytest.raises(MatrixError):
        matrix.says(conversation.room_id, mxid(a), "禁言中")

    # 后端那条路也关着;新私聊也开不了。
    response = _send(a_client, conversation.id)
    assert response.status_code == 403 and response.data["code"] == "muted"
    c, _ = ready_soul(cn_tenant, name="丙")
    assert _open(a_client, c).status_code == 403

    with django_capture_on_commit_callbacks(execute=True):
        moderation.lift_mute(mute, actor=None)
    assert can_speak(conversation.room_id, mxid(a))


def test_an_expired_mute_lifts_the_next_time_the_soul_opens_chat(cn_tenant, pair, django_capture_on_commit_callbacks):
    """禁言到期没有事件;灵魂下一次取聊天会话时生效。
    变异:删掉 `chat_session` 里的 `sync_rooms` → 到期后仍说不了话,红。"""
    a, a_client, _, _, conversation = pair
    with django_capture_on_commit_callbacks(execute=True):
        moderation.mute_user(a.user, cn_tenant, 1, actor=None)
    assert not can_speak(conversation.room_id, mxid(a))
    SocialMute.objects.update(until=timezone.now() - timedelta(seconds=1))  # 到期,不经任何写路径

    assert a_client.get("/api/v1/me/chat/session/").status_code == 200
    assert can_speak(conversation.room_id, mxid(a))


def test_a_muted_soul_can_still_write_to_its_hall(cn_tenant, pair, django_capture_on_commit_callbacks):
    """禁言管的是灵魂之间;给殿司写信(申诉)不受影响。见报告「待拍板」。"""
    a, a_client, _, _, _ = pair
    with django_capture_on_commit_callbacks(execute=True):
        moderation.mute_user(a.user, cn_tenant, 3, actor=None)
    inbox = a_client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json")
    assert inbox.status_code == 201
    assert _send(a_client, inbox.data["id"], "我要申诉禁言").status_code == 201


def test_unchanged_levels_are_not_rewritten(synapse_settings):
    """每写一次 power level 就是双方时间线上的一条状态事件。没变就不写。测的是真客户端
    `SynapseClient.set_user_levels`(只把 HTTP 那一层换掉),不是替身里那份同样的判断。
    变异:去掉「没变就返回」→ 第一次调用也 PUT,红。"""
    from apps.chat.matrix import SynapseClient

    state = {"users": {"@a:x": 50, "@s:x": 100}, "users_default": 0, "events_default": 50}
    calls = []

    def fake_admin(method, path, **kwargs):
        calls.append(method)
        return {**state, "users": dict(state["users"])} if method == "GET" else {}

    client = SynapseClient()
    client._admin = fake_admin
    assert client.set_user_levels("!r:x", {"@a:x": 50}) is False
    assert calls == ["GET"]
    assert client.set_user_levels("!r:x", {"@a:x": 0}) is True
    assert calls == ["GET", "GET", "PUT"]


@pytest.fixture
def synapse_settings(settings):
    settings.MATRIX_INTERNAL_URL = "http://synapse.invalid"
    settings.MATRIX_PUBLIC_BASEURL = "https://matrix.invalid/"
    settings.MATRIX_SERVER_NAME = "x"
    settings.MATRIX_JWT_SECRET = "jwt-secret-for-tests-0123456789abcdef"
    settings.MATRIX_REGISTRATION_SHARED_SECRET = "s"
    settings.MATRIX_USER_SALT = "salt"
    return settings


# ── 调拨与回归 ───────────────────────────────────────────────────────────


def _dispatch(soul, home, away):
    record = DispatchRecord.objects.create(
        source_tenant=home, target_tenant=away, soul=soul, status=DispatchStatus.APPROVED,
        reason="受罚", tenant=home)
    DispatchService.execute(record, "executor")


def test_a_residing_soul_chats_with_both_its_home_and_its_residence(
        cn_tenant, eu_tenant, pair, django_capture_on_commit_callbacks):
    """暂居(2026-09-19 用户决定):与原属文明、暂居地文明的灵魂都能私聊,两者都不是的不能;
    回归后只剩原属文明,暂居期间开的暂居地私聊冻结(双方 0 级)。
    变异:`_civilizations` 只返回 `soul.tenant_id` → 调拨后与原属文明的乙说不了话,红。
    变异:`_civilizations` 只返回 `soul.home_tenant_id` → 暂居时找不到暂居地的丙(404),红。
    变异:删掉 `apps/chat/signals.py` 的 `_soul_moved` → 回归后与丙的房间仍能说话,红。"""
    from apps.tenants.models import Tenant

    eg_tenant = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "EG"})[0]
    a, a_client, b, b_client, with_b = pair  # 甲乙都原属中国,互关
    c, _ = ready_soul(eu_tenant, name="Clara")
    d, _ = ready_soul(eg_tenant, name="Djed")
    with django_capture_on_commit_callbacks(execute=True):
        _dispatch(a.soul, cn_tenant, eu_tenant)

    # 与原属文明的乙:照旧,互关仍算(关注边记在中国,是两人共同的可聊文明)。
    assert can_speak(with_b.room_id, mxid(a)) and can_speak(with_b.room_id, mxid(b))
    assert _send(a_client, with_b.id).status_code == 201
    assert _send(b_client, with_b.id).status_code == 201
    # 与暂居地的丙:可以发私聊请求;与两者都不是的埃及的丁:不能。
    opened = _open(a_client, c)
    assert opened.status_code == 201 and opened.data["throttled"] is True
    assert _send(a_client, opened.data["id"], "打扰").status_code == 201
    assert _open(a_client, d).status_code == 404

    a.soul.refresh_from_db()
    with django_capture_on_commit_callbacks(execute=True):
        DispatchService.end_residence(a.soul, actor="system", trigger=DispatchService.RETURN_MANUAL)
    with_c = Conversation.objects.get(pk=opened.data["id"])
    assert not can_speak(with_c.room_id, mxid(a)) and not can_speak(with_c.room_id, mxid(c))
    response = _send(a_client, with_c.id)
    assert response.status_code == 403 and response.data["code"] == "cross_civilization"
    assert can_speak(with_b.room_id, mxid(a))
    assert _open(a_client, c).status_code == 404


def test_a_soul_from_the_same_home_residing_elsewhere_is_still_reachable(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """对称:乙暂居欧洲,在中国的甲照样能找到它、与它私聊(乙的原属落在甲的可聊文明里)。
    变异:`_reachable` 去掉 `home_tenant_id__in` 那一支 → 404,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    b.soul.tenant = eu_tenant  # 暂居;home_tenant 仍是中国
    b.soul.save()
    assert _open(a_client, b).status_code == 201


def test_the_inbox_follows_the_hall_the_soul_is_in(cn_tenant, eu_tenant, matrix, django_capture_on_commit_callbacks):  # noqa: F811
    """收件箱只能写给**当前所在**殿司:调走之后原殿司那封只能读(官员仍能回),新殿司另开一封。
    变异:删掉 `refusal` 里收件箱那条 `tenant_id` 判定 → 调走后仍能写给原殿司,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    home = a_client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json").data
    with django_capture_on_commit_callbacks(execute=True):
        _dispatch(a.soul, cn_tenant, eu_tenant)

    assert not can_speak(home["room_id"], mxid(a))
    response = _send(a_client, home["id"])
    assert response.status_code == 403 and response.data["code"] == "not_current_hall"

    away = a_client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json")
    assert away.status_code == 201 and away.data["id"] != home["id"]
    assert Conversation.objects.get(pk=away.data["id"]).tenant_id == eu_tenant.pk
    assert _send(a_client, away.data["id"]).status_code == 201


# ── 转世 ─────────────────────────────────────────────────────────────────


def test_a_new_life_starts_new_rooms(cn_tenant, pair, django_capture_on_commit_callbacks):
    """前世的会话随账号关闭;新一世与同一个灵魂再开私聊是新房间,旧房间不再列出。
    变异:删掉 `deactivate_for_account` 里关会话那一步 → 新一世 `_open` 拿回旧房间(新身份不在里面),红。"""
    from apps.soul_accounts import services as accounts
    from apps.soul_accounts.models import AccountOrigin
    from tests.soul_account_support import soul_client

    a, _, b, b_client, old = pair
    with django_capture_on_commit_callbacks(execute=True):
        accounts.retire_account_for_rebirth(a.soul, a.cycle)
    old.refresh_from_db()
    assert old.closed_at is not None

    from apps.reincarnation.models import Reincarnation

    Reincarnation.objects.create(soul=a.soul, cycle_count=1, rebirth_form="HUMAN", target_realm="R0",
                                 tenant=cn_tenant)
    new_account, created = accounts.provision_account(a.soul, AccountOrigin.OFFICER)
    assert created and new_account.cycle == 1
    new_account.must_change_password = False
    new_account.save()
    new_client = soul_client(new_account)
    assert new_client.get(CONVERSATIONS).data == []

    response = _open(new_client, b)  # 新一世不继承关注:这是一条私聊请求
    assert response.status_code == 201, response.data
    assert response.data["id"] != str(old.id) and response.data["throttled"] is True
    assert _send(b_client, old.id).status_code == 409  # 旧房间已关闭


def test_mutual_follows_made_at_home_still_count_while_residing(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """在中国互关的两人,甲暂居欧洲后第一次开私聊:仍是自由房间,不是私聊请求。
    朋友圈的 `are_mutual_followers` 要求此刻同文明,在这里答「否」—— 所以聊天用自己的 `_mutual`。
    变异:`open_direct` 改用 `circle.are_mutual_followers` → throttled 为真,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    mutual(a, b)
    a.soul.tenant = eu_tenant
    a.soul.save()
    response = _open(a_client, b)
    assert response.status_code == 201 and response.data["throttled"] is False
