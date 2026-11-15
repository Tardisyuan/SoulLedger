"""SQLite for a civilization shard alias, test settings only (config/settings_sharded.py): see
`config/shard_db/__init__.py`. Without it a shard row's key to authentication_user fails on insert
("no such table") instead of being a bare id."""
from django.db.backends.sqlite3 import base, schema

from config.shard_db import BareKeysToAbsentTables


class DatabaseSchemaEditor(BareKeysToAbsentTables, schema.DatabaseSchemaEditor):
    pass


class DatabaseWrapper(base.DatabaseWrapper):
    SchemaEditorClass = DatabaseSchemaEditor
