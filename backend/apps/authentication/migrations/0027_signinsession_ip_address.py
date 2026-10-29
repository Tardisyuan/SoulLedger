from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0026_impersonation_hall"),
    ]

    operations = [
        migrations.AddField(
            model_name="signinsession",
            name="ip_address",
            field=models.GenericIPAddressField(blank=True, null=True),
        ),
    ]
