"""Run one gated SELECT for one hall, on the read-only `ask_data` connection (docs/ARCHITECTURE-ask-data.md §4).

    BEGIN (READ ONLY)  ->  statement_timeout, app.tenant_id  (both SET LOCAL: gone at COMMIT, safe under
    pgbouncer transaction pooling)  ->  the SQL on a server-side cursor  ->  fetch to MAX_ROWS or MAX_RESULT_BYTES  ->  COMMIT

The hall comes from the caller (`request.tenant`), never from the question or the model; no hall = nothing
runs. Sharded (`settings.SHARDED`), the statement runs on the hall's shard, as the same role: `ask_data_<shard
alias>` (config/shard_db `ask_data_shard_databases`), where the same grants and policy are built (setup.py). The SQL is not rewritten (no LIMIT added): a result longer than ASK_DATA_MAX_ROWS is cut and flagged.
What stops a bad statement is, in order, the gate (gate.py), then `_one_statement` here, then this
connection's role and the RLS policy (setup.py): column-level SELECT only, rows of the current hall only.

`_one_statement` exists because the policy trusts `app.tenant_id`, a setting any role may write, and psycopg2
sends a text through the simple query protocol, which runs every statement in it. So the executor itself,
gate or no gate, sends exactly one statement, never one that ends or restarts the transaction, and never one
that calls `set_config`: the hall setting is written by this module only (ADR 0007).
"""
import logging
import math
import time
from dataclasses import dataclass
from decimal import Decimal

import sqlglot
from django.conf import settings
from django.db import DatabaseError, connections, transaction
from sqlglot import exp
from sqlglot.errors import SqlglotError

from apps.soul_assist.ask_data import gate

logger = logging.getLogger(__name__)

ALIAS = "ask_data"

# Error codes: a contract with the view and the evals, asserted by constant.
NOT_CONFIGURED = "ask_data_not_configured"
NO_TENANT = "no_tenant"
TIMEOUT = "timeout"
PERMISSION_DENIED = "permission_denied"
READ_ONLY = "read_only"
EXECUTION_ERROR = "execution_error"

#: SQLSTATE -> code. Anything else is EXECUTION_ERROR (its text goes to the log, not to the caller).
_SQLSTATE = {"57014": TIMEOUT, "42501": PERMISSION_DENIED, "25006": READ_ONLY}

#: Bytes of result the web process holds per question; a result past it is cut and flagged like one past
#: ASK_DATA_MAX_ROWS. Counted as text length per value, so a guide, not an exact RSS bound.
# ponytail: one row is fetched whole, so a single value near PG's 1 GB field limit still lands in memory; cap
# value size in SQL (or stream column by column) if that ever matters.
MAX_RESULT_BYTES = 4 * 1024 * 1024
_FETCH_BATCH = 10  # rows per round trip from the server-side cursor: at most this many past the byte cap


class ExecutionError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Result:
    columns: list
    rows: list
    truncated: bool
    elapsed_ms: int


def alias_for(tenant_id, using: str = ALIAS) -> str:
    """The alias the hall's rows are read through: `using` itself, or sharded, `<using>_<the hall's shard>`
    (`using` is the control alias; tests pass a throwaway one and name its shard aliases the same way). A hall of
    no known civilization keeps its rows on control (D2), so it reads `using`. No hall = nothing runs."""
    if not tenant_id:
        raise ExecutionError(NO_TENANT)  # fail closed: never run without a hall
    if not settings.SHARDED:
        return using
    from apps.core.shard_reads import CONTROL_ALIAS, alias_for_reads
    from apps.tenants.models import Tenant

    tenant = Tenant.objects.filter(pk=tenant_id).only("code", "declared_civilization").first()
    if tenant is None:
        raise ExecutionError(NO_TENANT)
    shard = alias_for_reads(tenant.civilization)
    return using if shard == CONTROL_ALIAS else f"{using}_{shard}"


