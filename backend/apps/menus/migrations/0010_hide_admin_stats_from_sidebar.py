"""
Data migration: /admin/stats 已并入 /dashboard 的「karma」标签页。

背景：
- 前端 grep 确认 /dashboard 与 /admin/stats 调的是同一个接口
  karmaApi.statsOverview()，四块卡片（状态分布、业力分布、租户/文明
  明细、最近活动）几乎完全重复。产品决定合并成一个页面，业力统计降
  为 /dashboard 的一个 tab（?tab=karma）。
- 合并后「业力统计」独立菜单项与「灵魂账本统计」(/dashboard) 完全
  重叠——参照 0009 里 /welcome 因与 /dashboard 职责重叠而被移出侧边
  栏的处理方式，这里同样只隐藏、不删除：
  - /admin/stats 路由本身仍在（前端改成重定向到
    /dashboard?tab=karma），旧书签、外部链接不会失效；
  - roles=["ADMIN"]、icon、permission、component 等既有配置原样保留，
    以后要恢复独立入口的话 reverse 一次就够。

幂等性：
- 只按 path="/admin/stats" 更新 visible 字段，重复执行安全。
- 查询限定 is_deleted=False，避免误伤库里软删除的同 path 记录。
"""
from django.db import migrations

TARGET_PATH = "/admin/stats"


def _live(menu_model):
    """未被软删除的菜单。"""
    return menu_model.all_objects.filter(is_deleted=False)


def hide_from_sidebar(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")
    _live(Menu).filter(path=TARGET_PATH).update(visible=False)


def restore_to_sidebar(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")
    _live(Menu).filter(path=TARGET_PATH).update(visible=True)


class Migration(migrations.Migration):

    dependencies = [
        ("menus", "0009_regroup_menus_into_directories"),
    ]

    operations = [
        migrations.RunPython(hide_from_sidebar, restore_to_sidebar),
    ]
