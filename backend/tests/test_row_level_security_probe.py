"""PostgreSQL row-level security as a second tenant wall: a verification on two tables, not a rollout.

ADR 0006 (`docs/adr/0006-row-level-security-verified-not-rolled-out.md`) records the decision. Tenant isolation today
is the view layer alone (ADR 0001): a query that forgets `scope_to_tenant` returns every hall's rows. These tests show
what RLS would turn that into, on `souls_soul` and `judgment_judgment`, with the policy keyed on a per-transaction
setting (`set_config('app.tenant_id', …, true)`, i.e. `SET LOCAL`) because production runs pgbouncer in transaction
pooling, where a session-level setting would leak to the next client on the same server connection.

Nothing here changes the schema that migrations build. The fixture enables RLS, adds the policies and (when Django's
role bypasses RLS) a throwaway non-owner role, commits that, and removes all of it after the test.

PostgreSQL only: SQLite has no RLS, so on SQLite every assertion here could never fire.
Run them (real PG; see ADR 0006 "How to run"):

    cd backend && SECRET_KEY=… REDIS_URL=redis://127.0.0.1:6399/0 \
      .venv/bin/python -m pytest tests/test_row_level_security_probe.py -q --no-cov --create-db
"""
import uuid
from contextlib import contextmanager

import pytest
from django.db import DatabaseError, connection, transaction

from apps.judgment.models import Judgment
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

SQLITE = connection.vendor == "sqlite"
pytestmark = [
    pytest.mark.skipif(SQLITE, reason="Row-level security exists only on PostgreSQL; on SQLite it cannot be tested."),
    pytest.mark.django_db(transaction=True),
]

SOULS = Soul._meta.db_table
JUDGMENTS = Judgment._meta.db_table
#: `nullif(…, '')`: once a SET LOCAL has ended, the same session reads the setting back as '' (not NULL), and
#: ''::bigint would raise instead of matching nothing. NULL compares as unknown, so no setting = no rows.
CURRENT = "nullif(current_setting('app.tenant_id', true), '')::bigint"
POLICIES = {
    # Deliberately wider than the app layer (be-sec 3.5): the home hall may still read a soul resident elsewhere.
    # RLS is the backstop for a forgotten filter; the exact rule stays in scope_to_tenant.
    SOULS: f"USING (tenant_id = {CURRENT} OR home_tenant_id = {CURRENT}) WITH CHECK (tenant_id = {CURRENT})",
    JUDGMENTS: f"USING (tenant_id = {CURRENT}) WITH CHECK (tenant_id = {CURRENT})",
}


@contextmanager
def tenant_transaction(tenant_id):
    """The wiring a rollout would use: one transaction, the tenant set inside it, gone at COMMIT."""
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.tenant_id', %s, true)", [str(tenant_id)])
        yield cursor


def _count(cursor, table):
    cursor.execute(f"SELECT count(*) FROM {table}")  # noqa: S608 - table names come from model Meta
    return cursor.fetchone()[0]


@pytest.fixture
def halls():
    """Two halls with one soul and one judgment each, created before RLS is switched on."""
    rows = {}
    for code in ("RLS_A", "RLS_B"):
        tenant = Tenant.objects.create(code=code, display_name=code, declared_civilization="CHINESE")
        soul = Soul.objects.create(name=f"{code} soul", tenant=tenant, current_state=SoulState.JUDGING)
        judgment = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=tenant)
        rows[code] = (tenant, soul, judgment)
    return rows


@pytest.fixture
def rls(halls):
    """Enable + FORCE RLS on the two tables; act as a role that does not bypass it. Undone after the test."""
    role = None
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user")
            bypasses = cursor.fetchone()[0]
            for table, policy in POLICIES.items():
                cursor.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
                cursor.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
                cursor.execute(f"CREATE POLICY tenant_wall ON {table} {policy}")
            if bypasses:
                # A superuser ignores RLS even under FORCE, so the probe needs a role that is neither superuser
                # nor owner -- which is also what a rollout needs (ADR 0006). Roles are cluster-wide: unique name.
                name = f"rls_probe_{uuid.uuid4().hex[:12]}"
                cursor.execute(f"CREATE ROLE {name} NOLOGIN NOSUPERUSER NOBYPASSRLS")
                role = name
                cursor.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
                cursor.execute(f"GRANT SELECT, UPDATE ON {SOULS}, {JUDGMENTS} TO {role}")
                cursor.execute(f"SET ROLE {role}")
        yield halls
    finally:
        # Committed DDL (transaction=True), so undo it by hand -- also when setup stopped half way.
        with connection.cursor() as cursor:
            cursor.execute("RESET ROLE")
            for table in POLICIES:
                cursor.execute(f"DROP POLICY IF EXISTS tenant_wall ON {table}")
                cursor.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
                cursor.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
            if role:
                cursor.execute(f"DROP OWNED BY {role}")
                cursor.execute(f"DROP ROLE {role}")


