"""一次性发言凭据:被节流的私聊请求「临时提权、本人发、降回 0」里,挡住提权窗口的那一半。

提权期间发起方是 50 级,它拿着自己的 access token 直接在 Matrix 里发什么 Synapse 都会收。
所以 power level 不能是唯一的闸:节流房间里有一条状态事件 `io.soulledger.throttle`
(`{"initiator": <mxid>}`,只有服务账号能写),Synapse 模块
(config/synapse/soulledger_policy.py)对**发起方**在这种房间里的每一条非状态事件:

* 不是 `m.room.message` → 拒绝;
* 是消息,但 content 里没有有效的 `io.soulledger.grant` → 拒绝;
* 凭据有效但 nonce 用过 → 拒绝。

凭据只有后端签得出(密钥是 `MATRIX_JWT_SECRET`,与登录凭据同一信任边界 —— 拿到它本来就能
以任何人身份登录),绑定房间与发送者、30 秒过期、一次有效。于是提权窗口里发起方能发出的
**恰好是后端替它签的那一条**。

模块里有一份同样的 `verify`(Synapse 进程里 import 不到 Django);两份是否一致由
`tests/test_chat_synapse_integration.py` 对着真 Synapse 证明。
"""
import hashlib
import hmac
import secrets
import time

KEY = "io.soulledger.grant"
TTL_SECONDS = 30


def _mac(secret, room_id, sender, nonce, exp):
    message = f"{room_id}\n{sender}\n{nonce}\n{exp}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def sign(secret, room_id, sender, *, now=None):
    exp = int(now if now is not None else time.time()) + TTL_SECONDS
    nonce = secrets.token_hex(16)
    return {"nonce": nonce, "exp": exp, "mac": _mac(secret, room_id, sender, nonce, exp)}


def verify(secret, room_id, sender, grant, *, now=None):
    """凭据本身有效(不管是否用过 —— 那由调用方记)。"""
    if not isinstance(grant, dict):
        return False
    nonce, exp, mac = grant.get("nonce"), grant.get("exp"), grant.get("mac")
    if not (isinstance(nonce, str) and isinstance(exp, int) and isinstance(mac, str)):
        return False
    if exp < int(now if now is not None else time.time()):
        return False
    return hmac.compare_digest(mac, _mac(secret, room_id, sender, nonce, exp))
