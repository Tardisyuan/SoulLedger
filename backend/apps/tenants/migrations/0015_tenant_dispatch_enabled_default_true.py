# 2026-10-08:`dispatch_enabled` 从这一天起才被真正读到(调拨拒收关着的殿)。默认改成开着,
# 理由见 apps/tenants/models.py 字段旁的注释。只改默认值,不动现有行。

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tenants', '0014_tenant_seal_glyphs'),
    ]

    operations = [
        migrations.AlterField(
            model_name='tenant',
            name='dispatch_enabled',
            field=models.BooleanField(default=True),
        ),
    ]
