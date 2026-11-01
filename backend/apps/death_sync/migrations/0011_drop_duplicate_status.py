from django.db import migrations, models

#: DUPLICATE had no writer, ever (review 2026-11-01 P3): a replayed key is answered 409 with the row that owns it
#: (or, since the same review, a FAILED row is run again) and never writes a row of its own. Should a row on a shared
#: box carry it anyway, it registered nothing itself -> FAILED (the status a human is shown), its error_code
#: DUPLICATE when it has none, so it still says why. Not reversed, as in 0009.


def move_rows(apps, schema_editor):
    Registration = apps.get_model("death_sync", "DeathRegistrationRequest")
    rows = Registration._base_manager.using(schema_editor.connection.alias).filter(status="DUPLICATE")
    rows.filter(error_code="").update(error_code="DUPLICATE")
    rows.update(status="FAILED")


class Migration(migrations.Migration):

    dependencies = [
        ("death_sync", "0010_encrypted_json_in_a_text_column"),
    ]

    operations = [
        migrations.RunPython(move_rows, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="deathregistrationrequest",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending Validation"),
                    ("PROCESSED", "Processed Successfully"),
                    ("FAILED", "Processing Failed"),
                ],
                default="PENDING",
                max_length=20,
            ),
        ),
    ]
