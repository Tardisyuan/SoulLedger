"""Production database router for per-civilization sharding (docs/ARCHITECTURE-tenant-sharding.md 4.2;
plan docs/audit/2026-11-15-sharding/PLAN.md).

STAGE 0 CONTRACT: this router routes nothing. Every read and write goes to "default", it has no
opinion on relations, and every model migrates everywhere. It is installed now so that the router
chain, the placement inventory (`apps/core/sharding.py`, `tests/tenancy_placement.py`) and the
alias-aware data migrations are exercised by every test run before any row moves.
`tests/test_shard_router_is_neutral.py` holds it to that.

"Goes to default" is spelled `return None`, not `return "default"`. None lets Django fall back the
way it does with no router at all: an instance hint's own database (`obj._state.db`), else default.
A hard "default" overrides that, so a row fetched with `.using(alias)` reads its relations from
default. Measured 2026-11-15: with a hard "default" every test in tests/test_multidb_shadow.py
errored (8/8) while migrating the shadow alias -- a RunPython's `Role` came from the shadow, its
related lookup from default, and the assignment was refused across databases.

What later stages change, and nothing else may:
  1B  allow_migrate: SHARD models only on civ_* aliases, CONTROL only on default, REFERENCE (Tenant)
      on both, decided by `placement_of(app_label, model_name)` -- by label, because during migrate the
      model hint is a historical class (tests/test_placement_by_label.py); SHARD <-> CONTROL foreign
      keys become bare ids (both cut lists pinned in the placement test). Data migrations already skip
      civ_* aliases (`placed_here`).
  2   writes still go to default; a shadow write to the civilization alias happens outside the router.
  3   db_for_read: a SHARD model of a civilization in settings.SHARD_READ_CIVS goes to
      `alias_for_civilization(civ)`, the civilization taken from the instance hint, else the tenant
      contextvar; neither present raises `NoShardContext` -- never a silent fall back to default.
  4   db_for_write: the same for settings.SHARD_WRITE_CIVS; allow_relation refuses cross-alias pairs.

Rollback at any stage before 4: delete the DATABASE_ROUTERS line in settings.
"""


class ShardRouter:
    def db_for_read(self, model, **hints):
        return None

    def db_for_write(self, model, **hints):
        return None

    def allow_relation(self, obj1, obj2, **hints):
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        return True
