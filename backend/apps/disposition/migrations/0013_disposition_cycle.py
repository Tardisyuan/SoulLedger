
from django.conf import settings
from django.db import migrations, models


def stamp_rows_with_their_life(apps, schema_editor):
    """存量 Disposition 按「创建时该灵魂已经转世几次」回填 cycle。

    一世的生命周期是 死亡 → 审判 → 处置 → 转世,所以一行属于第 N 世,当且仅当它
    创建时恰有 N 条早于它的 Reincarnation。只遍历转过世的灵魂:其余的 cycle 本来
    就该是默认的 0。
    """
    Row = apps.get_model("disposition", "Disposition")
    Reincarnation = apps.get_model("reincarnation", "Reincarnation")
    reborn = Reincarnation._base_manager.values_list("soul_id", flat=True).distinct()
    for soul_id in set(reborn):
        rebirths = sorted(
            Reincarnation._base_manager.filter(soul_id=soul_id).values_list("reincarnated_at", flat=True)
        )
        for pk, created_at in Row._base_manager.filter(soul_id=soul_id).values_list("pk", "created_at"):
            n = sum(1 for at in rebirths if at < created_at)
            if n:
                Row._base_manager.filter(pk=pk).update(cycle=n)


class Migration(migrations.Migration):

    dependencies = [
        ("disposition", "0012_arithmetic_fields_get_bounds"),
        (
            "judgment",
            "0020_remove_judgmentcitation_unique_citation_judgment_statute_and_more",
        ),
        ("realms", "0018_split_greek_from_european"),
        ("souls", "0034_ledger_is_per_life"),
        ("reincarnation", "0013_arithmetic_fields_get_bounds"),
        ("tenants", "0010_drop_dead_notification_table"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="disposition",
            name="cycle",
            field=models.PositiveIntegerField(
                default=0,
                help_text="Life index this row belongs to; 0 is the first life.",
            ),
        ),
        migrations.AddIndex(
            model_name="disposition",
            index=models.Index(
                fields=["soul", "cycle"], name="disposition_soul_id_3fdfe8_idx"
            ),
        ),
        migrations.RunPython(stamp_rows_with_their_life, migrations.RunPython.noop),
    ]
