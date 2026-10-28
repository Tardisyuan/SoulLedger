"""给还没执行、没写刑期的处置填上界域的默认刑期(用户 2026-10-29;规则与出处见 `apps/disposition/default_terms.py`)。

只碰**未执行**的:执行 = 开始服刑,刑满才往下走。已执行的处置当时没有刑期,就是执行即服完;回填它们会让已经
往下走了的灵魂倒回「受刑中」,或让候转世的灵魂被 `term_not_served` 挡住 —— 那是改写已经发生的事。
永久刑(`is_eternal`)、已删除的、表外的界域都不碰。挂着它的受刑计划节点(`disposition_id`)若也没写年数,
一并写上,节点与处置说同一个刑期。

表是 `default_terms.DEFAULT_TERM_YEARS` 在 2026-10-29 的一份抄本:迁移里不 import 运行时常量
(与 souls/0050 同一做法),以后改运行时的表不回头改这里。

不写事件:这是规则补上之后的数据对齐,不是哪位官员改了刑期。反向不动数据(`noop`):回填前就是「没写」,
回滚到 0016 后这些年数留着也只是判官可改的一个值。
"""
from django.db import migrations

DEFAULT_TERM_YEARS = {
    "GR_TARTARUS": 1000,
    "GR_ISLES_OF_THE_BLESSED": 1000,
    "DY_COURT_02_CHUJIANG": 10,
    "DY_COURT_03_SONGDI": 20,
    "DY_COURT_04_WUGUAN": 30,
    "DY_COURT_05_YANLUO": 40,
    "DY_COURT_06_BIANCHENG": 50,
    "DY_COURT_07_TAISHAN": 60,
    "DY_COURT_08_DUSHI": 70,
    "DY_COURT_09_PINGDENG": 80,
    "EU_PURGATORY": 100,
    "EU_PURGATORY_T1_PRIDE": 100,
    "EU_PURGATORY_T2_ENVY": 100,
    "EU_PURGATORY_T3_WRATH": 100,
    "EU_PURGATORY_T4_SLOTH": 100,
    "EU_PURGATORY_T5_AVARICE": 100,
    "EU_PURGATORY_T6_GLUTTONY": 100,
    "EU_PURGATORY_T7_LUST": 100,
}


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Disposition = apps.get_model("disposition", "Disposition")
    SentenceNode = apps.get_model("sentence_plan", "SentenceNode")
    pending = Disposition._base_manager.using(alias).filter(
        is_executed=False, is_eternal=False, is_deleted=False, sentence_years__isnull=True,
    )
    for code, years in DEFAULT_TERM_YEARS.items():
        ids = list(pending.filter(destination_realm__realm_code=code).values_list("pk", flat=True))
        if not ids:
            continue
        Disposition._base_manager.using(alias).filter(pk__in=ids).update(sentence_years=years)
        SentenceNode._base_manager.using(alias).filter(
            disposition_id__in=ids, sentence_years__isnull=True, is_eternal=False,
        ).update(sentence_years=years)


class Migration(migrations.Migration):
    dependencies = [
        ("disposition", "0016_disposition_lost_hold"),
        ("sentence_plan", "0002_relax_home_node_first"),
        ("realms", "0026_realm_type_annihilation_label"),
    ]
    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
