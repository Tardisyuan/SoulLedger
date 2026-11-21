"""问数的四步(docs/ARCHITECTURE-ask-data.md §2):召回 → 模型出 SQL → 闸门 → 只读执行。视图与 `manage.py ask_data` 共用。

殿只来自调用方(`request.tenant` / 命令的 `--tenant`),不来自问题,不来自模型。模型只看到问题、召回到的表说明与
今天的日期,不看任何一行数据;结果只回给官员(沿用 docs/ARCHITECTURE-officer-assist.md §2.2)。

失败一律抛 `AskDataError(status, code, sql)`:码是对外契约(闸门的码见 gate.py,执行器的码见 executor.py)。
"""
import json

from django.db import connections
from django.utils import timezone

from apps.soul_assist import features
from apps.soul_assist.ask_data import evals, executor, gate, schema
from apps.soul_assist.redact import data_block

MAX_QUESTION = 500
#: 执行器用的数据库别名。测试把它换成一个以只读角色登录的临时别名。
ALIAS = executor.ALIAS

SYSTEM = (
    "You write ONE PostgreSQL SELECT statement that answers an officer's question about the case data of their own "
    "hall in SoulLedger. Use only the tables and columns listed in the facts; any other table or column is refused. "
    "Never filter by hall or tenant: the database shows only the officer's own hall. Never use SELECT * or t.*; "
    "name the columns. One statement only, no semicolon-separated second statement, no writes, no locking clauses. "
    "Use plain SQL functions (count, sum, avg, min, max, date_trunc, extract, age, make_date, generate_series, coalesce, "
    "CASE). Dates are relative to "
    "`today` in the facts. Reply with the SQL in one ```sql fenced block and nothing else."
)

#: 执行器的码 → HTTP 状态。其余(超时、权限、只读、执行出错、执行器自己拒的)是这条 SQL 不行:400。
_STATUS = {executor.NOT_CONFIGURED: 503, executor.NO_TENANT: 403, executor.NOT_ON_THIS_DATABASE: 409}


class AskDataError(Exception):
    def __init__(self, status, code, sql=None):
        super().__init__(code)
        self.status, self.code, self.sql = status, code, sql


def configured(using=None) -> bool:
    return (using or ALIAS) in connections


def run_sql(sql, tenant_id, *, using=None) -> dict:
    """闸门 → 执行器。`--sql` 演示与接口共用后半段。"""
    verdict = gate.check(sql)
    if not verdict.ok:
        raise AskDataError(400, verdict.code, sql)
    try:
        result = executor.run(sql, tenant_id, using=using or ALIAS)
    except executor.ExecutionError as exc:
        raise AskDataError(_STATUS.get(exc.code, 400), exc.code, sql) from exc
    return {"sql": sql, "columns": result.columns, "rows": result.rows, "truncated": result.truncated,
            "elapsed_ms": result.elapsed_ms}


def generate(request, question, *, today=None, conn=None):
    """召回 → 模型 → SQL(回复里没有就是 None)。模型不可用抛 `features.FeatureUnavailableError`。"""
    found = schema.recall(question)
    facts = {"today": (today or timezone.localdate()).isoformat(), "tables": schema.describe(found.tables)}
    done = features.complete("ask_data", request, system=SYSTEM, facts=json.dumps(facts, ensure_ascii=False),
                             prompt=data_block("question", question[:MAX_QUESTION]), conn=conn)
    return evals.extract_sql(done.text)


def ask(request, question) -> dict:
    tenant = getattr(request, "tenant", None)
    if tenant is None:
        raise AskDataError(403, executor.NO_TENANT)  # 没绑殿的 ADMIN 不开放(§9 Q2);不调模型
    if not configured():
        raise AskDataError(503, executor.NOT_CONFIGURED)  # 先于模型:没有库就不花模型的钱
    try:
        sql = generate(request, question)
    except features.FeatureUnavailableError as exc:
        raise AskDataError(exc.status, exc.code) from exc
    return run_sql(sql or "", tenant.pk)


def eval_hooks(tenant_id, *, using=None):
    """`evals.evaluate` 的 check 与 execute:真闸门、真执行器(`ask_data_eval` 与 tests/test_ask_data_evals.py 共用)。"""

    def check(sql):
        verdict = gate.check(sql)
        return None if verdict.ok else verdict.code

    def execute(sql):
        try:
            result = executor.run(sql, tenant_id, using=using or ALIAS)
        except executor.ExecutionError as exc:
            return {"code": exc.code}
        return {"rows": result.rows, "truncated": result.truncated}

    return check, execute
