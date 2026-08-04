"""
Copy existing birth_date/death_date/event_date values into the new
signed year/month/day columns.

All pre-existing data is CE (Python's DateField couldn't hold anything
else), so this is lossless: every row's date splits into
(date.year, date.month, date.day) exactly, and reversing it just
reassembles the DateField from those three ints. Reversal only loses
information for rows that were *created after* this migration ran with
a BCE year or year-only precision — those never fit in a DateField to
begin with, so there is nothing to migrate backward.
"""
from django.db import migrations


def _migrate_forward(manager, source_field, prefix, batch_size=1000):
    year_field, month_field, day_field = f"{prefix}_year", f"{prefix}_month", f"{prefix}_day"
    rows = manager.exclude(**{f"{source_field}__isnull": True}).only(
        "id", source_field, year_field, month_field, day_field
    )
    batch = []
    for obj in rows.iterator(chunk_size=batch_size):
        d = getattr(obj, source_field)
        setattr(obj, year_field, d.year)
        setattr(obj, month_field, d.month)
        setattr(obj, day_field, d.day)
        batch.append(obj)
        if len(batch) >= batch_size:
            manager.bulk_update(batch, [year_field, month_field, day_field])
            batch = []
    if batch:
        manager.bulk_update(batch, [year_field, month_field, day_field])


def _migrate_backward(manager, source_field, prefix, batch_size=1000):
    import datetime

    year_field, month_field, day_field = f"{prefix}_year", f"{prefix}_month", f"{prefix}_day"
    rows = manager.exclude(**{f"{year_field}__isnull": True}).only(
        "id", source_field, year_field, month_field, day_field
    )
    batch = []
    for obj in rows.iterator(chunk_size=batch_size):
        year = getattr(obj, year_field)
        month = getattr(obj, month_field)
        day = getattr(obj, day_field)
        if year is not None and year >= 1 and month is not None and day is not None:
            try:
                setattr(obj, source_field, datetime.date(year, month, day))
            except ValueError:
                # Not a valid calendar date (shouldn't happen — validated on
                # write) — leave the legacy DateField null rather than error.
                setattr(obj, source_field, None)
        else:
            # BCE or year-only precision: cannot be represented as a
            # DateField. Nothing to roll back to; leave it null.
            setattr(obj, source_field, None)
        batch.append(obj)
        if len(batch) >= batch_size:
            manager.bulk_update(batch, [source_field])
            batch = []
    if batch:
        manager.bulk_update(batch, [source_field])


def forwards(apps, schema_editor):
    Soul = apps.get_model('souls', 'Soul')
    SoulRecord = apps.get_model('souls', 'SoulRecord')
    # Soul's migration-state manager set only tracks `all_objects` (the
    # unfiltered base manager) — see 0018_alter_soul_managers. Using it here
    # is also the more correct choice: we want every row migrated,
    # including soft-deleted ones, not just what the default manager's
    # is_deleted filter would return.
    _migrate_forward(Soul.all_objects, 'birth_date', 'birth')
    _migrate_forward(Soul.all_objects, 'death_date', 'death')
    _migrate_forward(SoulRecord.objects, 'event_date', 'event')


def backwards(apps, schema_editor):
    Soul = apps.get_model('souls', 'Soul')
    SoulRecord = apps.get_model('souls', 'SoulRecord')
    _migrate_backward(Soul.all_objects, 'birth_date', 'birth')
    _migrate_backward(Soul.all_objects, 'death_date', 'death')
    _migrate_backward(SoulRecord.objects, 'event_date', 'event')


class Migration(migrations.Migration):

    dependencies = [
        ('souls', '0019_add_historical_date_fields'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
