"""A stand-in `schema_editor` for tests that call a `RunPython` function directly.

Data migrations route every query through `schema_editor.connection.alias`
(tests/test_migrations_use_the_migrated_alias.py), so passing `None`, which the
tests used to do, now fails on the first line.
"""
from types import SimpleNamespace

from django.db import connection

SCHEMA_EDITOR = SimpleNamespace(connection=connection)
