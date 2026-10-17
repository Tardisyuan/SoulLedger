# 第四十批 S-a:灵魂「互动消息」。手写(子代理不跑 makemigrations);与 models.SocialInteraction 逐字对应。

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("social", "0010_post_edited_at"),
        ("tenants", "0015_tenant_dispatch_enabled_default_true"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SocialInteraction",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("kind", models.CharField(choices=[
                    ("COMMENT", "Commented on my post"), ("REPLY", "Replied to my comment"),
                    ("REACTION", "Reacted to my post"), ("LAMP", "Lit an eternal lamp on my post"),
                    ("FOLLOW", "Followed me"),
                ], max_length=10)),
                ("actor_ids", models.JSONField(default=list)),
                ("day", models.DateField()),
                ("last_at", models.DateTimeField()),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("actor", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="+",
                                            to=settings.AUTH_USER_MODEL)),
                ("comment", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                                              related_name="+", to="social.comment")),
                ("post", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                                           related_name="+", to="social.post")),
                ("recipient", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                                related_name="social_interactions", to=settings.AUTH_USER_MODEL)),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                             related_name="social_interactions", to="tenants.tenant")),
            ],
            options={
                "ordering": ["-last_at"],
                "indexes": [
                    models.Index(fields=["recipient", "last_at"], name="social_soci_recipie_b40a01_idx"),
                    models.Index(fields=["last_at"], name="social_soci_last_at_b40a02_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        condition=models.Q(("kind__in", ["REACTION", "LAMP"])),
                        fields=("recipient", "kind", "post", "day"),
                        name="social_interaction_one_row_per_post_day",
                    ),
                    models.UniqueConstraint(
                        condition=models.Q(("kind", "FOLLOW")),
                        fields=("recipient", "kind", "day"),
                        name="social_interaction_one_follow_row_per_day",
                    ),
                ],
            },
        ),
    ]
