"""问数's database wall (docs/ARCHITECTURE-ask-data.md §4, ADR 0007): the read-only role, the column grants and
the tenant policy from `apps/soul_assist/ask_data/setup.py`, and the executor that runs a statement on it.

Every statement here goes to the executor directly, past the gate (gate.py): the wall must hold with the gate
gone. The fixture runs the same `setup.apply` as `manage.py ask_data_setup`, with a role whose name has a
random suffix (roles are cluster-wide), connects as that role through a throwaway alias, and removes the
policies, the RLS switch and the role after the test -- the same clean-up shape as
`test_row_level_security_probe.py`.

PostgreSQL only, apart from the first three tests (no database / no hall / a cut-over hall): SQLite has no RLS.
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
def test_a_hall_whose_reads_are_cut_over_is_not_on_this_database():
    hall = Tenant.objects.create(code="ASK_GR", display_name="ASK_GR", declared_civilization="GREEK")
    with override_settings(SHARD_READ_CIVS=["GREEK"]), pytest.raises(executor.ExecutionError) as err:
        executor.run("SELECT 1", hall.pk, using="default")
    assert err.value.code == executor.NOT_ON_THIS_DATABASE
    with override_settings(SHARD_READ_CIVS=["EGYPTIAN"]):  # another civilization's cut-over changes nothing here
        executor._check_hall(hall.pk)


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
    """`setup.apply` as `ask_data_setup` runs it, and an alias that logs in as the new role."""
    suffix = uuid.uuid4().hex[:12]
    role, alias, password = f"ask_data_t_{suffix}", f"ask_data_t_{suffix}", uuid.uuid4().hex
    try:
        setup.apply(connection, role, password)
        connections.settings[alias] = {**connection.settings_dict, "USER": role, "PASSWORD": password,
                                       "CONN_MAX_AGE": 0}
        # Log in now: Django's test case refuses to *open* a connection on an alias outside its `databases`,
        # and this alias did not exist when the test case was set up. An open one it leaves alone.
        connections[alias].connect()
        yield {**halls, "role": role, "alias": alias}
    finally:
        # Gone before Django's own teardown, which walks every alias in `connections`.
        if alias in connections.settings:
            connections[alias].close()
            del connections[alias]
            del connections.settings[alias]
        with connection.cursor() as cursor:  # committed DDL (transaction=True): undo by hand
            for table in TABLES:
                cursor.execute(f"DROP POLICY IF EXISTS {setup.POLICY} ON {table}")
                cursor.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role])
            if cursor.fetchone():
                cursor.execute(f"DROP OWNED BY {role}")
                cursor.execute(f"DROP ROLE {role}")


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
@pytest.mark.xfail(strict=True, raises=AssertionError, reason=(
    "Known gap (ADR 0007, doc §8): app.tenant_id is a custom setting any role may change, and psycopg2 sends "
    "the text as one simple query, so a second statement runs too. Only the gate stops these "
    "(forbidden_function for set_config, multiple_statements). Strict: a fix turns this XPASS, i.e. red."))
@pytest.mark.parametrize("forge", [
    "SELECT set_config('app.tenant_id', '{b}', true); SELECT id FROM judgment_judgment",
    "SET LOCAL app.tenant_id = '{b}'; SELECT id FROM judgment_judgment",
])
def test_a_statement_that_sets_another_hall_still_sees_only_its_own(wall, forge):
    (a, a_rows), b = wall["A"], wall["B"][0]
    assert _rows(forge.format(b=b.pk), a, wall["alias"]) == [[a_rows[Judgment].pk]]


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
