"""`SoulRecord.batch()` 的状态不能是进程级的,`__exit__` 清的必须是真属性。

原实现有三处:

1. `__exit__` 里写 `cls._deferred_soul_ids = set()` —— **这个属性不存在**,
   真名是 `_deferred_souls`。2026-08-29 实跑证实:进出一次之后类上凭空多出一个
   属性,而真正那个集合原封不动。那一行是纯死写。
2. 两个类属性被同进程所有请求共享。两个 batch 交叠时,后进者的 `__enter__`
   会**清空前者累积的集合** —— 那批灵魂的重算就此丢失,反规范化的分数保持陈旧
   **且不报错**。
3. `__exit__` 无条件把 `_batch_mode` 置 False,于是嵌套 `with` 的内层退出会
   把外层的批处理也关掉。

现在是一个 `ContextVar` 装 `(depth, souls)` —— 一个变量,两个值不可能更新不同步。
"""
import threading

import pytest

from apps.souls.models import Soul
from apps.souls.record_models import _BATCH, RecordType, SoulRecord
from apps.tenants.models import Tenant


@pytest.fixture
def souls(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )
    return [Soul.objects.create(name=f"soul-{i}", tenant=tenant) for i in range(3)]


def test_exit_does_not_leave_a_stale_attribute_behind():
    """第 1 条。拼错的那个名字不该再出现在源码里。"""
    import inspect

    source = inspect.getsource(SoulRecord.batch)
    assert "_deferred_soul_ids" not in source, (
        "`_deferred_soul_ids` 又出现了 —— 真名是 `_deferred_souls`,"
        "而这个类上根本没有前者"
    )
    assert not hasattr(SoulRecord, "_deferred_soul_ids")
    assert not hasattr(SoulRecord, "_deferred_souls"), (
        "批处理状态又回到类属性上了 —— 那是跨请求共享的"
    )


@pytest.mark.django_db
def test_the_batch_defers_and_then_flushes(souls):
    """**断存在。** 只断「不共享」的测试,在 batch 什么都不做时也全绿。"""
    with SoulRecord.batch():
        for soul in souls:
            SoulRecord.objects.create(
                soul=soul, record_type=RecordType.MERIT, description="x", weight=5
            )
        depth, deferred = _BATCH.get()
        assert depth == 1
        assert deferred == {s.id for s in souls}
    assert _BATCH.get() == (0, set()) or _BATCH.get()[0] == 0


@pytest.mark.django_db
def test_a_nested_batch_does_not_end_the_outer_one(souls):
    """第 3 条。"""
    with SoulRecord.batch():
        with SoulRecord.batch():
            SoulRecord.objects.create(
                soul=souls[0], record_type=RecordType.MERIT, description="x", weight=1
            )
        # 内层退出之后,外层仍在批处理里
        assert _BATCH.get()[0] == 1, "内层的 __exit__ 把外层的批处理也关掉了"
        SoulRecord.objects.create(
            soul=souls[1], record_type=RecordType.MERIT, description="y", weight=1
        )
        assert _BATCH.get()[1] == {souls[0].id, souls[1].id}


@pytest.mark.django_db(transaction=True)
def test_two_concurrent_batches_do_not_wipe_each_other(souls):
    """第 2 条 —— 审计里标着「高度可疑(读码,未在并发下实跑)」的那半。

    两个线程各自进入 batch,交叠推进:A 进、B 进(旧实现在这里清空 A 的集合)、
    A 记一笔、B 记一笔。旧实现下 A 的那笔会落进 B 的集合或被丢掉。
    """
    b_entered = threading.Event()
    a_recorded = threading.Event()
    seen = {}
    errors = {}

    def worker_a():
        try:
            with SoulRecord.batch():
                b_entered.wait(timeout=5)
                SoulRecord.objects.create(
                    soul=souls[0], record_type=RecordType.MERIT, description="a", weight=1
                )
                seen["a"] = set(_BATCH.get()[1])
        except Exception as exc:  # noqa: BLE001 — 报给断言,不吞
            errors["a"] = repr(exc)
        finally:
            a_recorded.set()

    def worker_b():
        try:
            with SoulRecord.batch():
                b_entered.set()
                a_recorded.wait(timeout=5)
                SoulRecord.objects.create(
                    soul=souls[1], record_type=RecordType.MERIT, description="b", weight=1
                )
                seen["b"] = set(_BATCH.get()[1])
        except Exception as exc:  # noqa: BLE001
            errors["b"] = repr(exc)

    threads = [threading.Thread(target=worker_a), threading.Thread(target=worker_b)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert errors == {}, errors
    assert seen.get("a") == {souls[0].id}, (
        f"A 的批里是 {seen.get('a')};应该只有它自己那一个灵魂"
    )
    assert seen.get("b") == {souls[1].id}, (
        f"B 的批里是 {seen.get('b')};应该只有它自己那一个灵魂"
    )
