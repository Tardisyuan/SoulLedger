"""四文明殿司的默认展示名。只填空着的列:运维改过的不覆盖,重跑无害。

**取法**:不新造名字,每一个都是仓库里已有的殿域行(`apps/actors/mythology/realms.py`)与语言包
`realms.codes.*`(egy 那一份)里的现成写法 —— 选的是「灵魂写信给谁」在那个文明里最说得通的那一处:

* CN_DIYU  → DY_COURT_05_YANLUO「第五殿」/ Fifth Court / Yanluo Qedi。阎罗王那一殿:realms.py 说它
  审「行为背后的用心」、望乡台在此;传统上阎罗王本居第一殿,因怜屈死者屡放还阳伸雪而降居第五 ——
  受理陈情,说得通。也是用户举的例子。
* EU_HEAVEN_HELL → EU_PURGATORY「炼狱」/ Purgatory / Ta Hesmen。但丁的三界里,唯有炼狱的灵魂
  还在求告、还在等人代祷;地狱不收信,天堂不必写。
* EG_DUAT → EG_HALL_TWO_TRUTHS「真理殿堂」/ Hall of Two Truths / Weret Maaty。称心之所。
* GR_HADES → EU_PLATO_MEADOW「岔路草原」/ The Meadow at the Parting of the Ways(Gorgias 524a,
  三判官坐的地方)。egy 不用语言包里那个「Meadow」(英文残留),用词根 Wat(路)+ Wedja(审)。

en / egy 与 zh 并列存,App 与官员后台按界面语言取(`Tenant.hall_names`)。
"""
from django.db import migrations

DEFAULTS = {
    "CN_DIYU": ("第五殿", "The Fifth Court", "Yanluo Qedi"),
    "EU_HEAVEN_HELL": ("炼狱", "Purgatory", "Ta Hesmen"),
    "EG_DUAT": ("真理殿堂", "Hall of Two Truths", "Weret Maaty"),
    "GR_HADES": ("岔路草原", "The Meadow at the Parting of the Ways", "Wat Wedja"),
}


def fill(apps, schema_editor):
    Tenant = apps.get_model("tenants", "Tenant")
    for code, (zh, en, egy) in DEFAULTS.items():
        Tenant._base_manager.filter(code=code, hall_name="").update(hall_name=zh)
        Tenant._base_manager.filter(code=code, hall_name_en="").update(hall_name_en=en)
        Tenant._base_manager.filter(code=code, hall_name_egy="").update(hall_name_egy=egy)


class Migration(migrations.Migration):

    dependencies = [("tenants", "0011_tenant_hall_name")]

    operations = [migrations.RunPython(fill, migrations.RunPython.noop)]
