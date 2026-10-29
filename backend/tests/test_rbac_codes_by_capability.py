"""权限严查第 2、3、11、12、13 条与 rbac-be3 余项(2026-10-29)。

* 第 2 条:权限页读按 `system.settings`、写要「码 + 无殿」;用户页按 `user.manage`;
  只许 ADMIN 的码(scheduler / menu / 更正结案 / 回收站)checker 恒拒、矩阵拒授。
* 第 3 条:城隍 / 土地公 / 枉死城 / 勾魂 / 导出 / 重算拆码 —— 迁移后默认角色行为不变;收回新码,旧码不再够用。
* 第 13 条:设计类码与审批类码按角色互斥,不看角色名。
* rbac-be3:M-4(目录码禁删禁改名、新建带默认授予)、M-9(兼任持有者拒删 + 菜单不认已删兼任)、
  L-1 导入校验、L-2 复制过禁授、L-4 撞名 400、L-5 导出审计、L-8 回收站、L-14 PATCH role 与 assign_roles 同规则;
  `can_end` 按 workflow.update。
每条都有反例:放行的那一侧和拒绝的那一侧都断言。
"""
from types import SimpleNamespace

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User, UserRole
from apps.dispatch.services import CrossTenantJudgmentService
from apps.menus.access import menu_is_visible_to
from apps.menus.models import Menu
from apps.perm.cache import invalidate_all_permissions
from apps.perm.checker import check_permission
from apps.perm.models import Permission, Role, RolePermission
from apps.perm.services import RoleHolder
from apps.souls.models import Soul
from apps.tenants.models import Tenant

CHANGES = "/api/v1/perm/role-permissions/changes/"
ASSIGN = "/api/v1/perm/role-permissions/assign/"
ALL_GRANTS = "/api/v1/perm/role-permissions/all/"
IMPORT = "/api/v1/perm/import/"


def _client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    if user.tenant_id:
        token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _perm(codename):
    return Permission.objects.get_or_create(
        codename=codename, defaults={"name": codename, "category": codename.split(".")[0]}
    )[0]


def _role(name, *codenames):
    role, _ = Role.objects.get_or_create(name=name, defaults={"display_name": name})
    for c in codenames:
        RolePermission.objects.get_or_create(role=role, permission=_perm(c))
    invalidate_all_permissions()
    return role


def _revoke(role_name, codename):
    RolePermission.objects.filter(role__name=role_name, permission__codename=codename).delete()
    invalidate_all_permissions()


@pytest.fixture
def world(db):
    invalidate_all_permissions()
    hall, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    other, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "杜阿特"})
    for name in UserRole.values:
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})
    admin = User.objects.create_user(username="cap_admin", password="x", role="ADMIN", tenant=None)
    yield SimpleNamespace(hall=hall, other=other, admin=admin, client=_client(admin))
    invalidate_all_permissions()


def _user(world, name, role, tenant=None, extra=()):
    return User.objects.create_user(username=name, password="x", role=role, tenant=tenant or world.hall,
                                    extra_roles=list(extra))


def _cell(role, codename, action="grant"):
    return {"role": role, "permission_id": _perm(codename).pk, "action": action}


# ── 第 13 条:设计与审批按能力互斥 ──────────────────────────────────────


def test_a_role_holding_a_design_codename_is_denied_approve_whatever_its_name(world):
    _role("DESIGNER", "workflow.update", "workflow.approve", "workflow.advance")
    _role("REVIEWER", "workflow.approve")
    assert check_permission(RoleHolder("DESIGNER"), "workflow.update") is True
    assert check_permission(RoleHolder("DESIGNER"), "workflow.approve") is False
    assert check_permission(RoleHolder("DESIGNER"), "workflow.advance") is False
    assert check_permission(RoleHolder("REVIEWER"), "workflow.approve") is True
    # Per role: a lead who is also a judge approves through the judge.
    assert check_permission(RoleHolder("MODERATOR"), "workflow.approve") is False
    assert check_permission(RoleHolder("MODERATOR", ["JUDGE"]), "workflow.approve") is True


