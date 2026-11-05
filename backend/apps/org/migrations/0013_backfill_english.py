"""The English the display table held for organizations, by name. Only blank columns are filled.
Reverse: `0012` drops the column."""
from django.db import migrations

NAME_EN = {
    "中国地府": "Diyu",
    "冥界": "The Underworld",
    "土地公": "Earth Gods",
    "地曹": "Bureau of Earth",
    "地狱": "Hell",
    "埃及冥界": "The Duat",
    "城隍体系": "City Gods",
    "大天使团": "The Archangels",
    "天堂": "Heaven",
    "天堂执行层": "Heaven's Executors",
    "天曹": "Bureau of Heaven",
    "孟婆": "Meng Po",
    "岔路草原": "The Meadow at the Parting of the Ways",
    "崔珏（崔府君）": "Cui Jue",
    "希腊冥界": "Hades",
    "炼狱": "Purgatory",
    "牛头马面": "Ox-Head and Horse-Face",
    "真理大厅": "Hall of Ma'at",
    "真理殿堂": "The Hall of Two Truths",
    "神曹": "Bureau of Spirits",
    "第一殿-秦广王": "First Court · King Qinguang",
    "第七殿-泰山王": "Seventh Court · King Taishan",
    "第三殿-宋帝王": "Third Court · King Songdi",
    "第九殿-平等王": "Ninth Court · King Pingdeng",
    "第二殿-楚江王": "Second Court · King Chujiang",
    "第五殿": "Fifth Court",
    "第五殿-阎罗王": "Fifth Court · King Yanluo",
    "第八殿-都市王": "Eighth Court · King Dushi",
    "第六殿-卞城王": "Sixth Court · King Biancheng",
    "第十殿-转轮王": "Tenth Court · King Zhuanlun",
    "第四殿-五官王": "Fourth Court · King Wuguan",
    "钟馗": "Zhong Kui",
    "门之书十二门": "Twelve Gates of the Book of Gates",
    "阴间之书阿佩普领域": "Realm of Apep, Book of the Underworld",
    "陆之道": "Lu Zhidao",
    "鬼曹": "Bureau of Ghosts",
    "魏征": "Wei Zheng",
    "黑白无常": "The Impermanences",
}


def forwards(apps, schema_editor):
    db = schema_editor.connection.alias
    Organization = apps.get_model("org", "Organization")
    for name, english in NAME_EN.items():
        Organization._base_manager.using(db).filter(name=name, name_en="").update(name_en=english)


class Migration(migrations.Migration):
    dependencies = [("org", "0012_english_columns")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
