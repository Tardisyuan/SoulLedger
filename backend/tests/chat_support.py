"""聊天测试共用(不是测试文件,pytest 不收集)。**没有任何一条路径访问 Synapse。**

`FakeMatrix` **只记账,不执行策略**:它不因为某人 power level 是 0 就拒绝发送。
这是刻意的 —— 一个会按 power level 拒绝的假实现,就是把「Synapse 真的会拒绝」这条
断言换成了「我写的假实现会拒绝」,而那正是这个仓库记过的那类测试替身。
单元测试断言的是**后端交给 Synapse 的 power level 是什么**;
「Synapse 照着拒绝」由 `tests/test_chat_synapse_integration.py` 对着真服务断言。
"""
import pytest

SERVER_NAME = "test.soulledger"


class FakeMatrix:
    """按 `apps/chat/matrix.SynapseClient` 的形状回答。类属性记账,每个测试由 fixture 清零。"""

    users: dict = {}
    rooms: dict = {}
    sent: list = []
    calls: list = []

    def __init__(self):
        self.service_user = f"@soulledger:{SERVER_NAME}"

    @classmethod
    def reset(cls):
        cls.users, cls.rooms, cls.sent, cls.calls = {}, {}, [], []

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
        # 真 Synapse 的 deactivate 同时让用户离开所有房间 —— 这一点照抄,因为
        # 「停用后还留在房间里」会让下面的断言读起来是对的而其实不对。
        for room in FakeMatrix.rooms.values():
            room["members"].discard(self.user_id(localpart))

    # ── 房间 ──
    def create_room(self, *, name, power_levels):
        room_id = f"!room{len(FakeMatrix.rooms)}:{SERVER_NAME}"
        FakeMatrix.rooms[room_id] = {"name": name, "power_levels": power_levels,
                                     "members": set(), "messages": []}
        return room_id

    def force_join(self, room_id, user_id):
        FakeMatrix.rooms[room_id]["members"].add(user_id)

    def set_power_level(self, room_id, user_id, level):
        FakeMatrix.rooms[room_id]["power_levels"]["users"][user_id] = level

    def send_message(self, room_id, body, *, as_localpart, extra=None):
        room = FakeMatrix.rooms[room_id]
        event_id = f"$evt{len(FakeMatrix.sent)}"
        message = {"event_id": event_id, "sender": self.user_id(as_localpart), "body": body,
                   "officer": (extra or {}).get("io.soulledger.officer", ""),
                   "timestamp": 1000 + len(FakeMatrix.sent)}
        room["messages"].append(message)
        FakeMatrix.sent.append((room_id, message))
        return event_id

    def recent_messages(self, room_id, *, limit=50):
        return list(reversed(FakeMatrix.rooms[room_id]["messages"]))[:limit]

    # ── 测试直接用的辅助:模拟「对方在 Matrix 里回了一句」──
    @classmethod
    def peer_says(cls, room_id, mxid, body="来了"):
        cls.rooms[room_id]["messages"].append({
            "event_id": f"$peer{len(cls.rooms[room_id]['messages'])}", "sender": mxid,
            "body": body, "officer": "", "timestamp": 2000,
        })


@pytest.fixture
def matrix(settings):
    """打开聊天、把客户端换成假的、把状态清零。"""
    settings.MATRIX_ENABLED = True
    settings.MATRIX_CLIENT = "tests.chat_support.FakeMatrix"
    settings.MATRIX_PUBLIC_BASEURL = "https://matrix.test.soulledger/"
    settings.MATRIX_SERVER_NAME = SERVER_NAME
    settings.MATRIX_JWT_SECRET = "jwt-secret-for-tests"
    settings.MATRIX_REGISTRATION_SHARED_SECRET = "shared-secret-for-tests"
    settings.MATRIX_USER_SALT = "salt-for-tests"
    settings.MATRIX_SERVICE_LOCALPART = "soulledger"
    FakeMatrix.reset()
    yield FakeMatrix
    FakeMatrix.reset()


def follow(a_account, b_account):
    """a 关注 b(`Follow` 连的是 User)。"""
    from apps.social.models import Follow

    Follow.objects.create(follower=a_account.user, following=b_account.user,
                          tenant=a_account.soul.tenant)


def mutual(a_account, b_account):
    follow(a_account, b_account)
    follow(b_account, a_account)


def room_of(conversation):
    return FakeMatrix.rooms[conversation.room_id]
