"""pytest 插件:行锁查询连带了关联表却没写 `of=`,在 SQLite 上也当场判失败。

WHY。PostgreSQL 拒绝 `SELECT ... FOR UPDATE` 锁 LEFT OUTER JOIN 的可空一侧:

    NotSupportedError: FOR UPDATE cannot be applied to the nullable side of an outer join

`select_for_update().select_related("<可空外键>")` 正好生成这种查询。SQLite 不实现
FOR UPDATE —— Django 的编译器在 `features.has_select_for_update` 为 False 时连检查都
跳过 —— 所以本地全绿、到 PG 上成片报错。2026-09-17 灵魂端分支实测:SQLite 3931 passed,
PG 上 47 failed / 6 errors,全部是这一句。

判据读的是**编译后的查询对象**,不是源码字符串:包一层 `SQLCompiler.as_sql`,在查询
真正被编译的那一刻看 `query.select_for_update`、`query.select_for_update_of`、
`query.select_related` 与 `query.alias_map` 里的 join 类型。于是经由任何写法(链式、
管理器、`refresh_from_db(from_queryset=...)`)到达数据库的查询都会被看见,注释与字符串不会。

规则比 PostgreSQL 的更严一点:

* 有 LEFT OUTER JOIN 而没有 `of=` —— PG 会报错,违规;
* 有 `select_related` 而没有 `of=` —— INNER JOIN 在 PG 上不报错,但会把关联表的行
  一起锁住(锁一个账号顺带锁住它的灵魂与租户),这几乎从来不是本意,也算违规。

违规先记下,测试 call 阶段结束时判失败,而不是在查询处抛:被测代码里有
`except Exception`(例如开号失败不回滚死亡登记)会把就地抛出的异常吞掉,守卫就沉默了。
"""
import pytest

_violations: list[str] = []
_installed = {"done": False}


def _describe(query) -> str:
    return f"{query.model.__name__ if query.model else '?'}: select_related={query.select_related!r}"


def check(query, sql):
    """返回违规描述或 None。`sql` 是编译器刚产出的 SQL 文本(不是源码)。"""
    if not query.select_for_update or query.select_for_update_of:
        return None
    # LEFT OUTER JOIN 从编译结果里读:select_related 加的 join 在 alias_map 里 refcount 可以是 0,
    # 按 alias_map 数会漏掉 —— 这一版守卫第一次就是这样漏的。
    outer = "LEFT OUTER JOIN" in sql
    if outer or query.select_related:
        return f"{_describe(query)} left_outer_join={outer}"
    return None


def install():
    if _installed["done"]:
        return
    from django.db.models.sql.compiler import SQLCompiler

    original = SQLCompiler.as_sql

    def guarded_as_sql(self, *args, **kwargs):
        result = original(self, *args, **kwargs)
        problem = check(self.query, result[0] if result else "")
        if problem:
            _violations.append(problem)
        return result

    SQLCompiler.as_sql = guarded_as_sql
    _installed["done"] = True


def pytest_runtest_setup(item):
    _violations.clear()
    try:
        install()
    except Exception:
        pass


@pytest.hookimpl(wrapper=True)
def pytest_runtest_call(item):
    result = yield
    if _violations:
        found = sorted(set(_violations))
        _violations.clear()
        pytest.fail(
            "select_for_update() 连带了关联表却没有 of=(\"self\",):\n  "
            + "\n  ".join(found)
            + "\nPostgreSQL 会对可空一侧报 NotSupportedError,或把关联表的行一起锁住。"
            "改成 select_for_update(of=(\"self\",)),或把关联对象拆到锁之外再取。"
            "(apps/core/lock_join_guard.py)",
            pytrace=False,
        )
    return result
