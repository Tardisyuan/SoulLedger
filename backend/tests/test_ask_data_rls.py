"""问数's database wall (docs/ARCHITECTURE-ask-data.md §4, ADR 0007): the read-only role, the column grants and
the tenant policy from `apps/soul_assist/ask_data/setup.py`, and the executor that runs a statement on it.

Every statement here goes to the executor directly, past the gate (gate.py): the wall must hold with the gate
gone. The fixture runs the same `setup.apply` as `manage.py ask_data_setup`, with a role whose name has a
random suffix (roles are cluster-wide), connects as that role through a throwaway alias, and removes the
policies, the RLS switch and the role after the test -- the same clean-up shape as
`test_row_level_security_probe.py`.

PostgreSQL only, apart from the first four tests (no database / no hall / the alias of a sharded hall / the shard
aliases' settings): SQLite has no RLS.
Proven red 2026-11-21 (setup.py mutated, then restored): policy `USING (true)`, RLS never enabled, and a
table-wide `GRANT SELECT` each turned the tests that guard them red; see ADR 0007.
"""
import time
import uuid

import pytest
import yaml
from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import override_settings

from apps.disposition.models import Disposition
from apps.judgment.models import Judgment
from apps.sentence_plan.models import SentencePlan
from apps.soul_assist.ask_data import executor, setup
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests import ask_data_wall

SQLITE = connection.vendor == "sqlite"
PG_ONLY = pytest.mark.skipif(SQLITE, reason="Row-level security exists only on PostgreSQL.")
WALLED = [Judgment, Soul, Disposition, SentencePlan]
TABLES = [m._meta.db_table for m in WALLED]


def test_no_ask_data_database_is_not_configured():
    with pytest.raises(executor.ExecutionError) as err:
        executor.run("SELECT 1", 1, using="ask_data_never_configured")
    assert err.value.code == executor.NOT_CONFIGURED


def test_no_hall_runs_nothing():
    for tenant_id in (None, 0, ""):
        with pytest.raises(executor.ExecutionError) as err:
            executor.run("SELECT 1", tenant_id, using="default")
        assert err.value.code == executor.NO_TENANT


@pytest.mark.django_db
def test_sharded_a_hall_reads_through_its_shards_alias_and_one_not_configured_is_503():
    """Decision 2 (2026-11-21): sharded, `<alias>_<the hall's shard>`; a hall of no known civilization keeps its rows
    on control (D2) and reads `<alias>`; not sharded, `<alias>` with no lookup. A shard alias that does not exist is
    a misconfiguration: NOT_CONFIGURED (503), nothing sent. The real-PG run is tests/test_ask_data_sharded.py."""
    greek = Tenant.objects.create(code="ASK_GR", display_name="ASK_GR", declared_civilization="GREEK")
    nowhere = Tenant.objects.create(code="ASK_XX", display_name="ASK_XX")
    assert nowhere.civilization == "UNKNOWN"
    assert executor.alias_for(greek.pk, "ask_x") == "ask_x"
    with override_settings(SHARDED=True):
        assert executor.alias_for(greek.pk, "ask_x") == "ask_x_civ_greek"
        assert executor.alias_for(nowhere.pk, "ask_x") == "ask_x"
        with pytest.raises(executor.ExecutionError) as err:
            executor.alias_for(greek.pk + nowhere.pk + 1000)
        assert err.value.code == executor.NO_TENANT
        with pytest.raises(executor.ExecutionError) as err:
            executor.run("SELECT 1", greek.pk, using="default")  # there is no `default_civ_greek`
        assert err.value.code == executor.NOT_CONFIGURED


