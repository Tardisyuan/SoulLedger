"""Production database router for per-civilization sharding (docs/ARCHITECTURE-tenant-sharding.md 4.2;
plan docs/audit/2026-11-15-sharding/PLAN.md).

STAGE 1B CONTRACT (and stage 3 with SHARD_READ_CIVS empty). Reads and writes still go where they went with
no router at all: "default", or an
instance hint's own database. `tests/test_shard_router_is_neutral.py` holds it to that. What 1B adds
only ever answers for a civilization alias (`civ_*`), and production has none until stage 2:

  allow_migrate   on a `civ_*` alias, CONTROL models are not created; SHARD and REFERENCE (Tenant) are.
                  A RunPython / RunSQL of an app with no table there (auth, token_blacklist...) is skipped.
                  Every other alias (default = the control database, any other) has no answer, so
                  it keeps everything. Decided by `placement_of(app_label, model_name)` -- by label,
                  because during migrate the model hint is a historical class (tests/test_placement_by_label.py).
                  A shard alias also needs the engine in `config/shard_db/` so the historical foreign keys
                  to control tables are created bare there.
  allow_relation  a pair with a CONTROL or REFERENCE side is allowed across databases (a shard row keeps a
                  control user's bare id; every shard has a Tenant copy, D4). Two SHARD rows in different
                  databases are refused. Same database: no answer (Django allows it).
  CONTROL reads   a CONTROL model asked with an instance hint from a `civ_*` alias goes to default: its
  / writes        table is not there, so `shard_row.create_user` resolves against the control database.

"Goes to default" is spelled `return None`, not `return "default"`. None lets Django fall back the
way it does with no router at all: an instance hint's own database (`obj._state.db`), else default.
A hard "default" overrides that, so a row fetched with `.using(alias)` reads its relations from
default. Measured 2026-11-15: with a hard "default" every test in tests/test_multidb_shadow.py
errored (8/8) while migrating the shadow alias (that guard and its alias were retired in stage 2).

What later stages change:
  2   writes still go to default; a shadow write to the civilization alias happens outside the router.
  3   db_for_read (done): a SHARD model of a civilization in settings.SHARD_READ_CIVS goes to its shard, by
      `apps.core.shard_reads.route` -- the instance hint, else the read context of the request / task; no
      context raises `NoShardContext`, never a silent fall back to default. FANOUT reads are merged by the
      QuerySet hooks in that module, not here.
  4   db_for_write (done): a SHARD row of a civilization in settings.SHARD_WRITE_CIVS is written on its shard, any
      other on control, by `apps.core.shard_reads.write_route` -- the row's hall, else the context's master; no
      single answer raises NoShardContext. Reads that may act on a write (in a transaction, a write request,
      Celery, a command) read the master too (reads your writes); `transaction.atomic()` opens on the shard as well.

Rollback at any stage before 4: delete the DATABASE_ROUTERS line in settings.
"""
from apps.core.sharding import CONTROL, SHARD, NoShardContext, app_has_shard_tables, placement, placement_of

SHARD_PREFIX = "civ_"


def is_shard_alias(alias) -> bool:
    return bool(alias) and alias.startswith(SHARD_PREFIX)


def _control_from_a_shard(model, hints):
    instance = hints.get("instance")
    if instance is not None and is_shard_alias(instance._state.db) and placement(model) == CONTROL:
        return "default"
    return None


class ShardRouter:
    def db_for_read(self, model, **hints):
        control = _control_from_a_shard(model, hints)
        if control is not None:
            return control
        # Stage 3 (apps/core/shard_reads.py): a SHARD model of a civilization in SHARD_READ_CIVS. None while
        # nothing is cut over. A FANOUT read reaching the router is one the QuerySet hooks did not merge
        # (raw SQL, explain, a combined queryset): refused rather than read from one database.
        from apps.core.shard_reads import FANOUT, MASTER, route

        alias = route(model, hints)
        if alias in (FANOUT, MASTER):
            raise NoShardContext(f"{model._meta.label}: a read across every shard through a path that cannot merge")
        return alias

    def db_for_write(self, model, **hints):
        from apps.core.shard_reads import write_route

        return _control_from_a_shard(model, hints) or write_route(model, hints)

    def allow_relation(self, obj1, obj2, **hints):
        if obj1._state.db == obj2._state.db or None in (obj1._state.db, obj2._state.db):
            return None
        from django.conf import settings

        if settings.SHARD_READ_CIVS:
            # Stage 3: rows read from two shards meet in memory along a crossing key (a judgment and the soul
            # it names); every write still goes to control (`apps.core.shard_reads.write_route`). Stage 4 the
            # same, and a write still goes where its own row's hall says (`write_alias_of`), not to the database
            # the related row came from -- so the in-memory pair decides nothing about where anything is written.
            return True
        return not (placement(obj1) == SHARD and placement(obj2) == SHARD)

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if not is_shard_alias(db):
            return None
        if model_name is None:
            # RunPython / RunSQL. An app with no table on a shard (auth, token_blacklist, menus, perm...)
            # has nothing to run there; third-party data migrations do not call `placed_here`. Our own
            # apps' data migrations are skipped on a shard by `placed_here`, their RunSQL runs.
            return None if app_has_shard_tables(app_label) else False
        return placement_of(app_label, model_name) != CONTROL
