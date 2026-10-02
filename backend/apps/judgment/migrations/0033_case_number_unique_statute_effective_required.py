from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0032_backfill_case_number_and_statute_version"),
    ]

    operations = [
        migrations.AlterField(
            model_name="judgment",
            name="case_number",
            field=models.CharField(editable=False, max_length=32, unique=True),
        ),
        migrations.AlterField(
            model_name="statute",
            name="effective_from",
            field=models.DateField(default=timezone.localdate),
        ),
    ]
