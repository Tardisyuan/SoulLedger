"""第四站的显示名改成「恶狗岭」(2026-11-11 用户定，docs/06 §一 总览表)。

只改 choices 的标签，存的值仍是 `EVIL_DOG_VILLAGE`:不动任何一行，数据库上没有 SQL。
"""
from django.db import migrations, models


FIELD = models.CharField(
    blank=True,
    choices=[
        ("TUDI_TEMPLE", "土地庙"),
        ("YELLOW_SPRINGS_ROAD", "黄泉路"),
        ("WANGXIANG_TERRACE", "望乡台"),
        ("EVIL_DOG_VILLAGE", "恶狗岭"),
        ("GOLDEN_ROOSTER_HILL", "金鸡山"),
        ("WILD_GHOST_VILLAGE", "野鬼村"),
        ("MIHUN_HALL", "迷魂殿"),
        ("OFFERING_PAVILION", "供养阁"),
        ("GHOST_FORT", "鬼界堡"),
        ("FENGDU_CITY", "酆都城"),
        ("EIGHTEEN_HELLS", "十八层地狱"),
        ("LOTUS_TERRACE", "莲花台"),
        ("HUANHUN_CLIFF", "还魂崖"),
    ],
    default="",
    max_length=20,
)


class Migration(migrations.Migration):

    dependencies = [
        ("souls", "0055_backfill_soul_owner_org"),
    ]

    operations = [
        migrations.AlterField(model_name="soul", name="diyu_station", field=FIELD),
    ]
