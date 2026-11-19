"""Template-cloned worker databases (config/testdb.py, wired in the root conftest.py).
No DB server needed; the real-PostgreSQL run is what proves the clone works."""
import os
import re
import sys
import time

import pytest

from config import testdb
from config.testdb import (
    database_digests,
    gate_slot,
    in_use,
    keeps_templates,
    kept_template_names,
    objects_that_differ,
    prune_templates,
    stale_templates,
    template_names,
    touch_template,
    use_templates,
    wants_template,
)

PG = "django.db.backends.postgresql"
SQLITE = "django.db.backends.sqlite3"


def dbs(**extra):
    out = {"default": {"ENGINE": PG, "NAME": "soulledger"}}
    out.update(extra)
    return out


def test_template_name_carries_the_run_suffix():
    assert template_names(dbs(), "abc") == {"default": "test_soulledger_tpl_abc"}


def test_every_postgres_alias_gets_its_own_template_and_mirrors_none():
    d = dbs(
        tenant_shadow={"ENGINE": PG, "NAME": "soulledger_shadow"},
        replica={"ENGINE": PG, "NAME": "soulledger", "TEST": {"MIRROR": "default"}},
    )
    assert template_names(d, "abc") == {
        "default": "test_soulledger_tpl_abc",
        "tenant_shadow": "test_soulledger_shadow_tpl_abc",
    }


def test_explicit_test_name_is_the_base():
    d = dbs()
    d["default"]["TEST"] = {"NAME": "custom"}
    assert template_names(d, "abc") == {"default": "custom_tpl_abc"}


def test_sqlite_never_gets_a_template():
    d = {"default": {"ENGINE": SQLITE, "NAME": ":memory:"}}
    assert template_names(d, "abc") == {}
    assert not wants_template(d, distributing=True, reuse_db=False, nomigrations=False)


def test_postgres_under_xdist_wants_one():
    assert wants_template(dbs(), distributing=True, reuse_db=False, nomigrations=False)


@pytest.mark.parametrize("flags", [
    {"distributing": False, "reuse_db": False, "nomigrations": False},  # -n 0: old behaviour
    {"distributing": True, "reuse_db": True, "nomigrations": False},
    {"distributing": True, "reuse_db": False, "nomigrations": True},
])
def test_postgres_falls_back_to_per_worker_migrate(flags):
    assert not wants_template(dbs(), **flags)


def test_worker_side_sets_django_test_template():
    d = dbs()
    use_templates(d, {"default": "test_soulledger_tpl_abc", "gone": "x"})
    assert d["default"]["TEST"]["TEMPLATE"] == "test_soulledger_tpl_abc"
    assert "gone" not in d


def test_worker_without_templates_is_untouched():
    d = dbs()
    before = repr(d)
    use_templates(d, {})
    assert repr(d) == before


# --- GATES_IN_REMOTE=1: a kept template per input hash (2026-10-30) --------

H = "0123456789abcdef0123"


def test_only_the_remote_gate_run_keeps_templates():
    assert keeps_templates({"GATES_IN_REMOTE": "1"})
    assert not keeps_templates({})
    assert not keeps_templates({"GATES_IN_REMOTE": "0"})


def test_kept_name_carries_the_input_hash_not_the_run_suffix():
    assert kept_template_names(dbs(), {"default": H + "ffff"}) == {"default": f"test_soulledger_tpl_h{H}"}


def test_pruning_keeps_the_newest_three_by_last_use_and_this_runs_own():
    names = {i: f"test_soulledger_tpl_h{str(i) * 20}" for i in range(1, 7)}
    rows = [(names[i], str(1000 + i)) for i in range(1, 7)]
    rows += [("test_soulledger_tpl_abcd1234", "9999"),  # a per-run template: never pruned here
             ("test_soulledger_shadow_tpl_h" + H, "1"),  # another alias's base
             ("test_soulledger_gw0_x", "")]
    # This run uses the oldest one; it stays, with the two newest others.
    assert stale_templates(rows, names[1]) == [names[4], names[3], names[2]]
    assert stale_templates(rows, names[6]) == [names[3], names[2], names[1]]
    # Without a comment (never touched) a template counts as oldest.
    assert stale_templates([(names[2], None), (names[3], "5")], names[1], keep=2) == [names[2]]


