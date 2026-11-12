"""死亡地点另存一列(F-DEATH-06,2026-11-12):此前 `Soul.die` 把它写进 `origin_location`,出身地被覆盖、城隍按死亡地配。

只加列，不回填：已被覆盖的出身地无从恢复。
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("souls", "0056_diyu_station_evil_dog_ridge_label"),
    ]

    operations = [
        migrations.AddField(
            model_name="soul",
            name="death_location",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
