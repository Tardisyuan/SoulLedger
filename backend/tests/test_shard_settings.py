"""Sharding stage 2, part A: the shard aliases' settings and plumbing (docs/audit/2026-11-15-sharding/PLAN.md).

  * `SHARD_DATABASE_URL_<CIV>` adds `civ_<civ>` on the shard engine; one for every civilization makes the process
    SHARDED, none leaves production with `default` alone, some but not all refuse to start (asked of a fresh
    process, not of this run's settings); the retired per-civilization switches are ignored;
  * a name that is no civilization is refused at startup;
  * `shard_aliases()` is what DATABASES has, not a list;
  * `manage.py migrate_shards` migrates every shard, and with none configured does nothing;
  * a `sharded` test skips without the four shards and stops the run with only some (root conftest.py).

The `sharded` tests here run under `--ds=config.settings_sharded -m sharded`; the rest in every run.
"""
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.db import connections

from apps.core.sharding import check_shard_settings, civilization_aliases, shard_aliases
from config.shard_db import ENV_PREFIX, databases_from_env

BACKEND = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND.parent
PG = "postgres://u:p@db.example:5432/soulledger_{}"
ALL = {f"{ENV_PREFIX}{c}": PG.format(c.lower()) for c in ("CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK")}


def _env(**extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith((ENV_PREFIX, "DJANGO_SETTINGS_MODULE"))}
    env.update(SECRET_KEY="ci-test-key-not-for-production-32-bytes-min", DEBUG="true",
               DATABASE_URL="sqlite:///:memory:", DJANGO_SETTINGS_MODULE="config.settings", **extra)
    return env


def _settings_in_a_fresh_process(**env):
    """DATABASES and DATABASE_ROUTERS as a new process with this environment builds them."""
    code = ("import json, django; from django.conf import settings; django.setup(); "
            "print(json.dumps({'databases': settings.DATABASES, 'routers': settings.DATABASE_ROUTERS, "
            "'sharded': settings.SHARDED}, default=str))")
    proc = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=_env(**env),
                          capture_output=True, text=True, timeout=120)
    return proc, (json.loads(proc.stdout.strip().splitlines()[-1]) if proc.returncode == 0 else None)


# --- settings ---------------------------------------------------------------

#: The switches of the per-civilization cut-over (stages 3-5), still in the test box's environment: ignored.
RETIRED = {"SHARD_READ_CIVS": "GREEK", "SHARD_WRITE_CIVS": "GREEK", "SHARD_PURGED_CIVS": "GREEK"}


def test_without_the_env_production_has_default_alone_and_is_not_sharded():
    proc, out = _settings_in_a_fresh_process(**RETIRED)
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert list(out["databases"]) == ["default"], out["databases"]
    assert out["routers"] == ["config.sharding.ShardRouter"]
    assert out["sharded"] is False


def test_every_url_adds_its_alias_on_the_shard_engine_and_the_process_is_sharded():
    """The rule since 2026-11-21: the aliases decide. A partial list in the retired switches changes nothing.
    Mutation: SHARDED not derived from the aliases -> `sharded` is False here."""
    proc, out = _settings_in_a_fresh_process(**ALL, **RETIRED)
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert sorted(out["databases"]) == [*civilization_aliases(), "default"], out["databases"]
    greek = out["databases"]["civ_greek"]
    assert greek["ENGINE"] == "config.shard_db.postgresql" and greek["NAME"] == "soulledger_greek", greek
    assert greek["HOST"] == "db.example"
    assert out["sharded"] is True


def test_some_but_not_all_urls_refuse_to_start():
    proc, _ = _settings_in_a_fresh_process(**{f"{ENV_PREFIX}GREEK": PG.format("greek")})
    assert proc.returncode != 0 and "needs every civilization's shard" in proc.stderr, proc.stderr[-2000:]
    assert "civ_chinese" in proc.stderr