def test_the_matrix_refuses_either_side_of_the_pair_and_allows_approve_without_design(world):
    _role("DESIGNER", "workflow.create")
    response = world.client.post(CHANGES, {"changes": [
        _cell("DESIGNER", "workflow.approve"),   # approve beside design
        _cell("JUDGE", "workflow.update"),       # design beside the judge's approve
        _cell("GUARDIAN", "workflow.approve"),   # no design: fine
    ]}, format="json")
    assert response.status_code == 200, response.content
    codes = [(r["status"], r["code"]) for r in response.data["results"]]
    assert codes == [("refused", "role_forbidden_permission"), ("refused", "role_forbidden_permission"),
                     ("saved", None)]
    assert not RolePermission.objects.filter(role__name="DESIGNER", permission__codename="workflow.approve").exists()
    assert not RolePermission.objects.filter(role__name="JUDGE", permission__codename="workflow.update").exists()


def test_assign_refuses_design_and_approve_in_one_set(world):
    _role("DESIGNER")
    response = world.client.post(ASSIGN, {"role": "DESIGNER", "permission_ids": [
        _perm("workflow.create").pk, _perm("workflow.approve").pk,
    ]}, format="json")
    assert response.status_code == 400, response.content
    assert response.data["code"] == "role_forbidden_permission"
    assert "workflow.approve" in response.data["error"] and "workflow.create" not in response.data["error"]
    assert not RolePermission.objects.filter(role__name="DESIGNER").exists()


def test_a_copy_leaves_the_approve_side_behind(world):
    source = _role("LEGACY", "workflow.update", "workflow.approve", "soul.read")
    response = world.client.post(f"/api/v1/perm/roles/{source.pk}/copy/", {"name": "LEGACY_TWO",
                                                                            "display_name": "副本"}, format="json")
    assert response.status_code == 201, response.content
    held = set(RolePermission.objects.filter(role__name="LEGACY_TWO").values_list("permission__codename", flat=True))
    assert held == {"workflow.update", "soul.read"}


def test_import_skips_approve_for_a_role_that_designs(world):
    _role("DESIGNER", "workflow.update")
    response = world.client.post(IMPORT, {"role_permissions": [
        {"role": "DESIGNER", "permission": "workflow.approve"},
        {"role": "GUARDIAN", "permission": "workflow.approve"},
    ]}, format="json")
    assert response.status_code == 200, response.content
    reasons = {d["key"]: d["reason"] for d in response.data["stats"]["skipped_details"]}
    assert reasons.get("DESIGNER / workflow.approve") == "role_forbidden"
    assert "GUARDIAN / workflow.approve" not in reasons
    assert RolePermission.objects.filter(role__name="GUARDIAN", permission__codename="workflow.approve").exists()


# ── 第 2 条:只许 ADMIN 的码 ─────────────────────────────────────────────


@pytest.mark.parametrize("codename", ["scheduler.manage", "menu.manage", "soul.correct_settlement",
                                      "recycle_bin.restore"])
def test_admin_only_codenames_are_refused_by_the_matrix_and_denied_by_the_checker(world, codename):
    response = world.client.post(CHANGES, {"changes": [_cell("MODERATOR", codename)]}, format="json")
    assert response.data["results"][0]["code"] == "admin_only_permission"
    _role("STRAY", codename)  # a row written before the rule (or by hand)
    assert check_permission(RoleHolder("STRAY"), codename) is False
    assert check_permission(RoleHolder("ADMIN"), codename) is True


# ── 第 2 条:权限页按 system.settings,写还要无殿 ─────────────────────────


