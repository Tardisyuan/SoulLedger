"""A seat keeps its actor's names (sharding stage 4 part C): `participant_actor` is a bare id that may name a row of
another civilization's shard, so the bench reads the names from the seat. Existing seats are filled from the actor
they name; reverse just drops the columns."""
from django.db import migrations, models

from apps.core.migration_ops import placed_here


def fill(apps, schema_editor):
    if not placed_here(schema_editor, apps, "dispatch.CrossTenantJudgmentParticipant", "actors.Actor"):
        return
    alias = schema_editor.connection.alias
    Seat = apps.get_model("dispatch", "CrossTenantJudgmentParticipant")
    Actor = apps.get_model("actors", "Actor")
    seats = Seat._base_manager.using(alias).filter(participant_actor_id__isnull=False)
    names = dict((pk, (n, en)) for pk, n, en in Actor._base_manager.using(alias).filter(
        pk__in=seats.values_list("participant_actor_id", flat=True)).values_list("pk", "name", "name_en"))
    for pk, actor_id in seats.values_list("pk", "participant_actor_id"):
        if actor_id in names:
            name, name_en = names[actor_id]
            Seat._base_manager.using(alias).filter(pk=pk).update(participant_actor_name=name,
                                                                 participant_actor_name_en=name_en)


class Migration(migrations.Migration):

    dependencies = [
        ('actors', '0022_bare_ids_across_databases'),
        ('dispatch', '0016_bare_ids_across_civilizations'),
    ]

    operations = [
        migrations.AddField(
            model_name='crosstenantjudgmentparticipant',
            name='participant_actor_name',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name='crosstenantjudgmentparticipant',
            name='participant_actor_name_en',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.RunPython(fill, migrations.RunPython.noop),
    ]
