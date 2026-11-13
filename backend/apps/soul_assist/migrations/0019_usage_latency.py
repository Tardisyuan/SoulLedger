"""AssistUsage 记延迟与首字时间(作品集建议 B5,2026-11-13)。两列可空:旧行没有这项数字,用量页的 p50 / p95 只算有数的行。"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("soul_assist", "0018_eval_rebirth_quota_says_zhuansheng")]

    operations = [
        migrations.AddField(model_name="assistusage", name="latency_ms",
                            field=models.PositiveIntegerField(blank=True, null=True)),
        migrations.AddField(model_name="assistusage", name="first_token_ms",
                            field=models.PositiveIntegerField(blank=True, null=True)),
    ]
