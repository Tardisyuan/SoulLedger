"""Dante's two rivers and the Acheron's ferryman, renamed in Chinese (wording review 2026-11-06, EU-7 and EU-21).

Dante's Lethe is not the Greek one (docs/03 §5.1): it is 勒特河, not 忘川, and neither it nor Eunoè is a 河神 —
both streams come from God's will (Purg. XXVIII). 冥河 is the Styx, which Dante gives to Phlegyas; Charon works the
Acheron and is no god. A value changes only where it still reads the old way, so a name somebody edited stays.
Reverse is the same the other way.
"""
from django.db import migrations

#: (name, field, old, new) on European rows
TITLES = (
    ("Charon", "title", "冥河渡神卡戎", "阿刻戎河的摆渡人卡戎"),
    ("Charon", "title_zh", "冥河渡神卡戎", "阿刻戎河的摆渡人卡戎"),
    ("Lethe", "name_zh", "忘川", "勒特河"),
    ("Lethe", "title", "忘川河神", "勒特河"),
    ("Lethe", "title_zh", "忘川河神", "勒特河"),
    ("Eunoe", "title", "欧诺埃河神", "欧诺埃河"),
    ("Eunoe", "title_zh", "欧诺埃河神", "欧诺埃河"),
)


def _apply(apps, schema_editor, rows):
    db = schema_editor.connection.alias
    Actor = apps.get_model("actors", "Actor")
    for name, field, old, new in rows:
        Actor._base_manager.using(db).filter(civilization="EUROPEAN", name=name, **{field: old}).update(**{field: new})


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, TITLES)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, tuple((name, field, new, old) for name, field, old, new in TITLES))


class Migration(migrations.Migration):
    dependencies = [("actors", "0018_english_names_follow_their_sources")]
    operations = [migrations.RunPython(forwards, backwards)]
