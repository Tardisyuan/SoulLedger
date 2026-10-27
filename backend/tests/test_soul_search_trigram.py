"""The soul search's trigram indexes (`apps/souls/migrations/0047_soul_search_trigram.py`).

The indexes are raw SQL on an expression, so nothing in Django checks that they still match what the
search compiles to. These do: the column list against `SoulFilter.search_fields`, the expression
against PostgreSQL's lookup cast, and — on PostgreSQL only — that the four indexes exist.
"""
import importlib

import pytest
from django.db import connection

from apps.souls.filters import SoulFilter

migration = importlib.import_module("apps.souls.migrations.0047_soul_search_trigram")


def test_every_searched_column_is_indexed():
    assert list(migration.SEARCHED) == list(SoulFilter.search_fields)


def test_the_index_expression_is_what_icontains_compiles_to():
    from django.db.backends.postgresql.operations import DatabaseOperations

    # The migration indexes UPPER("col"::text); a different cast here means the planner ignores the index.
    for internal_type in ("CharField", "TextField"):
        assert DatabaseOperations(None).lookup_cast("icontains", internal_type) == "UPPER(%s::text)"


@pytest.mark.django_db
@pytest.mark.skipif(connection.vendor != "postgresql", reason="pg_trgm and GIN exist only on PostgreSQL")
def test_the_indexes_exist_on_postgresql():
    with connection.cursor() as cursor:
        cursor.execute("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'souls_soul'")
        found = dict(cursor.fetchall())
    for column in migration.SEARCHED:
        definition = found.get(migration.index_name(column), "")
        assert "gin_trgm_ops" in definition and f"upper(({column})::text)" in definition.lower(), definition