def test_one_ask_data_url_serves_every_shard_and_keeps_its_password_out_of_theirs():
    from config.shard_db import ask_data_shard_databases

    def db(user, name, host):
        return {"ENGINE": "django.db.backends.postgresql", "USER": user, "PASSWORD": f"{user}-pw", "NAME": name,
                "HOST": host, "PORT": "5432", "OPTIONS": {"sslmode": "require"}}

    databases = {"default": db("owner", "sl", "control"), "ask_data": db("soulledger_ask_data", "sl", "control"),
                 "civ_greek": db("owner", "sl_gr", "gr-host"), "civ_chinese": db("owner", "sl_cn", "cn-host")}
    derived = ask_data_shard_databases(databases)
    assert sorted(derived) == ["ask_data_civ_chinese", "ask_data_civ_greek"]
    gr = derived["ask_data_civ_greek"]
    assert (gr["USER"], gr["PASSWORD"], gr["NAME"], gr["HOST"]) == ("soulledger_ask_data", "soulledger_ask_data-pw",
                                                                     "sl_gr", "gr-host")
    assert gr["TEST"] == {"MIRROR": "civ_greek"} and gr["OPTIONS"] is not databases["ask_data"]["OPTIONS"]
    assert all(d["PASSWORD"] == "owner-pw" for a, d in databases.items() if a.startswith("civ_"))
    assert ask_data_shard_databases({k: v for k, v in databases.items() if k != "ask_data"}) == {}


def _rows(sql, hall, alias):
    return executor.run(sql, hall.pk, using=alias).rows


def _hall(code):
    tenant = Tenant.objects.create(code=code, display_name=code, declared_civilization="CHINESE")
    soul = Soul.objects.create(name=f"{code} soul", tenant=tenant, current_state=SoulState.JUDGING)
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=tenant)
    disposition = Disposition.objects.create(soul=soul, tenant=tenant, judgment=case)
    plan = SentencePlan.all_objects.create(soul=soul, tenant=tenant, origin_judgment_id=case.pk)
    return tenant, {Soul: soul, Judgment: case, Disposition: disposition, SentencePlan: plan}


@pytest.fixture
def halls():
    """Hall A and hall B with one live row in each walled table; A also has one soft-deleted row in each."""
    a, a_rows = _hall("ASK_A")
    b, b_rows = _hall("ASK_B")
    ghost = Soul.objects.create(name="deleted soul", tenant=a, current_state=SoulState.JUDGING)
    ghost_case = Judgment.objects.create(soul=ghost, civilization=ghost.civilization, tenant=a)
    deleted = {Soul: ghost, Judgment: ghost_case,
               Disposition: Disposition.objects.create(soul=ghost, tenant=a, judgment=ghost_case),
               SentencePlan: SentencePlan.all_objects.create(soul=ghost, tenant=a, origin_judgment_id=ghost_case.pk)}
    with connection.cursor() as cursor:
        for model, row in deleted.items():
            cursor.execute(f"UPDATE {model._meta.db_table} SET is_deleted = true WHERE id = %s", [row.pk])  # noqa: S608
    return {"A": (a, a_rows), "B": (b, b_rows), "deleted": deleted}


@pytest.fixture
def wall(halls):
    """`setup.apply` as `ask_data_setup` runs it, and an alias that logs in as the new role (tests/ask_data_wall.py)."""
    with ask_data_wall.wall() as (role, alias):
        yield {**halls, "role": role, "alias": alias}


@PG_ONLY
@pytest.mark.django_db(transaction=True)
def test_a_hall_counts_only_its_own_rows_without_writing_a_filter(wall):
    (a, a_rows), (_b, b_rows), alias = wall["A"], wall["B"], wall["alias"]
    for model in WALLED:
        table = model._meta.db_table
        assert _rows(f"SELECT count(*) FROM {table}", a, alias) == [[1]], table
        assert _rows(f"SELECT id FROM {table}", a, alias) == [[a_rows[model].pk]], table
        assert _rows(f"SELECT id FROM {table} WHERE id = '{b_rows[model].pk}'", a, alias) == [], table
    joined = _rows("SELECT j.id, s.id FROM judgment_judgment j JOIN souls_soul s ON s.id = j.soul_id", a, alias)
    assert joined == [[a_rows[Judgment].pk, a_rows[Soul].pk]]
    # B through the same wall sees B's, not A's: the policy follows the setting, not the connection.
    assert _rows("SELECT id FROM judgment_judgment", wall["B"][0], alias) == [[b_rows[Judgment].pk]]


