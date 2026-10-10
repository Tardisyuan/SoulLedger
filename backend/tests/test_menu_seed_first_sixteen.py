"""menus/0021 + 0022:全新的库有完整的侧边栏;已有这些行的库零改动;回收站入口只给 ADMIN。

0021 种下最早那 16 条菜单(此前只存在于早期手工建出来的库里,0009 只会改它们)。按 path 判断,
已存在(含已软删除的)一行都不动。0022 加 `/recycle-bin`,roles = ["ADMIN"]、不写码名。
反向:只删「建出来之后没人碰过」(与种子逐字段相同、version == 0)的行。
"""
import importlib

import pytest
from django.apps import apps as django_apps

from apps.authentication.models import User
from apps.menus.models import Menu
from tests.migration_schema_editor import SCHEMA_EDITOR
from tests.perm_support import seeded_menus
from tests.soul_account_support import officer_client

seed_module = importlib.import_module("apps.menus.migrations.0021_seed_the_first_sixteen_menus")
FIRST_SIXTEEN = [m["path"] for m in seed_module.MENUS]

pytestmark = pytest.mark.django_db


def _wipe():
    Menu.all_objects.all().delete()


def _rows():
    return {
        m.pk: (m.path, m.name, m.icon, m.order, m.parent_id, m.roles, m.visible, m.is_deleted, m.version)
        for m in Menu.all_objects.all()
    }


def _names(payload):
    out = set()

    def walk(items):
        for item in items:
            out.add(item["name"])
            walk(item.get("children") or [])

    walk(payload.get("results", payload) if isinstance(payload, dict) else payload)
    return out


def _seen_by(role, tenant, path="/api/v1/menus/tree/"):
    user = User.objects.create_user(username=f"seed_{role.lower()}", password="x", role=role,
                                    tenant=None if role == "ADMIN" else tenant)
    response = officer_client(user).get(path)
    assert response.status_code == 200, response.data
    return _names(response.json())


def test_there_are_sixteen_and_they_are_the_ones_the_task_names():
    assert len(FIRST_SIXTEEN) == 16 and len(set(FIRST_SIXTEEN)) == 16
    assert "/ledger" in FIRST_SIXTEEN and "/karma" not in FIRST_SIXTEEN  # 0011 moved it
    assert "/settings" not in FIRST_SIXTEEN  # 快照里已软删除的测试行不种


def test_a_fresh_database_gets_a_complete_sidebar():
    _wipe()
    seeded_menus()  # 按顺序重放全部菜单迁移 —— 全新的库走的就是这条路

    live = {m.path: m for m in Menu.objects.filter(is_deleted=False) if m.menu_type == "MENU"}
    assert set(FIRST_SIXTEEN) <= set(live), sorted(set(FIRST_SIXTEEN) - set(live))
    for item in seed_module.MENUS:
        row = live[item["path"]]
        assert (row.name, row.icon, row.order, row.roles, row.visible) == (
            item["name"], item["icon"], item["order"], item["roles"], item["visible"]
        )
        assert (row.parent.name if row.parent else None) == item["parent"], item["path"]
    # 在侧边栏里的每一页都挂在某个分组下(没有悬空的一级页),不在侧边栏的三条一级、不可见。
    for path, row in live.items():
        if row.visible:
            assert row.parent is not None and row.parent.menu_type == "DIRECTORY", path
    # /admin/stats 是 0010 隐藏的;其余三条是 0009 的 HIDDEN_FROM_SIDEBAR 与这里种的。
    assert {p for p, r in live.items() if not r.visible} == {"/welcome", "/profile", "/notifications", "/admin/stats"}


def test_the_admin_sidebar_shows_the_pages_a_fresh_database_used_to_lack(cn_tenant):
    _wipe()
    seeded_menus()
    seen = _seen_by("ADMIN", cn_tenant)
    assert {"仪表盘", "灵魂管理", "审判队列", "用户管理", "菜单管理", "权限与角色", "审计日志", "回收站"} <= seen


def test_a_database_that_already_has_the_rows_is_not_touched_by_the_seed():
    seeded_menus()
    Menu.all_objects.filter(path="/souls").update(name="我改过的名字", order=99, visible=False, version=3)
    Menu.all_objects.filter(path="/profile").update(is_deleted=True)
    before = _rows()

    seed_module.seed(django_apps, SCHEMA_EDITOR)
    seed_module.seed(django_apps, SCHEMA_EDITOR)

    assert _rows() == before
    souls = Menu.all_objects.get(path="/souls")
    assert (souls.name, souls.order, souls.visible) == ("我改过的名字", 99, False)
    assert not Menu.objects.filter(path="/profile", is_deleted=False).exists()  # 删掉的不复活
    assert Menu.all_objects.filter(path__in=FIRST_SIXTEEN).count() == 16


