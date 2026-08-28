"""退役 2026-05 那批遗留 Actor：错放到 CN_DIYU 的外国神，和三个重复行。

来源是已删除的 `scripts/seed_chinese_data.py`。任何被它播过的库都有同样一批行，
所以这件事属于迁移而不是一次性脚本；没有这些行的库上本迁移完全空转。

## 两类，处理方式不同

**一、错放的外国神（6 行）**

    Ammit / Isis / Nephthys / Ra   —— 埃及，属 EG_DUAT
    Charon / Gabriel               —— 属 EU_HEAVEN_HELL

它们被放进了 CN_DIYU（中国地府）。除了归属错，内容本身也是这个仓库后来逐条
纠正过的旧说法：

  * `Charon` 写 "Ferryman of the River Styx"。渡的是 Acheron 不是 Styx——
    Aeneid 6.295-330，正规行早已改正。
  * `Gabriel` 写 "guides souls to judgment and heaven"。那是 Michael 的职司
    被写到 Gabriel 头上，正规行的注释专门记着这一条。

也就是说这些行不只是放错了柜子，它们还在用被推翻的说法回答问题——而按名字
查询的代码会同时查到它们和正规行。

**在 192.168.2.115 这个库上这六行已于 2026-08-02 被软删除**，所以本迁移在
那里对它们空转。之所以仍然保留这段处理：产生它们的旧脚本播过的其他库未必
清理过，而 forward 的匹配条件是 `is_deleted=False`，已退役的行不会被重复
处理，也不会出现在 `retired` 里——「没有输出」在这里正确地表示「没有可做的」。

**二、三个重复行（各绑着一个 User 账号）**

    cui_fujun     ↔ 崔府君
    kshitigarbha  ↔ 地藏王菩萨
    wei_zheng     ↔ 魏征

这三位本来就是中国的，也本来就在 `CHINESE_ACTORS` 里——重复出现是因为旧脚本
用 ASCII slug 建行，而 `seed_mythology` 用中文名建行，两者永远不会互相匹配。

**它们不能直接删。** `User.actor` 是指向 Actor 行的外键，三个同名用户账号
(`cui_fujun` / `wei_zheng` / `kshitigarbha`) 正指着旧行。所以顺序必须是：
先把 User 改指正规行，再退役旧行。反过来做会打断账号绑定，或被 PROTECT 拒绝。

## 为什么是软删除而不是真删

沿用 judgment/0012 退役伪造冥律时的同一个理由：软删除保留行，历史引用仍然
可读，而反向迁移能原样恢复。真删掉的东西，回滚回来的只是一个新行。

判定「无引用」不是靠猜：forward 逐个反向关系数一遍，任何一个还有引用的行都
跳过并把它记在 `skipped` 里，而不是硬删过去。

## 可逆

backward 把 `is_deleted` 复位，并把 User.actor 指回旧行——两步都是机械的，
因为 forward 把每一步的旧值都读得出来（旧行按 name 唯一，正规行按 name_zh
唯一）。若正规行不存在（库比本迁移还老），repoint 一步跳过。
"""

from django.db import migrations
from django.utils import timezone

TENANT_CODE = "CN_DIYU"

#: 错放到中国租户的外国神。按 name 匹配，仅限 CN_DIYU。
MISFILED = ["Ammit", "Isis", "Nephthys", "Ra", "Charon", "Gabriel"]

#: (旧 slug, 正规行的 name)。旧行退役前，把指向它的 User.actor 改指正规行。
DUPLICATES = [
    ("cui_fujun", "崔府君"),
    ("kshitigarbha", "地藏王菩萨"),
    ("wei_zheng", "魏征"),
]


def _tenant_id(apps):
    Tenant = apps.get_model("tenants", "Tenant")
    row = Tenant._base_manager.filter(code=TENANT_CODE).first()
    return row.id if row else None


