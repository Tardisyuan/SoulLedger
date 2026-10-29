"""menus/0032(rbac-web H-1):`/dispatch` `/disposition` `/workflow` `/death-sync` 的侧栏跟着页门码走。

此前种子 roles 比页门码宽:JUDGE 看得见调度、GUARDIAN 看得见审批流程、VIEWER 看得见处置、JUDGE / GUARDIAN
看得见死亡同步 —— 点进去全是 403。迁移把 roles 收成默认持码的角色,并写上页门码。
"""
import importlib

import pytest
from django.apps import apps as django_apps

from apps.authentication.models import User
from apps.menus.models import Menu
from tests.migration_schema_editor import SCHEMA_EDITOR
from tests.perm_support import seeded_grants, seeded_menus
from tests.soul_account_support import officer_client

mod = importlib.import_module("apps.menus.migrations.0032_four_menus_follow_their_page_codename")

PAGES = {"/dispatch": "调度管理", "/workflow": "审批流程", "/disposition": "处置", "/death-sync": "死亡同步"}


def _seen(role, tenant):
    user = User.objects.create_user(username=f"h1_{role.lower()}", password="x", role=role, tenant=tenant)
    response = officer_client(user).get("/api/v1/menus/list-public/")
    assert response.status_code == 200, response.data
    out = set()

    def walk(items):
        for item in items:
            out.add(item["name"])
            walk(item.get("children") or [])

    data = response.json()
    walk(data.get("results", data) if isinstance(data, dict) else data)
    return out


@pytest.mark.django_db
def test_the_four_rows_carry_the_page_codename_and_the_holding_roles():
    Menu.all_objects.all().delete()
    seeded_menus()
    got = {m.path: (m.roles, m.permission) for m in Menu.objects.filter(path__in=PAGES, menu_type="MENU")}
    assert got == {path: (roles, codename) for path, (_, _, roles, codename) in mod.CHANGES.items()}


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("role", "sees", "not_sees"),
    [
        ("JUDGE", {"审批流程", "处置"}, {"调度管理", "死亡同步"}),
        ("GUARDIAN", {"调度管理", "处置"}, {"审批流程", "死亡同步"}),
        ("VIEWER", set(), {"调度管理", "审批流程", "处置", "死亡同步"}),
        ("MODERATOR", {"调度管理", "审批流程", "处置"}, {"死亡同步"}),
    ],
)
def test_each_role_sees_the_pages_it_can_open(cn_tenant, role, sees, not_sees):
    seeded_grants()
    Menu.all_objects.all().delete()
    seeded_menus()
    seen = _seen(role, cn_tenant)
    assert sees <= seen, seen
    assert seen.isdisjoint(not_sees), seen


@pytest.mark.django_db
def test_a_revoked_codename_takes_the_page_out_of_the_sidebar(cn_tenant):
    """roles 收窄之后,码就是门:矩阵里收回 GUARDIAN 的 dispatch.read,侧栏跟着没了。"""
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import RolePermission

    seeded_grants()
    Menu.all_objects.all().delete()
    seeded_menus()
    Menu.all_objects.filter(path="/dispatch").update(roles=["ADMIN"])  # GUARDIAN 只剩码这道门
    assert "调度管理" in _seen("GUARDIAN", cn_tenant)
    RolePermission.objects.filter(role__name="GUARDIAN", permission__codename="dispatch.read").delete()
    invalidate_all_permissions()
    User.objects.filter(username="h1_guardian").delete()
    assert "调度管理" not in _seen("GUARDIAN", cn_tenant)


@pytest.mark.django_db
def test_a_hand_edited_row_is_left_alone():
    Menu.all_objects.all().delete()
    seeded_menus()
    mod.backward(django_apps, SCHEMA_EDITOR)
    Menu.all_objects.filter(path="/death-sync").update(roles=["ADMIN", "JUDGE"])  # roles 改过
    Menu.all_objects.filter(path="/disposition").update(permission="disposition.execute")  # 码填过
    mod.forward(django_apps, SCHEMA_EDITOR)
    assert Menu.objects.get(path="/death-sync").roles == ["ADMIN", "JUDGE"]
    assert Menu.objects.get(path="/disposition").roles == ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"]
    assert Menu.objects.get(path="/dispatch").roles == ["ADMIN", "GUARDIAN"]  # 原样的那行照改


def _snapshot(apps):
    from tests.migration_roundtrip import snapshot_rows

    Menu_ = apps.get_model("menus", "Menu")
    return snapshot_rows(
        Menu_.all_objects.filter(path__in=PAGES, is_deleted=False),
        key=lambda m: m.path,
        fields={"permission": "permission", "roles": "roles"},
    )


def test_0032_round_trip_narrows_and_restores(migration_round_trip):
    def seed(apps):
        Menu_ = apps.get_model("menus", "Menu")
        Menu_.all_objects.filter(path__in=PAGES).delete()
        for path, (seed_roles, before, _, _) in mod.CHANGES.items():
            Menu_.all_objects.create(path=path, name=PAGES[path], menu_type="MENU", roles=seed_roles,
                                     permission=before, is_active=True, visible=True)

    def check_forward(apps):
        rows = _snapshot(apps)
        assert rows["/dispatch"] == {"roles": ["ADMIN", "GUARDIAN"], "permission": "dispatch.read"}
        assert rows["/disposition"] == {"roles": ["ADMIN", "JUDGE", "GUARDIAN"], "permission": "disposition.read"}
        assert rows["/workflow"] == {"roles": ["ADMIN", "JUDGE"], "permission": "workflow.read"}
        assert rows["/death-sync"] == {"roles": ["ADMIN"], "permission": ""}

    migration_round_trip(
        before=("menus", "0031_social_menus_drop_a_codename_that_does_not_exist"),
        after=("menus", "0032_four_menus_follow_their_page_codename"),
        seed=seed,
        snapshot=_snapshot,
        check_forward=check_forward,
    )
