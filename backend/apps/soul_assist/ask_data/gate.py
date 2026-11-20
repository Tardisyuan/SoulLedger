"""问数的 SQL 闸门(docs/ARCHITECTURE-ask-data.md §3)。

纯函数 `check(sql) -> Verdict`:用 sqlglot 按 postgres 方言解析成 AST,按 AST 判,不按字符串。
闸门是第一道,不是唯一一道 —— §4 的只读角色与 RLS 必须在闸门全失效时也挡得住。

错误码是对外契约(接口 400 的 `code`),按下面的常量断言;规则按表里的顺序判,第一条命中的给码。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import sqlglot
import yaml
from sqlglot import exp
from sqlglot.errors import SqlglotError

UNPARSEABLE = "unparseable"
MULTIPLE_STATEMENTS = "multiple_statements"
NOT_A_SELECT = "not_a_select"
LOCKING_CLAUSE = "locking_clause"
FORBIDDEN_FUNCTION = "forbidden_function"
UNKNOWN_FUNCTION = "unknown_function"
TABLE_NOT_ALLOWED = "table_not_allowed"
STAR_NOT_ALLOWED = "star_not_allowed"

# 树里出现任何一个就不是只读查询。`Into` 是 `SELECT … INTO 新表`(会建表);`TruncateTable` 不在 §3 的表里,
# 同属写操作,一并挡。`Command` 是 sqlglot 认不出、整句吞下的语句(VACUUM、EXPLAIN …)。
_WRITE_NODES = (
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Merge,
    exp.Create,
    exp.Drop,
    exp.Alter,
    exp.Command,
    exp.Copy,
    exp.Set,
    exp.Into,
    exp.TruncateTable,
)

_FORBIDDEN_EXACT = frozenset(
    {
        "pg_read_file",
        "pg_read_binary_file",
        "pg_ls_dir",
        "pg_stat_file",
        "set_config",
        "current_setting",
        "pg_terminate_backend",
        "pg_cancel_backend",
    }
)
_FORBIDDEN_PREFIXES = ("pg_sleep", "dblink", "lo_", "query_to_xml", "txid_", "pg_advisory")

# 放行清单:sqlglot 认得并解析成具体类的函数。认不出的(`Anonymous`)一律拒,所以 `age()`、`make_date()`
# 这类 PG 函数即使无害也过不了 —— 要放就先确认 sqlglot 把它解析成了哪个类,再加到这里。
_ALLOWED_FUNCTIONS = frozenset(
    {
        # 聚合
        exp.Count, exp.Sum, exp.Avg, exp.Min, exp.Max,
        exp.Stddev, exp.StddevPop, exp.StddevSamp, exp.Variance, exp.VariancePop,
        exp.ArrayAgg, exp.GroupConcat, exp.LogicalOr, exp.LogicalAnd,
        exp.PercentileCont, exp.PercentileDisc,
        # 窗口
        exp.RowNumber, exp.Rank, exp.DenseRank, exp.Lag, exp.Lead,
        exp.FirstValue, exp.LastValue, exp.NthValue, exp.Ntile, exp.PercentRank, exp.CumeDist,
        # 条件与类型
        exp.Case, exp.If, exp.Coalesce, exp.Nullif, exp.Greatest, exp.Least,
        exp.Cast, exp.TryCast, exp.Exists,
        # 日期
        exp.Extract, exp.TimestampTrunc, exp.DateTrunc,
        exp.CurrentDate, exp.CurrentTimestamp, exp.CurrentTime, exp.Localtimestamp, exp.Localtime,
        exp.StrToDate, exp.StrToTime, exp.TimeToStr, exp.UnixToTime,
        exp.DateAdd, exp.DateSub, exp.DateDiff,
        # 字符串
        exp.Length, exp.Upper, exp.Lower, exp.Substring, exp.Trim, exp.Concat, exp.ConcatWs,
        exp.SplitPart, exp.Replace, exp.StrPosition, exp.Left, exp.Right, exp.Initcap, exp.Pad,
        exp.RegexpLike, exp.RegexpILike,
        # 逻辑运算:sqlglot 把 AND / OR / XOR 也建模成 Func,不放就连 `WHERE a AND b` 都过不了
        exp.And, exp.Or, exp.Xor,
        # 数值
        exp.Abs, exp.Ceil, exp.Floor, exp.Round, exp.Sqrt, exp.Sign,
    }
)  # fmt: skip


@dataclass(frozen=True)
class Verdict:
    ok: bool
    code: str | None = None
    tables: frozenset[str] = field(default_factory=frozenset)


@cache
def allowed_tables() -> frozenset[str]:
    """白名单表:`schema.yaml` 的 `tables` 键。唯一来源,不在这里抄。"""
    data = yaml.safe_load(Path(__file__).with_name("schema.yaml").read_text(encoding="utf-8"))
    return frozenset(data["tables"])


def _reject(code: str) -> Verdict:
    return Verdict(ok=False, code=code)


def function_name(fn: exp.Func) -> str:
    return (fn.name if isinstance(fn, exp.Anonymous) else fn.sql_name()).lower()


def _is_forbidden(name: str) -> bool:
    return name in _FORBIDDEN_EXACT or name.startswith(_FORBIDDEN_PREFIXES)


def _folded(ident: exp.Identifier) -> str:
    """PG 的标识符规则:不带引号的折成小写,带引号的原样。`JUDGMENT_judgment` 就是白名单表,`"X"` 与 `x` 不是同一个名字。"""
    return ident.name if ident.quoted else ident.name.lower()


def _visible_ctes(table: exp.Table) -> set[str]:
    """沿祖先链收集包住这张表的查询定义的 CTE 名。按作用域收,不收全树:
    别处子查询里定义的 `WITH pg_roles AS (…)` 不能让外层的 `FROM pg_roles` 冒充 CTE。"""
    names: set[str] = set()
    node = table.parent
    while node is not None:
        with_ = node.args.get("with_")
        if isinstance(with_, exp.With):
            names.update(_folded(cte.args["alias"].this) for cte in with_.expressions)
        node = node.parent
    return names


def check(sql: str) -> Verdict:
    if not sql or not sql.strip():
        return _reject(UNPARSEABLE)
    try:
        statements = [s for s in sqlglot.parse(sql, read="postgres") if s is not None]
    except (SqlglotError, RecursionError, ValueError):
        return _reject(UNPARSEABLE)
    if not statements:
        return _reject(UNPARSEABLE)
    if len(statements) != 1:
        return _reject(MULTIPLE_STATEMENTS)
    root = statements[0]

    if not isinstance(root, exp.Query) or any(root.find_all(*_WRITE_NODES)):
        return _reject(NOT_A_SELECT)

    if any(root.find_all(exp.Lock)):
        return _reject(LOCKING_CLAUSE)

    functions = list(root.find_all(exp.Func))
    if any(_is_forbidden(function_name(fn)) for fn in functions):
        return _reject(FORBIDDEN_FUNCTION)
    if any(type(fn) not in _ALLOWED_FUNCTIONS for fn in functions):
        return _reject(UNKNOWN_FUNCTION)

    whitelist = allowed_tables()
    tables: set[str] = set()
    for table in root.find_all(exp.Table):
        if not isinstance(table.this, exp.Identifier) or table.args.get("db") or table.args.get("catalog"):
            return _reject(TABLE_NOT_ALLOWED)
        name = _folded(table.this)
        if name in _visible_ctes(table):
            continue
        if name not in whitelist:
            return _reject(TABLE_NOT_ALLOWED)
        tables.add(name)

    # `count(*)` 里的星号放行;`SELECT *`、`t.*` 不放。
    if any(not isinstance(star.parent, exp.Count) for star in root.find_all(exp.Star)):
        return _reject(STAR_NOT_ALLOWED)

    return Verdict(ok=True, tables=frozenset(tables))
