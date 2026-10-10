from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0021_user_email_verified"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="session_version",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
