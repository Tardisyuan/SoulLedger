# Judgment composite indexes per SPEC §8.1
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0003_judgment_tenant"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="judgment",
            index=models.Index(
                fields=["tenant", "verdict", "is_final"],
                name="idx_judgment_tenant_verdict",
            ),
        ),
        migrations.AddIndex(
            model_name="judgment",
            index=models.Index(
                fields=["soul", "created_at"],
                name="idx_judgment_soul_created",
            ),
        ),
    ]
