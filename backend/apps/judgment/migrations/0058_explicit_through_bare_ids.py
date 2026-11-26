"""Stage 4 gap 4c (the sharding plan (not in this repo)): CityGod.officers's through table, made an explicit model with
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
        ('judgment', '0057_evidence_record_bare_id_stage2_review'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [migrations.SeparateDatabaseAndState(state_operations=[
        migrations.CreateModel(
            name='CityGodOfficer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('citygod', models.ForeignKey(db_constraint=False, on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='judgment.citygod')),
                ('user', models.ForeignKey(db_constraint=False, on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'judgment_citygod_officers',
                'unique_together': {('citygod', 'user')},
            },
        ),
        migrations.AlterField(
            model_name='citygod',
            name='officers',
            field=models.ManyToManyField(blank=True, related_name='city_gods', through='judgment.CityGodOfficer', to=settings.AUTH_USER_MODEL),
        ),
    ])]
