"""地府判无罪的存量灵魂改回候转世(用户 2026-10-29)。

此前地府 PASSED 路由到 `DY_01_HEAVEN`,种子把它标成永久(`is_eternal=True`),处置执行后计划以永久收尾 → 灵魂
SETTLED,永不转世。新规则(`apps.judgment.models.acquitted_to_rebirth`):地府判无罪不发落、不建刑期节点,
结案后直接候转世(docs/11 §3.1 第六步「无罪 → 直接投胎」、docs/05 §2.1「善人 → 直接批准投胎」)。

选中:地府灵魂(规则同 0050 `_diyu_souls`:租户 CN_DIYU,或不在已知表里而 `declared_civilization == "CHINESE"`)、
状态 SETTLED、**最近一份**(按 `created_at`,未删除)处置的去向是 `DY_01_HEAVEN`。

改法 —— 与新规则下同一个灵魂会落到的样子对齐:
* 那份处置 `is_eternal = False`:`assert_may_be_reborn` 不再当它是永久刑期;
* 挂着它的计划节点 ETERNAL → COMPLETED(`is_eternal = False`):计划仍是 COMPLETED,只是不再以永久收尾,
  灵魂端的转生申请资格(计划 COMPLETED + 灵魂 REINCARNATING)随之开放;重开计划(`_reopen`)也不再被永久节点挡住;
* 灵魂 SETTLED → REINCARNATING。

处置行与节点行保留(那是当时发生的事),不改成「没有处置」。行程上还开着的天道那一站不关:转世时
`SoulPathService.leave` 会关。

**不写事件**(STATE_CHANGED 等):迁移不经 `transition_to`,也不该替官员在时间线上记一次「状态变更」——
这是规则改了之后的数据对齐,不是哪位官员做的决定;迁移文件本身就是记录。用 `_base_manager`,不受租户
contextvar 影响。反向不动数据(`noop`):改之前的 SETTLED 正是被纠正的错误,没有理由还原。
"""
from django.db import migrations
from django.db.models import OuterRef, Q, Subquery

CHINESE_TENANT_CODES = ("CN_DIYU",)
KNOWN_TENANT_CODES = ("CN_DIYU", "EU_HEAVEN_HELL", "EG_DUAT", "GR_HADES")
HEAVEN = "DY_01_HEAVEN"


def _diyu_souls(apps, alias):
    Soul = apps.get_model("souls", "Soul")
    return Soul._base_manager.using(alias).filter(
        Q(tenant__code__in=CHINESE_TENANT_CODES)
        | (Q(tenant__declared_civilization="CHINESE") & ~Q(tenant__code__in=KNOWN_TENANT_CODES))
    )


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Disposition = apps.get_model("disposition", "Disposition")
    SentenceNode = apps.get_model("sentence_plan", "SentenceNode")

    latest = (
        Disposition._base_manager.using(alias)
        .filter(soul_id=OuterRef("pk"), is_deleted=False)
        .order_by("-created_at")
    )
    souls = (
        _diyu_souls(apps, alias).filter(current_state="SETTLED")
        .annotate(last_realm=Subquery(latest.values("destination_realm__realm_code")[:1]),
                  last_disposition=Subquery(latest.values("pk")[:1]))
        .filter(last_realm=HEAVEN)
    )
    rows = list(souls.values_list("pk", "last_disposition"))
    if not rows:
        return
    soul_ids = [pk for pk, _ in rows]
    disposition_ids = [d for _, d in rows]
    Disposition._base_manager.using(alias).filter(pk__in=disposition_ids).update(is_eternal=False)
    SentenceNode._base_manager.using(alias).filter(
        disposition_id__in=disposition_ids, status="ETERNAL",
    ).update(status="COMPLETED", is_eternal=False)
    apps.get_model("souls", "Soul")._base_manager.using(alias).filter(
        pk__in=soul_ids, current_state="SETTLED",
    ).update(current_state="REINCARNATING")


class Migration(migrations.Migration):
    dependencies = [
        ("souls", "0050_backfill_diyu_station_and_birth_continent"),
        ("disposition", "0016_disposition_lost_hold"),
        ("sentence_plan", "0002_relax_home_node_first"),
        ("realms", "0026_realm_type_annihilation_label"),
        ("tenants", "0016_tenant_declared_civilization"),
    ]
    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
