from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0018_backfill_email_opted_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="extra_roles",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
