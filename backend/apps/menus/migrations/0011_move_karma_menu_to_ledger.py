"""
Data migration: 功德管理 的路由 /karma 跟随后端改名迁到 /ledger。

背景：
- 后端 apps/karma 整体改名为 apps/ledger —— 这套机制是逐条记善恶、
  正负相抵的净值账本，即明清「功过格」，而不是佛教意义上的业力
  （善恶各自成熟、不相抵消，也不随时间衰减）。前端路由同步改为
  /ledger。
- 侧边栏是数据驱动的：Menu.path 就是前端跳转的地址。前端路由改了而
  这行不改，点进去直接 404，而且是静默的——菜单本身照常渲染。

只改 path，其余字段原样保留：
- name 一直是「功德管理」，中文 UI 从来没用过「业力」这个词，不需要动；
- 这行的 permission 与 component 都是空串，没有从 path 派生出来的东西
  会跟着变。Menu.get_codename() 确实会从 path 推出 "ledger.read"，但它
  在代码里没有任何调用点，权限判定走的是 roles 与 permission 字段。

幂等性：
- 只按 path 更新，重复执行安全；反向迁移把 /ledger 改回 /karma。
- 查询限定 is_deleted=False，避免误伤库里软删除的同 path 记录。
- 全新的测试库里这两个 path 都不存在，update() 会安静地命中 0 行。
"""
from django.db import migrations

OLD_PATH = "/karma"
NEW_PATH = "/ledger"


def _live(menu_model):
    """未被软删除的菜单。"""
    return menu_model.all_objects.filter(is_deleted=False)


def move_to_ledger(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")
    _live(Menu).filter(path=OLD_PATH).update(path=NEW_PATH)


def move_back_to_karma(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")
    _live(Menu).filter(path=NEW_PATH).update(path=OLD_PATH)


class Migration(migrations.Migration):

    dependencies = [
        ("menus", "0010_hide_admin_stats_from_sidebar"),
    ]

    operations = [
        migrations.RunPython(move_to_ledger, move_back_to_karma),
    ]
