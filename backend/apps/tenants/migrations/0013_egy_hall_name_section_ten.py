"""CN_DIYU 殿司的 egy 展示名跟着 egy 词表第十节改:Qedi 换成 Wesekhet(Yanluo Qedi → Yanluo Wesekhet)。

``tenants/0012`` 取的是语言包 `realms.codes.DY_COURT_05_YANLUO` 的现成写法,那个值第十节改了,
这里跟上。只动仍是旧值的行:运维改过的不覆盖。其余三个文明的默认名不含被换掉的旧词。
"""
from django.db import migrations

OLD, NEW = "Yanluo Qedi", "Yanluo Wesekhet"


def forwards(apps, schema_editor):
    Tenant = apps.get_model("tenants", "Tenant")
    Tenant._base_manager.filter(code="CN_DIYU", hall_name_egy=OLD).update(hall_name_egy=NEW)


def backwards(apps, schema_editor):
    Tenant = apps.get_model("tenants", "Tenant")
    Tenant._base_manager.filter(code="CN_DIYU", hall_name_egy=NEW).update(hall_name_egy=OLD)


class Migration(migrations.Migration):

    dependencies = [("tenants", "0012_default_hall_names")]

    operations = [migrations.RunPython(forwards, backwards)]
