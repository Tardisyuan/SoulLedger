"""迁移操作。

`AddIndexConcurrently`:PostgreSQL 上是 `CREATE INDEX CONCURRENTLY`(不锁写,迁移须 `atomic = False`);
别的后端(SQLite 测试套件)退回普通的 `AddIndex` —— Django 自带的那个在 SQLite 上调
`add_index(..., concurrently=True)`,SQLite 的 schema editor 不收这个参数。
"""
from django.contrib.postgres import operations as pg
from django.db.migrations.operations import AddIndex


class AddIndexConcurrently(pg.AddIndexConcurrently):
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        if schema_editor.connection.vendor == "postgresql":
            return super().database_forwards(app_label, schema_editor, from_state, to_state)
        return AddIndex.database_forwards(self, app_label, schema_editor, from_state, to_state)

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        if schema_editor.connection.vendor == "postgresql":
            return super().database_backwards(app_label, schema_editor, from_state, to_state)
        return AddIndex.database_backwards(self, app_label, schema_editor, from_state, to_state)
