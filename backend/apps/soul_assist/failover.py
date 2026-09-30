"""主用供应商失败时改用备用,与断路器(docs/ARCHITECTURE-soul-assist.md §13,用户 2026-10-01 定)。

- **只在第一段文本发出之前切换**,且只为 `providers.SWITCHING_REASONS`(连不上、超时、429、5xx、402)。
  出过字之后再出错就是「中断」,不切:灵魂已经读到一半,换一个模型从头再答会把两段不同的回答拼在一起。
- **有备用时主用最多占 `ASSISTANT_PRIMARY_FIRST_TOKEN_SECONDS`(12 秒)到首字**,剩下的首字预算留给备用。
- **断路器**:主用连续失败 `THRESHOLD` 次(只数可切换的失败)→ 之后 `OPEN_SECONDS` 秒内直接用备用;
  到时再试主用(半开):成功清零,失败则计数仍 ≥ 阈值,立刻再断开。计数与断开时刻放在 Django 缓存里,
  多进程共享;键带主用连接的指纹,换了主用配置就是一个新的断路器。

ponytail: 计数是「连续」而不是「窗口内比例」,并发的成功与失败交错时它会被成功清零;要更稳就换成滑动窗口。
"""
import time

from django.conf import settings
from django.core.cache import cache

THRESHOLD = 3
OPEN_SECONDS = 60
#: 失败计数的寿命:十分钟没有新的失败就不再算「连续」。断开期间计数不变,所以半开那一次失败会立刻再断开。
COUNT_TTL = 600
_FAILS = "soul_assist:breaker:fails:"
_OPEN = "soul_assist:breaker:open:"


def _key(conn):
    return conn.fingerprint()[:32]


def open_until(conn):
    """断开到什么时候(`time.time()` 秒);没断开为 None。"""
    until = cache.get(_OPEN + _key(conn))
    return until if until is not None and time.time() < until else None


def failures(conn) -> int:
    return cache.get(_FAILS + _key(conn)) or 0


def record_failure(conn) -> int:
    key = _FAILS + _key(conn)
    cache.add(key, 0, COUNT_TTL)
    try:
        count = cache.incr(key)
    except ValueError:  # add 与 incr 之间过期了
        cache.set(key, 1, COUNT_TTL)
        count = 1
    cache.touch(key, COUNT_TTL)
    if count >= THRESHOLD:
        cache.set(_OPEN + _key(conn), time.time() + OPEN_SECONDS, OPEN_SECONDS * 2)
    return count


def record_success(conn):
    cache.delete_many([_FAILS + _key(conn), _OPEN + _key(conn)])


def plan(conn, backup, start):
    """这一问依次尝试的 `(角色, 连接, 首字截止时刻, 改用理由)`。改用理由在真的切换时才定,这里只有断路器的。"""
    first = start + settings.ASSISTANT_TIMEOUT_SECONDS
    if backup is None:
        return [("primary", conn, first, "")]
    if open_until(conn) is not None:
        return [("backup", backup, first, "circuit_open")]
    primary_first = min(first, start + settings.ASSISTANT_PRIMARY_FIRST_TOKEN_SECONDS)
    return [("primary", conn, primary_first, ""), ("backup", backup, first, "")]
