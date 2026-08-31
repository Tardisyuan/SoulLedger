"""Redis 挂掉时,一次撤销最多被无视多久 —— 以及那些键属于谁。

`PermissionCache` 的进程内兜底(`_fallback_cache`)是**每个进程一份**。
`Role`/`RolePermission` 有 post_save/post_delete 信号,`perm/views.py` 的每个写端点
都显式调 `invalidate_all_permissions()`,所以 **API 驱动的撤销是立即的** ——
这一点审计里已经把原怀疑推翻了。

剩下的真窗口是 Redis 挂掉的时候(兜底存在的全部理由):worker A 的撤销**到不了**
worker B 的内存,而那份内存拿的是一份谁也清不掉的副本。它此前跟共享条目共用
300 秒的 TTL —— 也就是说降级期间,一个已撤销的授权最多还能被认可五分钟。

两件事:
1. 兜底有了自己的 TTL(默认 15 秒),把那个窗口的宽度写成一个可以读到的数;
2. Redis 键有了部署前缀 —— `perm:{role}:{codename}` 此前没有任何命名空间,
   同一个 Redis 上的任何进程共享它,而 CLAUDE.md 里就记着测试跑会往共享盒子里写
   `perm:*`。

这个文件断的是这两件事本身,不是它们的取值。
"""
import time

import pytest
from django.test import override_settings

from apps.perm.cache import PermissionCache


@pytest.fixture
def offline_cache():
    """一个 Redis 不可用的缓存 —— 也就是兜底真正被用到的那种。"""
    cache = PermissionCache.__new__(PermissionCache)
    cache._redis_client = None
    cache._fallback_cache = {}
    cache._ttl = 300
    cache._fallback_ttl = 15
    cache._key_prefix = ""
    cache._last_connect_failure = time.monotonic()
    cache._retry_cooldown = 10_000  # 不要在测试中途去连 Redis
    return cache


def test_the_fallback_has_its_own_ttl_and_it_is_shorter():
    """两个数字必须是两个 —— 共用一个就是把跨进程的窗口宽度交给了共享条目的寿命。"""
    from django.conf import settings

    shared = getattr(settings, "CACHE_PERMISSION_TTL", 300)
    fallback = getattr(settings, "CACHE_PERMISSION_FALLBACK_TTL", None)
    assert fallback is not None, "兜底没有自己的 TTL 设置项"
    assert fallback < shared, (
        f"兜底 TTL {fallback} 不比共享 TTL {shared} 短 —— 那么一次撤销在降级期间"
        f"最多被无视 {fallback} 秒,而这个数字本该是被刻意压小的那个"
    )


def test_a_grant_written_to_the_fallback_expires_on_the_fallback_clock(offline_cache):
    offline_cache._fallback_ttl = 0
    offline_cache.set("JUDGE", "soul.read", True)
    time.sleep(0.01)
    assert offline_cache.get("JUDGE", "soul.read") is None


def test_it_is_the_fallback_clock_and_not_the_shared_one(offline_cache):
    """守卫的守卫。

    上面那条把 `_fallback_ttl` 设成 0。如果代码其实还在读 `_ttl`,那条会**因为
    另一个原因**通过(`_ttl` 也可能被谁设成 0)。这条把两个数字拉开:
    共享的设成 0、兜底的设成很长 —— 条目必须**还在**。
    """
    offline_cache._ttl = 0
    offline_cache._fallback_ttl = 10_000
    offline_cache.set("JUDGE", "soul.read", True)
    time.sleep(0.01)
    assert offline_cache.get("JUDGE", "soul.read") is True, (
        "兜底读的还是共享 TTL —— 那么两个数字里只有一个是真的"
    )


@pytest.mark.django_db
def test_a_revocation_still_clears_this_process(offline_cache):
    """**断存在。** 兜底不是不可清,它是别的进程清不掉。本进程必须清得掉。"""
    offline_cache.set("JUDGE", "soul.read", True)
    offline_cache.invalidate_role("JUDGE")
    assert offline_cache.get("JUDGE", "soul.read") is None


@override_settings(CACHE_PERMISSION_KEY_PREFIX="zz-test:")
def test_the_redis_keys_carry_the_deployment_prefix():
    cache = PermissionCache.__new__(PermissionCache)
    cache._key_prefix = "zz-test:"
    key = cache._make_key("JUDGE", "soul.read")
    assert key.startswith("zz-test:"), key
    assert key == "zz-test:perm:JUDGE:soul.read"


def test_an_empty_prefix_keeps_the_old_key_shape():
    """默认空串 —— 升级不能把既有部署的键变成孤儿。"""
    cache = PermissionCache.__new__(PermissionCache)
    cache._key_prefix = ""
    assert cache._make_key("JUDGE", "soul.read") == "perm:JUDGE:soul.read"
