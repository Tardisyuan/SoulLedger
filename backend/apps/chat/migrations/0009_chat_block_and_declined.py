# Hand-written 2026-11-01 (书信申请的拒绝与拉黑).

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0008_conversation_feedback_tag"),
        ("soul_accounts", "0010_retired_by_ammit"),
    ]

    operations = [
        migrations.AddField(
            model_name="conversation",
            name="declined_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="ChatBlock",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "blocked",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="+",
                        to="soul_accounts.soulaccount",
                    ),
                ),
                (
                    "blocker",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chat_blocks",
                        to="soul_accounts.soulaccount",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
                "constraints": [
                    models.UniqueConstraint(fields=("blocker", "blocked"), name="chat_one_block_per_pair"),
                    models.CheckConstraint(
                        condition=models.Q(("blocker", models.F("blocked")), _negated=True),
                        name="chat_block_not_self",
                    ),
                ],
            },
        ),
    ]
