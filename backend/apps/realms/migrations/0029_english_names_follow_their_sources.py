"""The realms' side of actors/0018: the hot hells' English, corrected. Reverse is the same the other way."""
from django.db import migrations

#: In this order: "Great Burning" has to become "Burning" before "Greater Burning" becomes "Great Burning".
REPLACEMENTS = (
    ("Great Burning", "Burning"),
    ("Greater Burning", "Great Burning"),
    ("Greater Howling", "Great Howling"),
    ("Scripture of the Ten Kings", "Scripture on the Ten Kings"),
)
FIELDS = ("name_en", "description_en")


def _apply(apps, schema_editor, pairs):
    db = schema_editor.connection.alias
    Realm = apps.get_model("realms", "Realm")
    for realm in Realm._base_manager.using(db).filter(name_en__contains="Hell") | Realm._base_manager.using(db).filter(description_en__contains="Ten Kings"):
        changed = {}
        for field in FIELDS:
            text = getattr(realm, field) or ""
            new = text
            for old, replacement in pairs:
                new = new.replace(old, replacement)
            if new != text:
                changed[field] = new
        if changed:
            Realm._base_manager.using(db).filter(pk=realm.pk).update(**changed)


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, REPLACEMENTS)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, tuple((new, old) for old, new in reversed(REPLACEMENTS)))


class Migration(migrations.Migration):
    dependencies = [("realms", "0028_backfill_english")]
    operations = [migrations.RunPython(forwards, backwards)]
