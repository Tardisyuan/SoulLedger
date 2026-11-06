# The official name is 欧洲天堂与地狱 (user decision, 2026-11-07); label only, no data change.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("org", "0013_backfill_english"),
    ]

    operations = [
        migrations.AlterField(
            model_name="organization",
            name="category",
            field=models.CharField(
                choices=[
                    ("CHINESE", "中国地府"),
                    ("EUROPEAN", "欧洲天堂与地狱"),
                    ("EGYPTIAN", "埃及冥界"),
                    ("GREEK", "希腊冥界"),
                ],
                help_text="所属文明体系",
                max_length=20,
            ),
        ),
    ]
