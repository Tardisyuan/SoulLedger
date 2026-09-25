"""Judgment.concluded_balance: the admitted merit − demerit frozen at conclusion.

Schema only — no data work. Rows concluded before this column stay null, and
the precedents ranking falls back to the soul's current balance for them
(apps/judgment/precedents.py). AddField of a nullable column reverses cleanly.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("judgment", "0026_judgment_claim_and_defer"),
    ]

    operations = [
        migrations.AddField(
            model_name="judgment",
            name="concluded_balance",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
