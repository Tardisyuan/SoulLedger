"""关键写接口的幂等键(请求头 `Idempotency-Key`,2026-10-29 用户决定)。

    @action(detail=True, methods=["post"])
    @idempotent
    def conclude(self, request, pk=None): ...

带这个头的请求,按(用户, 方法, 路径, 键)在缓存(生产是 Redis)里记一笔:
* 第一次:先占位「处理中」(`cache.add`,原子),跑视图;2xx 的状态码与响应体存 24 小时。
  非 2xx 或抛异常时删掉占位 —— 改了请求再试的人不该被一次失败锁住 24 小时。
* 同一个键、同样的请求体又来:回放第一次的状态码与响应体,加 `Idempotent-Replayed: true`,视图不再执行。
* 同一个键、不同的请求体:422 `idempotency_key_reused`。
* 第一次还没跑完:409 `idempotency_in_progress`(并发的双击、或弱网下客户端以为超时的重试)。

不带这个头的请求照旧,一行都不变:幂等是客户端选的,老客户端不受影响。
已有的 `death_sync` `X-Idempotency-Key` 与书信的 `txn_id` 是各自的办法,不经过这里。
"""
import functools
import hashlib
import json
import re

from django.core.cache import cache
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.utils.encoders import JSONEncoder

HEADER = "HTTP_IDEMPOTENCY_KEY"
REPLAYED_HEADER = "Idempotent-Replayed"
DONE_TTL = 24 * 3600
#: 占位的寿命。进程在请求中途死掉时,这么久之后同一个键可以重来;比任何一个被挂上的接口都长得多。
PENDING_TTL = 5 * 60
_VALID = re.compile(r"^[\x21-\x7e]{1,255}$")


def _refuse(detail, code, http_status):
    return Response({"detail": detail, "code": code}, status=http_status)


def _fingerprint(request) -> str:
    body = json.dumps(request.data, sort_keys=True, cls=JSONEncoder, default=str)
    return hashlib.sha256(body.encode()).hexdigest()


def _cache_key(request, key: str) -> str:
    raw = f"{request.user.pk}:{request.method}:{request.path}:{key}"
    return "idem:" + hashlib.sha256(raw.encode()).hexdigest()


def idempotent(view):
    """装在视图函数 / 视图方法上(`@action`、`@api_view`、`APIView.post` 都行),放在离 `def` 最近的一行。"""

    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        request = next((a for a in args[:2] if isinstance(a, Request)), None)
        key = request.META.get(HEADER, "") if request is not None else ""
        if not key or not getattr(request.user, "is_authenticated", False):
            return view(*args, **kwargs)
        if not _VALID.match(key):
            return _refuse("Idempotency-Key 不合法。", "idempotency_key_invalid", status.HTTP_400_BAD_REQUEST)

        slot = _cache_key(request, key)
        fingerprint = _fingerprint(request)
        if not cache.add(slot, {"state": "pending", "fp": fingerprint}, PENDING_TTL):
            seen = cache.get(slot)
            if seen is None:  # 刚好过期或被删;按第一次处理会与正在跑的那次并发,保守地答「处理中」
                return _refuse("同一个请求正在处理。", "idempotency_in_progress", status.HTTP_409_CONFLICT)
            if seen["fp"] != fingerprint:
                return _refuse("这个 Idempotency-Key 已用于另一个请求。", "idempotency_key_reused",
                               status.HTTP_422_UNPROCESSABLE_ENTITY)
            if seen["state"] == "pending":
                return _refuse("同一个请求正在处理。", "idempotency_in_progress", status.HTTP_409_CONFLICT)
            return Response(seen["data"], status=seen["status"], headers={REPLAYED_HEADER: "true"})

        try:
            response = view(*args, **kwargs)
        except BaseException:
            cache.delete(slot)
            raise
        if isinstance(response, Response) and 200 <= response.status_code < 300:
            # 存成 JSON 能表达的值:回放的与第一次渲染出来的一致,也不把序列化器对象塞进缓存。
            data = json.loads(json.dumps(response.data, cls=JSONEncoder)) if response.data is not None else None
            cache.set(slot, {"state": "done", "fp": fingerprint, "status": response.status_code, "data": data},
                      DONE_TTL)
        else:
            cache.delete(slot)
        return response

    return wrapper
