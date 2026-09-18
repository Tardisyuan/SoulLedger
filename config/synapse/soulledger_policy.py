"""Synapse 模块:房间的形状只有后端的服务账号能改;节流房间里发起方只能发后端签过的那一条。

后端(backend/apps/chat/services.py)决定谁能和谁说话;这个模块让「绕过后端」不可能:

1. 除服务账号外,不能建房、不能邀请(含第三方邀请)、不能建别名、不能把房间发布到目录 ——
   否则灵魂拿自己的 access token 直接 `createRoom` 再邀请任意 mxid,就绕过了全部聊天规则。
2. 节流房间(状态事件 `io.soulledger.throttle` 的 `initiator` 就是发送者):发起方的非状态事件
   只接受带有效、未用过的 `io.soulledger.grant` 的 `m.room.message`。后端发私聊请求时
   把发起方临时提到 50 级、以本人身份发、再降回 0;这条规则让提权窗口里发起方自己多发的
   任何一条都被拒(backend/apps/chat/grant.py 写了为什么)。

其余发言权由 power level 管(后端建房时写死,状态事件一律 100 级,只有服务账号有 100)。

homeserver.yaml:

    modules:
      - module: soulledger_policy.SoulLedgerPolicy
        config:
          service_user: "@soulledger:<server_name>"
          grant_secret: "<与后端 MATRIX_JWT_SECRET 相同>"

ponytail: 用过的 nonce 记在进程内存里。单进程 Synapse 足够;拆 worker 时换成共享存储。
`tests/test_chat_synapse_integration.py` 对着真 Synapse 断言这里每一条拒绝。
"""
import hashlib
import hmac
import time

from synapse.api.errors import Codes
from synapse.module_api import NOT_SPAM, ModuleApi

THROTTLE = "io.soulledger.throttle"
GRANT = "io.soulledger.grant"


def _verify(secret, room_id, sender, grant, now):
    """与 backend/apps/chat/grant.py::verify 同一算法。"""
    if not isinstance(grant, dict):
        return False
    nonce, exp, mac = grant.get("nonce"), grant.get("exp"), grant.get("mac")
    if not (isinstance(nonce, str) and isinstance(exp, int) and isinstance(mac, str)) or exp < now:
        return False
    expected = hmac.new(secret.encode(), f"{room_id}\n{sender}\n{nonce}\n{exp}".encode(),
                        hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, expected)


class SoulLedgerPolicy:
    def __init__(self, config, api: ModuleApi):
        self._api = api
        self._service = config["service_user"]
        self._secret = config["grant_secret"]
        self._used = {}  # nonce -> exp
        api.register_spam_checker_callbacks(
            user_may_create_room=self._only_service,
            user_may_invite=self._only_service,
            user_may_send_3pid_invite=self._only_service,
            user_may_create_room_alias=self._only_service,
            user_may_publish_room=self._only_service,
            check_event_for_spam=self._check_event,
        )

    @staticmethod
    def parse_config(config):
        if not str(config.get("service_user", "")).startswith("@"):
            raise ValueError("soulledger_policy: service_user 必须是完整 mxid")
        if len(str(config.get("grant_secret", ""))) < 32:
            raise ValueError("soulledger_policy: grant_secret 至少 32 字节")
        return config

    async def _only_service(self, user_id, *_args, **_kwargs):
        # 回调的第一个参数都是发起者 mxid;其余参数各回调不同,这里不需要。
        return NOT_SPAM if user_id == self._service else Codes.FORBIDDEN

    async def _check_event(self, event):
        if event.is_state() or event.sender == self._service:
            return NOT_SPAM
        state = await self._api.get_room_state(event.room_id, [(THROTTLE, "")])
        throttle = state.get((THROTTLE, ""))
        if throttle is None or throttle.content.get("initiator") != event.sender:
            return NOT_SPAM
        if event.type != "m.room.message":
            return Codes.FORBIDDEN
        now = int(time.time())
        grant = event.content.get(GRANT)
        if not _verify(self._secret, event.room_id, event.sender, grant, now):
            return Codes.FORBIDDEN
        self._used = {n: e for n, e in self._used.items() if e >= now}
        if grant["nonce"] in self._used:
            return Codes.FORBIDDEN
        self._used[grant["nonce"]] = grant["exp"]
        return NOT_SPAM