@pytest.mark.parametrize("value, want", [(None, 600), ("0", 0)])
def test_db_conn_max_age_reaches_default_and_every_shard(value, want):
    """2026-11-16: a runserver test backend kept a connection per thread per alias for 600 s and filled the test
    server's 100 with the four shard aliases. DB_CONN_MAX_AGE=0 closes them at the end of each request."""
    env = dict(ALL)
    if value is not None:
        env["DB_CONN_MAX_AGE"] = value
    proc, out = _settings_in_a_fresh_process(**env)
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert {a: d["CONN_MAX_AGE"] for a, d in out["databases"].items()} == dict.fromkeys(["default", *civilization_aliases()],
                                                                                        want)


def test_a_url_that_names_no_civilization_refuses_to_start():
    proc, _ = _settings_in_a_fresh_process(**{f"{ENV_PREFIX}CHINA": PG.format("china")})
    assert proc.returncode != 0 and "civ_china" in proc.stderr and "name no civilization" in proc.stderr, proc.stderr[-2000:]


def test_every_civilization_has_its_env_var_and_nothing_else_reads():
    """The aliases come from the variable names; they must be exactly the ones `alias_for_civilization` routes to."""
    out = databases_from_env({**ALL, "DATABASE_URL": PG.format("x"), f"{ENV_PREFIX}EMPTY": "  "},
                             disable_server_side_cursors=True)
    assert list(out) == civilization_aliases() and len(out) == 4
    for alias, db in out.items():
        assert db["ENGINE"] == "config.shard_db.postgresql" and db["NAME"] == f"soulledger_{alias[4:]}", db
        assert db["DISABLE_SERVER_SIDE_CURSORS"] is True and db["CONN_MAX_AGE"] == 600


def test_a_shard_url_that_is_not_postgresql_is_refused():
    with pytest.raises(ValueError, match=f"{ENV_PREFIX}GREEK must be a PostgreSQL URL"):
        databases_from_env({f"{ENV_PREFIX}GREEK": "sqlite:///shard.sqlite3"})


def test_startup_check_refuses_a_stray_shard_alias_and_accepts_the_four():
    check_shard_settings(databases={"default": {}, **dict.fromkeys(civilization_aliases(), {})}, sharded=True)
    with pytest.raises(ImproperlyConfigured, match=r"\['civ_china'\] name no civilization"):
        check_shard_settings(databases={"default": {}, "civ_greek": {}, "civ_china": {}}, sharded=False)


def test_shard_aliases_are_what_databases_has(settings):
    settings.DATABASES = {"default": {}, "replica": {}, "civ_greek": {}, "civ_chinese": {}}
    assert shard_aliases() == ["civ_chinese", "civ_greek"]
    settings.DATABASES = {"default": {}}
    assert shard_aliases() == []


# --- migrate_shards ----------------------------------------------------------

def test_migrate_shards_with_no_shard_does_nothing(monkeypatch):
    called = []
    monkeypatch.setattr("apps.tenants.management.commands.migrate_shards.shard_aliases", lambda: [])
    monkeypatch.setattr("apps.tenants.management.commands.migrate_shards.call_command", lambda *a, **k: called.append(a))
    out = io.StringIO()
    call_command("migrate_shards", stdout=out)
    assert "nothing to migrate" in out.getvalue() and called == []


@pytest.mark.sharded
@pytest.mark.django_db(databases="__all__")
def test_migrate_shards_migrates_each_shard_and_only_shards():
    out = io.StringIO()
    call_command("migrate_shards", "--check", stdout=out)  # the test databases are migrated: nothing unapplied
    said = [ln.split()[-1] for ln in out.getvalue().splitlines() if ln.startswith("migrate --database ")]
    assert said == civilization_aliases(), out.getvalue()


