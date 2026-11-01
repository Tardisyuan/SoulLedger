import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """面容 / 指纹登录凭据记下那部手机的登录会话:退出那台登录设备时凭据一并失效(review-2026-11-01 P2 #17)。
    已有的行为空,不回填(「除这台外全部退出」照样让它们失效)。"""

    dependencies = [
        ("authentication", "0023_sign_in_sessions"),
        ("soul_accounts", "0010_retired_by_ammit"),
    ]

    operations = [
        migrations.AddField(
            model_name="souldevicelogin",
            name="session",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="authentication.signinsession",
            ),
        ),
    ]
