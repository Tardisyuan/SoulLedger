import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0028_officer_organization_defaults_to_hall_root"),
    ]

    operations = [
        migrations.CreateModel(
            name="OfficerDeviceLogin",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("credential_hash", models.CharField(max_length=64, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_used_at", models.DateTimeField(blank=True, null=True)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                (
                    "revoked_reason",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("password_changed", "密码已修改或被重置"),
                            ("signed_out", "这台设备被退出"),
                            ("turned_off", "在这部手机上关闭"),
                        ],
                        default="",
                        max_length=30,
                    ),
                ),
                (
                    "session",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="authentication.signinsession",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="officer_device_logins",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
    ]