def test_permission_reads_follow_system_settings_and_writes_need_no_hall(world):
    _role("SETTINGS_READER", "system.settings")
    lead = _user(world, "cap_lead", "MODERATOR")
    reader = _user(world, "cap_reader", "MODERATOR", extra=["SETTINGS_READER"])
    hall_admin = _user(world, "cap_hall_admin", "ADMIN")
    assert _client(lead).get(ALL_GRANTS).status_code == 403
    assert _client(reader).get(ALL_GRANTS).status_code == 200
    assert _client(hall_admin).get(ALL_GRANTS).status_code == 200
    body = {"role": "VIEWER", "permission_ids": [_perm("soul.read").pk]}
    assert _client(hall_admin).post(ASSIGN, body, format="json").status_code == 403
    assert _client(reader).post(ASSIGN, body, format="json").status_code == 403
    assert world.client.post(ASSIGN, body, format="json").status_code == 200


# ── 第 2 条:用户页按 user.manage ─────────────────────────────────────────


def test_a_granted_user_manage_lists_its_own_hall_without_admins(world):
    _role("CLERK", "user.manage")
    clerk = _user(world, "cap_clerk", "CLERK")
    _user(world, "cap_hall_admin2", "ADMIN")
    _user(world, "cap_viewer", "VIEWER")
    _user(world, "cap_far", "VIEWER", tenant=world.other)
    response = _client(clerk).get("/api/v1/users/?page_size=100")
    assert response.status_code == 200, response.content
    rows = response.data["results"] if isinstance(response.data, dict) else response.data
    names = {u["username"] for u in rows}
    assert "cap_viewer" in names
    assert "cap_hall_admin2" not in names and "cap_far" not in names
    assert _client(_user(world, "cap_judge", "JUDGE")).get("/api/v1/users/").status_code == 403


# ── 第 3 条:拆码后默认行为不变,收回新码旧码不够 ───────────────────────────


def test_city_gods_need_city_god_read_not_judgment_read(world):
    judge = _client(_user(world, "cap_j", "JUDGE"))
    assert judge.get("/api/v1/judgment/city-gods/").status_code == 200
    _revoke("JUDGE", "city_god.read")
    assert judge.get("/api/v1/judgment/city-gods/").status_code == 403
    assert judge.get("/api/v1/judgment/").status_code == 200


def test_recalculation_is_ledger_calculate_which_guardian_does_not_hold(world):
    soul = Soul.objects.create(name="账上人", tenant=world.hall)
    guardian = _user(world, "cap_g", "GUARDIAN")
    lead = _user(world, "cap_m", "MODERATOR")
    assert check_permission(guardian, "ledger.manage") is True
    assert _client(guardian).post(f"/api/v1/ledger/calculate/{soul.pk}/").status_code == 403
    assert _client(lead).post(f"/api/v1/ledger/calculate/{soul.pk}/").status_code == 200


def test_ledger_overview_is_ledger_read_and_the_exports_are_ledger_export(world):
    Soul.objects.create(name="本殿", tenant=world.hall)
    Soul.objects.create(name="别殿", tenant=world.other)
    viewer = _client(_user(world, "cap_v", "VIEWER"))
    overview = viewer.get("/api/v1/ledger/stats/overview/")
    assert overview.status_code == 200, overview.content
    assert overview.data["total_souls"] == 1  # own hall only
    assert overview.data["recent_activity"] == []  # audit rows need audit.read
    assert viewer.get("/api/v1/ledger/stats/export/").status_code == 200
    assert viewer.get("/api/v1/souls/export/").status_code == 200
    _revoke("VIEWER", "ledger.export")
    _revoke("VIEWER", "soul.export")
    assert viewer.get("/api/v1/ledger/stats/export/").status_code == 403
    assert viewer.get("/api/v1/souls/export/").status_code == 403
    assert viewer.get("/api/v1/souls/").status_code == 200


def test_ws_and_report_lists_carry_the_new_codenames(world):
    from apps.perm.services import get_role_permission_codenames

    judge = set(get_role_permission_codenames("JUDGE"))
    assert {"city_god.read", "city_god.execute", "wangsi.execute", "tudi.register", "capture.issue",
            "soul.export", "judgment.export"} <= judge
    assert not {"city_god.manage", "wangsi.manage", "tudi.manage", "ledger.calculate"} & judge
    assert "reincarnation.complete" not in get_role_permission_codenames("ADMIN")