@PG_ONLY
@pytest.mark.django_db(transaction=True)
def test_soft_deleted_rows_are_invisible(wall):
    a, alias = wall["A"][0], wall["alias"]
    for model, row in wall["deleted"].items():
        table = model._meta.db_table
        assert _rows(f"SELECT id FROM {table} WHERE id = '{row.pk}'", a, alias) == [], table
        with connection.cursor() as cursor:  # still there for the owner
            cursor.execute(f"SELECT tenant_id FROM {table} WHERE id = %s", [row.pk])  # noqa: S608
            assert cursor.fetchone() == (a.pk,), table


@PG_ONLY
@pytest.mark.django_db(transaction=True)
def test_no_hall_set_reads_nothing_and_the_hall_ends_with_its_transaction(wall):
    a, alias = wall["A"][0], wall["alias"]
    with connections[alias].cursor() as cursor:  # this role, never set on this session: fail closed
        for table in TABLES:
            cursor.execute(f"SELECT count(*) FROM {table}")  # noqa: S608
            assert cursor.fetchone() == (0,), table
    assert _rows("SELECT count(*) FROM judgment_judgment", a, alias) == [[1]]
    # Same connection after the executor's COMMIT: the SET LOCAL is gone, as it would be for the next client
    # pgbouncer hands this server connection to.
    with connections[alias].cursor() as cursor:
        cursor.execute("SELECT current_setting('app.tenant_id', true), current_setting('statement_timeout')")
        hall, timeout = cursor.fetchone()
        assert hall in (None, "") and timeout != "3s"
        for table in TABLES:
            cursor.execute(f"SELECT count(*) FROM {table}")  # noqa: S608
            assert cursor.fetchone() == (0,), table


@PG_ONLY
@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize(("sql", "codes"), [
    ("UPDATE judgment_judgment SET court = 'x'", {executor.READ_ONLY, executor.PERMISSION_DENIED}),
    ("DELETE FROM souls_soul", {executor.READ_ONLY, executor.PERMISSION_DENIED}),
    ("SELECT confession FROM judgment_judgment", {executor.PERMISSION_DENIED}),
    ("SELECT name FROM souls_soul", {executor.PERMISSION_DENIED}),
    (f"SELECT id FROM {get_user_model()._meta.db_table}", {executor.PERMISSION_DENIED}),
    ("SELECT no_such_column FROM judgment_judgment", {executor.EXECUTION_ERROR}),
])
def test_what_the_gate_would_refuse_the_database_refuses_too(wall, sql, codes):
    a, alias = wall["A"][0], wall["alias"]
    with pytest.raises(executor.ExecutionError) as err:
        executor.run(sql, a.pk, using=alias)
    assert err.value.code in codes
    with connection.cursor() as cursor:  # and nothing was written
        cursor.execute("SELECT count(*) FROM souls_soul WHERE NOT is_deleted")
        assert cursor.fetchone() == (2,)
        cursor.execute("SELECT count(*) FROM judgment_judgment WHERE court = 'x'")
        assert cursor.fetchone() == (0,)


@PG_ONLY
@pytest.mark.django_db(transaction=True)
def test_a_slow_statement_is_cancelled_at_the_timeout(wall):
    started = time.monotonic()
    with pytest.raises(executor.ExecutionError) as err:
        executor.run("SELECT pg_sleep(10)", wall["A"][0].pk, using=wall["alias"])
    assert err.value.code == executor.TIMEOUT
    assert time.monotonic() - started < 5


@PG_ONLY
@pytest.mark.django_db(transaction=True)
def test_a_long_result_is_cut_at_max_rows_and_flagged(wall):
    a, alias = wall["A"][0], wall["alias"]
    long = executor.run("SELECT generate_series(1, 500) AS n", a.pk, using=alias)
    assert (len(long.rows), long.truncated, long.columns) == (200, True, ["n"])
    assert long.rows[0] == [1] and long.rows[-1] == [200]
    exact = executor.run("SELECT generate_series(1, 200) AS n", a.pk, using=alias)
    assert (len(exact.rows), exact.truncated) == (200, False)


