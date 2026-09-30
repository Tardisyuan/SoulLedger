"""menus/0020:助手管理页的侧边栏入口,只给 ADMIN,在迁移出来的真实菜单数据上看。"""
import importlib

import pytest
from django.apps import apps as django_apps

from apps.authentication.models import User
from apps.menus.models import Menu
from tests.perm_support import seeded_menus
from tests.soul_account_support import officer_client

migration = importlib.import_module("apps.menus.migrations.0020_add_assistant_admin_menu")

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _menus():
    seeded_menus()

NAME = "助手管理"


def _names(payload):
    out = set()

    def walk(items):
        for item in items:
            out.add(item["name"])
            walk(item.get("children") or [])

    walk(payload.get("results", payload) if isinstance(payload, dict) else payload)
    return out


def _seen_by(role, tenant, path):
    user = User.objects.create_user(username=f"m_{role.lower()}", password="x", role=role,
                                    tenant=None if role == "ADMIN" else tenant)
    response = officer_client(user).get(path)
    assert response.status_code == 200, response.data
    return _names(response.json())


def test_the_migration_seeded_the_entry_under_system_settings_without_a_codename():
    menu = Menu.objects.get(path="/admin/assistant")
    assert (menu.name, menu.parent.name, menu.roles, menu.permission) == (NAME, "系统设置", ["ADMIN"], "")
    assert not Menu.objects.filter(path="/admin/assistant/usage").exists()  # 用量是同一页的标签


@pytest.mark.parametrize("path", ["/api/v1/menus/", "/api/v1/menus/tree/"])
def test_only_the_admin_sees_it(cn_tenant, path):
    """变异:roles 写成 [] → 非 ADMIN 看得见,红。"""
    assert NAME in _seen_by("ADMIN", cn_tenant, path)
    for role in ("MODERATOR", "JUDGE", "GUARDIAN", "VIEWER"):
        assert NAME not in _seen_by(role, cn_tenant, path), role


def test_the_migration_is_reversible_and_idempotent():
    migration.remove_menus(django_apps, None)
    assert not Menu.objects.filter(path="/admin/assistant").exists()
    migration.add_menus(django_apps, None)
    migration.add_menus(django_apps, None)
    assert Menu.objects.filter(path="/admin/assistant").count() == 1
