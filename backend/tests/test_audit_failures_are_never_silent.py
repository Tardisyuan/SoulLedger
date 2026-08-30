"""审计写入失败永远会留下一行日志。

`apps/audit/signals.py` 里有过三份互相手抄的:

    err_str = str(e).lower()
    migration_related = any(x in err_str for x in [
        'no such table', 'undefinedtable', 'does not exist',
        'relation', 'column', 'constraint', 'programmingerror'
    ])
    if migration_related:
        return          # 连日志都不打

而 PostgreSQL 的日常运行时错误正好含这些子串:

    insert or update on table ... violates foreign key **constraint** ...
    null value in **column** ... violates not-null **constraint**
    **relation** ... does not exist

**任何这些形状的真实审计写入失败,被完全静默地丢掉。** C17 那个 `inet` DataError
恰好一个子串都没命中,这是它还能打出一行日志的唯一原因 —— 也就是说,能不能被看见
取决于报错措辞,而不取决于严重程度。

判据换成**上下文**:`_is_migration_context()` 本来就在跟踪迁移是否在跑,而那正是
那份子串清单想要表达的东西。迁移之外,一律记 error。
"""
import logging

import pytest
from django.db import DatabaseError

from apps.audit import signals


@pytest.fixture
def not_in_migration(monkeypatch):
    monkeypatch.setattr(signals, "_is_migration_context", lambda: False)


@pytest.mark.parametrize(
    "message",
    [
        # 三条都是真实 PostgreSQL 运行时错误的措辞,每条都会命中旧的子串清单。
        'insert or update on table "audit_auditlog" violates foreign key constraint "x"',
        'null value in column "action" violates not-null constraint',
        'relation "audit_auditlog" does not exist',
    ],
)
def test_a_real_database_failure_is_logged(caplog, not_in_migration, message):
    with caplog.at_level(logging.ERROR, logger=signals.logger.name):
        signals._swallow_or_log(DatabaseError(message), "Failed to create audit log")

    assert caplog.records, f"这条失败被静默丢掉了:{message}"
    assert message in caplog.text


def test_a_migration_time_failure_is_not_logged_as_an_error(caplog, monkeypatch):
    """反对照。

    没有它,一个「什么都记 error」的实现同样满足上面三条,而那会让每一次
    `migrate` 刷出一屏红色 —— 那正是当初写下那份子串清单的原因。真正的分歧点
    从来不是措辞,是上下文。
    """
    monkeypatch.setattr(signals, "_is_migration_context", lambda: True)
    with caplog.at_level(logging.ERROR, logger=signals.logger.name):
        signals._swallow_or_log(DatabaseError("no such table: audit_auditlog"), "x")
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


def test_the_substring_list_is_gone(not_in_migration):
    """那三份手抄副本不许回来。

    这条守的是形状而不是行为:上面几条只覆盖三种措辞,而那份清单有七项。
    有人补回一个 `if 'deadlock' in str(e): return`,上面几条一条都不会红。
    """
    import ast
    import inspect

    # 用 AST 找**赋值**,不在源码里找字符串。第一版是后者,当场就红了 ——
    # `_swallow_or_log` 的 docstring 里逐字引用了那段被删掉的代码。
    # 只剥 `#` 注释不够:那段引用在三引号字符串里。
    # 这个仓库栽在「扫描器读到了自己的文档」上,这是第三次(前两次:
    # `suiteShape.test.ts` 的规则、`test_execution_records_only_what_happened.py`
    # 的调用检查)。**注释、docstring 和代码在同一段文本里,只有解析能分开它们。**
    tree = ast.parse(inspect.getsource(signals))
    assigned = {
        node.id
        for n in ast.walk(tree)
        if isinstance(n, ast.Assign)
        for node in n.targets
        if isinstance(node, ast.Name)
    }
    assert "migration_related" not in assigned, (
        "按报错措辞判断「是不是迁移导致的」又回来了 —— 判据是上下文,不是子串"
    )
