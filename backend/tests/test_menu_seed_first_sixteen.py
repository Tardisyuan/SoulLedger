"""menus/0021 + 0022 + 0023 (+ 0025「轮回」一组):全新的库有完整的侧边栏;已有这些行的库零改动;回收站入口只给 ADMIN;灵魂事件挂在灵魂业务下。

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
codename_module = importlib.import_module("apps.menus.migrations.0029_first_sixteen_menus_name_their_read_codename")
# 0032 收窄了 /dispatch /workflow /disposition /death-sync 的 roles(rbac-web H-1),全新的库最终是它写的值。
four_module = importlib.import_module("apps.menus.migrations.0032_four_menus_follow_their_page_codename")
split_module = importlib.import_module("apps.menus.migrations.0033_menus_follow_the_split_codenames")
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
        roles = four_module.CHANGES[item["path"]][2] if item["path"] in four_module.CHANGES else item["roles"]
        assert (row.name, row.icon, row.order, row.roles, row.visible) == (
            item["name"], item["icon"], item["order"], roles, item["visible"]
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

    split_module.backward(django_apps, SCHEMA_EDITOR)  # 真实回退里 0033 先退(它给 /permissions 写了码)
    four_module.backward(django_apps, SCHEMA_EDITOR)  # 再退 0032
    codename_module.unfill(django_apps, SCHEMA_EDITOR)  # 再退 0029
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


def test_0023_round_trip_adds_and_removes_the_soul_events_entry(migration_round_trip):
    def check_forward(apps):
        rows = _snapshot(apps)
        assert rows["MENU:/events"] == {
            "name": "灵魂事件", "order": 15, "visible": True,
            "roles": ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"], "parent": "灵魂业务",
        }

    migration_round_trip(
        before=("menus", "0022_add_recycle_bin_menu"),
        after=("menus", "0023_b37_add_soul_events_menu"),
        seed=_directories_and_a_customised_souls,
        snapshot=_snapshot,
        check_forward=check_forward,
    )


def test_the_soul_events_entry_sits_under_souls_for_every_officer(cn_tenant):
    seeded_menus()
    row = Menu.objects.get(path="/events", is_deleted=False)
    assert (row.name, row.parent.name, row.permission, row.icon, row.order) == (
        "灵魂事件", "灵魂业务", "soul.read", "Activity", 15,
    )
    for role in ("ADMIN", "JUDGE", "GUARDIAN", "VIEWER"):
        assert "灵魂事件" in _seen_by(role, cn_tenant), role


def test_0024_round_trip_adds_and_removes_the_sentence_plans_entry(migration_round_trip):
    def check_forward(apps):
        rows = _snapshot(apps)
        assert rows["MENU:/sentence-plans"] == {
            "name": "受刑计划", "order": 34, "visible": True, "roles": ["ADMIN", "JUDGE"], "parent": "灵魂业务",
        }

    migration_round_trip(
        before=("menus", "0023_b37_add_soul_events_menu"),
        after=("menus", "0024_add_sentence_plans_menu"),
        seed=_directories_and_a_customised_souls,
        snapshot=_snapshot,
        check_forward=check_forward,
    )


def test_the_sentence_plans_entry_is_for_whoever_reads_judgments(cn_tenant):
    seeded_menus()
    row = Menu.objects.get(path="/sentence-plans", is_deleted=False)
    assert (row.name, row.parent.name, row.permission, row.icon, row.order) == (
        "受刑计划", "灵魂业务", "judgment.read", "ListChecks", 34,
    )
    assert "受刑计划" in _seen_by("JUDGE", cn_tenant)
    assert "受刑计划" not in _seen_by("VIEWER", cn_tenant)


def test_0025_round_trip_groups_rebirths_and_comes_back_out(migration_round_trip):
    def check_forward(apps):
        rows = _snapshot(apps)
        assert rows["DIRECTORY:轮回"]["parent"] is None
        assert rows["MENU:/rebirths"] == {
            "name": "转生登记簿", "order": 20, "visible": True,
            "roles": ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"], "parent": "轮回",
        }

    migration_round_trip(
        before=("menus", "0024_add_sentence_plans_menu"),
        after=("menus", "0025_rebirth_group_and_register"),
        seed=_directories_and_a_customised_souls,
        snapshot=_snapshot,
        check_forward=check_forward,
    )


def test_the_rebirth_group_holds_dispositions_and_the_register(cn_tenant):
    """第四十批 W-c:侧栏「轮回」是一组 —— 处置(原 /disposition)· 转生登记簿。"""
    seeded_menus()
    disposition = Menu.objects.get(path="/disposition", is_deleted=False)
    register = Menu.objects.get(path="/rebirths", is_deleted=False)
    assert (disposition.name, disposition.parent.name, disposition.order) == ("处置", "轮回", 10)
    assert (register.name, register.parent.name, register.permission) == ("转生登记簿", "轮回", "reincarnation.read")
    assert register.parent.parent is None and register.parent.menu_type == "DIRECTORY"
    for role in ("ADMIN", "JUDGE", "GUARDIAN"):
        assert {"处置", "转生登记簿"} <= _seen_by(role, cn_tenant), role
    # VIEWER 不持 disposition.read(menus/0032,rbac-web H-1):处置不画,登记簿照旧,「轮回」组靠它开着。
    viewer = _seen_by("VIEWER", cn_tenant)
    assert {"轮回", "转生登记簿"} <= viewer and "处置" not in viewer, viewer


def test_the_appeal_and_city_god_entries_are_for_whoever_reads_judgments(cn_tenant):
    """menus/0026:申诉复核、城隍初审(灵魂业务)与城隍(系统设置),当时都是 `judgment.read`;
    menus/0033(2026-10-29 拆码)把后两条改成 `city_god.read`。默认持有者不变:JUDGE 看得见,VIEWER 看不见。"""
    seeded_menus()
    rows = {m.path: m for m in Menu.objects.filter(path__in=("/judgment/appeals", "/city-god-cases", "/city-gods"),
                                                      is_deleted=False)}
    assert {p: (r.name, r.parent.name, r.permission, r.order) for p, r in rows.items()} == {
        "/judgment/appeals": ("申诉复核", "灵魂业务", "judgment.read", 31),
        "/city-god-cases": ("城隍初审", "灵魂业务", "city_god.read", 18),
        "/city-gods": ("城隍", "系统设置", "city_god.read", 25),
    }
    assert {"申诉复核", "城隍初审", "城隍"} <= _seen_by("JUDGE", cn_tenant)
    assert not {"申诉复核", "城隍初审", "城隍"} & _seen_by("VIEWER", cn_tenant)


def test_the_capture_due_and_earth_god_entries(cn_tenant):
    """menus/0028(第五十七批):待发勾魂牒在「灵魂业务」里排在城隍初审(18)前面,只给能发牒的人(`soul.die`);
    土地公在「系统设置」里紧跟城隍(25),和城隍一样是 `judgment.read`。menus/0033 改成 `capture.issue` / `tudi.read`。"""
    seeded_menus()
    rows = {m.path: m for m in Menu.objects.filter(path__in=("/judgment/capture-due", "/death-sync/tudi-gods"),
                                                      is_deleted=False)}
    assert {p: (r.name, r.parent.name, r.permission, r.order) for p, r in rows.items()} == {
        "/judgment/capture-due": ("待发勾魂牒", "灵魂业务", "capture.issue", 17),
        "/death-sync/tudi-gods": ("土地公", "系统设置", "tudi.read", 26),
    }
    assert rows["/judgment/capture-due"].order < Menu.objects.get(path="/city-god-cases", is_deleted=False).order
    assert {"待发勾魂牒", "土地公"} <= _seen_by("JUDGE", cn_tenant)
    assert not {"待发勾魂牒", "土地公"} & _seen_by("VIEWER", cn_tenant)


# ── 0029:16 条写上页面读码,殿主与持码的自定义角色看得见(RBAC 审查 H2)────────────────


def _custom(tenant, username, *codenames):
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name="CLERK_" + username.upper(), defaults={"display_name": username})
    for c in codenames:
        perm, _ = Permission.objects.get_or_create(codename=c, defaults={"name": c, "category": c.split(".")[0]})
        RolePermission.objects.get_or_create(role=role, permission=perm)
    invalidate_all_permissions()
    user = User.objects.create_user(username=username, password="x", role=role.name, tenant=tenant)
    response = officer_client(user).get("/api/v1/menus/list-public/")
    assert response.status_code == 200, response.data
    return _names(response.json())


def test_0029_names_the_page_codename_on_the_seeded_rows():
    _wipe()
    seeded_menus()
    got = {m.path: m.permission for m in Menu.objects.filter(path__in=FIRST_SIXTEEN)}
    # /permissions 由 menus/0033 写上 system.settings(权限页的读接口 2026-10-29 起按这个码判)。
    assert got == {**dict.fromkeys(FIRST_SIXTEEN, ""), **codename_module.CODENAMES, "/permissions": "system.settings"}
    assert got["/welcome"] == ""  # 故意不写,见 0029 文件头


def test_a_moderator_sees_the_core_pages_and_not_the_admin_ones(cn_tenant):
    from tests.perm_support import seeded_grants

    seeded_grants()
    _wipe()
    seeded_menus()
    seen = _seen_by("MODERATOR", cn_tenant, "/api/v1/menus/list-public/")
    assert {"仪表盘", "灵魂管理", "审判队列", "跨域审判", "功德管理", "审批流程", "调度管理",
            "领域管理", "神祇名录", "审计日志"} <= seen, seen
    assert seen.isdisjoint({"用户管理", "权限与角色", "菜单管理"}), seen


def test_a_custom_role_sees_exactly_the_pages_its_codenames_open(cn_tenant):
    _wipe()
    seeded_menus()
    holder = _custom(cn_tenant, "souls_clerk", "soul.read", "menu.read")
    assert "灵魂管理" in holder and "灵魂业务" in holder
    assert holder.isdisjoint({"审判队列", "审计日志", "仪表盘", "用户管理"}), holder
    bare = _custom(cn_tenant, "bare_clerk", "menu.read")
    assert "灵魂管理" not in bare and "审判队列" not in bare


def test_0029_leaves_a_hand_edited_row_alone():
    _wipe()
    seeded_menus()
    codename_module.unfill(django_apps, SCHEMA_EDITOR)
    Menu.all_objects.filter(path="/souls").update(roles=["ADMIN"])            # roles 改过
    Menu.all_objects.filter(path="/audit").update(permission="audit.export")  # 码填过
    codename_module.fill(django_apps, SCHEMA_EDITOR)
    assert Menu.objects.get(path="/souls").permission == ""
    assert Menu.objects.get(path="/audit").permission == "audit.export"
    assert Menu.objects.get(path="/judgment").permission == "judgment.read"
    codename_module.unfill(django_apps, SCHEMA_EDITOR)
    assert Menu.objects.get(path="/audit").permission == "audit.export"     # 反向也不碰
    assert Menu.objects.get(path="/judgment").permission == ""


def _codenames_snapshot(apps):
    from tests.migration_roundtrip import snapshot_rows

    Menu_ = apps.get_model("menus", "Menu")
    return snapshot_rows(
        Menu_.all_objects.filter(is_deleted=False, menu_type="MENU"),
        key=lambda m: m.path,
        fields={"permission": "permission", "roles": "roles"},
    )


def test_0029_round_trip_fills_and_clears_the_codenames(migration_round_trip):
    def seed(apps):
        _directories_and_a_customised_souls(apps)
        seed_module.seed(apps, SCHEMA_EDITOR)

    def check_forward(apps):
        rows = _codenames_snapshot(apps)
        assert rows["/judgment"]["permission"] == "judgment.read"
        assert rows["/souls"]["permission"] == ""  # roles 被改过的那行不动
        assert rows["/permissions"]["permission"] == ""

    migration_round_trip(
        before=("menus", "0028_add_tudi_gods_and_capture_due_menus"),
        after=("menus", "0029_first_sixteen_menus_name_their_read_codename"),
        seed=seed,
        snapshot=_codenames_snapshot,
        check_forward=check_forward,
    )
