"""回填地府灵魂的部洲与十三站(2026-10-28 用户定)。0049 加了两列,存量灵魂全是空。

「地府灵魂」= 所属文明是中国地府,与 `Tenant.civilization` 同一规则:租户代码在 `TENANT_CIVILIZATION` 里按表
(CN_DIYU),不在表里的新建殿看 `declared_civilization == "CHINESE"`。迁移里不能 import 运行时常量,
所以这里重抄一份(与 0031 同一做法)。

部洲(`birth_continent`):空的一律填南瞻部洲(NANZHAN)—— 人间就是南瞻部洲(docs/07 §人道「四大部洲」)。
在世与否都填。

十三站(`diyu_station`):只填不在世(state != ALIVE)、站为空的。转世完成的灵魂回到 ALIVE,自然不在内。
按所在界域推断,先到先得(越靠后的站越先判):
  1. 已饮孟婆汤(`soup_taken_at` 不空)              → 还魂崖 HUANHUN_CLIFF(06 §二 第十三站第 1 步就是饮汤)
  2. 此刻在十殿任一殿(未关闭的行程在 `DY_COURT_*`)  → 酆都城 FENGDU_CITY(十殿阎罗在此处理政务)
  3. 审判中(JUDGING)且不在殿                         → 土地庙 TUDI_TEMPLE(刚死,还没进殿)
  其余(已处置在狱中、待转世而没饮汤……)留空:没有可信的依据,官员可在灵魂详情里挪站。
与运行时 `apps/souls/stations.py` 自动走的三处一一对应。不写 DIYU_STATION_CHANGED 事件:那是「换站」的记录,
回填不是一次换站。

反向不动数据(`noop`):回填前的值就是空,没有可还原的信息;反向到 0049 时这两列随之删除。
"""
from django.db import migrations

CHINESE_TENANT_CODES = ("CN_DIYU",)
KNOWN_TENANT_CODES = ("CN_DIYU", "EU_HEAVEN_HELL", "EG_DUAT", "GR_HADES")
COURT_PREFIX = "DY_COURT_"


def _diyu_souls(apps, alias):
    from django.db.models import Q

    Soul = apps.get_model("souls", "Soul")
    return Soul.objects.using(alias).filter(
        Q(tenant__code__in=CHINESE_TENANT_CODES)
        | (Q(tenant__declared_civilization="CHINESE") & ~Q(tenant__code__in=KNOWN_TENANT_CODES))
    )


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    SoulPathEntry = apps.get_model("realms", "SoulPathEntry")
    souls = _diyu_souls(apps, alias)

    souls.filter(birth_continent="").update(birth_continent="NANZHAN")

    dead = souls.exclude(current_state="ALIVE").filter(diyu_station="")
    in_court = SoulPathEntry.objects.using(alias).filter(
        left_at__isnull=True, realm__realm_code__startswith=COURT_PREFIX).values("soul_id")
    # 顺序即优先级:每一步只碰还空着的行,先写上的不会被后面的覆盖。
    dead.filter(soup_taken_at__isnull=False).update(diyu_station="HUANHUN_CLIFF")
    dead.filter(diyu_station="", pk__in=in_court).update(diyu_station="FENGDU_CITY")
    dead.filter(diyu_station="", current_state="JUDGING").update(diyu_station="TUDI_TEMPLE")


class Migration(migrations.Migration):
    dependencies = [
        ("souls", "0049_diyu_station_and_birth_continent"),
        ("realms", "0026_realm_type_annihilation_label"),
        ("tenants", "0016_tenant_declared_civilization"),
    ]
    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