# ── can_end 按 workflow.update ───────────────────────────────────────────


def test_can_end_goes_by_workflow_update_in_the_initiating_hall(world):
    _role("FLOW_KEEPER", "workflow.update")
    judgment = SimpleNamespace(create_user_id=None, initiating_tenant_id=world.hall.pk)
    assert CrossTenantJudgmentService.can_end(judgment, _user(world, "ce_m", "MODERATOR"), world.hall)
    assert CrossTenantJudgmentService.can_end(judgment, _user(world, "ce_k", "FLOW_KEEPER"), world.hall)
    assert not CrossTenantJudgmentService.can_end(judgment, _user(world, "ce_j", "JUDGE"), world.hall)
    far = _user(world, "ce_far", "MODERATOR", tenant=world.other)
    assert not CrossTenantJudgmentService.can_end(judgment, far, world.other)
    assert CrossTenantJudgmentService.can_end(judgment, world.admin, None)


# ── M-4:目录码 ─────────────────────────────────────────────────────────


def test_creating_a_catalogue_row_keeps_its_default_holders(world):
    Permission.all_objects.filter(codename="dispatch.return").delete()
    invalidate_all_permissions()
    assert check_permission(RoleHolder("MODERATOR"), "dispatch.return") is True  # dict answer
    response = world.client.post("/api/v1/perm/permissions/create/",
                                 {"codename": "dispatch.return", "name": "结束暂居", "category": "dispatch"},
                                 format="json")
    assert response.status_code == 201, response.content
    invalidate_all_permissions()
    assert check_permission(RoleHolder("MODERATOR"), "dispatch.return") is True
    assert check_permission(RoleHolder("JUDGE"), "dispatch.return") is False


def test_catalogue_rows_cannot_be_deleted_or_renamed_and_renames_cannot_collide(world):
    catalogue = _perm("soul.read")
    for method, body in (("delete", None), ("put", {"codename": "soul.peek"})):
        response = getattr(world.client, method)(f"/api/v1/perm/permissions/{catalogue.pk}/", body, format="json")
        assert response.status_code == 400, response.content
        assert response.data["code"] == "catalogue_permission"
    assert Permission.objects.filter(codename="soul.read").exists()

    custom = _perm("custom.alpha")
    _perm("custom.beta")
    url = f"/api/v1/perm/permissions/{custom.pk}/"
    assert world.client.put(url, {"codename": "soul.read"}, format="json").data["code"] == "catalogue_permission"
    clash = world.client.put(url, {"codename": "custom.beta"}, format="json")
    assert clash.status_code == 400, clash.content  # was an IntegrityError 500 (L-4)
    assert world.client.put(url, {"codename": "custom.gamma"}, format="json").status_code == 200
    assert world.client.delete(url).status_code == 204


# ── M-9:兼任持有者拒删;菜单不认已删的兼任 ────────────────────────────────


def test_a_role_held_only_as_an_additional_role_cannot_be_deleted(world):
    helper = _role("HELPER")
    _user(world, "cap_helper", "VIEWER", extra=["HELPER"])
    response = world.client.delete(f"/api/v1/perm/roles/{helper.pk}/")
    assert response.status_code == 400, response.content
    assert (response.data["code"], response.data["user_count"]) == ("role_in_use", 1)
    unused = _role("UNUSED")
    assert world.client.delete(f"/api/v1/perm/roles/{unused.pk}/").status_code == 204


def test_a_binned_additional_role_no_longer_shows_its_menus(world):
    helper = _role("HELPER")
    menu = Menu.objects.create(name="助手页", path="/helper-only", menu_type="MENU", roles=["HELPER"])
    user = _user(world, "cap_menu", "VIEWER", extra=["HELPER"])
    assert menu_is_visible_to(menu, user) is True
    helper.soft_delete()
    invalidate_all_permissions()
    assert menu_is_visible_to(menu, user) is False


