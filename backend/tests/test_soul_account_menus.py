"""menus/0016:两个灵魂端官员页面的侧边栏入口,在迁移出来的真实菜单数据上看可见性。"""
import importlib

import pytest
from django.apps import apps as django_apps

from apps.authentication.models import User
from apps.menus.models import Menu
from tests.soul_account_support import officer_client

migration = importlib.import_module("apps.menus.migrations.0016_add_soul_account_menus")

pytestmark = pytest.mark.django_db


def _names(payload):
    rows = payload.get("results", payload) if isinstance(payload, dict) else payload
    out = set()

    def walk(items):
        for item in items:
            out.add(item["name"])
            walk(item.get("children") or [])

    walk(rows)
    return out


def _tree_for(role, tenant):
    user = User.objects.create_user(username=f"menu_{role.lower()}", password="x", role=role, tenant=tenant)
    response = officer_client(user).get("/api/v1/menus/tree/")
    assert response.status_code == 200, response.data
    return _names(response.json())


def test_the_migration_seeded_both_menus_under_their_directories():
    credentials = Menu.objects.get(path="/soul-credentials")
    rebirth = Menu.objects.get(path="/rebirth-applications")
    assert (credentials.parent.name, credentials.permission) == ("灵魂业务", "soul_account.read")
    assert (rebirth.parent.name, rebirth.permission) == ("流程协作", "workflow.read")


def test_moderator_sees_both_through_the_codename_and_their_directories(cn_tenant):
    names = _tree_for("MODERATOR", cn_tenant)
    assert {"待交付初始密码", "灵魂业务", "转生申请", "流程协作"} <= names


def test_viewer_sees_neither(cn_tenant):
    names = _tree_for("VIEWER", cn_tenant)
    assert "灵魂业务" in names, "目录本身对 VIEWER 可见 —— 断言的主体不空"
    assert "待交付初始密码" not in names and "转生申请" not in names


def test_judge_sees_rebirth_applications_but_not_credentials(cn_tenant):
    names = _tree_for("JUDGE", cn_tenant)
    assert "转生申请" in names and "待交付初始密码" not in names


def test_guardian_is_not_offered_a_page_it_would_get_403_on(cn_tenant):
    assert "转生申请" not in _tree_for("GUARDIAN", cn_tenant)


def test_the_migration_is_reversible_and_idempotent():
    migration.remove_menus(django_apps, None)
    assert not Menu.objects.filter(path__in=["/soul-credentials", "/rebirth-applications"]).exists()
    migration.add_menus(django_apps, None)
    migration.add_menus(django_apps, None)
    assert Menu.objects.filter(path="/soul-credentials").count() == 1
    assert Menu.objects.filter(path="/rebirth-applications").count() == 1
