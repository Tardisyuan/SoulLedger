"""`GET /menus/buttons/config/`:菜单按钮配置的生效集合(第四十批 W-b)。

页面上的关键按钮要「权限码允许且配置允许」才显示,没有配置行 = 允许。所以每个角色都要读到**全部**行,
包括挂在它看不见的菜单下的、以及它没有权限码的 —— 否则一条「关」会被收窄藏掉,前端读成「显示」。
不带 `permission` 字段:码名表不因此对所有角色敞开。
"""
import pytest

from apps.authentication.models import User
from apps.menus.models import Menu, MenuButton
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db
URL = "/api/v1/menus/buttons/config/"


@pytest.fixture
def rows():
    admin_only = Menu.objects.create(name="管理", path="/x-admin-only", roles=["ADMIN"], menu_type="MENU")
    souls = Menu.objects.create(name="灵魂", path="/x-souls", roles=["ADMIN", "VIEWER"], menu_type="MENU")
    off = MenuButton.objects.create(menu=souls, name="新建", code="create", permission="soul.create", is_active=False)
    on = MenuButton.objects.create(menu=admin_only, name="删除", code="delete", permission="tenant.delete")
    gone = MenuButton.objects.create(menu=souls, name="导出", code="export", permission="soul.read")
    gone.delete()
    return {"off": off, "on": on}


def test_every_role_reads_every_live_row_without_codenames(rows, cn_tenant):
    viewer = User.objects.create_user(username="cfg_viewer", password="x", role="VIEWER", tenant=cn_tenant)
    resp = officer_client(viewer).get(URL)
    assert resp.status_code == 200, resp.data
    got = {(r["menu_path"], r["code"]): r["is_active"] for r in resp.json()}
    assert got[("/x-souls", "create")] is False, "an off row the viewer lacks the codename for must still come back"
    assert got[("/x-admin-only", "delete")] is True
    assert ("/x-souls", "export") not in got, "a deleted row is not config"
    assert all("permission" not in r for r in resp.json())


def test_anonymous_gets_nothing(rows):
    from rest_framework.test import APIClient

    assert APIClient().get(URL).status_code == 401