# ── L-1 导入校验、L-5 导出审计 ────────────────────────────────────────────


@pytest.mark.parametrize("roles,perms", [
    ([{"name": "SOUL", "display_name": "x"}], []),
    ([{"name": "lower", "display_name": "x"}], []),
    ([{"name": "A" * 21, "display_name": "x"}], []),
    ([], [{"codename": "bad code", "name": "x", "category": "x"}]),
])
def test_import_refuses_bad_role_names_and_codenames(world, roles, perms):
    response = world.client.post(IMPORT, {"roles": roles, "permissions": perms}, format="json")
    assert response.status_code == 400, response.content
    assert not Role.all_objects.filter(name__in=["lower", "A" * 21]).exists()
    assert Role.all_objects.filter(name="SOUL").count() <= 1  # the fixture's own row, never a second


def test_the_permission_export_writes_an_audit_row(world):
    response = world.client.get("/api/v1/perm/export/")
    assert response.status_code == 200
    assert AuditLog.objects.filter(action=AuditAction.EXPORT, resource="permission_config").count() == 1


# ── L-8 回收站 ──────────────────────────────────────────────────────────


def test_a_hall_officer_with_recycle_bin_read_does_not_list_roles(world):
    binned = _role("BINNED")
    binned.soft_delete()
    _role("BIN_READER", "recycle_bin.read")
    reader = _user(world, "cap_bin", "BIN_READER")
    mine = _client(reader).get("/api/v1/recycle-bin/")
    assert mine.status_code == 200, mine.content
    assert "role" not in {e["entity_type"] for e in mine.data["results"]}
    everything = world.client.get("/api/v1/recycle-bin/")
    assert ("role", "BINNED") in {(e["entity_type"], e["label"]) for e in everything.data["results"]}


# ── L-14 PATCH role 与 assign_roles 同规则 ────────────────────────────────


def test_patch_role_refuses_what_assign_roles_refuses(world):
    target = _user(world, "cap_target", "VIEWER", extra=["JUDGE"])
    url = f"/api/v1/users/{target.pk}/"
    assert world.client.patch(url, {"role": "ADMIN"}, format="json").status_code == 400
    assert world.client.patch(url, {"role": "NO_SUCH_ROLE"}, format="json").status_code == 400
    response = world.client.patch(url, {"role": "JUDGE"}, format="json")
    assert response.status_code == 200, response.content
    target.refresh_from_db()
    assert (target.role, target.extra_roles) == ("JUDGE", [])


# ── M-5 / M-6:assign 过冲突确认,缓存提交后才失效 ─────────────────────────


def _judge_step_template(world):
    from apps.workflow.models import WorkflowTemplate

    return WorkflowTemplate.objects.create(
        name="复核 · 判官", civilization="CHINESE", case_type="ROUTINE", tenant=world.hall,
        nodes_json=[{"node_name": "复核", "node_type": "FINAL", "node_order": 1,
                     "approver_type": "ROLE", "approver_role": "JUDGE"}],
    )


def test_assign_refuses_to_orphan_a_step_unless_acknowledged(world, django_capture_on_commit_callbacks):
    _role("JUDGE", "workflow.approve", "soul.read")
    _judge_step_template(world)
    keep = [_perm("soul.read").pk]
    refused = world.client.post(ASSIGN, {"role": "JUDGE", "permission_ids": keep}, format="json")
    assert refused.status_code == 400, refused.content
    assert refused.data["code"] == "conflict_unacknowledged"
    assert [c["step_name"] for c in refused.data["conflicts"]] == ["复核"]
    assert RolePermission.objects.filter(role__name="JUDGE", permission__codename="workflow.approve").exists()

    with django_capture_on_commit_callbacks(execute=True):
        saved = world.client.post(ASSIGN, {"role": "JUDGE", "permission_ids": keep, "acknowledge_conflicts": True},
                                  format="json")
    assert saved.status_code == 200, saved.content
    assert check_permission(RoleHolder("JUDGE"), "workflow.approve") is False