class _Cursor:
    """Answers the queries database_digests makes from {table: [row text]}."""

    def __init__(self, tables, columns=(("column:t.id", "1|integer"),)):
        self.tables, self.columns, self.result, self.executed = tables, list(columns), [], []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))
        if "information_schema.columns" in sql:
            self.result = self.columns
        elif sql.startswith("SELECT tablename"):
            self.result = [(t,) for t in sorted(self.tables)]
        elif sql.startswith("SELECT t::text"):
            self.result = [(r,) for r in self.tables[sql.split('public."')[1].split('"')[0]]]
        else:
            self.result = []

    def fetchall(self):
        return self.result


def test_two_migrates_that_differ_only_in_timestamps_are_the_same():
    a = database_digests(_Cursor({"django_migrations": ['(1,auth,0001,"2026-10-30 01:02:03.456+00")']}))
    b = database_digests(_Cursor({"django_migrations": ['(1,auth,0001,"2026-10-31 09:09:09.1+00")']}))
    assert objects_that_differ(a, b) == []


def test_a_different_row_order_is_the_same_table():
    a = database_digests(_Cursor({"t": ["(1,a)", "(2,b)"]}))
    b = database_digests(_Cursor({"t": ["(2,b)", "(1,a)"]}))
    assert objects_that_differ(a, b) == []


def test_a_changed_seed_row_a_missing_table_or_a_changed_column_differ():
    base = database_digests(_Cursor({"t": ["(1,a)"], "u": []}))
    assert objects_that_differ(base, database_digests(_Cursor({"t": ["(1,b)"], "u": []}))) == ["rows:t"]
    assert objects_that_differ(base, database_digests(_Cursor({"t": ["(1,a)"]}))) == ["rows:u"]
    changed = database_digests(_Cursor({"t": ["(1,a)"], "u": []}, columns=(("column:t.id", "1|bigint"),)))
    assert objects_that_differ(base, changed) == ["column:t.id"]


def test_touch_refuses_anything_but_a_test_database():
    cursor = _Cursor({})
    touch_template(cursor, f"test_soulledger_tpl_h{H}", 1700000000.9)
    assert cursor.executed[-1] == (f'COMMENT ON DATABASE "test_soulledger_tpl_h{H}" IS %s', ["1700000000"])
    with pytest.raises(ValueError):
        touch_template(cursor, "soulledger", 1)


# --- Gate slots sharing one PG server (2026-11-17) ----------------------------


def test_no_slot_keeps_the_unslotted_name_and_a_slot_is_in_the_name():
    assert gate_slot({}) == "" and gate_slot({"SL_GATE_SLOT": "x y"}) == ""
    assert gate_slot({"SL_GATE_SLOT": "2"}) == "s2_"
    assert kept_template_names(dbs(), {"default": H}, gate_slot({"SL_GATE_SLOT": "2"})) == {
        "default": f"test_soulledger_tpl_s2_h{H}"}


class _PgCursor:
    """pg_database rows for the LIKE the prune issues (applied here), a busy set for the in-use query."""

    def __init__(self, rows, busy=()):
        self.rows, self.busy, self.dropped, self.result = rows, set(busy), [], []

    def execute(self, sql, params=None):
        if sql.startswith("SELECT datname"):
            pat = params[0].replace("\\_", "\0").replace("%", ".*").replace("\0", "_")
            self.result = [r for r in self.rows if re.fullmatch(pat, r[0])]
        elif "pg_stat_activity" in sql:
            self.result = [(1,)] if params[0] in self.busy else []
        elif sql.startswith("DROP DATABASE"):
            self.dropped.append(sql.split('"')[1])

    def fetchall(self):
        return self.result

    def fetchone(self):
        return self.result[0] if self.result else None


def _slot_rows():
    return [(f"test_soulledger_tpl_{slot}h{str(i) * 20}", str(1000 + i)) for slot in ("", "s1_", "s2_") for i in range(1, 6)]


def test_two_slots_never_prune_each_others_templates():
    rows = _slot_rows()
    for slot in ("s1_", "s2_", ""):
        mine = f"test_soulledger_tpl_{slot}h{'5' * 20}"
        cur = _PgCursor(rows)
        dropped = prune_templates(cur, mine)
        assert dropped and all(n.startswith(f"test_soulledger_tpl_{slot}h") for n in dropped), (slot, dropped)
        assert mine not in dropped


