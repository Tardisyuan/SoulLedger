"""Synapse → 后端的新消息回调:签名与校验。

新消息不经过后端(互关的私聊灵魂直接在 Matrix 里发),所以「有新书信要推送」只有 Synapse 知道。
Synapse 模块(config/synapse/soulledger_policy.py)在消息落库后 `POST /api/v1/chat/hooks/new-message/`,
body 是 `{room_id, event_id, sender, ts, mac}`,`mac` 由这里同一算法签。

**密钥沿用 grant_secret(= 后端 `MATRIX_JWT_SECRET`)**:同一条信任边界 —— 拿到它本来就能以任何人
身份登录 Synapse,多一份密钥只多一处要配、要轮换的地方。签名串以 `push\\n` 开头,与发言凭据
(`grant.py`,以房间 id `!` 开头)不会互相冒充。

签的是字段而不是 HTTP body 的字节:Synapse 的 http client 自己序列化 JSON,我们控制不了字节。
`ts` 限 5 分钟,挡旧回调的重放;窗口内的重放由推送的 dedupe_key(`chat:<event_id>`)挡。

模块里有一份同样的 `sign`(Synapse 进程里 import 不到 Django);两份一致由
`tests/test_chat_push_hook.py` 对着模块源码的同一算法、以及 `test_chat_synapse_integration.py` 对真 Synapse 证明。
"""
import hashlib
import hmac
import time

MAX_SKEW_SECONDS = 300
FIELDS = ("room_id", "event_id", "sender")


def _mac(secret, room_id, event_id, sender, ts):
    message = f"push\n{room_id}\n{event_id}\n{sender}\n{ts}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def sign(secret, room_id, event_id, sender, *, now=None):
    ts = int(now if now is not None else time.time())
    return {"room_id": room_id, "event_id": event_id, "sender": sender, "ts": ts,
            "mac": _mac(secret, room_id, event_id, sender, ts)}


def verify(secret, body, *, now=None):
    """body 形状对、时间在窗口内、mac 对得上。"""
    if not isinstance(body, dict) or not secret:
        return False
    values = [body.get(name) for name in FIELDS]
    ts, mac = body.get("ts"), body.get("mac")
    if not all(isinstance(v, str) and 0 < len(v) <= 255 for v in values):
        return False
    if not (isinstance(ts, int) and not isinstance(ts, bool) and isinstance(mac, str)):
        return False
    if abs(int(now if now is not None else time.time()) - ts) > MAX_SKEW_SECONDS:
        return False
    return hmac.compare_digest(mac, _mac(secret, *values, ts))
