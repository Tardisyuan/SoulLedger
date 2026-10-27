"""Trigram GIN indexes for the soul list's `?search=` (perf review 2026-10-27 #5).

`SoulFilter.filter_search` ORs `icontains` over four columns. On PostgreSQL Django compiles each to
`UPPER("souls_soul"."<col>"::text) LIKE UPPER('%…%')`, so the index is on exactly that expression —
an index on the bare column is not used. All four are indexed: an OR is index-assisted only when every
arm is (one unindexed arm and the planner scans the table anyway).

PostgreSQL only. SQLite has neither pg_trgm nor GIN; there both functions do nothing. The model state
does not change (raw SQL, no `Meta.indexes`), so `makemigrations --check` stays clean on both.
`tests/test_soul_search_trigram.py` pins the expression to Django's lookup cast.
"""
from django.db import migrations

#: The columns `SoulFilter.search_fields` searches; the test keeps the two lists equal.
SEARCHED = ("name", "birth_name", "origin_location", "description")


def index_name(column: str) -> str:
    return f"souls_soul_{column}_trgm"


def forward(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    # pg_trgm is a trusted extension (PostgreSQL 13+): the database owner may create it without superuser.
    schema_editor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for column in SEARCHED:
        schema_editor.execute(
            f'CREATE INDEX IF NOT EXISTS {index_name(column)} ON souls_soul '
            f'USING gin ((UPPER("{column}"::text)) gin_trgm_ops)'
        )


def backward(apps, schema_editor):
    # The extension stays: dropping it is a no-op for nobody and other indexes may come to use it.
    if schema_editor.connection.vendor != "postgresql":
        return
    for column in SEARCHED:
        schema_editor.execute(f"DROP INDEX IF EXISTS {index_name(column)}")


class Migration(migrations.Migration):
    dependencies = [
        ("souls", "0046_duat_passage"),
    ]

    operations = [migrations.RunPython(forward, backward)]