def test_a_template_in_use_is_not_dropped_and_a_failed_check_counts_as_in_use():
    rows = _slot_rows()
    mine = f"test_soulledger_tpl_s1_h{'5' * 20}"
    busy = f"test_soulledger_tpl_s1_h{'2' * 20}"
    cur = _PgCursor(rows, busy={busy})
    dropped = prune_templates(cur, mine)
    assert busy not in dropped and busy not in cur.dropped and dropped  # the others still go

    class Broken(_PgCursor):
        def execute(self, sql, params=None):
            if "pg_stat_activity" in sql:
                raise RuntimeError("no")
            super().execute(sql, params)

    assert in_use(Broken([]), busy) is True


# --- Several aliases migrate at once (2026-11-19) ------------------------------

linux_only = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="the parallel build forks: Linux only")
ALIASES = ("default", "civ_chinese", "civ_european", "civ_egyptian", "civ_greek")


class _FakeConnections:
    """connections[alias].creation.create_test_db writes `<alias>` = its pid into `out`, after `delay[alias]` s;
    an alias in `fail` raises."""

    def __init__(self, out, delay=None, fail=()):
        self.out, self.delay, self.fail = out, delay or {}, set(fail)

    def __getitem__(self, alias):
        fake = self

        class Creation:
            def create_test_db(self, **kwargs):
                assert kwargs == {"verbosity": 0, "autoclobber": True, "serialize": False}
                time.sleep(fake.delay.get(alias, 0))
                if alias in fake.fail:
                    raise RuntimeError(f"migrate {alias} broke")
                (fake.out / alias).write_text(str(os.getpid()))

        return type("Conn", (), {"creation": Creation()})()

    def close_all(self):
        pass


def test_the_build_is_parallel_on_linux_only_and_can_be_forced_serial():
    assert testdb.parallel_build_ok({}, "linux")
    assert not testdb.parallel_build_ok({}, "darwin")
    assert not testdb.parallel_build_ok({"SOULLEDGER_TEMPLATE_BUILD_SERIAL": "1"}, "linux")


@linux_only
def test_five_aliases_build_at_once_each_in_its_own_process(tmp_path, monkeypatch):
    monkeypatch.delenv("SOULLEDGER_TEMPLATE_BUILD_SERIAL", raising=False)
    monkeypatch.setattr("django.db.connections", _FakeConnections(tmp_path, delay=dict.fromkeys(ALIASES, 1.5)))
    started = time.monotonic()
    testdb.build_test_databases(set(ALIASES))
    took = time.monotonic() - started
    pids = {(tmp_path / a).read_text() for a in ALIASES}
    assert len(pids) == len(ALIASES) and str(os.getpid()) not in pids
    assert took < 1.5 * len(ALIASES) / 2, f"{took:.1f}s for five 1.5 s builds: not concurrent"


def test_serial_builds_every_alias_in_this_process(tmp_path, monkeypatch):
    monkeypatch.setattr("django.db.connections", _FakeConnections(tmp_path))
    testdb.build_test_databases(set(ALIASES), parallel=False)
    assert {(tmp_path / a).read_text() for a in ALIASES} == {str(os.getpid())}


@linux_only
def test_a_failed_alias_fails_the_build_and_names_it(tmp_path, monkeypatch):
    monkeypatch.setattr("django.db.connections", _FakeConnections(tmp_path, fail={"civ_greek"}))
    with pytest.raises(RuntimeError, match=r"\['civ_greek'\]"):
        testdb.build_test_databases(set(ALIASES), parallel=True)
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(set(ALIASES) - {"civ_greek"})


@linux_only
def test_a_hung_alias_is_killed_at_the_limit_and_fails_the_build(tmp_path, monkeypatch):
    monkeypatch.setattr(testdb, "BUILD_TIMEOUT", 2)
    monkeypatch.setattr("django.db.connections", _FakeConnections(tmp_path, delay={"civ_egyptian": 60}))
    started = time.monotonic()
    with pytest.raises(RuntimeError, match=r"\['civ_egyptian'\]"):
        testdb.build_test_databases(set(ALIASES), parallel=True)
    assert time.monotonic() - started < 20


# --- SQLite: the missing templates of a worker, at once (2026-11-19) ------------

from config import sqlite_template  # noqa: E402


class _SqliteConns:
    def __init__(self, dbs):
        self.dbs = dbs

    def __getitem__(self, alias):
        db = self.dbs[alias]
        return type("Conn", (), {"vendor": db["vendor"], "settings_dict": db})()

    def close_all(self):
        pass


