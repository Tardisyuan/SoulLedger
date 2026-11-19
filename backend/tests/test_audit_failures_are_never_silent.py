"""审计写入失败永远不会被静默吞掉:它抛给调用方,业务随之回滚(2026-11-19 用户决定)。

历史:`apps/audit/signals.py` 里先有三份按报错措辞判断「是不是迁移导致的」的手抄副本:

    err_str = str(e).lower()
    migration_related = any(x in err_str for x in [
        'no such table', 'undefinedtable', 'does not exist',
        'relation', 'column', 'constraint', 'programmingerror'
    ])
    if migration_related:
        return          # 连日志都不打

而 PostgreSQL 的日常运行时错误正好含这些子串,于是真实的审计写入失败被完全静默地丢掉。之后换成按上下文
(`_is_migration_context()`)判断、迁移之外一律记 error 再吞掉(`_swallow_or_log`)。现在连吞都不吞了:
审计行与业务同一事务,写不进就整笔回滚(`tests/test_audit_inside_transactions.py` 逐路径注入失败)。
"""
import ast
import inspect
from unittest import mock

import pytest
from django.db import DatabaseError

from apps.audit import signals


@pytest.mark.parametrize(
    "message",
    [
        # 三条都是真实 PostgreSQL 运行时错误的措辞,每条都会命中旧的子串清单。
        'insert or update on table "audit_auditlog" violates foreign key constraint "x"',
        'null value in column "action" violates not-null constraint',
        'relation "audit_auditlog" does not exist',
    ],
)
@pytest.mark.django_db
def test_a_real_database_failure_reaches_the_caller(cn_tenant, message):
    from apps.audit.models import AuditLog
    from apps.souls.models import Soul

    with mock.patch.object(AuditLog, "save", side_effect=DatabaseError(message)), pytest.raises(DatabaseError) as raised:
        Soul.objects.create(name="失败", tenant=cn_tenant)
    assert str(raised.value) == message


@pytest.mark.django_db
def test_during_a_migration_no_row_is_attempted(cn_tenant, monkeypatch):
    """反对照:迁移时表可能还不在,审计整段跳过,不是写了再吞。"""
    from apps.audit.models import AuditLog
    from apps.souls.models import Soul

    monkeypatch.setattr(signals, "_is_migration_context", lambda: True)
    with mock.patch.object(AuditLog, "save") as save:
        Soul.objects.create(name="迁移中", tenant=cn_tenant)
    save.assert_not_called()


def test_nothing_in_the_signals_swallows_an_audit_write():
    """形状守卫:按措辞判断的清单、吞异常的 helper 不许回来;on_commit 只许出现在 `_write_row` 里那一处
    (另一个库上的审计行,挂在业务事务的提交上,见它的 docstring),而且整个模块里没有一个 `except` 包着写入。

    用 AST,不在源码里找字符串 —— docstring 里会逐字引用被删掉的代码(这个仓库栽在「扫描器读到了自己的
    文档」上不止一次)。"""
    tree = ast.parse(inspect.getsource(signals))
    assigned = {t.id for n in ast.walk(tree) if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Name)}
    defined = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    assert "migration_related" not in assigned
    assert "_swallow_or_log" not in defined
    hosts = {f.name for f in ast.walk(tree) if isinstance(f, ast.FunctionDef)
             for n in ast.walk(f) if isinstance(n, ast.Call) and getattr(n.func, "attr", None) == "on_commit"}
    assert hosts <= {"_write_row"}, hosts
    write_row = next(f for f in ast.walk(tree) if isinstance(f, ast.FunctionDef) and f.name == "_write_row")
    assert not [n for n in ast.walk(write_row) if isinstance(n, ast.Try)], "a try around the audit write swallows it"
