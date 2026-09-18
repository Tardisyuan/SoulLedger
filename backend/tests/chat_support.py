"""聊天测试共用(不是测试文件,pytest 不收集)。**没有任何一条路径访问 Synapse。**

`FakeMatrix` **照 Synapse 的样子拒绝**,每一条都在 2026-09-18 对真 Synapse v1.161
(本机 docker,`tests/test_chat_synapse_integration.py`)实测过:

* 发消息要求发送者是房间成员、未停用,且 power level ≥ `events_default`
  (`events` 表里的类型除外 —— 后端建房时把它设成空表);低了是 403 `M_FORBIDDEN`;
* 停用用户离开它的所有房间(真 Synapse 是后台异步做完的,这里立即);
* `set_user_levels` 只在级别真变了才写 —— 与真实现同一条判断,于是「写了几次」可断言;
* Synapse 模块(config/synapse/soulledger_policy.py)的节流规则:房间的 `io.soulledger.throttle`
  指向发送者时,只收带有效、未用过的一次性凭据的 `m.room.message`(凭据校验用后端同一个
  `apps.chat.grant.verify`;模块里那份与它一致,由集成测试对真 Synapse 证明)。

**不照抄的**:建房、邀请的拒绝也在模块里,后端只以服务账号建房,这里没有别的调用者可拒。

曾经的版本「只记账不拒绝」,理由是会拒绝的替身把「Synapse 会拒绝」换成了「替身会拒绝」。
代价是它把一条真缺陷藏了起来:后端以 0 级发起方的身份代发私聊请求,替身照收,真 Synapse
拒绝(`user_level (0) < send_level (50)`)。**不拒绝的替身同样是在复现缺陷** —— 它复现的是
「后端以为能发」。所以这里拒绝,而拒绝的依据本身由集成测试对着真服务钉住。
"""
import pytest
from django.conf import settings

from apps.chat.grant import KEY as GRANT_KEY
from apps.chat.grant import verify
from apps.chat.matrix import MatrixError

SERVER_NAME = "test.soulledger"


