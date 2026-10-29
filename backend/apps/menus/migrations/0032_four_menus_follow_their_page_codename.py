"""Data migration: 侧栏四条菜单不再把默认角色带进用不了的页面(rbac-web H-1,用户 2026-10-29 第 32 条)。

`menu_is_visible_to` 是「`roles` 点名 **或** 持有 `permission`」。这四条的种子 `roles` 比页面 / 接口的码宽:

| 菜单 | 种子 roles | 页门码 | 谁点进去 403 |
|---|---|---|---|
| `/dispatch`    | ADMIN, JUDGE, GUARDIAN (0021)         | dispatch.read    | JUDGE |
| `/disposition` | ADMIN, JUDGE, GUARDIAN, VIEWER (0009) | disposition.read | VIEWER |
| `/workflow`    | ADMIN, JUDGE, GUARDIAN (0021)         | workflow.read    | GUARDIAN |
| `/death-sync`  | ADMIN, JUDGE, GUARDIAN (0009)         | 无(后端 IsAdmin) | JUDGE、GUARDIAN |

只写码不够 —— 两道门是「或」,roles 仍点名的人照样看得见。所以:`permission` 写页门码,`roles` 收成
「种子 roles 里今天默认持码的那几个」(`apps/perm/models.py::ROLE_PERMISSIONS`)。于是对默认角色,
roles 与码给出同一个答案(`test_the_seeded_rows_are_unchanged_by_the_new_doors` 的不变式照旧成立),
矩阵里收回 / 授出的码由第二道门跟着走;殿主(MODERATOR)与自定义角色按码看见。

`/death-sync` 不写码:那一页的接口全是 IsAdmin,没有一个码能让别的角色用上它(同 0029 对 `/permissions`
的理由);roles 收成 ADMIN。土地公(`/death-sync/tudi-gods`)是另一行,不受影响。

只改仍是种子原值的行:`roles` 与种子相同、`permission` 是空串或 0029 写的那个码、未软删除。
反向:roles 与 permission 仍是本迁移写的值的行,放回种子 roles 与之前的码(`/dispatch` `/workflow` 回到 0029 的码)。
"""
from django.db import migrations

ALL4 = ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"]
SEED3 = ["ADMIN", "JUDGE", "GUARDIAN"]

#: path → (种子 roles, 之前的码, 新 roles, 新码)
CHANGES = {
    "/dispatch": (SEED3, "dispatch.read", ["ADMIN", "GUARDIAN"], "dispatch.read"),
    "/disposition": (ALL4, "", ["ADMIN", "JUDGE", "GUARDIAN"], "disposition.read"),
    "/workflow": (SEED3, "workflow.read", ["ADMIN", "JUDGE"], "workflow.read"),
    "/death-sync": (SEED3, "", ["ADMIN"], ""),
}


def _rows(menu_model, alias, path):
    return menu_model.all_objects.using(alias).filter(path=path, menu_type="MENU", is_deleted=False)


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    for path, (seed_roles, before, roles, codename) in CHANGES.items():
        # roles 是 JSONField,SQLite 上不能按值过滤 —— 逐行在 Python 里比(同 0029)。
        for row in _rows(Menu, alias, path):
            if row.roles == seed_roles and row.permission in ("", before):
                Menu.all_objects.using(alias).filter(pk=row.pk).update(roles=roles, permission=codename)


def backward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    for path, (seed_roles, before, roles, codename) in CHANGES.items():
        for row in _rows(Menu, alias, path):
            if row.roles == roles and row.permission == codename:
                Menu.all_objects.using(alias).filter(pk=row.pk).update(roles=seed_roles, permission=before)


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0031_social_menus_drop_a_codename_that_does_not_exist"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
