"""Stage 4 gap 4c (the sharding plan (not in this repo)): RoleDataScope.orgs's through table, made an explicit model with
both keys bare (DO_NOTHING, no constraint) so Django's collector never clears it on the wrong database;
apps.core.bare_ids clears it on every database instead. State only: the table, its columns, its unique pair and its
rows are the ones Django created for the M2M (1B already dropped its constraints), so nothing runs on any database
and reversing it changes nothing either.
"""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('org', '0017_bare_ids_across_databases'),
        ('perm', '0040_bare_ids_across_databases'),
    ]

    operations = [migrations.SeparateDatabaseAndState(state_operations=[
        migrations.CreateModel(
            name='RoleDataScopeOrg',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('organization', models.ForeignKey(db_constraint=False, on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='org.organization')),
                ('roledatascope', models.ForeignKey(db_constraint=False, on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='perm.roledatascope')),
            ],
            options={
                'db_table': 'perm_role_data_scope_orgs',
                'unique_together': {('roledatascope', 'organization')},
            },
        ),
        migrations.AlterField(
            model_name='roledatascope',
            name='orgs',
            field=models.ManyToManyField(blank=True, help_text='DEFINE 的机构', related_name='+', through='perm.RoleDataScopeOrg', to='org.organization'),
        ),
    ])]
