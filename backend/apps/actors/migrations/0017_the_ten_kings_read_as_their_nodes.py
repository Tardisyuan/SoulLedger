"""The ten kings' English in the form the workflow nodes use ("King Qinguang · triage"), so an actor and the station he
sits at read the same. A row changes only if it still holds the old seeded value; a name somebody entered stays.
Reverse is the same in the other direction."""
from django.db import migrations

#: Actor.name: (old seeded name_en, new name_en)
KINGS = {
    "阎罗王": ("Yanluo King", "King Yanluo"),
    "秦广王": ("Qinguang Wang", "King Qinguang"),
    "楚江王": ("Chujiang Wang", "King Chujiang"),
    "宋帝王": ("Songdi Wang", "King Songdi"),
    "五官王": ("Wuguan Wang", "King Wuguan"),
    "卞城王": ("Biancheng Wang", "King Biancheng"),
    "泰山王": ("Taishan Wang", "King Taishan"),
    "都市王": ("Dushi Wang", "King Dushi"),
    "平等王": ("Pingdeng Wang", "King Pingdeng"),
    "转轮王": ("Zhuanlun Wang", "King Zhuanlun"),
}


def _rename(apps, schema_editor, old_at, new_at):
    db = schema_editor.connection.alias
    Actor = apps.get_model("actors", "Actor")
    for name, pair in KINGS.items():
        Actor._base_manager.using(db).filter(name=name, civilization="CHINESE", name_en=pair[old_at]).update(
            name_en=pair[new_at])


def forwards(apps, schema_editor):
    _rename(apps, schema_editor, 0, 1)


def backwards(apps, schema_editor):
    _rename(apps, schema_editor, 1, 0)


class Migration(migrations.Migration):
    dependencies = [("actors", "0016_backfill_english")]
    operations = [migrations.RunPython(forwards, backwards)]
