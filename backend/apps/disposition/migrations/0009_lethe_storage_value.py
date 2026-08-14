"""
Fix the stored value of MemoryResetMechanism.LETHE: "LETIES" -> "LETHE".

"LETIES" was a misspelling of Lethe (忘川), the Greek river of forgetfulness.
The enum *member* and its label always read LETHE / "忘川 (Lethe)"; only the
stored value was wrong, and it had already reached the database and the API.

This is a storage-value change, not a label change, so every existing row has
to be rewritten — an AlterField alone would leave rows holding a value that is
no longer in `choices`. Both tables that carry the value are updated here in
one migration so a rollback cannot strand one of them on the old spelling:

  * disposition.Disposition.memory_reset
  * realms.Realm.memory_reset_mechanism  (declared with no `choices=` until
    realms/0011, which is why it drifted unnoticed in the first place)

`reverse_code` restores "LETIES" in both tables, so `migrate disposition 0008`
leaves the database consistent with the pre-change code instead of dirty.
"""
from django.db import migrations, models

OLD = "LETIES"
NEW = "LETHE"


def _rewrite(apps, old, new):
    disposition = apps.get_model("disposition", "Disposition")
    realm = apps.get_model("realms", "Realm")
    # `_base_manager` is the unfiltered plain manager: the tenant-scoped and
    # soft-delete managers would silently skip rows, and a data migration that
    # skips rows is exactly the failure this migration exists to fix.
    disposition._base_manager.filter(memory_reset=old).update(memory_reset=new)
    realm._base_manager.filter(memory_reset_mechanism=old).update(
        memory_reset_mechanism=new
    )


def forwards(apps, schema_editor):
    _rewrite(apps, OLD, NEW)


def backwards(apps, schema_editor):
    _rewrite(apps, NEW, OLD)


class Migration(migrations.Migration):

    dependencies = [
        (
            "disposition",
            "0008_disposition_archive_reason_disposition_archived_at_and_more",
        ),
        # Realm rows are rewritten here too, so its table must already exist.
        ("realms", "0010_realm_delete_cascade_id"),
    ]

    operations = [
        migrations.AlterField(
            model_name="disposition",
            name="memory_reset",
            field=models.CharField(
                choices=[
                    ("MENGPO", "孟婆汤 (Mengpo Soup)"),
                    ("LETHE", "忘川 (Lethe)"),
                    ("SPELL", "Spell Recitation"),
                    ("NONE", "No Reset"),
                ],
                default="NONE",
                max_length=20,
            ),
        ),
        migrations.RunPython(forwards, backwards),
    ]
