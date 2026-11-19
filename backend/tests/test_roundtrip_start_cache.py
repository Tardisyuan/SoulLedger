"""The round trip's two speedups (tests/migration_roundtrip.py, 2026-11-19):

* the start-state cache (SQLite, SOULLEDGER_RT_START_CACHE): its key must follow every project module a
  migration imports, transitively, and nothing else; a hit must be exactly what the approach builds; a bad
  entry is a miss; pruning keeps the current generation;
* the latest-schema restore after a round trip: a restore that did not put the schema back is refused, and
  on PostgreSQL the worker database comes back from a clone that is dropped at session end.
"""
import os
import sqlite3
import time

import pytest
from django.db import connection

from tests import migration_roundtrip as rt

SQLITE = connection.vendor == "sqlite"
#: A leaf migration nothing depends on: going back over it is cheap (one CreateModel).
CHEAP_START = [("officer_app", "0002_push_device_session")]


# --- the key ---------------------------------------------------------------------------------------------

def _project(tmp_path):
    files = {
        "apps/__init__.py": "",
        "apps/x/__init__.py": "",
        "apps/x/migrations/__init__.py": "",
        "apps/x/migrations/0001_seed.py": (
            "from django.db import migrations\n"
            "def forward(apps, schema_editor):\n"
            "    from apps.x.helpers import rows\n"
            "    rows()\n"
            "class Migration(migrations.Migration):\n"
            "    operations = [migrations.RunPython(forward)]\n"
        ),
        "apps/x/helpers.py": "from .deep import TABLE\ndef rows():\n    return TABLE\n",
        "apps/x/deep.py": "TABLE = [1, 2, 3]\n",
        "apps/x/loaded.py": "VALUE = 1\n",
        "apps/x/views.py": "def view(request):\n    return None\n",
        "apps/y/__init__.py": "",
        "apps/y/migrations/__init__.py": "",
        "apps/y/migrations/0001_reuse.py": (
            "import importlib\n"
            "X = importlib.import_module('apps.x.loaded')\n"
        ),
        "requirements.lock": "django==5.2\n",
    }
    for rel, text in files.items():
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(text)
    return ["apps.x.migrations.0001_seed", "apps.y.migrations.0001_reuse"]


def test_the_key_follows_what_a_migration_imports_and_nothing_else(tmp_path):
    modules = _project(tmp_path)
    closure = {p.relative_to(tmp_path).as_posix() for p in rt.import_closure(tmp_path, modules)}
    # a helper imported inside a RunPython function, what it imports relatively, import_module("literal"),
    # and the packages on the way
    assert {"apps/x/helpers.py", "apps/x/deep.py", "apps/x/loaded.py", "apps/x/__init__.py"} <= closure
    assert "apps/x/views.py" not in closure

    def key():
        return rt.code_hash(tmp_path, modules, {"django": "5.2"})

    base = key()
    for rel, changed in [
        ("apps/x/views.py", "def view(request):\n    return 1\n"),  # unrelated: same key
    ]:
        (tmp_path / rel).write_text(changed)
        assert key() == base, rel
    for rel, changed in [
        ("apps/x/helpers.py", "from .deep import TABLE\ndef rows():\n    return TABLE[::-1]\n"),
        ("apps/x/deep.py", "TABLE = [1, 2]\n"),
        ("apps/x/loaded.py", "VALUE = 2\n"),
        ("apps/x/migrations/0001_seed.py", "# edited\n"),
        ("requirements.lock", "django==5.2.1\n"),
    ]:
        (tmp_path / rel).write_text(changed)
        assert key() != base, rel
        base = key()
    assert rt.code_hash(tmp_path, modules, {"django": "6.0"}) != base


def test_on_the_real_graph_the_key_holds_the_migration_helpers_and_no_views():
    from pathlib import Path

    backend = Path(rt.__file__).resolve().parents[1]
    modules = [".".join(p.relative_to(backend).with_suffix("").parts) for p in backend.glob("apps/*/migrations/0*.py")]
    closure = {p.relative_to(backend).as_posix() for p in rt.import_closure(backend, modules)}
    assert len(modules) > 300 and len(closure) > len(modules)
    # imported by 167 migrations (RunPython helpers), and a field class migrations name
    assert {"apps/core/migration_ops.py", "apps/death_sync/fields.py"} <= closure
    assert {"apps/realms/views.py", "apps/souls/views.py"}.isdisjoint(closure)


# --- pruning ---------------------------------------------------------------------------------------------

