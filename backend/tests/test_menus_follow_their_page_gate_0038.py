"""menus/0038(用户 2026-11-11,审计 C-06):`/menus` 与 `/judgment/capture-due` 的侧栏跟着页门码走。

什么改动会让它红:删掉 0038 或它的某一条(`test_page_gates_match_the_backend.py` 的菜单码对照也会红);
迁移改了管理员手改过的行;反向没有放回旧值。
"""
import importlib

import pytest
from django.apps import apps as django_apps

from apps.menus.models import Menu
from tests.migration_schema_editor import SCHEMA_EDITOR
from tests.perm_support import seeded_menus

mod = importlib.import_module("apps.menus.migrations.0038_menus_and_capture_due_follow_their_page_gate")


@pytest.mark.django_db
def test_the_two_rows_carry_the_page_codename_and_the_holding_roles():
    Menu.all_objects.all().delete()
    seeded_menus()
    got = {m.path: (m.roles, m.permission) for m in Menu.objects.filter(path__in=mod.CHANGES, menu_type="MENU")}
    assert got == {path: (roles, code) for path, (_, _, roles, code) in mod.CHANGES.items()}
    assert got["/menus"][1] == "menu.read" and got["/judgment/capture-due"][1] == "capture.read"


@pytest.mark.django_db
def test_a_hand_edited_row_is_left_alone():
    Menu.all_objects.all().delete()
    seeded_menus()
    mod.backward(django_apps, SCHEMA_EDITOR)
    assert Menu.objects.get(path="/menus").permission == "menu.manage"  # 反向放回了旧值
    Menu.all_objects.filter(path="/menus").update(roles=["ADMIN", "JUDGE"])  # roles 改过
    mod.forward(django_apps, SCHEMA_EDITOR)
    assert (Menu.objects.get(path="/menus").roles, Menu.objects.get(path="/menus").permission) == (
        ["ADMIN", "JUDGE"], "menu.manage"
    )
    assert Menu.objects.get(path="/judgment/capture-due").permission == "capture.read"  # 原样的那行照改


def _snapshot(apps):
    from tests.migration_roundtrip import snapshot_rows

    Menu_ = apps.get_model("menus", "Menu")
    return snapshot_rows(
        Menu_.all_objects.filter(path__in=mod.CHANGES, is_deleted=False),
        key=lambda m: m.path,
        fields={"permission": "permission", "roles": "roles"},
    )


def test_0038_round_trip_follows_the_gate_and_restores(migration_round_trip):
    def seed(apps):
        Menu_ = apps.get_model("menus", "Menu")
        Menu_.all_objects.filter(path__in=mod.CHANGES).delete()
        for path, (seed_roles, before, _, _) in mod.CHANGES.items():
            Menu_.all_objects.create(path=path, name=path, menu_type="MENU", roles=seed_roles,
                                     permission=before, is_active=True, visible=True)

    def check_forward(apps):
        rows = _snapshot(apps)
        assert rows["/menus"] == {"roles": mod.HOLDERS, "permission": "menu.read"}
        assert rows["/judgment/capture-due"] == {"roles": mod.HOLDERS, "permission": "capture.read"}

    migration_round_trip(
        before=("menus", "0037_corpus_menu_drops_moderator"),
        after=("menus", "0038_menus_and_capture_due_follow_their_page_gate"),
        seed=seed,
        snapshot=_snapshot,
        check_forward=check_forward,
    )