class FakeMatrix:
    """按 `apps/chat/matrix.SynapseClient` 的形状回答。类属性记账,每个测试由 fixture 清零。"""

    users: dict = {}
    rooms: dict = {}
    sent: list = []
    calls: list = []
    used: set = set()

    def __init__(self):
        self.service_user = f"@soulledger:{SERVER_NAME}"

    @classmethod
    def reset(cls):
        cls.users, cls.rooms, cls.sent, cls.calls, cls.used = {}, {}, [], [], set()

    # ── 用户 ──
    def user_id(self, localpart):
        return f"@{localpart}:{SERVER_NAME}"

    def ensure_user(self, localpart, displayname):
        FakeMatrix.calls.append(("ensure_user", localpart, displayname))
        FakeMatrix.users[localpart] = {"displayname": displayname, "deactivated": False}
        return self.user_id(localpart)

    def deactivate_user(self, localpart):
        FakeMatrix.calls.append(("deactivate_user", localpart))
        FakeMatrix.users.setdefault(localpart, {})["deactivated"] = True
        for room in FakeMatrix.rooms.values():
            room["members"].discard(self.user_id(localpart))

    # ── 房间 ──
    def create_room(self, *, name, power_levels):
        FakeMatrix.calls.append(("create_room", name))
        room_id = f"!room{len(FakeMatrix.rooms)}:{SERVER_NAME}"
        FakeMatrix.rooms[room_id] = {"name": name, "power_levels": power_levels, "throttle": None,
                                     "members": {self.service_user}, "messages": [], "level_writes": 0,
                                     "level_log": []}
        return room_id

    def force_join(self, room_id, user_id):
        FakeMatrix.rooms[room_id]["members"].add(user_id)

    def set_user_levels(self, room_id, levels):
        pl = FakeMatrix.rooms[room_id]["power_levels"]
        users = pl.setdefault("users", {})
        if all(users.get(m, pl.get("users_default", 0)) == lvl for m, lvl in levels.items()):
            return False
        users.update(levels)
        FakeMatrix.rooms[room_id]["level_writes"] += 1
        FakeMatrix.rooms[room_id]["level_log"].append(dict(levels))
        return True

    def set_room_throttle(self, room_id, initiator):
        FakeMatrix.rooms[room_id]["throttle"] = initiator

    def send_message(self, room_id, body, *, as_localpart, extra=None):
        room = FakeMatrix.rooms[room_id]
        sender = self.user_id(as_localpart)
        if FakeMatrix.users.get(as_localpart, {}).get("deactivated"):
            raise MatrixError("User is deactivated", errcode="M_USER_DEACTIVATED", status=403)
        if sender not in room["members"]:
            raise MatrixError("User not in room", errcode="M_FORBIDDEN", status=403)
        pl = room["power_levels"]
        need = pl.get("events", {}).get("m.room.message", pl.get("events_default", 0))
        have = pl.get("users", {}).get(sender, pl.get("users_default", 0))
        if have < need:
            raise MatrixError(f"user_level ({have}) < send_level ({need})", errcode="M_FORBIDDEN", status=403)
        if room["throttle"] == sender:
            grant = (extra or {}).get(GRANT_KEY)
            if not verify(settings.MATRIX_JWT_SECRET, room_id, sender, grant) or grant["nonce"] in FakeMatrix.used:
                raise MatrixError("This message has been rejected as probable spam", errcode="M_FORBIDDEN",
                                  status=403)
            FakeMatrix.used.add(grant["nonce"])
        event_id = f"$evt{len(FakeMatrix.sent)}"
        message = {"event_id": event_id, "sender": sender, "body": body,
                   "officer": (extra or {}).get("io.soulledger.officer", ""),
                   "grant": (extra or {}).get(GRANT_KEY),
                   "timestamp": 1000 + len(FakeMatrix.sent)}
        room["messages"].append(message)
        FakeMatrix.sent.append((room_id, message))
        return event_id

    def recent_messages(self, room_id, *, limit=50):
        return list(reversed(FakeMatrix.rooms[room_id]["messages"]))[:limit]

    # ── 测试直接用:模拟某个灵魂拿自己的 token 在 Matrix 里发言(同样受 power level 约束)──
    @classmethod
    def says(cls, room_id, mxid, body="来了", extra=None):
        localpart = mxid[1:].split(":", 1)[0]
        return cls().send_message(room_id, body, as_localpart=localpart, extra=extra)


def can_speak(room_id, mxid):
    """`mxid` 此刻在这个房间里能不能直接发消息(按房间当前的 power level)。"""
    room = FakeMatrix.rooms[room_id]
    pl = room["power_levels"]
    return mxid in room["members"] and pl["users"].get(mxid, pl.get("users_default", 0)) >= pl["events_default"]


@pytest.fixture
def matrix(settings):
    """打开聊天、把客户端换成假的、把状态清零。"""
    settings.MATRIX_ENABLED = True
    settings.MATRIX_CLIENT = "tests.chat_support.FakeMatrix"
    settings.MATRIX_PUBLIC_BASEURL = "https://matrix.test.soulledger/"
    settings.MATRIX_SERVER_NAME = SERVER_NAME
    settings.MATRIX_JWT_SECRET = "jwt-secret-for-tests-0123456789abcdef"
    settings.MATRIX_REGISTRATION_SHARED_SECRET = "shared-secret-for-tests"
    settings.MATRIX_USER_SALT = "salt-for-tests"
    settings.MATRIX_SERVICE_LOCALPART = "soulledger"
    FakeMatrix.reset()
    yield FakeMatrix
    FakeMatrix.reset()


def follow(a_account, b_account):
    """a 关注 b(`Follow` 连的是 User,边记在 a 当前所在的文明上 —— 与朋友圈同一口径)。"""
    from apps.social.models import Follow

    Follow.objects.create(follower=a_account.user, following=b_account.user,
                          tenant=a_account.soul.tenant)


def mutual(a_account, b_account):
    follow(a_account, b_account)
    follow(b_account, a_account)


def room_of(conversation):
    return FakeMatrix.rooms[conversation.room_id]


def mxid(account):
    from apps.chat.models import ChatIdentity

    return ChatIdentity.objects.get(account=account).matrix_user_id
