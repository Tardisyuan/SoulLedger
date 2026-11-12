from django.db import migrations, models


class Migration(migrations.Migration):
    """转生申请记下跨文明的目标殿(F-REB-11,用户 2026-11-12):判官初审选「跨文明」时一并选目标殿,
    办转世时灵魂迁到那里。存租户 code(不加跨租户外键)。已有的行为空:此前跨文明只是一个标记,
    没有目标可回填;那些申请办转世时照旧留在原文明。纯加列,反向即删列。"""

    dependencies = [
        ("soul_accounts", "0011_souldevicelogin_session"),
    ]

    operations = [
        migrations.AddField(
            model_name="rebirthapplication",
            name="target_tenant_code",
            field=models.CharField(blank=True, default="", max_length=50),
        ),
    ]
