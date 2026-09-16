"""Data migration: 给 /scheduler(定时任务登记与管理页)加侧边栏入口,挂在「系统设置」下。

字段依据(与 0013 同一套理由,只写不同处):

permission = "scheduler.read"
    页面数据来自 `apps/scheduler/views.py` 的两个 viewset,都声明
    `permission_codename = "scheduler"`,list/retrieve 映射到 `scheduler.read`。
    该 codename 由 perm/0021 播种、ADMIN 持有。

icon = "Clock"
    `frontend/src/lib/icons.ts` 的 `ALL_ICONS` 里有 `Clock`(实测在册);
    `Timer` / `CalendarClock` 不在册,写上去会静默退回齿轮。

order = 45,parent = 「系统设置」
    该组现有 users=10、permissions=20、menus=30、audit=40、tenants=50、
    organizations=60。定时任务是运维视图,紧随审计日志之后;取 45 插在 40 与 50
    之间,不给既有行重新编号。

roles = ["ADMIN"]
    实际持有 `scheduler.read` 的唯一角色。矩阵里授给别的角色后,这里的 roles
    仍只写 ADMIN —— 与 0013 的说明相同,子菜单不参与 tree 的 roles 过滤,
    可见性由目录「系统设置」(roles=["ADMIN"])决定。**待用户确认**:若要让被
    授权的非 ADMIN 角色看到这一页,得同时放宽目录的 roles,那是另一个决定。

幂等 / 可逆:按 path 取或建,限定 is_deleted=False;反向按 path 删这一行。
"""
from django.db import migrations

MENU_PATH = "/scheduler"
PARENT_DIRECTORY = "系统设置"

MENU_DEFAULTS = {
    "name": "定时任务",
    "icon": "Clock",
    "order": 45,
    "menu_type": "MENU",
    "permission": "scheduler.read",
    "roles": ["ADMIN"],
    "is_active": True,
    "visible": True,
    "component": "scheduler",
}


def _live(menu_model):
    return menu_model.all_objects.filter(is_deleted=False)


def add_scheduler_menu(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")
    parent = _live(Menu).filter(name=PARENT_DIRECTORY, menu_type="DIRECTORY").first()
    Menu.all_objects.get_or_create(
        path=MENU_PATH, is_deleted=False, defaults={**MENU_DEFAULTS, "parent": parent}
    )
    _live(Menu).filter(path=MENU_PATH).exclude(menu_type="DIRECTORY").update(
        parent=parent, order=MENU_DEFAULTS["order"]
    )


def remove_scheduler_menu(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")
    _live(Menu).filter(path=MENU_PATH).exclude(menu_type="DIRECTORY").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0014_alter_menubutton_unique_together_and_more"),
    ]

    operations = [
        migrations.RunPython(add_scheduler_menu, remove_scheduler_menu),
    ]
