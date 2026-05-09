# Disposition composite indexes per SPEC §8.1
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("disposition", "0002_disposition_tenant"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="disposition",
            index=models.Index(
                fields=["tenant", "is_executed"],
                name="idx_disposition_tenant_executed",
            ),
        ),
        migrations.AddIndex(
            model_name="disposition",
            index=models.Index(
                fields=["soul", "created_at"],
                name="idx_disposition_soul_created",
            ),
        ),
    ]
