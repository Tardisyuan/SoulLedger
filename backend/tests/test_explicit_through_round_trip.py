"""Stage 4 gap 4c: the `*_explicit_through_bare_ids` migrations (RoleDataScope.orgs, CityGod.officers,
TudiGod.officers made explicit through models) change only the migration state. Back and forward again, every
through row is still there, the table keeps its columns, its unique pair and no foreign-key constraint.

Read from the database's own catalogue, not the models. On SQLite here, on PostgreSQL in
`run-gates.sh --real-pg --full` (the migration round trips run there).
"""
from django.db import connection

STAGE = "explicit_through_bare_ids"
TABLES = {"perm_role_data_scope_orgs": ("roledatascope_id", "organization_id"),
          "judgment_citygod_officers": ("citygod_id", "user_id"),
          "death_sync_tudigod_officers": ("tudigod_id", "user_id")}


def _stage():
    from django.db.migrations.loader import MigrationLoader

    loader = MigrationLoader(connection)
    mine = sorted(k for k in loader.disk_migrations if k[1].endswith(STAGE))
    before = [next(p.key for p in loader.graph.node_map[k].parents if p.key[0] == k[0]) for k in mine]
    return mine, before


def _catalogue():
    out = {}
    with connection.cursor() as cur:
        for table, cols in TABLES.items():
            constraints = connection.introspection.get_constraints(cur, table).values()
            cur.execute(f"SELECT {', '.join(cols)} FROM {table} ORDER BY 1, 2")  # noqa: S608 -- our table names
            out[table] = {
                "rows": [tuple(map(str, r)) for r in cur.fetchall()],
                "columns": sorted(c.name for c in connection.introspection.get_table_description(cur, table)),
                "unique": sorted(tuple(c["columns"]) for c in constraints if c["unique"] and not c["primary_key"]),
                "foreign": [c["columns"] for c in constraints if c.get("foreign_key")],
            }
    return out


def test_the_through_models_are_state_only_and_keep_their_rows(migration_round_trip):
    from apps.authentication.models import User
    from apps.death_sync.models import TudiGod
    from apps.judgment.models import CityGod
    from apps.org.models import Organization
    from apps.perm.models import Role, RoleDataScope
    from apps.tenants.models import Tenant
    from tests.migration_roundtrip import migrate_to, migrate_to_latest

    mine, before = _stage()
    assert [k[0] for k in mine] == ["death_sync", "judgment", "perm"], mine
    hall = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})[0]
    user = User.objects.create_user(username="rt-through", password="x", role="JUDGE", tenant=hall)
    CityGod.objects.create(tenant=hall, name="rt city god").officers.add(user)
    TudiGod.objects.create(tenant=hall, name="rt tudi god").officers.add(user)
    org = Organization._base_manager.filter(tenant=hall).first() or Organization.objects.create(
        tenant=hall, name="rt", code="RT_THROUGH")
    RoleDataScope.objects.create(role=Role.objects.create(name="rt_through", display_name="rt"),
                                 scope="DEFINE").orgs.add(org)
    at_latest = _catalogue()
    assert all(at_latest[t]["rows"] for t in TABLES), at_latest
    assert all(not at_latest[t]["foreign"] for t in TABLES), at_latest
    assert all(at_latest[t]["unique"] == [cols] or at_latest[t]["unique"] == [tuple(sorted(cols))]
               for t, cols in TABLES.items()), at_latest

    migrate_to(before)
    assert _catalogue() == at_latest
    migrate_to_latest()
    assert _catalogue() == at_latest
