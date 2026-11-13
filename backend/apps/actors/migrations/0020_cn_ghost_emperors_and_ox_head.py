"""五方鬼帝与牛头的种子行跟着文档改(2026-11-13 四文明核对 CN-1、CN-28;用户定)。

* 中央鬼帝「周文」→「周乞」:《元始上真众仙记》作「周乞、嵇康為中央鬼帝,治抱犢山」,没有「周文」;
* 西方、北方两行的描述去掉「second candidate」:原文是每方二人并列(赵文和、王真人;张衡、杨云),不是候选人之争;
* 牛头一行的头衔「牛头马面 / Ox Head and Horse Face」→「牛头 / Ox Head」,与马面一行(「马面 / Horse Face」)对齐。

东方鬼帝不动(原文异文未核到)。``seed_mythology`` 默认只建不改,已有库里的行不会跟着种子变,所以这里改。
只动仍是旧值的列:手改过的不覆盖。反向同样只还原本迁移写下的值。走 ``_base_manager``(默认 manager 在迁移里
不可用,理由同 ``realms/0016``)。中央一行按头衔「中央鬼帝」找,因为名字本身就是要改的列。
"""
from django.db import migrations

#: (lookup, ((field, old, new), ...)) on Chinese rows
CHANGES = (
    ({"name": "赵文和"}, (
        ("description", (
            "Ghost Emperor of the West - governs the western ghost domain from 嶓冢山 (docs/02 §二). The seat has a "
            "second candidate, 王真人; the docs list both. 嶓冢山 is not modelled; filed at the holding pen"
        ), (
            "Ghost Emperor of the West - governs the western ghost domain from 嶓冢山 (docs/02 §二). 《元始上真众仙记》 seats "
            "two emperors here, 赵文和 and 王真人; this row carries the first name. 嶓冢山 is not modelled; filed at the "
            "holding pen"
        )),
        ("description_en", (
            "Ghost Emperor of the West - governs the western ghost domain from Mount Bozhong (docs/02 §2). The "
            "seat has a second candidate, Wang Zhenren; the docs list both. Mount Bozhong is not modelled; filed "
            "at the holding pen"
        ), (
            "Ghost Emperor of the West - governs the western ghost domain from Mount Bozhong (docs/02 §2). The "
            "Yuanshi Shangzhen Zhongxian Ji seats two emperors here, Zhao Wenhe and Wang Zhenren; this row "
            "carries the first name. Mount Bozhong is not modelled; filed at the holding pen"
        )),
    )),
    ({"name": "张衡"}, (
        ("description", (
            "Ghost Emperor of the North - sits at 罗酆山 in 酆都 and keeps the underworld's punishments (docs/02 §二). "
            "The seat has a second candidate, 杨云; the docs list both. 罗酆山 is not modelled; filed at the holding "
            "pen"
        ), (
            "Ghost Emperor of the North - sits at 罗酆山 in 酆都 and keeps the underworld's punishments (docs/02 §二). "
            "《元始上真众仙记》 seats two emperors here, 张衡 and 杨云; this row carries the first name. 罗酆山 is not modelled; "
            "filed at the holding pen"
        )),
        ("description_en", (
            "Ghost Emperor of the North - sits at Mount Luofeng in Fengdu and keeps the underworld's punishments "
            "(docs/02 §2). The seat has a second candidate, Yang Yun; the docs list both. Mount Luofeng is not "
            "modelled; filed at the holding pen"
        ), (
            "Ghost Emperor of the North - sits at Mount Luofeng in Fengdu and keeps the underworld's punishments "
            "(docs/02 §2). The Yuanshi Shangzhen Zhongxian Ji seats two emperors here, Zhang Heng and Yang Yun; "
            "this row carries the first name. Mount Luofeng is not modelled; filed at the holding pen"
        )),
    )),
    ({"title_zh": "中央鬼帝"}, (
        ("name", "周文", "周乞"),
        ("name_zh", "周文", "周乞"),
        ("name_en", "Zhou Wen", "Zhou Qi"),
        ("name_egy", "Zhouwen", "Zhouqi"),
        ("title_egy", "Zhouwen", "Zhouqi"),
        ("description", (
            "Ghost Emperor of the Centre - on 抱犊山, coordinates the other four quarters and keeps the balance of "
            "yin and yang (docs/02 §二). The docs record few sources for this seat and call its holder's name "
            "disputed. 抱犊山 is not modelled; filed at the holding pen"
        ), (
            "Ghost Emperor of the Centre - on 抱犊山, coordinates the other four quarters and keeps the balance of "
            "yin and yang (docs/02 §二). 《元始上真众仙记》 seats two emperors here, 周乞 and 嵇康; this row carries the first "
            "name. 抱犊山 is not modelled; filed at the holding pen"
        )),
        ("description_en", (
            "Ghost Emperor of the Centre - on Mount Baodu, coordinates the other four quarters and keeps the "
            "balance of yin and yang (docs/02 §2). The docs record few sources for this seat and call its "
            "holder's name disputed. Mount Baodu is not modelled; filed at the holding pen"
        ), (
            "Ghost Emperor of the Centre - on Mount Baodu, coordinates the other four quarters and keeps the "
            "balance of yin and yang (docs/02 §2). The Yuanshi Shangzhen Zhongxian Ji seats two emperors here, "
            "Zhou Qi and Ji Kang; this row carries the first name. Mount Baodu is not modelled; filed at the "
            "holding pen"
        )),
    )),
    ({"name": "牛头"}, (
        ("title", "牛头马面", "牛头"),
        ("title_zh", "牛头马面", "牛头"),
        ("title_en", "Ox Head and Horse Face", "Ox Head"),
        ("title_egy", "Niuma", "Niutou"),
    )),
)


def _apply(apps, schema_editor, forward):
    db = schema_editor.connection.alias
    Actor = apps.get_model("actors", "Actor")
    for lookup, fields in CHANGES:
        for field, old, new in fields:
            src, dst = (old, new) if forward else (new, old)
            Actor._base_manager.using(db).filter(civilization="CHINESE", **lookup, **{field: src}).update(**{field: dst})


def forwards(apps, schema_editor):
    _apply(apps, schema_editor, True)


def backwards(apps, schema_editor):
    _apply(apps, schema_editor, False)


class Migration(migrations.Migration):
    dependencies = [("actors", "0019_dantes_rivers_and_the_acheron_ferryman")]
    operations = [migrations.RunPython(forwards, backwards)]
