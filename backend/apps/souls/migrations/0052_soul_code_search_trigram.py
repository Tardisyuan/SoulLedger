"""Trigram GIN index on `soul_code` — the officer app's search box says 「姓名、编号或案号」.

`SoulFilter.search_fields` gained `soul_code`, and the OR in `filter_search` is index-assisted only
when every arm is (0047's docstring). Same expression and same PostgreSQL-only guard as 0047; the
unique btree index Django already keeps on `soul_code` is not used by `UPPER(…) LIKE '%…%'`.
`tests/test_soul_search_trigram.py` keeps 0047 + this list equal to `search_fields`.
"""
import importlib

from django.db import migrations

_0047 = importlib.import_module("apps.souls.migrations.0047_soul_search_trigram")

SEARCHED = ("soul_code",)


def forward(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for column in SEARCHED:
        schema_editor.execute(
            f'CREATE INDEX IF NOT EXISTS {_0047.index_name(column)} ON souls_soul '
            f'USING gin ((UPPER("{column}"::text)) gin_trgm_ops)'
        )


def backward(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    for column in SEARCHED:
        schema_editor.execute(f"DROP INDEX IF EXISTS {_0047.index_name(column)}")


class Migration(migrations.Migration):
    dependencies = [
        ("souls", "0051_backfill_diyu_acquitted_to_rebirth"),
    ]

    operations = [migrations.RunPython(forward, backward)]
