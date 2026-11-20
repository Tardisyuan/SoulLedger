"""问数评测(docs/ARCHITECTURE-ask-data.md §7):按执行结果比对,再给每题落一个错误分类。

读者:`evalsets/ask_data.json` 的离线 / 在线两种跑法与 `tests/test_ask_data_evals.py`。
闸门、执行器、出 SQL 的模型都由调用方传进来(`evaluate` 的三个参数),这里不 import 它们:
比对与分类是纯函数,没有库也能测;离线整套在真 PostgreSQL 上把真的闸门与执行器接进来。

执行结果的形状(执行器适配成这个):`{"rows": [行…], "truncated": bool}`,或出错时 `{"code": "timeout" | …}`。
"""
import json
import re
from collections import Counter
from datetime import date, datetime, time
from decimal import ROUND_HALF_UP, Decimal

import sqlglot
from sqlglot import exp

#: 每题落且只落一个,按这个顺序判第一个命中的(§7)。
CATEGORIES = (
    "no_sql", "gate_rejected", "timeout", "permission_denied", "execution_error", "truncated", "ok",
    "wrong_table", "wrong_join", "wrong_filter", "wrong_aggregate", "other",
)
_PLACES = Decimal("0.000001")
_FENCE = re.compile(r"```(?:sql)?\s*(.*?)```", re.S | re.I)


def extract_sql(reply):
    """模型回复里的 SQL:有 ``` 围栏取围栏里的,否则取整段;空 → None(分类 `no_sql`)。"""
    if not reply:
        return None
    match = _FENCE.search(reply)
    return (match.group(1) if match else reply).strip() or None


def _value(v):
    """整数精确;小数四舍五入到 6 位(整数值的小数当整数,`count(*)` 与 `sum(…)::numeric` 可比);日期时间 ISO。"""
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, (float, Decimal)):
        d = Decimal(str(v)).quantize(_PLACES, ROUND_HALF_UP)
        return int(d) if d == d.to_integral_value() else d
    if isinstance(v, (date, datetime, time)):
        return v.isoformat()
    if isinstance(v, (list, dict)):
        return json.dumps(v, sort_keys=True, ensure_ascii=False)
    return str(v)  # uuid、interval…


def _key(v):
    return (type(v).__name__, "" if v is None else v)


def _row(row):
    """不比列名、不比列序:一行按值排序。"""
    return tuple(sorted((_value(v) for v in row), key=_key))


def same_result(gold_rows, got_rows, *, ordered):
    gold, got = [_row(r) for r in gold_rows], [_row(r) for r in got_rows]
    return gold == got if ordered else Counter(gold) == Counter(got)


# --- AST 差异(只在结果不同时用来起名字;判不出的落 `other`) ---

def _tree(sql):
    return sqlglot.parse_one(sql, read="postgres")


def tables(tree):
    """用到的表(CTE 名不算)。"""
    ctes = {c.alias_or_name for c in tree.find_all(exp.CTE)}
    return {t.name for t in tree.find_all(exp.Table) if t.name not in ctes}


def _conjuncts(node):
    return list(node.flatten()) if isinstance(node, exp.And) else [node]


def _norm(node, aliases=None):
    """别名换回表名(aliases 给了时)或去掉限定(没给时);`a = b` 与 `b = a` 写成同一个样子。"""
    node = node.copy()
    for col in node.find_all(exp.Column):
        if col.table:
            col.set("table", exp.to_identifier(aliases[col.table]) if aliases and col.table in aliases else None)
    if isinstance(node, exp.EQ):
        return " = ".join(sorted(side.sql(dialect="postgres") for side in (node.left, node.right)))
    return node.sql(dialect="postgres")


def _signature(sql):
    tree = _tree(sql)
    aliases = {t.alias_or_name: t.name for t in tree.find_all(exp.Table)}
    joins = Counter(_norm(c, aliases) for j in tree.find_all(exp.Join) if j.args.get("on")
                    for c in _conjuncts(j.args["on"]))
    where = Counter(_norm(c) for w in tree.find_all(exp.Where) for c in _conjuncts(w.this))
    aggregate = Counter([_norm(g) for grp in tree.find_all(exp.Group) for g in grp.expressions]
                        + ["agg:" + _norm(a) for a in tree.find_all(exp.AggFunc)]
                        + ["having:" + _norm(h.this) for h in tree.find_all(exp.Having)])
    return tables(tree), joins, where, aggregate


def _ast_category(sql, gold_sql):
    try:
        mine, gold = _signature(sql), _signature(gold_sql)
    except sqlglot.errors.SqlglotError:
        return "other"
    for name, a, b in zip(("wrong_table", "wrong_join", "wrong_filter", "wrong_aggregate"), mine, gold, strict=True):
        if a != b:
            return name
    return "other"


def classify(sql, *, gate_code, got, gold, gold_sql, ordered):
    """一题的分类与错误码:`(分类, 码或 None)`。got / gold 是执行结果(见模块说明);gold 必须是成功的。"""
    if not sql:
        return "no_sql", None
    if gate_code:
        return "gate_rejected", gate_code
    code = got.get("code")
    if code in ("timeout", "permission_denied"):
        return code, code
    if code:
        return "execution_error", code
    if got["truncated"] or gold["truncated"]:
        return "truncated", None
    if same_result(gold["rows"], got["rows"], ordered=ordered):
        return "ok", None
    return _ast_category(sql, gold_sql), None


def evaluate(cases, *, generate, check, execute):
    """逐题:gold 跑出期望 → 模型出 SQL → 闸门 → 执行 → 分类。

    generate(case) -> 模型回复文本(离线是 `case["naive_sql"]`);check(sql) -> 闸门错误码或 None;
    execute(sql) -> 执行结果(见模块说明)。gold 自己跑不通是用例集的错,直接报。
    """
    results = []
    for case in cases:
        gold = execute(case["gold_sql"])
        if gold.get("code"):
            raise ValueError(f"{case['id']}: gold_sql failed with {gold['code']}")
        sql = extract_sql(generate(case))
        gate_code = check(sql) if sql else None
        got = execute(sql) if sql and not gate_code else {}
        category, code = classify(sql, gate_code=gate_code, got=got, gold=gold, gold_sql=case["gold_sql"],
                                  ordered=case.get("ordered", False))
        results.append({"id": case["id"], "category": category, "code": code, "expect": case["expect"]})
    return results


def summarize(results):
    """执行准确率 = ok / 非反例题;反例题单独算拒绝率(期望的分类与实际相同)。"""
    graded = [r for r in results if r["expect"] == "ok"]
    adversarial = [r for r in results if r["expect"] != "ok"]
    return {
        "accuracy": f"{sum(r['category'] == 'ok' for r in graded)}/{len(graded)}",
        "rejected": f"{sum(r['category'] == r['expect'] for r in adversarial)}/{len(adversarial)}",
        "counts": dict(sorted(Counter(r["category"] for r in results).items())),
    }