def test_prune_keeps_the_current_generation_and_the_newest_other_one(tmp_path):
    now = time.time()
    ages = {"cur-1.sqlite3": 900, "cur-2.sqlite3": 800, "new-1.sqlite3": 10, "old-1.sqlite3": 500,
            "older-1.sqlite3": 700}
    for name, age in ages.items():
        (tmp_path / name).write_bytes(b"x")
        os.utime(tmp_path / name, (now - age, now - age))
    removed = rt.prune(tmp_path, "cur")
    assert sorted(removed) == ["old-1.sqlite3", "older-1.sqlite3"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["cur-1.sqlite3", "cur-2.sqlite3", "new-1.sqlite3"]
    assert rt.prune(tmp_path, "cur", keep=1) == ["new-1.sqlite3"]


# --- the cache on a real approach ------------------------------------------------------------------------

def _copy():
    plain = sqlite3.connect(":memory:")
    connection.ensure_connection()
    connection.connection.backup(plain)
    return plain


@pytest.fixture
def start_cache(tmp_path, monkeypatch, migration_round_trip):
    if not SQLITE:
        pytest.skip("the start-state cache is SQLite only")
    monkeypatch.setenv(rt.CACHE_ENV, str(tmp_path))
    rt.reset_to_latest()  # both approaches below start from the same latest database
    return tmp_path


def _stats():
    return dict(rt.STATS)


def test_a_hit_is_exactly_what_the_approach_built(start_cache):
    from config.sqlite_template import tables_that_differ

    before = _stats()
    rt.migrate_to(CHEAP_START)
    assert _stats()["miss"] == before["miss"] + 1
    assert len(list(start_cache.glob("*.sqlite3"))) == 1
    built = _copy()

    rt.reset_to_latest()
    rt.migrate_to(CHEAP_START)
    assert _stats()["hit"] == before["hit"] + 1
    assert tables_that_differ(built, _copy()) == []


def test_a_corrupt_or_foreign_entry_is_a_miss_not_an_error(start_cache):
    rt.migrate_to(CHEAP_START)
    (entry,) = start_cache.glob("*.sqlite3")
    rt.reset_to_latest()

    entry.write_bytes(b"not a database")
    misses = _stats()["miss"]
    rt.migrate_to(CHEAP_START)
    assert _stats()["miss"] == misses + 1
    assert sqlite3.connect(entry).execute("PRAGMA quick_check").fetchone()[0] == "ok"  # rewritten
    rt.reset_to_latest()

    # a valid database whose recorder says otherwise (a latest-schema copy under this key)
    connection.connection.backup(dst := sqlite3.connect(entry))
    dst.close()
    rt.migrate_to(CHEAP_START)
    assert _stats()["miss"] == misses + 2
    rt.reset_to_latest()

    entry.unlink()
    rt.migrate_to(CHEAP_START)
    assert _stats()["miss"] == misses + 3


# --- the latest-schema restore ---------------------------------------------------------------------------

def test_migrate_to_latest_keeps_the_rows_a_test_seeded_after_the_snapshot(migration_round_trip):
    """2026-11-19 (red on PostgreSQL in test_explicit_through_round_trip): `migrate_to_latest` restored the
    snapshot of the worker's first round trip, losing every row seeded since. It migrates for real now; only
    teardown (`reset_to_latest`) restores."""
    from apps.tenants.models import Tenant

    rt.migrate_to(CHEAP_START)
    rt.reset_to_latest()  # the snapshot now exists and predates the row below
    Tenant.objects.create(code="RT_KEEP_ME", display_name="rt")
    rt.migrate_to(CHEAP_START)
    rt.migrate_to_latest()
    assert Tenant._base_manager.filter(code="RT_KEEP_ME").exists()


def test_a_restore_that_did_not_put_the_schema_back_is_refused(migration_round_trip, monkeypatch):
    rt.reset_to_latest()
    rt.migrate_to(CHEAP_START)
    monkeypatch.setattr(rt, "_restore_latest_db", lambda: True)
    with pytest.raises(AssertionError, match="not at the latest migration"):
        rt.reset_to_latest()
    monkeypatch.undo()  # the fixture's teardown restores for real


@pytest.mark.skipif(SQLITE, reason="CREATE DATABASE ... TEMPLATE is PostgreSQL")
def test_postgresql_restores_the_latest_schema_from_a_clone_and_drops_it(migration_round_trip):
    from config.testdb import database_exists

    rt.migrate_to(CHEAP_START)
    assert rt._LATEST, "no clone of the latest schema was taken"
    clone = rt._LATEST
    assert rt.restore_latest_snapshot()  # raises unless the schema is back at latest
    size = rt.drop_pg_latest()
    print(f"\nlatest-schema clone {clone}: {size} bytes")
    with connection.creation._nodb_cursor() as cur:
        assert not database_exists(cur, clone)
    assert size and size > 0
