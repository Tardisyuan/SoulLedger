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

* 新消息落库之后,模块的 `on_new_event` 回调后端(`push_url`)—— 这里把每条落库的消息记进
  `FakeMatrix.hooks`,由 `deliver_hooks()` 交给**模块本身**(`config/synapse/soulledger_policy.py`,
  用下面的 `FakeModuleApi` 装载)去签名、回调真实 URL。Synapse 是在后台进程里调的、在消息落库之后:
  所以这里也是「先落库、后回调」,回调失败不回滚那条消息。

**不照抄的**:建房、邀请的拒绝也在模块里,后端只以服务账号建房,这里没有别的调用者可拒。

曾经的版本「只记账不拒绝」,理由是会拒绝的替身把「Synapse 会拒绝」换成了「替身会拒绝」。
代价是它把一条真缺陷藏了起来:后端以 0 级发起方的身份代发私聊请求,替身照收,真 Synapse
拒绝(`user_level (0) < send_level (50)`)。**不拒绝的替身同样是在复现缺陷** —— 它复现的是
「后端以为能发」。所以这里拒绝,而拒绝的依据本身由集成测试对着真服务钉住。
"""
import importlib
import sys
import types
from pathlib import Path

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
    hooks: list = []  # 落库后待回调的 (room_id, event)

    def __init__(self):
        self.service_user = f"@soulledger:{SERVER_NAME}"

    @classmethod
    def reset(cls):
        cls.users, cls.rooms, cls.sent, cls.calls, cls.used, cls.hooks = {}, {}, [], [], set(), []

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
                   "officer_title": (extra or {}).get("io.soulledger.officer_title", ""),
                   "grant": (extra or {}).get(GRANT_KEY),
                   "timestamp": 1000 + len(FakeMatrix.sent)}
        room["messages"].append(message)
        FakeMatrix.sent.append((room_id, message))
        FakeMatrix.hooks.append(FakeEvent(room_id, event_id, sender, "m.room.message",
                                          {"msgtype": "m.text", "body": body, **(extra or {})}))
        return event_id

    def recent_messages(self, room_id, *, limit=50):
        return list(reversed(FakeMatrix.rooms[room_id]["messages"]))[:limit]

    # ── 测试直接用:模拟某个灵魂拿自己的 token 在 Matrix 里发言(同样受 power level 约束)──
    @classmethod
    def says(cls, room_id, mxid, body="来了", extra=None):
        localpart = mxid[1:].split(":", 1)[0]
        return cls().send_message(room_id, body, as_localpart=localpart, extra=extra)


class FakeEvent:
    """模块回调拿到的 `EventBase` 的那几个属性。"""

    def __init__(self, room_id, event_id, sender, type_, content, state_key=None):
        self.room_id, self.event_id, self.sender, self.type, self.content = room_id, event_id, sender, type_, content
        self.state_key = state_key

    def is_state(self):
        return self.state_key is not None


REPO = Path(__file__).resolve().parents[2]


def load_policy_module():
    """`config/synapse/soulledger_policy.py` 本身。它 import 的两个 synapse 名字换成最小替身
    (`Codes.FORBIDDEN`、`NOT_SPAM`、`ModuleApi`)—— 后端环境里没有 synapse。"""
    if "synapse.module_api" not in sys.modules:
        synapse = types.ModuleType("synapse")
        api = types.ModuleType("synapse.api")
        errors = types.ModuleType("synapse.api.errors")
        errors.Codes = type("Codes", (), {"FORBIDDEN": "M_FORBIDDEN"})
        module_api = types.ModuleType("synapse.module_api")
        module_api.NOT_SPAM = "NOT_SPAM"
        module_api.ModuleApi = object
        sys.modules.update({"synapse": synapse, "synapse.api": api, "synapse.api.errors": errors,
                            "synapse.module_api": module_api})
    path = str(REPO / "config" / "synapse")
    if path not in sys.path:
        sys.path.insert(0, path)
    return importlib.import_module("soulledger_policy")


def run_coroutine(coro):
    """跑完一个不会真正挂起的协程,不起事件循环 —— 回调里要走 Django 的同步 ORM,
    而 ORM 在有运行中事件循环的线程里拒绝工作(SynchronousOnlyOperation)。"""
    try:
        coro.send(None)
    except StopIteration as done:
        return done.value
    coro.close()
    raise RuntimeError("协程挂起了:替身里不该有真正的异步等待")


class HttpResponseException(Exception):  # noqa: N818 — Synapse 里就叫这个名字
    """Synapse 的 `SimpleHttpClient.post_json_get_json` 对非 2xx 抛的那个。"""


class FakeModuleApi:
    """模块用到的 ModuleApi 那几样,照 Synapse 的行为:

    * `run_as_background_process`:不在调用者的这条链上跑(这里排进 `background`,由 `deliver_hooks`
      在回调返回之后再跑),**异常记日志后吞掉**,不传回调用者;
    * `http_client.post_json_get_json`:POST JSON,非 2xx 抛 `HttpResponseException`,2xx 返回解析后的 JSON。
      这里 POST 进 Django 的测试客户端,于是回调走的是真实的 URL、真实的视图。
    """

    def __init__(self, client=None, *, url_ok=True):
        self.callbacks = {}
        self.posts = []
        self.failures = []
        self.background = []
        self._client = client
        api = self

        class _Http:
            async def post_json_get_json(self, uri, body, headers=None):
                api.posts.append((uri, body))
                if api._client is None:
                    raise HttpResponseException("connection refused")
                path = "/" + uri.split("://", 1)[-1].split("/", 1)[1]
                response = api._client.post(path, body, format="json")
                if response.status_code >= 300:
                    raise HttpResponseException(f"{response.status_code}")
                return response.json()

        self.http_client = _Http()

    def register_spam_checker_callbacks(self, **callbacks):
        self.callbacks.update(callbacks)

    def register_third_party_rules_callbacks(self, **callbacks):
        self.callbacks.update(callbacks)

    def run_as_background_process(self, desc, func, *args, **kwargs):
        self.background.append((desc, func, args, kwargs))

    def drain(self):
        pending, self.background = self.background, []
        for desc, func, args, kwargs in pending:
            try:
                run_coroutine(func(*args, **kwargs))
            except Exception as exc:  # noqa: BLE001 — Synapse 记日志、吞掉
                self.failures.append((desc, exc))


PUSH_URL = "http://backend:8000/api/v1/chat/hooks/new-message/"


def policy(client=None, *, push_url=PUSH_URL):
    """用测试的 grant_secret 装载的模块实例。"""
    module = load_policy_module()
    api = FakeModuleApi(client)
    config = module.SoulLedgerPolicy.parse_config({
        "service_user": f"@soulledger:{SERVER_NAME}", "grant_secret": settings.MATRIX_JWT_SECRET,
        **({"push_url": push_url} if push_url else {}),
    })
    return module.SoulLedgerPolicy(config, api), api


def deliver_hooks(client=None):
    """把落库后待回调的消息交给模块(= Synapse 此时会做的事)。返回模块的 FakeModuleApi,
    `posts` 是它发出的回调,`failures` 是被吞掉的异常。"""
    from rest_framework.test import APIClient

    _, api = policy(client or APIClient())
    pending, FakeMatrix.hooks = FakeMatrix.hooks, []
    for event in pending:
        run_coroutine(api.callbacks["on_new_event"](event, {}))
    api.drain()
    return api


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
