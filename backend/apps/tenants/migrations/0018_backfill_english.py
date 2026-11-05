"""The English the display table held for halls. The four seeded display names and three of their descriptions are
English already, so they need none. Only blank columns are filled. Reverse: `0017` drops the columns."""
from django.db import migrations

DISPLAY_NAME_EN = {
    "中国地府": "Diyu",
    "埃及冥界": "The Duat",
    "希腊冥界": "Hades",
}

DESCRIPTION_EN = {
    "中国地府 — 十殿阎王、十八层地狱、第一层天界": "Diyu, the Chinese underworld: the ten kings, the eighteen hells and the first heaven",
}


def forwards(apps, schema_editor):
    Tenant = apps.get_model("tenants", "Tenant")
    for name, english in DISPLAY_NAME_EN.items():
        Tenant._base_manager.filter(display_name=name, display_name_en="").update(display_name_en=english)
    for description, english in DESCRIPTION_EN.items():
        Tenant._base_manager.filter(description=description, description_en="").update(description_en=english)


class Migration(migrations.Migration):
    dependencies = [("tenants", "0017_english_columns")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
