"""
Data migration: point the stored Celery beat schedules at the renamed tasks.

A Celery task name is an explicit string, decoupled from the module path, so
renaming apps.karma to apps.ledger did *not* rename `karma.recalculate_all` /
`karma.recalculate_single` — @shared_task(name=...) in apps/ledger/tasks.py did.
The rows written by the old `setup_karma_tasks` command are still in
django_celery_beat pointing at the dead names, and beat does not complain about
a schedule whose task nothing is registered for: it just stops producing work.
The nightly recalculation would go quiet with no error anywhere.

Both `task` and `name` are remapped, not just `task`:
- `task` is what beat dispatches on — the actual break.
- `name` is PeriodicTask's unique key and is what `setup_ledger_tasks` does
  get_or_create() on. Left as "karma.recalculate_all", the next run of that
  command would not find the row and would insert a second one, and the
  recalculation would then be scheduled twice a night.

`description` is deliberately left alone — it is free text an operator may have
edited, and nothing dispatches on it.

This app owns no tables and this migration creates none; apps/ledger just
happens to be the app the renamed tasks live in.

Reversal restores the old names exactly, so a rollback to the karma-era code
finds its schedules where it left them.
"""
from django.db import migrations

RENAMES = {
    "karma.recalculate_all": "ledger.recalculate_all",
    "karma.recalculate_single": "ledger.recalculate_single",
}


def _remap(apps, mapping):
    """Rewrite PeriodicTask.task and .name according to ``mapping``.

    Skips any row whose target name is already taken, because `name` is unique
    and a half-migrated database (or a hand-created row) must not turn this
    into an IntegrityError.
    """
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    for old, new in mapping.items():
        PeriodicTask.objects.filter(task=old).update(task=new)
        if not PeriodicTask.objects.filter(name=new).exists():
            PeriodicTask.objects.filter(name=old).update(name=new)


def rename_to_ledger(apps, schema_editor):
    _remap(apps, RENAMES)


def rename_back_to_karma(apps, schema_editor):
    _remap(apps, {new: old for old, new in RENAMES.items()})


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("django_celery_beat", "__first__"),
    ]

    operations = [
        migrations.RunPython(rename_to_ledger, rename_back_to_karma),
    ]
