from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("workflow", "0024_b37_backfill_workflow_number"),
    ]

    operations = [
        migrations.AlterField(
            model_name="approvalworkflow",
            name="number",
            field=models.CharField(editable=False, max_length=32, unique=True),
        ),
    ]