@PG_ONLY
@pytest.mark.django_db(transaction=True)
def test_a_wide_result_is_cut_at_the_byte_cap_on_a_server_side_cursor(wall):
    """Review 2026-11-21: a plain cursor pulled the whole result into the web process (221 -> 1185 MB RSS) before
    `fetchmany` cut it. Now the statement runs on a named cursor (it sees itself in `pg_cursors`) and the fetch
    stops at MAX_RESULT_BYTES."""
    a, alias = wall["A"][0], wall["alias"]
    assert executor.run("SELECT count(*) FROM pg_cursors", a.pk, using=alias).rows == [[1]]
    wide = executor.run("SELECT lpad('x', 1000000, 'x') AS w FROM generate_series(1, 50)", a.pk, using=alias)
    held = sum(len(w) for (w,) in wide.rows)
    assert wide.truncated and 0 < held <= executor.MAX_RESULT_BYTES and len(wide.rows) < 50


@PG_ONLY
@pytest.mark.django_db(transaction=True)
def test_the_statement_runs_in_a_read_only_transaction(wall):
    """Deleting `SET TRANSACTION READ ONLY` kept every other test green (the role has no write grant anyway)."""
    result = executor.run("SELECT current_setting('transaction_read_only')", wall["A"][0].pk, using=wall["alias"])
    assert result.rows == [["on"]]


@PG_ONLY
@pytest.mark.django_db(transaction=True)
def test_values_json_cannot_write_come_back_as_null_or_text(wall):
    """NaN / Infinity (float and numeric) and bytea made the view 500 after the audit row said ok."""
    from rest_framework.renderers import JSONRenderer

    sql = ("SELECT 'NaN'::float8, 'Infinity'::float8, '-Infinity'::numeric, 'NaN'::numeric, 1.5::numeric, "
           "'\\x00ff'::bytea, ARRAY['NaN'::float8, 2.5]")
    rows = executor.run(sql, wall["A"][0].pk, using=wall["alias"]).rows
    assert [[None if v is None else str(v) for v in r[:6]] + [r[6]] for r in rows] == [
        [None, None, None, None, "1.5", "\\x00ff", [None, 2.5]]]
    JSONRenderer().render(rows)  # raised ValueError / UnicodeDecodeError before


@PG_ONLY
@pytest.mark.django_db(transaction=True)
def test_the_date_and_series_functions_the_gate_allows_run_as_the_read_only_role(wall):
    """Decision 1 (2026-11-21): the by-name / newly listed functions pass the gate and the role may call them."""
    from apps.soul_assist.ask_data import gate

    a, alias = wall["A"][0], wall["alias"]
    sql = ("SELECT m, count(j.id) FROM generate_series(make_date(2026, 1, 1), make_date(2026, 3, 1), "
           "interval '1 month') AS m LEFT JOIN judgment_judgment j ON false "
           "WHERE age(m) IS NOT NULL AND justify_interval(make_interval(days => 40)) IS NOT NULL "
           "AND date_part('year', m) = 2026 AND to_char(m, 'YYYY') = '2026' GROUP BY m ORDER BY m")
    assert gate.check(sql).ok
    result = executor.run(sql, a.pk, using=alias)
    assert [[str(m)[:10], n] for m, n in result.rows] == [["2026-01-01", 0], ["2026-02-01", 0], ["2026-03-01", 0]]


FORGES = [
    # (text, the code the executor refuses it with). Each would read hall B, or run outside the read-only
    # transaction, if it reached the database: psycopg2 sends a text as one simple query, which runs every
    # statement in it, and app.tenant_id is a setting any role may write (ADR 0007).
    ("SELECT set_config('app.tenant_id', '{b}', true); SELECT id FROM judgment_judgment", "multiple_statements"),
    ("SET LOCAL app.tenant_id = '{b}'; SELECT id FROM judgment_judgment", "multiple_statements"),
    ("COMMIT; SELECT id FROM judgment_judgment", "multiple_statements"),
    ("SELECT 1; DROP TABLE souls_soul", "multiple_statements"),
    # One statement that writes the setting before the table is scanned.
    ("WITH f AS MATERIALIZED (SELECT set_config('app.tenant_id', '{b}', true)) SELECT j.id FROM f, judgment_judgment j",
     "forbidden_function"),
    ("SELECT id FROM judgment_judgment WHERE pg_catalog.set_config('app.tenant_id', '{b}', true) IS NOT NULL",
     "forbidden_function"),
    ("SET LOCAL app.tenant_id = '{b}'", "not_a_select"),
    ("RESET ALL", "not_a_select"),
    ("COMMIT", "not_a_select"),
    ("START TRANSACTION", "not_a_select"),  # sqlglot reads this as an alias: refused as "not on the allow-list"
    ("ABORT", "not_a_select"),
    ("DO $$ BEGIN PERFORM 1; END $$", "not_a_select"),
    ("SEL/**/ECT 1", "unparseable"),
    ("", "unparseable"),
]