@pytest.mark.sharded
@pytest.mark.django_db(databases="__all__")
def test_migrate_shards_check_finds_an_unapplied_migration_on_one_shard():
    """One shard loses a migration record: --check fails, and the other databases' records are untouched."""
    victim = "civ_egyptian"
    counts = {}
    for alias in connections:
        with connections[alias].cursor() as c:
            c.execute("SELECT count(*) FROM django_migrations")
            counts[alias] = c.fetchone()[0]
    with connections[victim].cursor() as c:
        c.execute("DELETE FROM django_migrations WHERE id = (SELECT max(id) FROM django_migrations)")
    with pytest.raises(SystemExit):
        call_command("migrate_shards", "--check", stdout=io.StringIO())
    for alias in connections:
        with connections[alias].cursor() as c:
            c.execute("SELECT count(*) FROM django_migrations")
            assert c.fetchone()[0] == counts[alias] - (alias == victim), alias


# --- the `sharded` marker ----------------------------------------------------

def _collect_control_boundary(**env):
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-c", str(REPO_ROOT / "pytest.ini"), "--no-cov", "-q", "-p", "no:cacheprovider",
         "-rs", "backend/tests/test_control_boundary.py"],
        cwd=REPO_ROOT, env=_env(REDIS_URL=os.environ.get("REDIS_URL", "redis://127.0.0.1:6399/0"), **env),
        capture_output=True, text=True, timeout=300)


def test_a_sharded_test_skips_without_shards_and_a_partial_set_stops_the_run():
    """Mutation: the conftest hook never skips -> the first run errors on a missing alias. A partial set no longer
    reaches the conftest: Django's startup check refuses it first (`check_shard_settings`)."""
    none = _collect_control_boundary()
    assert none.returncode == 0 and "6 skipped" in none.stdout and "needs --ds=config.settings_sharded" in none.stdout, \
        none.stdout[-2000:]
    partial = _collect_control_boundary(**{f"{ENV_PREFIX}GREEK": PG.format("greek")})
    assert partial.returncode != 0 and "needs every civilization's shard" in partial.stdout + partial.stderr, \
        (partial.stdout + partial.stderr)[-2000:]


# --- a purged control database refuses to start not sharded -----------------------------------------------

@pytest.mark.django_db
def test_a_purged_control_refuses_to_start_unless_sharded(settings):
    """GlobalCode SHARD_PURGED on control and no shard URLs: the process would serve the purged civilizations as empty,
    and only the sync refused it. The system check (runserver, migrate, check) and Celery's worker / beat start refuse;
    no record, or sharded, starts. Mutations: the check unregistered -> `check` passes; `settings.SHARDED` not asked ->
    the sharded process is refused; Celery's receiver raising an exception instead of SystemExit -> Celery starts."""
    from django.core.management.base import SystemCheckError

    from apps.core.shard_sync import PURGED, purged_control_needs_shards
    from apps.tenants.models import GlobalCode
    from config.celery import refuse_purged_control_without_shards

    settings.SHARDED = False
    assert purged_control_needs_shards(databases=["default"]) == []
    call_command("check", "--database", "default", stdout=io.StringIO())
    refuse_purged_control_without_shards()

    GlobalCode.objects.using("default").create(kind=PURGED, value="GREEK")
    assert [e.id for e in purged_control_needs_shards(databases=["default"])] == ["sharding.E001"]
    assert purged_control_needs_shards() == []  # outside migrate / check --database: not asked
    with pytest.raises(SystemCheckError, match=r"\['GREEK'\] were purged"):
        call_command("check", "--database", "default", stdout=io.StringIO())
    with pytest.raises(SystemExit, match="sharding.E001"):
        refuse_purged_control_without_shards()

    settings.SHARDED = True
    assert purged_control_needs_shards(databases=["default"]) == []
    refuse_purged_control_without_shards()


def test_a_database_with_no_tables_yet_passes_the_purge_check():
    """A first `migrate` runs the system checks before any table exists (here: a fresh in-memory SQLite): no GlobalCode
    table is no record. Mutation: `purge_records` without its table check and the check without `except DatabaseError`
    -> "no such table" and a non-zero exit (either one alone keeps it green)."""
    proc = subprocess.run([sys.executable, "manage.py", "check", "--database", "default"], cwd=BACKEND, env=_env(),
                          capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-2000:]
