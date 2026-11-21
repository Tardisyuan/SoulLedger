"""Production database router for per-civilization sharding (docs/ARCHITECTURE-tenant-sharding.md 4.2;
plan docs/audit/2026-11-15-sharding/PLAN.md).

NOT SHARDED (settings.SHARDED False: no SHARD_DATABASE_URL_<CIV>). Reads and writes go where they go with no
router at all: "default", or an instance hint's own database. `tests/test_shard_router_is_neutral.py` holds it to
that. What stage 1B added only ever answers for a civilization alias (`civ_*`):

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

SHARDED (every civilization's reads and writes on its shard; the per-civilization stages 2-5 are done and their
switches gone, 2026-11-21):
  db_for_read   a SHARD model goes to its civilization's shard, by `apps.core.shard_reads.route` -- the instance
                hint, else the read context of the request / task; no context raises `NoShardContext`, never a
                silent fall back to default. FANOUT reads are merged by the QuerySet hooks in that module, not here.
  db_for_write  a SHARD row of a hall is written on its civilization's shard, any other on control, by
                `apps.core.shard_reads.write_route` -- the row's hall, else the context's master; no single answer
                raises NoShardContext. Reads that may act on a write (in a transaction, a write request, Celery, a
                command) read the master too (reads your writes); `transaction.atomic()` opens on the shard as well.

There is no rollback to the one database once a civilization is purged (GlobalCode SHARD_PURGED): control no longer
holds its rows (`apps.core.sharding.check_shard_settings`).
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
        # apps/core/shard_reads.py: a SHARD model, sharded. None in the one-database form. A FANOUT read reaching
        # the router is one the QuerySet hooks did not merge
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

        if settings.SHARDED:
            # Rows read from two shards meet in memory along a crossing key (a judgment and the soul it names); a
            # write still goes where its own row's hall says (`write_alias_of`), not to the database the related
            # row came from -- so the in-memory pair decides nothing about where anything is written.
            return True
        return not (placement(obj1) == SHARD and placement(obj2) == SHARD)

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if db == "ask_data" or db.startswith("ask_data_"):
            return False  # the read-only 问数 role on control or a shard (ADR 0007): never migrated through it
        if not is_shard_alias(db):
            return None
        if model_name is None:
            # RunPython / RunSQL. An app with no table on a shard (auth, token_blacklist, menus, perm...)
            # has nothing to run there; third-party data migrations do not call `placed_here`. Our own
            # apps' data migrations are skipped on a shard by `placed_here`, their RunSQL runs.
            return None if app_has_shard_tables(app_label) else False
        return placement_of(app_label, model_name) != CONTROL