@pytest.mark.parametrize(("forge", "code"), FORGES)
def test_the_executor_sends_one_statement_and_never_a_setting(forge, code):
    """No database needed: the refusal comes before a cursor is opened (SQLite runs this too)."""
    with pytest.raises(executor.ExecutionError) as err:
        executor.run(forge.format(b=2), 1, using="default")
    assert err.value.code == code


@PG_ONLY
@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("forge", [f for f, _ in FORGES[:2]] + [FORGES[4][0]])
def test_a_statement_that_sets_another_hall_still_sees_only_its_own(wall, forge):
    """Was an xfail until 2026-11-21 (ADR 0007): through the wall, these read hall B. The executor now refuses
    them before sending; the next question on the same connection still reads A only."""
    (a, a_rows), (b, _b_rows) = wall["A"], wall["B"]
    with pytest.raises(executor.ExecutionError) as err:
        _rows(forge.format(b=b.pk), a, wall["alias"])
    assert err.value.code in ("multiple_statements", "forbidden_function")
    assert _rows("SELECT id FROM judgment_judgment", a, wall["alias"]) == [[a_rows[Judgment].pk]]


SPEC = yaml.safe_load(setup.SCHEMA.read_text(encoding="utf-8"))["tables"]


def _privileges(role):
    """({(table, column): has SELECT}, {(table, privilege): has it on the whole table})."""
    columns, whole = {}, {}
    with connection.cursor() as cursor:
        for table, t in SPEC.items():
            for column in t["columns"]:
                cursor.execute("SELECT has_column_privilege(%s, %s, %s, 'SELECT')", [role, table, column["name"]])
                columns[(table, column["name"])] = cursor.fetchone()[0]
            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                cursor.execute("SELECT has_table_privilege(%s, %s, %s)", [role, table, privilege])
                whole[(table, privilege)] = cursor.fetchone()[0]
    return columns, whole


def _policies():
    with connection.cursor() as cursor:
        cursor.execute("SELECT tablename, policyname, roles::text, cmd, qual FROM pg_policies "
                       "WHERE tablename = ANY(%s) ORDER BY tablename, policyname", [TABLES])
        policies = cursor.fetchall()
        cursor.execute("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                       "WHERE relname = ANY(%s) ORDER BY relname", [TABLES])
        return policies, cursor.fetchall()


@PG_ONLY
@pytest.mark.django_db(transaction=True)
def test_setup_runs_twice_to_the_same_wall_and_the_owner_is_untouched(wall):
    role = wall["role"]
    privileges, policies = _privileges(role), _policies()
    # Exactly the schema.yaml `granted: true` columns, column by column; never a whole-table privilege.
    assert privileges[0] == {(t, c["name"]): c["granted"] for t, s in SPEC.items() for c in s["columns"]}
    assert not any(privileges[1].values()), privileges[1]
    assert privileges[0][("judgment_judgment", "confession")] is False
    assert policies[1] == sorted((t, True, False) for t in TABLES)  # enabled, not forced
    assert [p[1] for p in policies[0]] == [setup.POLICY] * 4

    with connection.cursor() as cursor:  # a grant schema.yaml does not list is taken back by the next run
        cursor.execute(f"GRANT SELECT (confession) ON judgment_judgment TO {role}")
    setup.apply(connection, role, uuid.uuid4().hex)
    assert _privileges(role) == privileges and _policies() == policies

    # The owner (this connection, no hall set) bypasses the policy: business code reads and writes as before.
    a_case = wall["A"][1][Judgment]
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM judgment_judgment")
        assert cursor.fetchone()[0] == Judgment.all_objects.count() == 3
        cursor.execute("UPDATE judgment_judgment SET court = court WHERE id = %s", [a_case.pk])
        assert cursor.rowcount == 1
