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
    """
    alias = schema_editor.connection.alias
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
