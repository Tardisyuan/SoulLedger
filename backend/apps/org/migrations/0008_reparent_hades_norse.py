"""把 `HADES_NORSE` 从希腊的 `HADES` 底下挪回欧洲租户内。

**`0007` 的 docstring 说「任何时刻都没有节点跨文明孤立」,而它迁的那个库反驳了它。**

`0007` 只移了 `HADES` 与 `HADES_GREEK` 两行到 GREEK/GR_HADES,从没枚举 `HADES` 的
其它子节点。115 实测(全库唯一一条):

    id 30 | HADES_NORSE | tenant 2 (EU_HEAVEN_HELL) | parent=HADES | tenant 40 (GR_HADES)

`Organization.get_ancestors()` 沿 `parent` 走且**不过滤租户**,所以从这个节点往上爬
会走进另一个租户的树里。

挪到 `HELL` 底下:`HADES_NORSE` 在 `HADES` 还是欧洲节点时就挂在那儿,而欧洲侧对应
「冥府」的那一支现在是 `HELL`。**这不是在给 Norse 找一个归宿** —— Norse 已经不属于
这个系统(`consolidate_eu_pantheon` 的 `--purge-norse` 清的就是它那批 actor,
`init_organizations` 里这个节点也早已删掉)。这里只做一件事:让这一行不再跨租户。
它本身是不是该留下,是另一个决定,记在审计账本里。

backward 把 parent 放回 `HADES`,两步都是机械的。
"""
from django.db import migrations


def _org(apps, code):
    Organization = apps.get_model("org", "Organization")
    # `all_objects`,不是 `objects`:`Organization` 混入 `SoftDeleteMixin`,
    # 迁移状态里的基础管理器叫 `all_objects` 且**根本没有 `objects`**
    # —— 与 org/0004、org/0007 同一个理由。
    return Organization.all_objects.filter(code=code).first()


def reparent(apps, schema_editor):
    norse = _org(apps, "HADES_NORSE")
    if norse is None:
        return
    hell = _org(apps, "HELL")
    if hell is None or hell.tenant_id != norse.tenant_id:
        # 目标不存在或不同租户 —— 什么都不做比挪到一个更糟的地方好,
        # 而 `tests/test_no_organization_crosses_a_tenant.py` 会红,
        # 于是这件事被人看见,而不是被这个迁移悄悄决定。
        return
    norse.parent = hell
    norse.save(update_fields=["parent"])


def restore(apps, schema_editor):
    norse = _org(apps, "HADES_NORSE")
    hades = _org(apps, "HADES")
    if norse is None or hades is None:
        return
    norse.parent = hades
    norse.save(update_fields=["parent"])


class Migration(migrations.Migration):
    dependencies = [("org", "0007_hades_tree_becomes_greek")]
    operations = [migrations.RunPython(reparent, restore)]
