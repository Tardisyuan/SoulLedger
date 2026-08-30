"""模板查询失败时,不会把外层的判决事务一起带走 —— 也不会假装什么都没发生。

`_resolve_template` 曾经是一个裸的 `except Exception: pass` 包着一次 ORM 查询。
`apps/judgment/services.py` 把步骤 1-4 包在 `transaction.atomic()` 里,第 3 步调
`create_from_judgment`,后者在自己的内层 atomic **之前**调这个方法 —— 于是这次查询
跑在**判决的事务里**。PostgreSQL 上一条失败语句会毒掉整个事务,吞掉它只是把报错
推迟到一条不相干的语句上。在 PostgreSQL 克隆库上复现过:

    inner except swallowed: DataError
    FOLLOW-UP QUERY RAISED TransactionManagementError:
        An error occurred in the current transaction.

与 `apps/perm/migrations/0017` 同形:一个缺失的列被报成「current transaction is
aborted」,而报错指着一行无辜的代码。

**SQLite 上那个吞咽是真正的空操作,所以整个套件对它是盲的。** 下面能测的是两件事,
以及一件只能按形状钉住的事,分别说清楚:

  能测:非 DatabaseError 必须往外抛,不许被当成「回落到内置模板」
  能测:DatabaseError 被接住、被记日志、并且真的回落了
  只能按形状钉:那个 `atomic()`(savepoint)在不在 —— 它的作用只在 PostgreSQL 上
    看得见,在这里造不出失败场景
"""
import ast
import inspect
import logging
import textwrap

import pytest
from django.db import DatabaseError

from apps.workflow.services import WorkflowService


@pytest.mark.django_db
def test_a_database_error_falls_back_and_says_so(caplog, monkeypatch, cn_tenant):
    from apps.workflow import services as mod

    class Boom:
        def filter(self, *a, **k):
            raise DatabaseError('relation "workflow_workflowtemplate" does not exist')

    monkeypatch.setattr(mod.WorkflowTemplate, "objects", Boom())

    with caplog.at_level(logging.WARNING, logger=mod.logger.name):
        template, priority = WorkflowService._resolve_template(
            "CHINESE", "ROUTINE", cn_tenant
        )

    assert template["nodes"], "回落之后应当拿到内置模板"
    assert caplog.records, "查询失败被静默吞掉了 —— 它至少要留下一行"


@pytest.mark.django_db
def test_a_programming_error_in_this_block_is_not_swallowed(monkeypatch, cn_tenant):
    """收窄 except 的那一半。

    裸 `except Exception` 会把这个块里的 TypeError / AttributeError 也变成
    「回落到内置模板」—— 于是审批流带着**错误的节点**建起来,而没有任何迹象表明
    出过事。这条断言那类错误必须往外抛。
    """
    from apps.workflow import services as mod

    class Broken:
        def filter(self, *a, **k):
            raise TypeError("this is a bug in the block, not a database failure")

    monkeypatch.setattr(mod.WorkflowTemplate, "objects", Broken())

    with pytest.raises(TypeError):
        WorkflowService._resolve_template("CHINESE", "ROUTINE", cn_tenant)


def test_the_lookup_runs_inside_a_savepoint():
    """只能按形状钉的那一件。

    `atomic()` 在这里的作用是开一个 savepoint,让失败回滚到它、外层事务仍可用。
    那个作用**只在 PostgreSQL 上存在** —— SQLite 上没有可复现的失败场景,所以
    这里没有行为断言可写。用 AST 确认那个 `with transaction.atomic()` 还在,并且
    把「为什么只能这样测」写在这儿,免得下一个人把它当成一条懒惰的断言删掉。
    """
    # `dedent`,不是 `lstrip` —— 后者只去掉整串的首行缩进,剩下几行仍然缩进,
    # `ast.parse` 当场 IndentationError。同一个坑在这一轮里踩过两次。
    tree = ast.parse(
        textwrap.dedent(inspect.getsource(WorkflowService._resolve_template))
    )
    withs = [n for n in ast.walk(tree) if isinstance(n, ast.With)]
    calls = [
        item.context_expr
        for w in withs
        for item in w.items
        if isinstance(item.context_expr, ast.Call)
    ]
    names = {
        f"{c.func.value.id}.{c.func.attr}"
        for c in calls
        if isinstance(c.func, ast.Attribute) and isinstance(c.func.value, ast.Name)
    }
    assert "transaction.atomic" in names, (
        "模板查询不再跑在 savepoint 里 —— PostgreSQL 上一次失败会毒掉整个判决事务,"
        "而报错会指向一条不相干的语句"
    )


def test_the_except_is_not_bare():
    """`except Exception` 不许回来。上面那条 TypeError 测试只覆盖一种错误类型;
    这一条说的是规则本身。"""
    tree = ast.parse(
        textwrap.dedent(inspect.getsource(WorkflowService._resolve_template))
    )
    handlers = [n for n in ast.walk(tree) if isinstance(n, ast.ExceptHandler)]
    assert handlers, "这个方法里应当还有那个 try/except"
    for h in handlers:
        assert h.type is not None, "裸 except 回来了"
        caught = h.type.id if isinstance(h.type, ast.Name) else None
        assert caught != "Exception", (
            "`except Exception` 回来了 —— 它会把这个块里的编码错误变成"
            "「回落到内置模板」,而那会建出一条节点错误的审批流"
        )
