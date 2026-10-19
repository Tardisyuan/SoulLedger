"""Per-run PostgreSQL test database name, and the run's resilience to a dropped
database connection. Used by the root conftest.py; also loaded as a pytest
plugin from pytest.ini (`-p config.testdb`) for the two hooks at the bottom.

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
import contextlib
import os
import re
import secrets

import pytest

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


# --- One migration per run: clone worker databases from a template ----------
#
# Under `pytest -n 4` on PostgreSQL every xdist worker used to create its own
# database and replay all ~389 migrations against 115, four times over the
# network. Now the xdist controller (the process with no `workerinput`) builds
# `test_soulledger_tpl_<suffix>` once and migrates it; each worker's database is
# `CREATE DATABASE ... TEMPLATE` that (Django's own TEST["TEMPLATE"]), and its
# migrate finds nothing to apply. The controller drops the template at session
# end, or straight away if building it failed. Wiring: root conftest.py.

def postgres_aliases(databases: dict) -> list:
    """Aliases that get a database of their own on PostgreSQL (mirrors don't)."""
    return [
        alias for alias, db in databases.items()
        if "postgresql" in db.get("ENGINE", "") and not db.get("TEST", {}).get("MIRROR")
    ]


def template_names(databases: dict, suffix: str) -> dict:
    """{alias: template database name}, e.g. `test_soulledger_tpl_<suffix>`."""
    out = {}
    for alias in postgres_aliases(databases):
        db = databases[alias]
        base = db.get("TEST", {}).get("NAME") or f"test_{db['NAME']}"
        out[alias] = f"{base}_tpl_{suffix}"
    return out


def wants_template(databases: dict, *, distributing: bool, reuse_db: bool, nomigrations: bool) -> bool:
    """Build a template only when it saves work and cannot change behaviour.

    Not without xdist (one database, nothing to share), not with `--reuse-db`
    (workers keep their databases; a clone would be wasted or ignored), not with
    `--nomigrations` (workers then build tables with syncdb, which fails on a
    clone that already has them), and never for SQLite.
    """
    return distributing and not reuse_db and not nomigrations and bool(postgres_aliases(databases))


def use_templates(databases: dict, templates: dict) -> None:
    """Point each alias's TEST TEMPLATE at its template, in place (worker side)."""
    for alias, name in templates.items():
        if alias in databases:
            databases[alias].setdefault("TEST", {})["TEMPLATE"] = name


# --- A dropped connection costs one test, not the rest of the worker ---------
#
# 2026-10-19, real PostgreSQL, `-n 4`: gw2's connection to 115 died mid-test
# (`OperationalError: could not receive data from server: Operation timed out`)
# and every later test on gw2 failed with `InterfaceError: connection already
# closed` -- 150 failures and errors from one drop. Django replaces a dead
# connection by itself only when the error surfaces while it rolls back the
# outermost atomic block (it closes and reconnects there). Anywhere else -- a
# transactional test's flush, the next test's atomic.__enter__ -- it keeps the
# dead psycopg2 object, and ensure_connection() never reconnects a non-None one.
#
# So: when any phase of a test raised a connection-level error, close every
# connection after its teardown (pytest-django's per-test atomics are exited by
# then) and the next test's setup connects afresh to the same worker database.
# The failing test still fails; nothing is retried or rewritten.

KEEPALIVES = {
    # libpq: probe an idle link after 30 s, every 10 s, give up after 3 misses,
    # so a dead link becomes an error in about a minute instead of the OS default
    # (two hours on macOS). connect_timeout: a reconnect to an unreachable box
    # fails in 10 s instead of hanging. Test runs only; settings.py is untouched.
    "keepalives": 1,
    "keepalives_idle": 30,
    "keepalives_interval": 10,
    "keepalives_count": 3,
    "connect_timeout": 10,
}

_CONNECTION_LOST = (
    "connection already closed",
    "could not receive data",
    "server closed the connection",
    "operation timed out",
    "terminating connection",
)


def add_keepalives(databases: dict) -> None:
    """Add KEEPALIVES to each PostgreSQL alias's OPTIONS, in place; options already set win.
    SQLite is skipped: sqlite3.connect() rejects these keywords."""
    for db in databases.values():
        if "postgresql" in db.get("ENGINE", ""):
            options = db.setdefault("OPTIONS", {})
            for key, value in KEEPALIVES.items():
                options.setdefault(key, value)


def is_connection_lost(exc) -> bool:
    """InterfaceError / OperationalError (Django's or psycopg2's) whose message
    says the link is gone, anywhere along the cause/context chain."""
    from django.db import InterfaceError, OperationalError

    kinds = (InterfaceError, OperationalError)
    with contextlib.suppress(ImportError):
        import psycopg2

        kinds += (psycopg2.InterfaceError, psycopg2.OperationalError)
    seen = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        if isinstance(exc, kinds) and any(s in str(exc).lower() for s in _CONNECTION_LOST):
            return True
        exc = exc.__cause__ or exc.__context__
    return False


def _close_all_connections() -> None:
    from django.db import connections

    for conn in connections.all(initialized_only=True):
        # An exception out of a pytest hook ends the whole session; never let one out.
        with contextlib.suppress(Exception):
            conn.close()


def close_connections() -> None:
    """This thread's connections, and those of asgiref's one ORM thread, where
    async tests run their queries (see the root conftest's django_db_setup)."""
    from asgiref.sync import SyncToAsync

    _close_all_connections()
    with contextlib.suppress(Exception):
        SyncToAsync.single_thread_executor.submit(_close_all_connections).result(timeout=10)


_connection_lost = pytest.StashKey[bool]()


def pytest_configure(config):
    from django.conf import settings

    add_keepalives(settings.DATABASES)


@pytest.hookimpl(tryfirst=True)
def pytest_runtest_makereport(item, call):
    """Note a connection-level error in setup, call or teardown; after teardown,
    close the connections. Returns None: the report and the failure stand."""
    if call.excinfo is not None and is_connection_lost(call.excinfo.value):
        item.stash[_connection_lost] = True
    if call.when == "teardown" and item.stash.get(_connection_lost, False):
        close_connections()


# --- Teardown: a worker database must not outlive its run --------------------

_DISPOSABLE = re.compile(r"test_soulledger_[a-z0-9_]+")


def is_disposable_test_db(name) -> bool:
    return bool(_DISPOSABLE.fullmatch(name or ""))


def terminate_other_sessions(cursor, name: str) -> None:
    """Terminate every other session on test database `name`, waiting up to 5 s each (PG 14+).

    After the 2026-10-19 drop the server still held gw2's session as idle, and
    pytest-django's plain `DROP DATABASE` (no FORCE) refused, leaving the database
    on 115. Refuses any name that is not `test_soulledger_...`.
    """
    if not is_disposable_test_db(name):
        raise ValueError(f"refusing to terminate sessions on {name!r}: not a test_soulledger_ database")
    cursor.execute(
        "SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity "
        "WHERE datname = %s AND pid <> pg_backend_pid()",
        [name],
    )