def _inbound_refs(actor_model, row):
    """有多少行指着它。空 = 可以安全退役。"""
    total = 0
    for rel in actor_model._meta.related_objects:
        model = rel.related_model
        total += model._base_manager.filter(**{rel.field.name: row}).count()
    return total


def forwards(apps, schema_editor):
    Actor = apps.get_model("actors", "Actor")
    User = apps.get_model("authentication", "User")

    tenant_id = _tenant_id(apps)
    if tenant_id is None:
        return

    # `deleted_at` 与 `is_deleted` 必须一起写。这个库里 2026-08-02 退役的那批
    # 两者都有，只置 is_deleted 会造出一种「删了但没有删除时间」的行——按时间
    # 排查退役记录时它们是隐形的。
    now = timezone.now()
    retired, skipped, repointed = [], [], []

    # 一、重复行：先改 User 指向，再退役。顺序不能反。
    for slug, canonical_name in DUPLICATES:
        old = Actor._base_manager.filter(
            tenant_id=tenant_id, name=slug, is_deleted=False
        ).first()
        if old is None:
            continue
        canonical = Actor._base_manager.filter(
            tenant_id=tenant_id, name=canonical_name, is_deleted=False
        ).first()
        if canonical is None:
            # 库比 seed_mythology 还老，正规行还不存在。什么都不做——退役唯一
            # 一份数据比留着一份放错位置的更糟。
            skipped.append(f"{slug}(无正规行)")
            continue
        moved = User._base_manager.filter(actor_id=old.id).update(actor_id=canonical.id)
        if moved:
            repointed.append(f"{slug}->{canonical_name}({moved})")
        if _inbound_refs(Actor, old) == 0:
            old.is_deleted = True
            old.deleted_at = now
            old.save(update_fields=["is_deleted", "deleted_at"])
            retired.append(slug)
        else:
            skipped.append(f"{slug}(仍被引用)")

    # 二、错放的外国神：只退役真的没人引用的。
    for name in MISFILED:
        row = Actor._base_manager.filter(
            tenant_id=tenant_id, name=name, is_deleted=False
        ).first()
        if row is None:
            continue
        if _inbound_refs(Actor, row) == 0:
            row.is_deleted = True
            row.deleted_at = now
            row.save(update_fields=["is_deleted", "deleted_at"])
            retired.append(name)
        else:
            skipped.append(f"{name}(仍被引用)")

    if retired or skipped or repointed:
        print(
            f"\n  [actors.0010] 退役 {len(retired)}: {', '.join(retired) or '无'}"
            f"\n               改指 {len(repointed)}: {', '.join(repointed) or '无'}"
            f"\n               跳过 {len(skipped)}: {', '.join(skipped) or '无'}"
        )


def backwards(apps, schema_editor):
    Actor = apps.get_model("actors", "Actor")
    User = apps.get_model("authentication", "User")

    tenant_id = _tenant_id(apps)
    if tenant_id is None:
        return

    for name in MISFILED + [slug for slug, _ in DUPLICATES]:
        Actor._base_manager.filter(
            tenant_id=tenant_id, name=name, is_deleted=True
        ).update(is_deleted=False, deleted_at=None)

    # User.actor 指回旧行。按用户名匹配 slug —— forward 改指的正是这三个账号，
    # 它们的 username 与 slug 相同，这是本迁移唯一能重建的对应关系。
    for slug, _canonical_name in DUPLICATES:
        old = Actor._base_manager.filter(tenant_id=tenant_id, name=slug).first()
        if old is None:
            continue
        User._base_manager.filter(username=slug).update(actor_id=old.id)


class Migration(migrations.Migration):
    dependencies = [
        ("actors", "0009_alter_actor_civilization"),
        ("authentication", "0013_loginlog_delete_cascade_id_user_delete_cascade_id"),
        ("tenants", "0008_notification_delete_cascade_id_and_more"),
    ]
    operations = [migrations.RunPython(forwards, backwards)]