def test_prebuild_builds_only_the_missing_sqlite_templates_and_nothing_when_all_exist(tmp_path, monkeypatch):
    dbs = {"default": {"vendor": "sqlite"}, "civ_a": {"vendor": "sqlite"}, "civ_b": {"vendor": "sqlite"},
           "pg": {"vendor": "postgresql"}, "mirror": {"vendor": "sqlite", "TEST": {"MIRROR": "default"}}}
    monkeypatch.setattr("django.db.connections", _SqliteConns(dbs))
    monkeypatch.setattr(sqlite_template, "template_path", lambda d, b, s, alias: tmp_path / f"{alias}-{'0' * 40}.sqlite3")
    (tmp_path / f"default-{'0' * 40}.sqlite3").write_text("")
    calls = []
    monkeypatch.setattr("config.testdb.run_in_children", lambda aliases, build: calls.append(list(aliases)))
    assert sqlite_template.prebuild(set(dbs), directory=tmp_path, backend_dir=tmp_path) == ["civ_a", "civ_b"]
    assert calls == [["civ_a", "civ_b"]]
    for alias in ("civ_a", "civ_b"):
        (tmp_path / f"{alias}-{'0' * 40}.sqlite3").write_text("")
    assert sqlite_template.prebuild(set(dbs), directory=tmp_path, backend_dir=tmp_path) == []
    assert calls == [["civ_a", "civ_b"]], "built again with every template there"


def test_the_build_lock_is_per_alias(tmp_path):
    import threading

    got = threading.Event()

    def other():
        with sqlite_template._locked(tmp_path, "civ_b"):
            got.set()

    with sqlite_template._locked(tmp_path, "civ_a"):
        t = threading.Thread(target=other, daemon=True)
        t.start()
        assert got.wait(5), "a second alias waited for the first alias's build"


def test_saving_a_template_prunes_only_that_aliases_older_ones(tmp_path):
    import sqlite3

    for i, alias in enumerate(["default"] * 4 + ["civ_a"] * 4):
        p = tmp_path / f"{alias}-{i:040d}.sqlite3"
        p.write_text("")
        os.utime(p, (1000 + i, 1000 + i))
    src = sqlite3.connect(":memory:")
    sqlite_template._save(src, tmp_path / f"default-{'f' * 40}.sqlite3")
    left = sorted(p.name.split("-")[0] for p in tmp_path.glob("*.sqlite3"))
    assert left == ["civ_a"] * 4 + ["default"] * sqlite_template.KEEP, left


# --- The test clock does not run while test databases are built ----------------

def _clock_probe(tmp_path, body):
    """A child pytest under a copy of the root conftest, whose database setup takes 4 s against a 2 s limit."""
    import shutil
    import subprocess
    from pathlib import Path

    repo = Path(__file__).resolve().parents[2]
    shutil.copy(repo / "conftest.py", tmp_path / "conftest.py")
    probe = tmp_path / "test_clock_probe.py"
    probe.write_text(
        "import time\n"
        "import django.test.utils as u\n"
        "def slow_setup(*a, **k):\n"
        "    time.sleep(4)\n"
        "    return []\n"
        "u.setup_databases = slow_setup\n"
        "u.teardown_databases = lambda *a, **k: None\n"
        f"def test_probe(django_db_setup):\n    {body}\n"
    )
    return subprocess.run(
        [sys.executable, "-m", "pytest", str(probe), "-c", str(repo / "pytest.ini"), "-q", "--no-header", "--no-cov",
         "-p", "no:cacheprovider", "-n", "0", "-o", "faulthandler_timeout=2", "-o", "faulthandler_exit_on_timeout=true"],
        cwd=repo, capture_output=True, text=True, timeout=120,
        env={**os.environ, "PYTHONPATH": str(repo / "backend"), "DJANGO_SETTINGS_MODULE": "config.settings",
             "DATABASE_URL": "sqlite:///:memory:"},
    )


def test_a_slow_database_setup_is_not_the_first_tests_time(tmp_path):
    proc = _clock_probe(tmp_path, "pass")
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_the_clock_runs_again_once_the_databases_exist(tmp_path):
    proc = _clock_probe(tmp_path, "time.sleep(4)")
    assert proc.returncode != 0 and "Timeout" in proc.stdout + proc.stderr, proc.stdout + proc.stderr
