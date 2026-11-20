"""Run one gated SELECT for one hall, on the read-only `ask_data` connection (docs/ARCHITECTURE-ask-data.md §4).

    BEGIN (READ ONLY)  ->  statement_timeout, app.tenant_id  (both SET LOCAL: gone at COMMIT, safe under
    pgbouncer transaction pooling)  ->  the SQL  ->  fetchmany(MAX_ROWS + 1)  ->  COMMIT

The hall comes from the caller (`request.tenant`), never from the question or the model; no hall = nothing
runs. The SQL is not rewritten (no LIMIT added): a result longer than ASK_DATA_MAX_ROWS is cut and flagged.
What stops a bad statement is, in order, the gate (gate.py), then this connection's role and the RLS policy
(setup.py): column-level SELECT only, rows of the current hall only. Known gaps when the gate is bypassed
are in ADR 0007.
"""
import logging
import time
from dataclasses import dataclass

from django.conf import settings
from django.db import DatabaseError, connections, transaction

logger = logging.getLogger(__name__)

ALIAS = "ask_data"

# Error codes: a contract with the view and the evals, asserted by constant.
NOT_CONFIGURED = "ask_data_not_configured"
NO_TENANT = "no_tenant"
NOT_ON_THIS_DATABASE = "not_on_this_database"
TIMEOUT = "timeout"
PERMISSION_DENIED = "permission_denied"
READ_ONLY = "read_only"
EXECUTION_ERROR = "execution_error"

#: SQLSTATE -> code. Anything else is EXECUTION_ERROR (its text goes to the log, not to the caller).
_SQLSTATE = {"57014": TIMEOUT, "42501": PERMISSION_DENIED, "25006": READ_ONLY}


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


def _check_hall(tenant_id) -> None:
    if not tenant_id:
        raise ExecutionError(NO_TENANT)  # fail closed: never run without a hall
    if settings.SHARD_READ_CIVS:
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.filter(pk=tenant_id).first()
        if tenant is None:
            raise ExecutionError(NO_TENANT)
        if tenant.civilization in settings.SHARD_READ_CIVS:
            # The hall's rows are read from its shard, which has no ask_data role (§8: not this version).
            raise ExecutionError(NOT_ON_THIS_DATABASE)


def run(sql: str, tenant_id, *, using: str = ALIAS) -> Result:
    if using not in connections:
        raise ExecutionError(NOT_CONFIGURED)
    _check_hall(tenant_id)
    tenant = str(int(tenant_id))
    max_rows = settings.ASK_DATA_MAX_ROWS
    started = time.monotonic()
    try:
        with transaction.atomic(using=using), connections[using].cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")  # first statement of the transaction, or it is refused
            cursor.execute("SELECT set_config('statement_timeout', %s, true), set_config('app.tenant_id', %s, true)",
                           [str(settings.ASK_DATA_TIMEOUT_MS), tenant])
            cursor.execute(sql)  # no params: a `%` in the SQL is not a placeholder
            columns = [c[0] for c in cursor.description or ()]
            rows = cursor.fetchmany(max_rows + 1) if cursor.description else []
    except DatabaseError as exc:
        cause = exc.__cause__
        code = _SQLSTATE.get(getattr(cause, "pgcode", None) or getattr(cause, "sqlstate", None), EXECUTION_ERROR)
        logger.warning("ask_data: %s (tenant %s): %s", code, tenant, exc)
        raise ExecutionError(code) from exc
    return Result(columns=columns, rows=[list(r) for r in rows[:max_rows]], truncated=len(rows) > max_rows,
                  elapsed_ms=round((time.monotonic() - started) * 1000))
