"""pytest 插件:审计断言跑在一个永远不会提交的事务里时,当场失败。

`apps/audit/signals.py` 用 `transaction.on_commit(...)` 写审计日志。在
`@pytest.mark.django_db`(非 transactional)下,Django 把整个测试包在一个最后会
**回滚**的 atomic 块里,那些回调因此**永不执行**。

实跑证据:`django_db` 下对 ApprovalWorkflow 发一次 PATCH,`AuditLog.objects.count()`
是 **0**;同一段代码换成 `django_db(transaction=True)` 才有行。

于是两种断言同时失去意义:

    assert AuditLog.objects.filter(action="UPDATE").exists()   # 对着空表断言,会红
    assert AuditLog.objects.count() == 0                        # **无条件通过**

第一种至少会红,写的人会发现。第二种是无声的:它长得像一条「我们确认没有多写
审计日志」的断言,而它其实什么都没确认 —— 表本来就是空的。这类断言正是
[[verification-mechanisms-fail-silently-here]] 里那一族,失败模式是沉默。

判据分两步,在**测试结束时**合成:

  记录 —— 测试文件里的某一行读了 AuditLog,而当时连接上挂着审计模块注册的、
          尚未执行的 on_commit 回调(记下文件与行号)
  判决 —— 整个测试跑完,这张表**从来没有被真正写过**

第二步是必须的。`apps/workflow/tests.py::test_denied_node_can_still_be_moved_by_escalate`
先读一个基线计数再触发一次**同步**写入的审计行,那条断言完全有效 —— 而在读发生
的那一刻,它和一条空断言长得一模一样。**在读的那一行就下结论,判不出这个区别。**
代价是报错落在测试收尾处,所以消息里带着第一次可疑读取的文件与行号。

**这次读是谁发起的,也是判据的一部分。** 只有写在测试文件里的那一行才算数:
`/api/v1/ledger/stats/overview/` 这类接口自己就要读审计表,而那是被测行为,不是
一条空断言。第一版没有这条,29 个测试因此变红,它们无一例外是「视图内部读了
AuditLog」。**一个会误报的守卫最终会被关掉,那比没有守卫更糟。**

这两条收窄都是实跑逼出来的,不是预先想到的:第一版全量 29 红,第二版 1 红。

不误伤:
  - `transaction=True` 下回调立即随真提交执行,`run_on_commit` 是空的
  - `captureOnCommitCallbacks(execute=True)` 之后同样是空的
  - 与审计无关的 on_commit 回调不算数(按注册函数的 `__module__` 过滤)
  - **本次测试自己直接写过 AuditLog 行**的,不算数。`apps/audit/tests.py` 的
    `TestAuditLogListRetrieve` 在 fixture 里 `AuditLog.objects.create(...)` 两行,
    然后测列表/详情接口 —— 那张表对它不是空的,断言是有意义的。第一版没有这条,
    它把这 6 条报成了缺陷。

**这个守卫会漏什么,说清楚。** 一个既自己插了行、又(徒劳地)断言某条信号写入
存在的测试,不会被抓到。判据是「表对本次测试是不是空的」,不是逐条断言的意图。
不做得更细是有意的:再细就得猜哪条断言指着哪一行,而猜错的守卫比没有更糟。

真需要在未提交上下文里查审计表的测试,加 `@pytest.mark.allow_uncommitted_audit`。
"""

import os
import re
import sys

import pytest

AUDIT_CALLBACK_MODULES = ("apps.audit.signals",)

_TEST_FILE = re.compile(r"(^test_.*\.py$)|(^tests\.py$)")

MARKER = "allow_uncommitted_audit"

_state = {"allowed": False, "seeded": False, "suspect": None}


class VacuousAuditAssertionError(AssertionError):
    """在一个永不提交的事务里查询 AuditLog —— 这次查询读的是一张空表。"""


def _reading_test_line():
    """这次查询是不是由测试文件里的一行直接发起的;是就返回 "文件:行号"。

    从调用栈往上走,跳过守卫自己和 Django ORM 的帧 —— `AuditLog.objects.count()`
    经 `django/db/models/manager.py` 转一手才到这里,直接看上一帧会永远看到 Django。
    第一个「既不是本模块、也不在 django 包里」的帧就是发起者。
    """
    frame = sys._getframe(1)
    while frame is not None:
        filename = frame.f_code.co_filename
        if filename != __file__ and f"{os.sep}django{os.sep}" not in filename:
            if _TEST_FILE.match(os.path.basename(filename)):
                return f"{filename}:{frame.f_lineno}"
            return None
        frame = frame.f_back
    return None


