"""把 `Organization.level` 从「全表 0」修回真实的树深。

`Organization.save()` 会算 level,而 `init_organizations.py` 用
`org.save(update_fields=["parent"])` 更新父子关系 —— UPDATE 语句里**根本没有
level 这一列**,算出来的值每次都被丢掉。共享库 2026-08-29 实测
`select level, count(*) from organizations group by 1` → `0 | 35`,
整张表(含 `DIYU_01..10`)都在深度 0,而 help_text 写着「层级深度(用于权限计算)」。

`org/tests.py:47` 断言 `level == 1`,走的是 `objects.create(parent=...)`
—— **唯一那条能工作的路径**。所以这个缺陷旁边一直坐着一个通过的测试。

自上而下重算,不是 `for org in ...: org.save()`:后者按父行**存着的** level 计算,
而那正是上一层的同一个 bug。
"""
from django.db import migrations


def recompute(apps, schema_editor):
    Organization = apps.get_model("org", "Organization")
    rows = list(Organization.all_objects.all())
    children: dict = {}
    for org in rows:
        children.setdefault(org.parent_id, []).append(org)

    frontier = [(org, 0) for org in children.get(None, [])]
    while frontier:
        org, depth = frontier.pop()
        if org.level != depth:
            Organization.all_objects.filter(pk=org.pk).update(level=depth)
        frontier.extend((child, depth + 1) for child in children.get(org.pk, []))


class Migration(migrations.Migration):
    dependencies = [("org", "0008_reparent_hades_norse")]
    operations = [migrations.RunPython(recompute, migrations.RunPython.noop)]
