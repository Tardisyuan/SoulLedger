"""Ops gap 18: the migrations a rollback cannot `migrate` back over, listed where a release sees them.

An operation is irreversible when Django says so (`op.reversible is False`): a RunPython
without reverse_code, a RunSQL without reverse_sql. Rolling the image back past one of
these needs a restore, not `migrate <app> <previous>` — docs/DEPLOYMENT.md「部署回滚」.

`irreversible_migrations.txt` pins the set. A new irreversible migration turns this red
until it is added there, so it shows up in the release diff; one made reversible turns
it red until it is removed. `RunPython.noop` as the reverse counts as reversible: it
rolls back the schema and leaves the data — that is the migration's own docstring's job.
"""
from pathlib import Path

from django.db.migrations.loader import MigrationLoader

LISTED = Path(__file__).with_name("irreversible_migrations.txt")


def _irreversible(operations):
    for op in operations:
        inner = getattr(op, "database_operations", None)  # SeparateDatabaseAndState
        if inner is not None:
            yield from _irreversible(inner)
        elif not op.reversible:
            yield op


def _actual():
    loader = MigrationLoader(None, ignore_no_migrations=True)
    found = set()
    for (app, name), migration in loader.disk_migrations.items():
        if not type(migration).__module__.startswith("apps."):
            continue  # Django's and third-party apps' migrations are not ours to roll back
        if any(True for _ in _irreversible(migration.operations)):
            found.add(f"{app}.{name}")
    return found


def _listed():
    lines = (line.split("#", 1)[0].strip() for line in LISTED.read_text().splitlines())
    return {line for line in lines if line}


def test_every_irreversible_migration_is_listed_and_nothing_else():
    actual, listed = _actual(), _listed()
    assert not actual - listed, f"irreversible, not listed in {LISTED.name}: {sorted(actual - listed)}"
    assert not listed - actual, f"listed but reversible (or gone): {sorted(listed - actual)}"


def test_the_check_sees_a_runpython_without_reverse():
    from django.db import migrations

    ops = [migrations.RunPython(lambda a, s: None), migrations.RunPython(lambda a, s: None, migrations.RunPython.noop),
           migrations.RunSQL("select 1"), migrations.RunSQL("select 1", "select 1")]
    assert list(_irreversible(ops)) == [ops[0], ops[2]]
