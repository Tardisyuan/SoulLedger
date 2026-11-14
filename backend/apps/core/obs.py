"""进程内累加的计数器,定时刷进 Redis(2026-11-14 架构评审裁决:不是每个请求一次 Redis 写)。

为什么不直接在 `/metrics/` 上导出进程内的数:HTTP 现在是单进程 daphne,但 Celery 是 prefork 多进程,
而 HTTP 换成多 worker(be-scale)之后,一次抓取只落到其中一个进程上。所以每个进程各自累加,
满 FLUSH_EVERY 个请求或距上次刷过 FLUSH_SECONDS 秒,就用一个 pipeline `HINCRBY` 进 Redis;`/metrics/` 读 Redis。
多进程下各自 `HINCRBY`,和天然正确;每个请求零往返。

* 键写进缓存那个库(`REDIS_URL`),不写 broker 那个(`CELERY_BROKER_URL`)。
* `obs:total`:单调递增,`/metrics/` 当 Prometheus counter 导出。
* `obs:h:<yyyymmddHH>`(UTC):同样的字段按小时分桶,留 35 天 —— 给 28 天 SLO 窗口用,不需要 Prometheus。
* Redis 不可用:丢掉这一批计数,只记一次 warning,之后 RETRY_COOLDOWN 秒内不再尝试。度量绝不让请求失败。
* `incr` 只动内存,从任何上下文(含 async 的 WebSocket consumer)调用都安全;
  会碰网络的只有 `maybe_flush` / `flush`,只在同步的地方调(中间件、Celery 信号、`/metrics/`)。

字段是 `kind|label|label…`;标签里的 `|` 换成 `/`。

本模块不 import 任何模型(`trace.py` 在 apps 加载前就被日志配置引用,而它 import 这里)。
"""
import logging
import threading
import time
from collections import Counter
from datetime import UTC, datetime

logger = logging.getLogger(__name__)

#: 耗时桶的上边界(毫秒),+Inf 隐含。`docs/SLO.md` 的每个延迟阈值(400 / 500 / 800)都必须正好是一个边界,
#: 否则「≤ 阈值的比例」只能插值 —— `tests/test_obs_request_metrics.py` 守着。
BUCKETS_MS = (100, 250, 400, 500, 800, 1500, 3000)
FLUSH_EVERY = 100
FLUSH_SECONDS = 10.0
RETRY_COOLDOWN = 30.0
HOUR_TTL_SECONDS = 35 * 24 * 3600
TOTAL_KEY = "obs:total"
SEP = "|"

_lock = threading.Lock()
_pending: Counter = Counter()
_since_flush = 0
_last_flush = time.monotonic()
_down_until = 0.0
_client = None
_client_url = None


def _clean(label) -> str:
    return str(label).replace(SEP, "/")


def incr(kind: str, *labels, n: int = 1) -> None:
    field = SEP.join((kind, *map(_clean, labels)))
    with _lock:
        _pending[field] += n


def bucket_for(ms: float) -> str:
    for edge in BUCKETS_MS:
        if ms <= edge:
            return str(edge)
    return "inf"


def status_class(status: int) -> str:
    return f"{status // 100}xx" if 100 <= status < 600 else "other"


def record_request(method: str, route: str, status: int, ms: float) -> None:
    """一次 HTTP 请求。耗时直方图只计非 5xx —— 与 SLO 的延迟 SLI 同一个分母(`docs/SLO.md`)。"""
    global _since_flush
    klass = status_class(status)
    with _lock:
        _since_flush += 1  # FLUSH_EVERY counts requests; everything else flushes on time
    incr("http", method, route, klass)
    if klass != "5xx":
        incr("http_le", method, route, bucket_for(ms))
        incr("http_ms", method, route, n=int(round(ms)))


def pending() -> dict:
    """还没刷出去的计数(测试与 `/metrics/` 自检用)。"""
    with _lock:
        return dict(_pending)


def _redis():
    global _client, _client_url
    import redis
    from django.conf import settings

    url = settings.REDIS_URL
    if _client is None or _client_url != url:
        _client = redis.Redis.from_url(url, socket_timeout=0.5, socket_connect_timeout=0.5)
        _client_url = url
    return _client


def flush() -> bool:
    """把这一批写进 Redis。失败返回 False,这一批丢掉(见模块说明)。"""
    global _since_flush, _last_flush, _down_until
    with _lock:
        batch = dict(_pending)
        _pending.clear()
        _since_flush = 0
        _last_flush = time.monotonic()
    if not batch:
        return True
    if time.monotonic() < _down_until:
        return False
    hour_key = "obs:h:" + datetime.now(UTC).strftime("%Y%m%d%H")
    try:
        pipe = _redis().pipeline(transaction=False)
        for field, n in batch.items():
            pipe.hincrby(TOTAL_KEY, field, n)
            pipe.hincrby(hour_key, field, n)
        pipe.expire(hour_key, HOUR_TTL_SECONDS)
        pipe.execute()
    except Exception:
        # ponytail: 丢这一批(≤ 10 秒的计数)而不是攒着重试;要零丢失时改成合并回 _pending,并按小时记账。
        _down_until = time.monotonic() + RETRY_COOLDOWN
        logger.warning("obs: flush to Redis failed; dropped %d counters, retrying in %ds",
                       len(batch), RETRY_COOLDOWN, exc_info=True)
        return False
    return True


def maybe_flush() -> None:
    with _lock:
        due = _since_flush >= FLUSH_EVERY or time.monotonic() - _last_flush >= FLUSH_SECONDS
    if due:
        flush()


def read_totals() -> dict:
    """所有进程刷进 Redis 的累计值,`{field: int}`。Redis 不可用时抛出,由调用方决定怎么报。"""
    raw = _redis().hgetall(TOTAL_KEY)
    return {k.decode(): int(v) for k, v in raw.items()}


def _reset_for_tests() -> None:
    global _since_flush, _last_flush, _down_until, _client, _client_url
    with _lock:
        _pending.clear()
        _since_flush = 0
        _last_flush = time.monotonic()
    _down_until = 0.0
    _client = None
    _client_url = None
