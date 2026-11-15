"""PostgreSQL for a civilization shard alias: see `config/shard_db/__init__.py`."""
from django.db.backends.postgresql import base, schema

from config.shard_db import BareKeysToAbsentTables


class DatabaseSchemaEditor(BareKeysToAbsentTables, schema.DatabaseSchemaEditor):
    pass


class DatabaseWrapper(base.DatabaseWrapper):
    SchemaEditorClass = DatabaseSchemaEditor