def test_assign_dedupes_ids_and_invalidates_only_after_commit(world, django_capture_on_commit_callbacks):
    from unittest import mock

    _role("SCRIBE")
    read = _perm("ledger.read").pk
    with mock.patch("apps.perm.views.invalidate_role_permissions") as invalidate:
        with django_capture_on_commit_callbacks(execute=False) as callbacks:
            response = world.client.post(ASSIGN, {"role": "SCRIBE", "permission_ids": [read, read]}, format="json")
        assert response.status_code == 200, response.content  # a repeated id was an IntegrityError 500 (L-4)
        assert response.data["assigned_count"] == 1
        invalidate.assert_not_called()
        for callback in callbacks:
            callback()
        invalidate.assert_called_once_with("SCRIBE")


# ── perm/0029 往返 ─────────────────────────────────────────────────────


def test_the_split_migration_round_trips(migration_round_trip):
    """Holders of the old codename get the new one, from the table when the old one has a row and from the
    frozen dict when it has none; ledger.calculate skips GUARDIAN; backward removes only what forward made."""
    tracked = ("city_god.manage", "city_god.read", "ledger.calculate", "soul.export")

    def seed(apps):
        perm_model = apps.get_model("perm", "Permission")
        role_model = apps.get_model("perm", "Role")
        grant_model = apps.get_model("perm", "RolePermission")
        for name in ("ADMIN", "MODERATOR", "JUDGE", "GUARDIAN", "VIEWER", "ASSIGNER"):
            role_model.all_objects.get_or_create(name=name, is_deleted=False, defaults={"display_name": name})
        # judgment.assign has a row granted to a custom role only: the table answers, not the dict.
        assign, _ = perm_model.all_objects.get_or_create(codename="judgment.assign", is_deleted=False,
                                                          defaults={"name": "x", "category": "judgment"})
        grant_model.all_objects.filter(permission=assign).delete()
        grant_model.all_objects.create(role=role_model.all_objects.get(name="ASSIGNER", is_deleted=False),
                                       permission=assign)
        # judgment.read has no row: the frozen dict answers (ADMIN, MODERATOR, JUDGE).
        perm_model.all_objects.filter(codename="judgment.read").delete()
        manage, _ = perm_model.all_objects.get_or_create(codename="ledger.manage", is_deleted=False,
                                                          defaults={"name": "x", "category": "ledger"})
        for name in ("MODERATOR", "GUARDIAN"):
            grant_model.all_objects.get_or_create(
                role=role_model.all_objects.get(name=name, is_deleted=False), permission=manage, is_deleted=False)

    def snapshot(apps):
        grant_model = apps.get_model("perm", "RolePermission")
        perm_model = apps.get_model("perm", "Permission")
        out = {f"perm:{c}": {"live": True} for c in perm_model.all_objects.filter(
            codename__in=tracked, is_deleted=False).values_list("codename", flat=True)}
        for role, codename in grant_model.all_objects.filter(
                permission__codename__in=tracked, is_deleted=False).values_list("role__name", "permission__codename"):
            out[f"{role}:{codename}"] = {"held": True}
        out["sentinel"] = {"ok": True}  # the baseline has none of the tracked rows
        return out

    def check_forward(apps):
        grant_model = apps.get_model("perm", "RolePermission")

        def holders(codename):
            return set(grant_model.all_objects.filter(permission__codename=codename, is_deleted=False)
                       .values_list("role__name", flat=True))
        assert holders("city_god.manage") == {"ASSIGNER"}
        assert holders("city_god.read") == {"ADMIN", "MODERATOR", "JUDGE"}
        assert "GUARDIAN" not in holders("ledger.calculate") and "MODERATOR" in holders("ledger.calculate")
        assert holders("soul.export") >= {"VIEWER", "GUARDIAN"}

    migration_round_trip(
        before=("perm", "0028_session_manage_permission"),
        after=("perm", "0029_split_business_codenames"),
        seed=seed, snapshot=snapshot, check_forward=check_forward,
    )
