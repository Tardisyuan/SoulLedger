"""Stage 4 gap 4c (docs/audit/2026-11-15-sharding/PLAN.md): TudiGod.officers's through table, made an explicit model with
both keys bare (DO_NOTHING, no constraint) so Django's collector never clears it on the wrong database;
apps.core.bare_ids clears it on every database instead. State only: the table, its columns, its unique pair and its
rows are the ones Django created for the M2M (1B already dropped its constraints), so nothing runs on any database
and reversing it changes nothing either.
"""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('death_sync', '0013_bare_ids_across_civilizations'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [migrations.SeparateDatabaseAndState(state_operations=[
        migrations.CreateModel(
            name='TudiGodOfficer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('tudigod', models.ForeignKey(db_constraint=False, on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='death_sync.tudigod')),
                ('user', models.ForeignKey(db_constraint=False, on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'death_sync_tudigod_officers',
                'unique_together': {('tudigod', 'user')},
            },
        ),
        migrations.AlterField(
            model_name='tudigod',
            name='officers',
            field=models.ManyToManyField(blank=True, related_name='tudi_gods', through='death_sync.TudiGodOfficer', to=settings.AUTH_USER_MODEL),
        ),
    ])]
