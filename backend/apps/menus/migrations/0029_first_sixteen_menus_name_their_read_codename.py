"""Data migration: 0021 那 16 条菜单写上页面要的读码,持码的角色(殿主 MODERATOR、自定义角色)在侧栏看得见。

背景(RBAC 审查 H2,2026-10-29)。0021 的 `ALL` 是 ADMIN / JUDGE / GUARDIAN / VIEWER —— 照搬 0009 之后的快照,
那时 MODERATOR 还不在种子里 —— 而 16 条的 `permission` 全是空串。`menus/access.py::menu_is_visible_to`
的第二道门(持有 `permission` 码名即可见)对空串不开,于是殿主持有 soul.read / judgment.read / audit.read……
侧栏里却没有灵魂管理、审判队列、审计日志;自定义角色同理,权限矩阵里授了码,侧栏照样空。

码名取页面主接口的读码,且每个码今天的默认持有者都是「`roles` 已列的角色 + MODERATOR」或其子集 ——
所以对 JUDGE / GUARDIAN / VIEWER 零变化(`tests/test_menu_visibility_follows_the_codename.py` 的
`test_the_seeded_rows_are_unchanged_by_the_new_doors` 照旧成立),新增可见的只有殿主与被授码的自定义角色。

三条故意不写:
* `/welcome` —— `roles=[]`,本来就人人可见。
* `/permissions` —— 权限页的读写接口只给 ADMIN(`perm/views.py`),没有一个码能让别的角色真用上它;
  写一个码只会给持码者一扇打开就 403 的门。
* `/users`、`/menus` 用的是写码 `user.manage` / `menu.manage`:这两页是管理页,`*.read` 不存在
  (`menu.read` 是导航本身,人人持有)。`user.manage` 对 MODERATOR 是服务端禁码(checker.ROLE_FORBIDDEN_CODENAMES)。

只改仍是种子原值的行:`permission` 为空、`roles` 与 0021 种下的相同、未软删除。管理员改过 roles 或已填了码的行不动。
`update()` 不动 `version`,所以 0021 的反向(只删 version == 0 的原样行)在回退到 0028 之后照样认得它们。
反向:码仍是本迁移写的那个、roles 仍是种子原值的行,码清回空串。
# ponytail: 迁移前就被人工填了同一个码且 roles 未改的行,反向也会被清掉 —— 区分不了,要分就得另记一列。
"""
from django.db import migrations

CODENAMES = {
    "/dashboard": "dashboard.read",
    "/souls": "soul.read",
    "/judgment": "judgment.read",
    "/cross-judgments": "cross_judgment.read",
    "/ledger": "ledger.read",
    "/workflow": "workflow.read",
    "/dispatch": "dispatch.read",
    "/realms": "realms.read",
    "/actors": "actors.read",
    "/users": "user.manage",
    "/menus": "menu.manage",
    "/audit": "audit.read",
    "/profile": "menu.read",
    "/notifications": "notification.read",
}


def _seed_roles():
    from importlib import import_module

    return {m["path"]: m["roles"] for m in import_module("apps.menus.migrations.0021_seed_the_first_sixteen_menus").MENUS}


def fill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    roles = _seed_roles()
    for path, codename in CODENAMES.items():
        # roles 是 JSONField,SQLite 上不能按值过滤 —— 逐行在 Python 里比(参照 menus/access.py 文件头)。
        for row in Menu.all_objects.using(alias).filter(path=path, menu_type="MENU", is_deleted=False, permission=""):
            if row.roles == roles[path]:
                Menu.all_objects.using(alias).filter(pk=row.pk).update(permission=codename)


def unfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    roles = _seed_roles()
    for path, codename in CODENAMES.items():
        for row in Menu.all_objects.using(alias).filter(path=path, menu_type="MENU", permission=codename):
            if row.roles == roles[path]:
                Menu.all_objects.using(alias).filter(pk=row.pk).update(permission="")


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0028_add_tudi_gods_and_capture_due_menus"),
    ]

    operations = [
        migrations.RunPython(fill, unfill),
    ]
