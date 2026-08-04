"""
Drop the old DateField columns now that birth/death/event are
authoritatively stored as signed year/month/day (0019) and all
existing data has been copied across (0020).

Model-level `birth_date`/`death_date`/`event_date` still exist as
Python properties (see apps.souls.models.Soul and
apps.souls.record_models.SoulRecord) for callers that only need
CE dates — this migration only removes the database columns.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('souls', '0020_migrate_date_data'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='soul',
            name='birth_date',
        ),
        migrations.RemoveField(
            model_name='soul',
            name='death_date',
        ),
        migrations.RemoveField(
            model_name='soulrecord',
            name='event_date',
        ),
    ]
