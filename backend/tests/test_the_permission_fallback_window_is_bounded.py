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


def test_the_fallback_is_disabled_by_default():
    """默认 0 —— 降级期间不缓存权限答案。

    两进程实测(Redis 指向关着的端口,共享一个 SQLite 文件库):A 读、B 读、
    A 删掉授权行并调 `invalidate_all_permissions()`,然后 B 再问:

        兜底 TTL   A 撤销后 B 立刻答   +20s   B 转为 False
        300        True(库已 False)  True   +301.5s
         15        True(库已 False)  —      +16.5s
          0        False              False  立刻

    **有界的 TTL 只是把窗口收窄,只有 0 让它为空。** 这是一个授权判断,
    在降级期间从一份谁也清不掉的副本上作答是错的一边。
    """
    from django.conf import settings

    fallback = getattr(settings, "CACHE_PERMISSION_FALLBACK_TTL", None)
    assert fallback is not None, "兜底没有自己的 TTL 设置项"
    assert fallback == 0, (
        f"兜底 TTL 是 {fallback},不是 0 —— 那么 Redis 挂掉时,一次撤销最多还能"
        f"被无视 {fallback} 秒。调大它是一个取舍(每次检查省两条索引查询,"
        f"实测 217 µs),但那要是一个写下来的决定。"
    )


def test_it_is_still_a_separate_number_from_the_shared_one():
    """两个数字必须是两个。

    共用一个就是把跨进程的窗口宽度交给了共享条目的寿命 —— 而那正是修复前的
    状态:兜底跟着 `CACHE_PERMISSION_TTL` 一起是 300 秒。
    """
    from django.conf import settings

    shared = getattr(settings, "CACHE_PERMISSION_TTL", 300)
    fallback = getattr(settings, "CACHE_PERMISSION_FALLBACK_TTL", 0)
    assert fallback != shared, (
        f"兜底与共享 TTL 又是同一个数({shared})—— 跨进程窗口的宽度重新由"
        f"共享条目的寿命决定了"
    )


def test_with_the_default_ttl_the_fallback_never_answers(offline_cache):
    """默认 0:写得进去,读不出来 —— 也就是「降级期间不缓存」。"""
    offline_cache._fallback_ttl = 0
    offline_cache.set("JUDGE", "soul.read", True)
    assert offline_cache.get("JUDGE", "soul.read") is None


def test_a_grant_written_to_the_fallback_expires_on_the_fallback_clock(offline_cache):
    """非零配置下,过期走的是兜底那口钟。"""
    offline_cache._fallback_ttl = 0.05
    offline_cache.set("JUDGE", "soul.read", True)
    assert offline_cache.get("JUDGE", "soul.read") is True
    time.sleep(0.1)
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


@override_settings(CACHE_PERMISSION_TTL=300, CACHE_PERMISSION_FALLBACK_TTL=7)
def test_a_real_instance_wires_the_fallback_ttl_from_its_own_setting():
    """**走 `__init__`,不是手工构造的实例。**

    这个文件上面每一条都不会红于把 `self._fallback_ttl = self._ttl` 写回去 ——
    读 settings 的那几条读的是**设置**,行为那几条用的是 `__new__` 造出来、
    再由测试自己赋值的实例。**接线本身一条都没被走过**,而接线正是这次改的东西。

    实测:把 `__init__` 里那一行改成 `self._fallback_ttl = self._ttl`,
    加这一条之前 **8 passed 全绿**。
    """
    cache = PermissionCache()
    assert cache._fallback_ttl == 7, (
        f"实例拿到的兜底 TTL 是 {cache._fallback_ttl},而设置里写的是 7 —— "
        f"`__init__` 没有从 CACHE_PERMISSION_FALLBACK_TTL 取值"
    )
    assert cache._ttl == 300
    assert cache._fallback_ttl != cache._ttl


def test_an_instance_built_without_init_still_defaults_to_zero():
    """`tests/test_coverage_boost.py` 用 `__new__` 绕过 `__init__` 造纯兜底缓存,
    所以类级默认值也要是 0 —— 否则那条路径上的默认是另一个数。"""
    assert PermissionCache._fallback_ttl == 0