def _pending_audit_callbacks():
    """当前连接上,由审计模块注册且尚未执行的 on_commit 回调。"""
    from django.db import connection

    if not connection.in_atomic_block:
        return []
    pending = []
    for entry in getattr(connection, "run_on_commit", []):
        # Django 的条目形如 (sids, func) 或 (sids, func, robust)。取可调用的那个,
        # 而不是按下标写死 —— 这个元组的宽度在 Django 4.2 加 robust 时变过一次。
        func = next((x for x in entry if callable(x)), None)
        if func is not None and getattr(func, "__module__", "") in AUDIT_CALLBACK_MODULES:
            pending.append(func)
    return pending


def install():
    """把守卫装到 AuditLog 的默认 manager 上。Django 就绪之后才能调。"""
    from apps.audit.models import AuditLog

    # **每一个** manager,不是 `_default_manager`。第一版只装了后者,而
    # `AuditLog._default_manager is AuditLog.objects` 是 **False** —— 于是守卫
    # 装好了、报告「已安装」、一次也没被调用过。这正是它自己要抓的那种形状:
    # 机制在跑,主体选错了。
    managers = [m for m in AuditLog._meta.managers]
    if getattr(AuditLog, "_oncommit_guard_installed", False):
        return
    if not managers:
        raise RuntimeError("AuditLog 上一个 manager 都没有 —— 守卫会静默失效")

    def _wrap(manager):
        original = manager.get_queryset

        def guarded_get_queryset(*args, **kwargs):
            if (
                not _state["allowed"]
                and not _state["seeded"]
                and _state["suspect"] is None
                and _pending_audit_callbacks()
                and (where := _reading_test_line()) is not None
            ):
                _state["suspect"] = where
            return original(*args, **kwargs)

        manager.get_queryset = guarded_get_queryset

    for manager in managers:
        _wrap(manager)

    # 直接写入这张表的测试,后续的查询不算「对着空表断言」。
    #
    # 三个写入入口都要挂,而且 `create`/`bulk_create` 必须挂在 **manager 上**、
    # 在 `get_queryset` 之前把标记立起来:`Manager.create()` 的第一件事就是
    # `self.get_queryset()`,只挂 `save()` 的话守卫会在标记立起来之前就抛,
    # 于是「自己插一行」这个动作本身被守卫拦下。第一版正是这样,而它红的是
    # 那条正对照 —— 正对照又一次先发现了问题。
    original_save = AuditLog.save

    def marking_save(self, *args, **kwargs):
        _state["seeded"] = True
        return original_save(self, *args, **kwargs)

    AuditLog.save = marking_save

    def _mark_then(func):
        def wrapper(*args, **kwargs):
            _state["seeded"] = True
            return func(*args, **kwargs)

        return wrapper

    for manager in managers:
        for write in ("create", "bulk_create", "get_or_create", "update_or_create"):
            if hasattr(manager, write):
                setattr(manager, write, _mark_then(getattr(manager, write)))
    AuditLog._oncommit_guard_installed = True


# ── pytest 钩子 ───────────────────────────────────────────────────────────


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        f"{MARKER}: 这个测试有意在未提交上下文里查询 AuditLog",
    )


def pytest_runtest_setup(item):
    _state["allowed"] = item.get_closest_marker(MARKER) is not None
    _state["seeded"] = False
    _state["suspect"] = None
    try:
        install()
    except Exception:
        # Django 尚未就绪(收集期的少数路径)。下一个测试会再试一次。
        pass


def verdict():
    """测试跑完之后的判决。可疑读取存在,而这张表整场从未被真正写过。"""
    if _state["allowed"] or _state["seeded"] or _state["suspect"] is None:
        return None
    return VacuousAuditAssertionError(
        f"{_state['suspect']} 读了 AuditLog,而那次读发生在一个不会提交的事务里:"
        f"审计信号用 transaction.on_commit 写日志,`django_db` 的事务最后回滚,"
        f"回调永不执行。这张表在本次测试里从头到尾是空的,而本测试也没有自己往里写过。\n"
        f"断言「存在」会红,断言「不存在」**无条件通过** —— 后者是这条守卫存在的理由。\n"
        f"改法:给测试加 `django_db(transaction=True)`,或把触发写入的那段包进 "
        f"`django.test.TestCase.captureOnCommitCallbacks(execute=True)`。\n"
        f"确实要在未提交上下文里查这张表,加 `@pytest.mark.{MARKER}`。"
    )


@pytest.hookimpl(wrapper=True)
def pytest_runtest_call(item):
    """判决落在 call 阶段。放进 teardown,pytest 会把它报成一个与断言无关的错误,
    而读的人第一反应是「清理坏了」。

    用 wrapper 而不是自己调 `item.runtest()`:`pytest_runtest_call` 不是
    firstresult 钩子,自己调一次会让每个测试**跑两遍**。"""
    try:
        result = yield
    except BaseException:
        # 测试自己已经失败了。再叠一条守卫的报错只会把真正的原因挤下去。
        raise
    problem = verdict()
    if problem is not None:
        raise problem
    return result


def pytest_runtest_teardown(item):
    _state["allowed"] = False
    _state["seeded"] = False
    _state["suspect"] = None
