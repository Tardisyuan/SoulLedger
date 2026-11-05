"""English the first backfill wrote without a source, corrected against published ones (Jordan's Jade Records, Teiser's
Scripture on the Ten Kings, the usual English for the eight hot hells). 判官 are judges, not registrars. A piece of text
changes only where it still reads the old way, so a name somebody edited stays. Reverse is the same the other way."""
from django.db import migrations

#: In this order: "Great Burning" has to become "Burning" before "Greater Burning" becomes "Great Burning".
REPLACEMENTS = (
    ("Great Burning", "Burning"),
    ("Greater Burning", "Great Burning"),
    ("Greater Howling", "Great Howling"),
    ("Clerk-Registrar of the Dead", "Judge of the Dead"),
    ("Cui the Registrar", "Judge Cui"),
    ("Four Great Registrars", "Four Great Judges"),
    ("Registrars who compile", "Judges who compile"),
    ("Scripture of the Ten Kings", "Scripture on the Ten Kings"),
    ("Popular lists of the 四大判官 give him the 阴律司", "This project's docs give him the 阴律司"),
)
ACTOR_FIELDS = ("title_en", "description", "description_en")


def replace_all(text, pairs):
    for old, new in pairs:
        text = text.replace(old, new)
    return text


def _apply(apps, schema_editor, pairs, panguan):
    db = schema_editor.connection.alias
    Actor = apps.get_model("actors", "Actor")
    for actor in Actor._base_manager.using(db).filter(civilization="CHINESE"):
        changed = {f: replace_all(getattr(actor, f) or "", pairs) for f in ACTOR_FIELDS}
        changed = {f: v for f, v in changed.items() if v != (getattr(actor, f) or "")}
        if changed:
            Actor._base_manager.using(db).filter(pk=actor.pk).update(**changed)
    Actor._base_manager.using(db).filter(name="判官", civilization="CHINESE", name_en=panguan[0]).update(name_en=panguan[1])


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, REPLACEMENTS, ("Registrar", "Judge"))


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, tuple((new, old) for old, new in reversed(REPLACEMENTS)), ("Judge", "Registrar"))


class Migration(migrations.Migration):
    dependencies = [("actors", "0017_the_ten_kings_read_as_their_nodes")]
    operations = [migrations.RunPython(forwards, backwards)]
