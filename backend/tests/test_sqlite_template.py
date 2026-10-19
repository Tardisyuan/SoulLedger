"""The cached migrated SQLite template (config/sqlite_template.py): what its hash
covers, when it is used, and the drift check. No database server, no Django DB."""
import sqlite3

import pytest

from config.sqlite_template import ENV_VAR, input_files, input_hash, mode, tables_that_differ

EXTRA = {"alias": "default", "django": "5.2"}


@pytest.fixture
def tree(tmp_path):
    files = {
        "apps/judgment/migrations/0013_gongguoge_corpus.py": "CODES = ['a']",
        "apps/judgment/snapshot.py": "def f(): pass",
        "apps/soul_assist/corpus/doc.md": "# corpus",
        "apps/audit/signals.py": "# post_migrate receiver",
        "config/settings.py": "INSTALLED_APPS = []",
        "config/settings_multidb.py": "from .settings import *",
        "requirements.lock": "django==5.2",
        "apps/judgment/tests.py": "def test(): pass",
        "apps/judgment/test_models.py": "def test(): pass",
        "apps/judgment/tests/test_x.py": "def test(): pass",
        "tests/test_y.py": "def test(): pass",
        "README.md": "readme",
    }
    for rel, text in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    (tmp_path / "apps/judgment/__pycache__").mkdir()
    (tmp_path / "apps/judgment/__pycache__/snapshot.cpython-311.pyc").write_bytes(b"x")
    return tmp_path


@pytest.mark.parametrize(
    "rel",
    [
        "apps/judgment/migrations/0013_gongguoge_corpus.py",  # a migration
        "apps/judgment/snapshot.py",                           # code a migration imports
        "apps/soul_assist/corpus/doc.md",                      # a data file under apps/
        "apps/audit/signals.py",                               # a post_migrate receiver
        "config/settings.py",
        "config/settings_multidb.py",
        "requirements.lock",
    ],
)
def test_changing_an_input_changes_the_hash(tree, rel):
    before = input_hash(tree, EXTRA)
    (tree / rel).write_text((tree / rel).read_text() + "\n# changed")
    assert input_hash(tree, EXTRA) != before


def test_a_new_migration_changes_the_hash(tree):
    before = input_hash(tree, EXTRA)
    (tree / "apps/judgment/migrations/0014_new.py").write_text("")
    assert input_hash(tree, EXTRA) != before


@pytest.mark.parametrize(
    "rel",
    [
        "apps/judgment/tests.py",
        "apps/judgment/test_models.py",
        "apps/judgment/tests/test_x.py",
        "tests/test_y.py",
        "README.md",
        "apps/judgment/__pycache__/snapshot.cpython-311.pyc",
    ],
)
def test_changing_an_unrelated_file_keeps_the_hash(tree, rel):
    before = input_hash(tree, EXTRA)
    (tree / rel).write_bytes((tree / rel).read_bytes() + b"\n# changed")
    assert input_hash(tree, EXTRA) == before


def test_settings_and_versions_are_in_the_hash(tree):
    assert input_hash(tree, EXTRA) != input_hash(tree, {**EXTRA, "django": "6.0"})
    assert input_hash(tree, EXTRA) != input_hash(tree, {**EXTRA, "alias": "tenant_shadow"})


def test_the_real_tree_covers_migrations_settings_and_the_lock():
    from pathlib import Path

    backend = Path(__file__).resolve().parents[1]
    files = {p.as_posix() for p in input_files(backend)}
    assert "apps/judgment/migrations/0013_gongguoge_corpus.py" in files
    assert "apps/audit/signals.py" in files
    assert "config/settings.py" in files and "requirements.lock" in files
    assert not any(f.startswith("tests/") or f.endswith("/tests.py") for f in files)


@pytest.mark.parametrize(
    ("env", "kw", "expected"),
    [
        ({}, {}, "use"),
        ({ENV_VAR: "0"}, {}, "verify"),
        ({"GATES_FULL": "1"}, {}, "verify"),
        ({}, {"has_migration_tests": True}, "verify"),
        ({}, {"reuse_db": True}, "off"),
        ({}, {"nomigrations": True}, "off"),
        ({ENV_VAR: "0"}, {"reuse_db": True}, "off"),
    ],
)
def test_mode(env, kw, expected):
    args = {"reuse_db": False, "nomigrations": False, "has_migration_tests": False, **kw}
    assert mode(env, **args) == expected


def _db(path, rows, schema="CREATE TABLE t (id integer primary key, name text, created text)"):
    conn = sqlite3.connect(path)
    conn.execute(schema)
    conn.execute("CREATE TABLE other (id integer primary key autoincrement, v text)")
    conn.execute("INSERT INTO other (v) VALUES ('x')")
    conn.executemany("INSERT INTO t (id, name, created) VALUES (?, ?, ?)", rows)
    conn.commit()
    return conn


def test_identical_databases_do_not_differ(tmp_path):
    a = _db(tmp_path / "a.sqlite3", [(1, "x", "2026-10-19 10:00:00.1")])
    b = _db(tmp_path / "b.sqlite3", [(1, "x", "2026-10-19 10:00:00.1")])
    assert tables_that_differ(a, b) == []


def test_only_a_timestamp_differs_is_the_same(tmp_path):
    """Two real migrates differ in seeded create/update times and nothing else."""
    a = _db(tmp_path / "a.sqlite3", [(1, "x", "2026-10-19 10:00:00.123456")])
    b = _db(tmp_path / "b.sqlite3", [(1, "x", "2026-10-19 10:00:27.654321")])
    assert tables_that_differ(a, b) == []


@pytest.mark.parametrize(
    "rows_b",
    [
        [(1, "y", "2026-10-19 10:00:00")],                         # a value
        [(1, "x", "2026-10-19 10:00:00"), (2, "z", "2026-10-19")],  # an extra row
        [],                                                        # a missing row
    ],
)
def test_different_rows_differ_and_are_named(tmp_path, rows_b):
    a = _db(tmp_path / "a.sqlite3", [(1, "x", "2026-10-19 10:00:00")])
    b = _db(tmp_path / "b.sqlite3", rows_b)
    assert tables_that_differ(a, b) == ["t"]


def test_different_schema_differs(tmp_path):
    a = _db(tmp_path / "a.sqlite3", [])
    b = _db(tmp_path / "b.sqlite3", [], schema="CREATE TABLE t (id integer primary key, name text, created text, extra int)")
    assert tables_that_differ(a, b) == ["t"]


def test_autoincrement_sequence_counts(tmp_path):
    a = _db(tmp_path / "a.sqlite3", [])
    b = _db(tmp_path / "b.sqlite3", [])
    b.execute("INSERT INTO other (v) VALUES ('y')")
    b.execute("DELETE FROM other WHERE v = 'y'")  # same rows, sequence moved on
    assert tables_that_differ(a, b) == ["sqlite_sequence"]
