"""迁移操作。

`AddIndexConcurrently`:PostgreSQL 上是 `CREATE INDEX CONCURRENTLY`(不锁写,迁移须 `atomic = False`);
别的后端(SQLite 测试套件)退回普通的 `AddIndex` —— Django 自带的那个在 SQLite 上调
`add_index(..., concurrently=True)`,SQLite 的 schema editor 不收这个参数。
"""
from django.contrib.postgres import operations as pg
from django.db import router
from django.db.migrations.operations import AddIndex


def placed_here(schema_editor, apps, *labels):
    """True when every model (`"app.Model"`) is migrated on the database `schema_editor` is migrating.

    A data migration starts with `if not placed_here(schema_editor, apps, ...): return` naming every
    model it reads or writes, so a seed of a control-only table (menus, roles, permissions) is skipped
    on a shard. `router.allow_migrate_model` is Django's own test; while the router allows everything
    this is always True. Guarded by `tests/test_migrations_use_the_migrated_alias.py`.

    On a civilization shard (any alias named `civ_*`) it is False for every model, SHARD, CONTROL and
    REFERENCE alike: no seed or backfill runs there. A shard is created empty and filled only by the
    stage-2 sync; a SHARD seed run per shard would write every civilization's rows, and rows with no
    hall, into each of them (plan stage 2, assertions b and c). `tests/test_placement_by_label.py`.
    """
    alias = schema_editor.connection.alias
    if alias.startswith("civ_"):
        return False
    return all(router.allow_migrate_model(alias, apps.get_model(label)) for label in labels)


class AddIndexConcurrently(pg.AddIndexConcurrently):
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        if schema_editor.connection.vendor == "postgresql":
            return super().database_forwards(app_label, schema_editor, from_state, to_state)
        return AddIndex.database_forwards(self, app_label, schema_editor, from_state, to_state)

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        if schema_editor.connection.vendor == "postgresql":
            return super().database_backwards(app_label, schema_editor, from_state, to_state)
        return AddIndex.database_backwards(self, app_label, schema_editor, from_state, to_state)
