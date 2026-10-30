"""Template-cloned worker databases (config/testdb.py, wired in the root conftest.py).
No DB server needed; the real-PostgreSQL run is what proves the clone works."""
import pytest

from config.testdb import (
    database_digests,
    keeps_templates,
    kept_template_names,
    objects_that_differ,
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
