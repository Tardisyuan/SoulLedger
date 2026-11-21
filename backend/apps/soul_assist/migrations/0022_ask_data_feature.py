"""FEATURES 加 `ask_data`(官员端问数,docs/ARCHITECTURE-ask-data.md §1):只改 choices,不动数据。"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("soul_assist", "0021_bare_ids_across_databases"),
    ]

    operations = [
        migrations.AlterField(
            model_name="aidraft",
            name="feature",
            field=models.CharField(
                choices=[
                    ("assist", "assist"),
                    ("perm_explain", "perm_explain"),
                    ("audit_query", "audit_query"),
                    ("statute_suggest", "statute_suggest"),
                    ("verdict_draft", "verdict_draft"),
                    ("moderation", "moderation"),
                    ("letter_draft", "letter_draft"),
                    ("ask_data", "ask_data"),
                ],
                max_length=30,
            ),
        ),
        migrations.AlterField(
            model_name="assistusage",
            name="feature",
            field=models.CharField(
                choices=[
                    ("assist", "assist"),
                    ("perm_explain", "perm_explain"),
                    ("audit_query", "audit_query"),
                    ("statute_suggest", "statute_suggest"),
                    ("verdict_draft", "verdict_draft"),
                    ("moderation", "moderation"),
                    ("letter_draft", "letter_draft"),
                    ("ask_data", "ask_data"),
                ],
                db_index=True,
                default="assist",
                max_length=30,
            ),
        ),
    ]
