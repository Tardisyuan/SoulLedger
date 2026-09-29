"""Per-run PostgreSQL test database name. Used only by the root conftest.py.

pytest-django names the test database `test_<NAME>` and suffixes it only for
xdist workers / tox. So two sessions running `pytest --create-db` against the
shared PostgreSQL at once both want `test_soulledger`, and the second fails
every test at setup with `DuplicateDatabase` / `ObjectInUse ... 1 other
session` (2026-09-29). Each run now gets its own name.

SQLite is left alone: its test database is `:memory:` or a local file, so two
runs never meet.

`SOULLEDGER_TEST_DB_SUFFIX` fixes the suffix (e.g. to find the database by
name, or with `--reuse-db`, which a random suffix would defeat). Leftovers
still match `datname like 'test_soulledger%'`.
"""
import os
import re
import secrets

ENV_VAR = "SOULLEDGER_TEST_DB_SUFFIX"
_SAFE = re.compile(r"[a-z0-9_]{1,20}")


def run_suffix() -> str:
    """The env override if set, else 8 random hex chars."""
    value = os.environ.get(ENV_VAR, "")
    if not value:
        return secrets.token_hex(4)
    # It ends up in CREATE/DROP DATABASE; keep it a plain lowercase identifier.
    if not _SAFE.fullmatch(value):
        raise ValueError(f"{ENV_VAR} must match [a-z0-9_]{{1,20}}, got {value!r}")
    return value


def suffix_postgres_test_databases(databases: dict, suffix: str) -> None:
    """Append `_<suffix>` to each PostgreSQL alias's TEST NAME, in place.

    Runs after pytest-django's xdist suffix, so a worker gets
    `test_soulledger_gw0_<suffix>`.
    """
    for db in databases.values():
        if "postgresql" not in db.get("ENGINE", ""):
            continue
        base = db.get("TEST", {}).get("NAME") or f"test_{db['NAME']}"
        db.setdefault("TEST", {})["NAME"] = f"{base}_{suffix}"
