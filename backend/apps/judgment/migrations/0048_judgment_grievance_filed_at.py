from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0047_alter_judgment_grievance_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="judgment",
            name="grievance_filed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