def test_the_seed_fills_only_the_gaps():
    seeded_menus()
    Menu.all_objects.filter(path="/audit").delete()
    before = _rows()

    seed_module.seed(django_apps, SCHEMA_EDITOR)

    after = _rows()
    assert len(after) == len(before) + 1
    assert {k: v for k, v in after.items() if k in before} == before
    assert Menu.objects.get(path="/audit").parent.name == "系统设置"


def test_reverse_removes_only_untouched_seed_rows():
    _wipe()
    seeded_menus()
    Menu.all_objects.filter(path="/souls").update(version=2)       # 有人保存过
    Menu.all_objects.filter(path="/users").update(name="成员管理")  # 改过名

    seed_module.unseed(django_apps, SCHEMA_EDITOR)

    left = set(Menu.objects.filter(menu_type="MENU", is_deleted=False).values_list("path", flat=True))
    assert {"/souls", "/users"} <= left
    assert left.isdisjoint(set(FIRST_SIXTEEN) - {"/souls", "/users"})
    # 别的迁移种的页面不受影响。
    assert "/scheduler" in left and "/moderation" in left


@pytest.mark.parametrize("exit_url", ["/api/v1/menus/tree/", "/api/v1/menus/list-public/"])
def test_the_recycle_bin_entry_is_for_the_admin_alone(cn_tenant, exit_url):
    seeded_menus()
    row = Menu.objects.get(path="/recycle-bin", is_deleted=False)
    assert (row.name, row.parent.name, row.roles, row.permission, row.icon) == (
        "回收站", "系统设置", ["ADMIN"], "", "Trash2",
    )
    assert "回收站" in _seen_by("ADMIN", cn_tenant, exit_url)
    for role in ("MODERATOR", "JUDGE", "GUARDIAN", "VIEWER"):
        assert "回收站" not in _seen_by(role, cn_tenant, exit_url), role


# ── 往返:正向 → 反向 → 正向,按数据比较(tests/migration_roundtrip.py)──────────────


def _directories_and_a_customised_souls(apps):
    Menu_ = apps.get_model("menus", "Menu")
    objects = Menu_.all_objects
    objects.all().delete()
    for name, order in (("概览", 10), ("灵魂业务", 20), ("流程协作", 30), ("组织与领域", 40), ("社交", 50), ("系统设置", 60)):
        objects.create(name=name, menu_type="DIRECTORY", order=order, roles=["ADMIN"], path="", is_deleted=False)
    parent = objects.get(name="灵魂业务", menu_type="DIRECTORY")
    objects.create(path="/souls", name="我改过的名字", icon="Users", order=77, parent=parent, menu_type="MENU",
                   roles=["ADMIN"], visible=True, version=3)


def _snapshot(apps):
    from tests.migration_roundtrip import snapshot_rows

    Menu_ = apps.get_model("menus", "Menu")
    return snapshot_rows(
        Menu_.all_objects.filter(is_deleted=False),
        key=lambda m: f"{m.menu_type}:{m.path or m.name}",
        fields={"name": "name", "order": "order", "visible": "visible", "roles": "roles",
                "parent": lambda m: m.parent.name if m.parent_id else None},
    )


def test_0021_round_trip_adds_the_gaps_keeps_what_exists_and_comes_back_out(migration_round_trip):
    def check_forward(apps):
        rows = _snapshot(apps)
        assert rows["MENU:/souls"]["name"] == "我改过的名字" and rows["MENU:/souls"]["order"] == 77
        assert {f"MENU:{p}" for p in FIRST_SIXTEEN} <= set(rows)

    migration_round_trip(
        before=("menus", "0020_add_assistant_admin_menu"),
        after=("menus", "0021_seed_the_first_sixteen_menus"),
        seed=_directories_and_a_customised_souls,
        snapshot=_snapshot,
        check_forward=check_forward,
    )


def test_0022_round_trip_adds_and_removes_the_recycle_bin_entry(migration_round_trip):
    def check_forward(apps):
        rows = _snapshot(apps)
        assert rows["MENU:/recycle-bin"] == {
            "name": "回收站", "order": 70, "visible": True, "roles": ["ADMIN"], "parent": "系统设置",
        }

    migration_round_trip(
        before=("menus", "0021_seed_the_first_sixteen_menus"),
        after=("menus", "0022_add_recycle_bin_menu"),
        seed=_directories_and_a_customised_souls,
        snapshot=_snapshot,
        check_forward=check_forward,
    )
