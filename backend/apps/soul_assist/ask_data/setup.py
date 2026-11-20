"""The database wall for 问数 (docs/ARCHITECTURE-ask-data.md §4; ADR 0007): a read-only login role and a
tenant policy on the four whitelisted tables, in one function that `manage.py ask_data_setup` and
`tests/test_ask_data_rls.py` both call.

Not a migration (ADR 0007): creating a role is cluster-wide, needs CREATEROLE and a password, and a policy
names the role, which does not exist where `migrate` runs first. So these statements are not in the
migration history; running this once per environment is the deploy step.

Idempotent. Each run re-states the role's attributes and password, revokes everything on the four tables
and grants the `granted: true` columns of schema.yaml again (a column removed there loses its grant), and
drops and recreates the policy. RLS is ENABLEd, never FORCEd: the owner role the application runs as
bypasses it, so no business query changes; the policy is `TO` this role only.
"""
import re
from functools import cache
from pathlib import Path

import yaml

SCHEMA = Path(__file__).with_name("schema.yaml")
DEFAULT_ROLE = "soulledger_ask_data"
POLICY = "ask_data_tenant"
#: Same expression as ADR 0006: after a SET LOCAL ends the session reads '' (not NULL) back, and ''::bigint
#: would raise instead of matching nothing. No tenant set = NULL = no row matches.
CURRENT_TENANT = "nullif(current_setting('app.tenant_id', true), '')::bigint"
_IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]{0,62}")


@cache
def tables() -> dict:
    """{db_table: {"columns": [granted column names], "soft_delete": bool}} from schema.yaml."""
    spec = yaml.safe_load(SCHEMA.read_text(encoding="utf-8"))["tables"]
    return {
        name: {"columns": [c["name"] for c in t["columns"] if c["granted"]], "soft_delete": bool(t.get("soft_delete"))}
        for name, t in spec.items()
    }


def _ident(name: str) -> str:
    """Role, table and column names go into DDL unparameterised: lower-case identifiers only."""
    if not _IDENTIFIER.fullmatch(name):
        raise ValueError(f"not a plain identifier: {name!r}")
    return f'"{name}"'


def policy_using(soft_delete: bool) -> str:
    return f"tenant_id = {CURRENT_TENANT}" + (" AND NOT is_deleted" if soft_delete else "")


def apply(connection, role: str = DEFAULT_ROLE, password: str = "") -> None:
    """Create or update `role` and the wall, in one transaction on `connection` (the table owner's)."""
    from django.db import transaction

    if not password:
        raise ValueError("the ask_data role needs a password (ASK_DATA_DB_PASSWORD)")
    r = _ident(role)
    attrs = "LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %s"
    with transaction.atomic(using=connection.alias), connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role])
        cursor.execute(f"{'ALTER' if cursor.fetchone() else 'CREATE'} ROLE {r} {attrs}", [password])
        cursor.execute(f"GRANT USAGE ON SCHEMA public TO {r}")
        for table, spec in tables().items():
            t = _ident(table)
            cursor.execute(f"REVOKE ALL ON {t} FROM {r}")  # takes the column grants with it
            cursor.execute(f"GRANT SELECT ({', '.join(map(_ident, spec['columns']))}) ON {t} TO {r}")
            cursor.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
            cursor.execute(f"DROP POLICY IF EXISTS {POLICY} ON {t}")
            cursor.execute(f"CREATE POLICY {POLICY} ON {t} FOR SELECT TO {r} USING ({policy_using(spec['soft_delete'])})")
