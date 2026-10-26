import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0025_auth_round_password_policy"),
        ("tenants", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="impersonation",
            name="hall",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name="+", to="tenants.tenant",
            ),
        ),
    ]