#: Roots the executor sends on: a query, or a write the role and READ ONLY refuse in the database (the wall
#: tests send those on purpose). An allow-list, because sqlglot reads `START TRANSACTION`, `ABORT`,
#: `SAVEPOINT x` and `DISCARD ALL` as a column or an alias, and transaction control must never get through.
_SENDABLE = (exp.Query, exp.Insert, exp.Update, exp.Delete, exp.Merge)


def _one_statement(sql: str) -> exp.Expression:
    """Refuse, before anything is sent, what the database wall cannot refuse: a second statement (it would run
    after a forged hall or after a COMMIT), transaction control, and any write of a setting. Codes are the
    gate's."""
    try:
        statements = [s for s in sqlglot.parse(sql or "", read="postgres") if s is not None]
    except (SqlglotError, RecursionError, ValueError):
        raise ExecutionError(gate.UNPARSEABLE) from None
    if len(statements) != 1:
        raise ExecutionError(gate.MULTIPLE_STATEMENTS if statements else gate.UNPARSEABLE)
    root = statements[0]
    if not isinstance(root, _SENDABLE):
        raise ExecutionError(gate.NOT_A_SELECT)
    if any(gate.function_name(fn) == "set_config" for fn in root.find_all(exp.Func)):
        raise ExecutionError(gate.FORBIDDEN_FUNCTION)
    return root


def _size(value) -> int:
    return len(value) if isinstance(value, (str, bytes, bytearray, memoryview)) else 8


def _json_safe(value):
    """What the JSON renderer cannot write becomes something it can: NaN / ±Infinity (float or Decimal) -> None,
    bytea -> PG's `\\x…` hex text. Arrays are walked."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, Decimal):
        return value if value.is_finite() else None
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "\\x" + bytes(value).hex()
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def _fetch(cursor, max_rows: int) -> tuple[list, bool]:
    """Up to `max_rows` rows and at most MAX_RESULT_BYTES of them; truncated if either limit cut something."""
    rows, size = [], 0
    while True:
        batch = cursor.fetchmany(_FETCH_BATCH)
        if not batch:
            return rows, False
        for row in batch:
            size += sum(_size(v) for v in row)
            if size > MAX_RESULT_BYTES or len(rows) == max_rows:
                return rows, True
            rows.append([_json_safe(v) for v in row])


def run(sql: str, tenant_id, *, using: str = ALIAS) -> Result:
    using = alias_for(tenant_id, using)
    if using not in connections:
        raise ExecutionError(NOT_CONFIGURED)  # also a shard with no ask_data alias: a misconfiguration, 503
    root = _one_statement(sql)
    tenant = str(int(tenant_id))
    max_rows = settings.ASK_DATA_MAX_ROWS
    started = time.monotonic()
    try:
        with transaction.atomic(using=using):
            connection = connections[using]
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION READ ONLY")  # first statement of the transaction, or it is refused
                cursor.execute(
                    "SELECT set_config('statement_timeout', %s, true), set_config('app.tenant_id', %s, true)",
                    [str(settings.ASK_DATA_TIMEOUT_MS), tenant])
            # A query runs on a server-side (named) cursor, so only the rows fetched reach this process, not the
            # whole result. A write cannot be DECLAREd; it goes on a plain cursor for the role and READ ONLY to refuse.
            with (connection.chunked_cursor() if isinstance(root, exp.Query) else connection.cursor()) as cursor:
                cursor.execute(sql)  # no params: a `%` in the SQL is not a placeholder
                query = isinstance(root, exp.Query) or cursor.description  # a named cursor's comes on first fetch
                rows, truncated = _fetch(cursor, max_rows) if query else ([], False)
                columns = [c[0] for c in cursor.description or ()]
    except DatabaseError as exc:
        cause = exc.__cause__
        code = _SQLSTATE.get(getattr(cause, "pgcode", None) or getattr(cause, "sqlstate", None), EXECUTION_ERROR)
        logger.warning("ask_data: %s (tenant %s): %s", code, tenant, exc)
        raise ExecutionError(code) from exc
    return Result(columns=columns, rows=rows, truncated=truncated,
                  elapsed_ms=round((time.monotonic() - started) * 1000))
