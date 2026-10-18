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
