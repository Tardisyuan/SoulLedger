"""Diyu's hall description, said the way the home page says it (`home.civ_desc.CHINESE`; wording review 2026-11-06,
CN-9). The old one introduced Diyu by two things the system does not use: the eighteen hells, the rival account the
Jade Records reject (docs/06), and the first heaven, retired 2026-10-29. Only a description still reading the old way
changes. Reverse is the same the other way."""
from django.db import migrations

#: (field, old, new)
DESCRIPTION = (
    ("description", "中国地府 — 十殿阎王、十八层地狱、第一层天界", "中国地府 — 十殿阎王、孟婆汤、六道轮回"),
    ("description_en", "Diyu, the Chinese underworld: the ten kings, the eighteen hells and the first heaven",
     "Diyu, the Chinese underworld: the ten kings, Meng Po's soup and the six paths of rebirth"),
)


def _apply(apps, schema_editor, rows):
    db = schema_editor.connection.alias
    Tenant = apps.get_model("tenants", "Tenant")
    for field, old, new in rows:
        Tenant._base_manager.using(db).filter(code="CN_DIYU", **{field: old}).update(**{field: new})


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, DESCRIPTION)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, tuple((field, new, old) for field, old, new in DESCRIPTION))


class Migration(migrations.Migration):
    dependencies = [("tenants", "0018_backfill_english")]
    operations = [migrations.RunPython(forwards, backwards)]
