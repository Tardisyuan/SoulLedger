"""
Data migration: 给 /corpus（语料条文浏览页）加侧边栏入口。

背景：
- `frontend/app/corpus/page.tsx` 已经上线，四套语料共 175 条转录条文
  第一次有地方看，但侧边栏里没有任何一行指向它——侧边栏是数据驱动的
  （`useSidebarMenus()` 读 /menus/，菜单行只来自本目录下的数据迁移），
  所以没有这一行就等于这个页面只能手输 URL 才能到达，与 0009 收编的
  那五个孤儿页面是同一种缺陷。
- 菜单行没有 `manage.py` 种子命令，数据迁移是唯一入口。

字段依据：

permission = "judgment.read"
    页面数据来自 `StatuteViewSet`，而该 viewset 的 docstring 写明它用
    `permission_codename = "judgment"` 而不是新开一个 `statute.*` 家族：
    「reading the rulebook is part of reading a case, the codename is
    already defined and granted, and inventing `statute.read` would seed
    an orphan no role holds (apps/perm/test_codename_coverage.py catches
    exactly that)」。`ACTION_PERM_MAP` 把 list/retrieve 映射到 read，
    所以浏览语料实际要的就是 `judgment.read`——已在 DEFAULT_PERMISSIONS
    中定义，且由 ADMIN / JUDGE / MODERATOR 三个角色持有，不是孤儿。

icon = "Scroll"
    `Menu.icon` 存的是字符串，前端 `AppLayout` 用
    `getIconByName(menu.icon)` 去 `src/lib/icons.ts` 的 `ICON_LOOKUP` 里
    查——那张表是用显式 import 的 `ALL_ICONS` 按 `displayName` 建的，
    **不是** lucide 的全集。查不到不会报错，会静默退回 `DEFAULT_ICON`
    (Settings)，所以图标名必须落在那份注册表里。实测确认：`Scroll` 在
    `ALL_ICONS` 中且 `displayName === "Scroll"`；反例是 `Library`，
    lucide 有、注册表没有，写上去就会变成一个齿轮。

order = 25，parent = 「灵魂业务」
    该组现有 souls=10、judgment=20、cross-judgments=30、ledger=40、
    disposition=50。语料是判决据以成立的条文，紧跟在「审判队列」之后
    最自然；取 25 是为了插进 20 与 30 之间而不必给任何既有行重新编号，
    这样反向迁移只需要删掉这一行，不用还原别人的 order。

roles = ["ADMIN", "JUDGE", "MODERATOR"]
    即实际持有 `judgment.read` 的三个角色——写成真话，别的角色点进去
    会从 `/statutes/` 吃 403。需要说明的是当前 `MenuViewSet.tree` 只对
    **顶级** 菜单按 roles 过滤，子菜单是从 `children_map` 里无过滤挂上
    去的，所以本行挂在目录下时这个字段并不参与判定，实际可见范围由
    「灵魂业务」目录的 roles 决定（与同组的 /judgment 完全一致，本迁移
    不改动目录，也就不改变任何既有菜单的可见性）。字段仍按真实持有者
    写，一是不留一条与权限矛盾的记录，二是下面的兜底分支里它会真的生效。

幂等性 / 稳健性：
- 按 path 取或建，重复执行安全；查询一律限定 is_deleted=False，
  与 0009–0011 一致（库中存在软删除的同 path 记录，不加会误伤）。
- 目录按 name 查找。若有人在 Stage 7 的菜单编辑器里把「灵魂业务」改了
  名，这里查不到目录，则退化为建一条顶级菜单而不是让入口整个消失——
  这也正是 roles 需要写对的那个分支。
"""
from django.db import migrations

MENU_PATH = "/corpus"
MENU_NAME = "语料条文"
PARENT_DIRECTORY = "灵魂业务"

# 与页面 H1 (`judgment.corpus.title` = 「语料条文」) 同名，免得面包屑和
# 标题各叫各的。
MENU_DEFAULTS = {
    "name": MENU_NAME,
    "icon": "Scroll",
    "order": 25,
    "menu_type": "MENU",
    "permission": "judgment.read",
    "roles": ["ADMIN", "JUDGE", "MODERATOR"],
    "is_active": True,
    "visible": True,
    "component": "corpus",
}


def _live(menu_model):
    """未被软删除的菜单。"""
    return menu_model.all_objects.filter(is_deleted=False)


def add_corpus_menu(apps, schema_editor):
    Menu = apps.get_model("menus", "Menu")

    parent = (
        _live(Menu)
        .filter(name=PARENT_DIRECTORY, menu_type="DIRECTORY")
        .first()
    )

    Menu.all_objects.get_or_create(
        path=MENU_PATH,
        is_deleted=False,
        defaults={**MENU_DEFAULTS, "parent": parent},
    )

    # 应对「上次跑了一半」或行已被手工建过：确保归位与顺序正确。
    _live(Menu).filter(path=MENU_PATH).exclude(menu_type="DIRECTORY").update(
        parent=parent, order=MENU_DEFAULTS["order"]
    )


def remove_corpus_menu(apps, schema_editor):
    """删掉本迁移建的那一行。

    不是 noop：这是一条可撤销的数据变更，留不可逆的反向迁移会让整条
    迁移链无法回退到 0012 之前。按 path 且排除 DIRECTORY 删除，不碰
    「灵魂业务」目录本身（它是 0009 建的，由 0009 负责回收）。
    """
    Menu = apps.get_model("menus", "Menu")
    _live(Menu).filter(path=MENU_PATH).exclude(menu_type="DIRECTORY").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("menus", "0012_menu_delete_cascade_id_menubutton_delete_cascade_id"),
    ]

    operations = [
        migrations.RunPython(add_corpus_menu, remove_corpus_menu),
    ]
