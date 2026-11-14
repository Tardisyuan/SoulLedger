"""回填 `from_tenant` / `to_tenant`,并把同一灵魂重号的转世记录重新编号(为 0018 的唯一约束让路)。

来源殿:行的 `tenant`。转世记录一直写在来源殿(`complete_rebirth` 在迁籍之前建行),所以这一列就是它。

目标殿:同一笔转世写的 `REINCARNATION_COMPLETED` 事件(载荷 `reincarnation_id`)里的 `to_tenant`(殿的 code)。
  * 载荷里有 code、且这个殿还在 → 那个殿;
  * 载荷里有 code、殿已不在 → 留空(计数);
  * `to_tenant` 为 null、没有这个键(11-12 跨文明迁籍之前的事件)、或根本没有事件 → 与来源殿相同。
    能让灵魂换殿的写法只有 `complete_rebirth`,它的事件与行同一事务;没有事件的行(种子、测试)没有迁过籍。
行没有 `tenant` 的,两列都留空(计数)。

重号:`cycle_count` 加灵魂行锁之前,两次并发转世拿到过同一个号(services.py 里那段实测)。有重号的灵魂,
它的全部转世记录按 (reincarnated_at, id) 重编为 1..n —— 与 `Soul.life_index`(= 转世记录条数)给的含义一致;
没有重号的灵魂一行不动。事件载荷里的 `cycle_count` 是当时写下的,不改。每改一个灵魂打印一行。

反向:noop。0016 的反向删掉两列;重编号不还原(还原就是把重号写回去)。
"""

from django.db import migrations
from django.db.models import Count, F


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Reincarnation = apps.get_model("reincarnation", "Reincarnation")
    SoulEvent = apps.get_model("events", "SoulEvent")
    Tenant = apps.get_model("tenants", "Tenant")
    rows = Reincarnation._base_manager.using(alias)

    rows.filter(tenant__isnull=False).update(from_tenant=F("tenant"), to_tenant=F("tenant"))
    unresolved = rows.filter(tenant__isnull=True).count()

    halls = dict(Tenant._base_manager.using(alias).values_list("code", "pk"))
    moved = {}
    for payload in SoulEvent._base_manager.using(alias).filter(
            event_type="REINCARNATION_COMPLETED").values_list("payload", flat=True):
        if isinstance(payload, dict) and payload.get("reincarnation_id") and payload.get("to_tenant"):
            moved[str(payload["reincarnation_id"])] = payload["to_tenant"]
    for pk in rows.filter(tenant__isnull=False).values_list("pk", flat=True):
        code = moved.get(str(pk))
        if code is None:
            continue
        hall = halls.get(code)
        rows.filter(pk=pk).update(to_tenant_id=hall)
        if hall is None:
            unresolved += 1
    if unresolved:
        print(f"\n  reincarnation/0017: {unresolved} row(s) left with from_tenant/to_tenant NULL "
              f"(no tenant on the row, or the event's target hall no longer exists)")

    duplicated = (rows.values("soul_id").annotate(n=Count("id"), cycles=Count("cycle_count", distinct=True))
                  .filter(n__gt=F("cycles")).values_list("soul_id", flat=True))
    for soul_id in list(duplicated):
        before = []
        for index, row in enumerate(rows.filter(soul_id=soul_id).order_by("reincarnated_at", "id"), start=1):
            before.append(row.cycle_count)
            if row.cycle_count != index:
                rows.filter(pk=row.pk).update(cycle_count=index)
        print(f"\n  reincarnation/0017: soul {soul_id} cycle_count {before} renumbered to "
              f"{list(range(1, len(before) + 1))}")


class Migration(migrations.Migration):

    dependencies = [
        ("reincarnation", "0016_reincarnation_from_to_tenant"),
        ("events", "0033_soulevent_soul_protect"),
    ]

    operations = [
        migrations.RunPython(forward, migrations.RunPython.noop),
    ]