def test_a_hall_reads_only_its_own_rows_even_through_raw_sql(rls):
    (a, a_soul, a_case), (_b, b_soul, b_case) = rls["RLS_A"], rls["RLS_B"]
    with tenant_transaction(a.pk) as cursor:
        for table in POLICIES:
            assert _count(cursor, table) == 1, table
        cursor.execute(f"SELECT id FROM {SOULS}")  # noqa: S608
        assert [r[0] for r in cursor.fetchall()] == [a_soul.pk]
        cursor.execute(f"SELECT id FROM {JUDGMENTS} WHERE id = %s", [b_case.pk])  # noqa: S608
        assert cursor.fetchall() == []
        # The ORM goes through the same wall: an unscoped manager query is what the wall exists for.
        assert list(Soul.all_objects.values_list("pk", flat=True)) == [a_soul.pk]
        assert not Judgment.objects.filter(pk=b_case.pk).exists()
        assert Judgment.objects.filter(pk=a_case.pk).exists()
        assert b_soul.pk not in set(Soul.all_objects.values_list("pk", flat=True))


def test_a_hall_cannot_write_another_halls_rows(rls):
    (a, a_soul, _), (b, b_soul, b_case) = rls["RLS_A"], rls["RLS_B"]
    with tenant_transaction(a.pk) as cursor:
        # B's rows are invisible to UPDATE and DELETE: zero rows touched, no error.
        cursor.execute(f"UPDATE {SOULS} SET name = 'taken' WHERE id = %s", [b_soul.pk])  # noqa: S608
        assert cursor.rowcount == 0
        cursor.execute(f"UPDATE {JUDGMENTS} SET tenant_id = %s WHERE id = %s", [a.pk, b_case.pk])  # noqa: S608
        assert cursor.rowcount == 0
    # Moving A's own row into B fails the WITH CHECK half of the policy.
    with pytest.raises(DatabaseError, match="row-level security"), tenant_transaction(a.pk) as cursor:
        cursor.execute(f"UPDATE {SOULS} SET tenant_id = %s WHERE id = %s", [b.pk, a_soul.pk])  # noqa: S608
    with tenant_transaction(b.pk) as cursor:
        cursor.execute(f"SELECT name, tenant_id FROM {SOULS} WHERE id = %s", [b_soul.pk])  # noqa: S608
        assert cursor.fetchone() == (b_soul.name, b.pk)
    with tenant_transaction(a.pk) as cursor:
        cursor.execute(f"SELECT tenant_id FROM {SOULS} WHERE id = %s", [a_soul.pk])  # noqa: S608
        assert cursor.fetchone() == (a.pk,)


def test_no_setting_means_no_rows_and_the_setting_ends_with_its_transaction(rls):
    a = rls["RLS_A"][0]
    with connection.cursor() as cursor:
        # Never set on this session: NULL -> nothing matches. Fail closed.
        for table in POLICIES:
            assert _count(cursor, table) == 0, table
    assert Soul.all_objects.count() == 0
    with tenant_transaction(a.pk) as cursor:
        assert _count(cursor, SOULS) == 1
    # Same session, after COMMIT: SET LOCAL is gone, so the next transaction on this (pooled) connection
    # sees nothing. A session-level set_config(..., false) would still read 'A' here -- the pgbouncer leak.
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_setting('app.tenant_id', true)")
        assert cursor.fetchone()[0] in (None, "")
        for table in POLICIES:
            assert _count(cursor, table) == 0, table


def test_the_owner_bypasses_rls_unless_forced(halls):
    """Why a rollout needs FORCE and a non-owner role: without them the policy is decoration.

    Django's test role owns these tables (and on the usual docker image is a superuser too). With RLS enabled
    but not forced, and no tenant set, it still sees every row.
    """
    with connection.cursor() as cursor:
        cursor.execute(f"ALTER TABLE {SOULS} ENABLE ROW LEVEL SECURITY")
        cursor.execute(f"CREATE POLICY tenant_wall ON {SOULS} {POLICIES[SOULS]}")
        try:
            cursor.execute(
                "SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) = current_user "
                "FROM pg_class c WHERE c.relname = %s", [SOULS],
            )
            assert cursor.fetchone() == (True, False, True)
            assert _count(cursor, SOULS) == Soul.all_objects.count() == 2
        finally:
            cursor.execute(f"DROP POLICY tenant_wall ON {SOULS}")
            cursor.execute(f"ALTER TABLE {SOULS} DISABLE ROW LEVEL SECURITY")
