"""Data migration: 两条侧栏入口跟着页门走(用户 2026-11-11 定,审计 2026-11-11 C-06)。

| 菜单 | 种子 roles | 之前的码 | 页门码 | 此前 |
|---|---|---|---|---|
| `/menus`                | ADMIN (0021)        | menu.manage (0029)   | menu.read    | 侧栏只给无殿管理员,直接输网址人人进得去 |
| `/judgment/capture-due` | ADMIN, JUDGE (0028) | capture.issue (0033) | capture.read | 守护者、查看者持读码,没有入口却能打开 |

做法同 0032:`permission` 写页门码,`roles` 写成「ADMIN / JUDGE / GUARDIAN / VIEWER 里今天默认持这个码的」
(`apps/perm/models.py::ROLE_PERMISSIONS`;两个码这四个角色都持有)。于是对默认角色,roles 与码给出同一个答案
(`test_the_seeded_rows_are_unchanged_by_the_new_doors` 的不变式照旧成立);MODERATOR 与自定义角色按码看见
(MODERATOR 持 `menu.read`,所以它的侧栏也出现菜单管理)。

页内的写操作不跟着放宽:菜单的新建 / 编辑 / 删除仍按 `menu.manage`(`frontend/app/menus/page.tsx`、
`MenuRowCells`,接口同),待发勾魂牒的「签发」仍按 `capture.issue`(`frontend/app/judgment/capture-due/page.tsx`)。

只改仍是种子原值的行:`roles` 与 `permission` 都等于上表的旧值、未软删除;管理员改过的不动。
反向:roles 与 permission 仍是本迁移写的值的行,放回旧值。
"""
from django.db import migrations

HOLDERS = ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"]

#: path -> (种子 roles, 之前的码, 新 roles, 新码)
CHANGES = {
    "/menus": (["ADMIN"], "menu.manage", HOLDERS, "menu.read"),
    "/judgment/capture-due": (["ADMIN", "JUDGE"], "capture.issue", HOLDERS, "capture.read"),
}


def _move(apps, schema_editor, forward):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    for path, (old_roles, old_code, new_roles, new_code) in CHANGES.items():
        frm_roles, frm_code, to_roles, to_code = (
            (old_roles, old_code, new_roles, new_code) if forward else (new_roles, new_code, old_roles, old_code)
        )
        rows = Menu.all_objects.using(alias).filter(path=path, menu_type="MENU", is_deleted=False, permission=frm_code)
        # roles 是 JSONField:在 Python 里比,不用 `roles=` 过滤(SQLite 与 PostgreSQL 对 JSON 相等的处理不同)。
        for row in rows:
            if row.roles == frm_roles:
                Menu.all_objects.using(alias).filter(pk=row.pk).update(roles=list(to_roles), permission=to_code)


def forward(apps, schema_editor):
    _move(apps, schema_editor, True)


def backward(apps, schema_editor):
    _move(apps, schema_editor, False)


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0037_corpus_menu_drops_moderator"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
