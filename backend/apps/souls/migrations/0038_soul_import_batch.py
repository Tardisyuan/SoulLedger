from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("souls", "0037_soulrecord_statute_life_stage_evidence_source"),
    ]

    operations = [
        migrations.AddField(
            model_name="soul",
            name="import_batch",
            field=models.UUIDField(blank=True, db_index=True, editable=False, null=True),
        ),
    ]
