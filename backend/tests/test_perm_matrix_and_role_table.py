"""权限页改版的后端:矩阵按格保存、保存前冲突预检、角色表计数、删除保护、复制为新角色。

设计取舍写在 `apps/perm/matrix.py` 的模块文档里。这里钉的是:

* 部分保存:同一请求里 saved / unchanged / refused / failed 各有其格,
  计数与逐格结果一致,失败的格**没有**落库;
* 部分保存之后,`check_permission` 的回答与表里的行逐格一致(缓存跟着提交走);
* 冲突预检用**经 API 存下的**模板(编辑器写出的那个形状),并且与真实的
  `approve_node` 对照:预检说「无人可批」的那一步,撤销之后真的 403;
* 角色 code 创建后不可改;内置角色与被模板引用的角色不可删;
* 复制为新角色:同一组授权、新 code、原角色不动。
"""
from unittest import mock

import pytest
from django.db import DatabaseError
from rest_framework.test import APIClient

from apps.authentication.models import User, UserRole
from apps.perm.cache import invalidate_all_permissions
from apps.perm.checker import check_permission
from apps.perm.models import Permission, Role, RolePermission
from apps.perm.services import RoleHolder
from apps.souls.models import Soul
from apps.tenants.models import Tenant
from apps.workflow.models import ApprovalWorkflow, NodeStatus, WorkflowTemplate
from apps.workflow.services import WorkflowService

CHANGES = "/api/v1/perm/role-permissions/changes/"
IMPACT = "/api/v1/perm/role-permissions/impact/"
ROLES = "/api/v1/perm/roles/"
TEMPLATES = "/api/v1/workflow/templates/"

CODENAMES = ["ledger.read", "ledger.manage", "soul.read", "workflow.approve", "workflow.read"]


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def world(db):
    invalidate_all_permissions()
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    for name in UserRole.values:
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})
    perms = {
        c: Permission.objects.get_or_create(codename=c, defaults={"name": c, "category": c.split(".")[0]})[0]
        for c in CODENAMES
    }
    judge = Role.objects.get(name="JUDGE")
    for c in ("workflow.approve", "workflow.read", "soul.read"):
        RolePermission.objects.get_or_create(role=judge, permission=perms[c])
    scribe = Role.objects.create(name="SCRIBE", display_name="书记")
    RolePermission.objects.create(role=scribe, permission=perms["ledger.read"])
    admin = User.objects.create_user(username="pm_admin", password="x", role="ADMIN", tenant=tenant)
    return {"tenant": tenant, "perms": perms, "judge": judge, "scribe": scribe,
            "admin": admin, "client": _client(admin)}


def _cell(role, perm, action):
    return {"role": role, "permission_id": perm.pk, "action": action}


def _held(role_name, codename):
    return RolePermission.objects.filter(role__name=role_name, permission__codename=codename).exists()


# ── 1. partial save ──────────────────────────────────────────────────────


@pytest.mark.django_db
def test_a_mixed_save_reports_each_cell_and_writes_only_the_saved_ones(world, django_capture_on_commit_callbacks):
    p = world["perms"]
    changes = [
        _cell("SCRIBE", p["ledger.manage"], "grant"),      # 0 saved
        _cell("SCRIBE", p["ledger.read"], "revoke"),       # 1 saved
        _cell("SCRIBE", p["soul.read"], "revoke"),         # 2 unchanged (never held)
        _cell("NOBODY", p["soul.read"], "grant"),          # 3 refused role_not_found
        {"role": "SCRIBE", "permission_id": 999999, "action": "grant"},  # 4 refused permission_not_found
        _cell("JUDGE", p["ledger.read"], "grant"),         # 5 refused version_conflict
    ]
    judge_version = world["judge"].version
    scribe_version = world["scribe"].version
    with django_capture_on_commit_callbacks(execute=True):
        response = world["client"].post(
            CHANGES, {"changes": changes, "expected_versions": {"JUDGE": judge_version - 1}}, format="json"
        )
    assert response.status_code == 200, response.content
    body = response.data
    statuses = [(r["index"], r["status"], r["code"]) for r in body["results"]]
    assert statuses == [
        (0, "saved", None),
        (1, "saved", None),
        (2, "unchanged", None),
        (3, "refused", "role_not_found"),
        (4, "refused", "permission_not_found"),
        (5, "refused", "version_conflict"),
    ], statuses
    assert (body["saved"], body["unchanged"], body["refused"], body["failed"]) == (2, 1, 3, 0)

    assert _held("SCRIBE", "ledger.manage") is True
    assert _held("SCRIBE", "ledger.read") is False
    assert _held("JUDGE", "ledger.read") is False, "版本冲突的格仍然写进去了"
    # One bump for SCRIBE however many cells moved; JUDGE untouched and reported as-is.
    assert body["versions"]["SCRIBE"] == scribe_version + 1
    assert body["versions"]["JUDGE"] == judge_version
    assert "NOBODY" not in body["versions"]


@pytest.mark.django_db
def test_a_failed_cell_rolls_back_alone_and_the_cache_matches_the_table(world, django_capture_on_commit_callbacks):
    """「已存 2 项，失败 1 项」—— 表与 check_permission 必须都这样说。"""
    p = world["perms"]
    holder = RoleHolder("SCRIBE")
    # Warm every cell first, so a stale answer has somewhere to live.
    for c in ("ledger.read", "ledger.manage", "soul.read"):
        check_permission(holder, c)

    import apps.perm.matrix as matrix

    real = matrix._write_change

    def flaky(role, permission, action):
        real(role, permission, action)
        if permission.codename == "soul.read":
            # After the row is written: the savepoint has to undo it.
            raise DatabaseError("simulated failure on soul.read")

    changes = [
        _cell("SCRIBE", p["ledger.manage"], "grant"),
        _cell("SCRIBE", p["soul.read"], "grant"),
        _cell("SCRIBE", p["ledger.read"], "revoke"),
    ]
    with (
        mock.patch.object(matrix, "_write_change", side_effect=flaky),
        django_capture_on_commit_callbacks(execute=True),
    ):
        response = world["client"].post(CHANGES, {"changes": changes}, format="json")
    assert response.status_code == 200, response.content
    body = response.data
    assert (body["saved"], body["failed"]) == (2, 1), body
    failed = [r for r in body["results"] if r["status"] == "failed"]
    assert [(r["index"], r["role"], r["permission_id"], r["code"]) for r in failed] == [
        (1, "SCRIBE", p["soul.read"].pk, "database_error")
    ]

    for codename in ("ledger.read", "ledger.manage", "soul.read"):
        in_table = _held("SCRIBE", codename)
        assert check_permission(holder, codename) is in_table, (
            f"{codename}: 表里是 {in_table},check_permission 答的是另一个"
        )
    assert _held("SCRIBE", "soul.read") is False, "失败的格留下了行"
    assert _held("SCRIBE", "ledger.manage") is True
    assert _held("SCRIBE", "ledger.read") is False


@pytest.mark.django_db
def test_both_halves_of_a_save_are_audited(world, django_capture_on_commit_callbacks):
    from apps.audit.models import AuditAction, AuditLog

    p = world["perms"]
    before = AuditLog.objects.filter(action=AuditAction.PERMISSION_CHANGE).count()
    with django_capture_on_commit_callbacks(execute=True):
        world["client"].post(CHANGES, {"changes": [
            _cell("SCRIBE", p["ledger.manage"], "grant"),
            _cell("SCRIBE", p["ledger.read"], "revoke"),
        ]}, format="json")
    rows = list(AuditLog.objects.filter(action=AuditAction.PERMISSION_CHANGE).order_by("pk")[before:])
    diffs = [r.changes["permissions"] for r in rows if r.changes and "permissions" in r.changes]
    assert {"old": [], "new": ["ledger.manage"]} in diffs, diffs
    assert {"old": ["ledger.read"], "new": []} in diffs, diffs


@pytest.mark.django_db
def test_the_same_cell_twice_is_a_400_and_writes_nothing(world):
    p = world["perms"]
    response = world["client"].post(CHANGES, {"changes": [
        _cell("SCRIBE", p["ledger.manage"], "grant"),
        _cell("SCRIBE", p["ledger.manage"], "revoke"),
    ]}, format="json")
    assert response.status_code == 400, response.content
    assert _held("SCRIBE", "ledger.manage") is False


@pytest.mark.django_db
@pytest.mark.parametrize("url", [CHANGES, IMPACT])
def test_the_matrix_endpoints_are_admin_only(world, url):
    judge = User.objects.create_user(username="pm_judge", password="x", role="JUDGE", tenant=world["tenant"])
    response = _client(judge).post(url, {"changes": [
        _cell("JUDGE", world["perms"]["ledger.manage"], "grant"),
    ]}, format="json")
    assert response.status_code == 403
    assert _held("JUDGE", "ledger.manage") is False


# ── 2. conflict detection ────────────────────────────────────────────────


@pytest.fixture
def cross_civ_template(world):
    """Saved through the template API, i.e. the shape /workflow's editor writes."""
    response = world["client"].post(TEMPLATES, {
        "name": "跨文明移交 · 两级",
        "civilization": "CHINESE",
        "case_type": "ROUTINE",
        "nodes": [
            {"node_name": "受理", "node_type": "TRIAL", "node_order": 1,
             "approver_type": "ROLE", "approver_role": "GUARDIAN"},
            {"node_name": "复核", "node_type": "FINAL", "node_order": 2,
             "approver_type": "ROLE", "approver_role": "JUDGE"},
        ],
    }, format="json")
    assert response.status_code == 201, response.content
    # Saving writes a draft (0018); publish so `nodes_json` holds the graph.
    published = world["client"].post(f"{TEMPLATES}{response.data['id']}/publish/")
    assert published.status_code == 200, published.content
    return WorkflowTemplate.objects.get(pk=response.data["id"])


@pytest.mark.django_db
def test_revoking_approve_from_the_designated_role_is_reported_with_step_and_cause(world, cross_civ_template):
    p = world["perms"]
    response = world["client"].post(IMPACT, {"changes": [
        _cell("JUDGE", p["ledger.manage"], "grant"),
        _cell("JUDGE", p["workflow.approve"], "revoke"),
    ]}, format="json")
    assert response.status_code == 200, response.content
    assert response.data["required_codenames"] == ["workflow.approve"]
    conflicts = response.data["conflicts"]
    assert len(conflicts) == 1, conflicts
    c = conflicts[0]
    assert c["template_id"] == str(cross_civ_template.pk)
    assert c["template_name"] == "跨文明移交 · 两级"
    assert (c["step_order"], c["step_name"]) == (2, "复核")
    assert c["approver_roles"] == ["JUDGE"]
    assert c["caused_by"] == [
        {"index": 1, "role": "JUDGE", "permission_id": p["workflow.approve"].pk, "codename": "workflow.approve"}
    ]
    # Read-only: nothing moved.
    assert _held("JUDGE", "workflow.approve") is True


@pytest.mark.django_db
def test_changes_that_leave_an_approver_report_nothing(world, cross_civ_template):
    p = world["perms"]
    cases = [
        [_cell("JUDGE", p["workflow.read"], "revoke")],          # not the approving codename
        [_cell("SCRIBE", p["workflow.approve"], "revoke")],      # a role no step designates
        [_cell("ADMIN", p["workflow.approve"], "revoke")],       # ADMIN's short-circuit
        # GUARDIAN never held it: step 1 was unapprovable before, not broken by this.
        [_cell("GUARDIAN", p["workflow.approve"], "revoke")],
    ]
    for changes in cases:
        response = world["client"].post(IMPACT, {"changes": changes}, format="json")
        assert response.status_code == 200, response.content
        assert response.data["conflicts"] == [], (changes, response.data["conflicts"])


@pytest.mark.django_db
def test_a_step_the_probe_calls_orphaned_really_cannot_be_approved(world, cross_civ_template, django_capture_on_commit_callbacks):
    """The probe against the real gate: build the flow the way judgments do,
    apply the revoke the probe warned about, and ask `approve_node`."""
    p = world["perms"]
    judge_user = User.objects.create_user(username="pm_j", password="x", role="JUDGE", tenant=world["tenant"])
    soul = Soul.objects.create(name="移交者", tenant=world["tenant"])
    workflow = ApprovalWorkflow.objects.create(soul=soul, tenant=world["tenant"])
    WorkflowService._create_nodes(
        workflow, {"name": cross_civ_template.name, "nodes": cross_civ_template.nodes_json}, "CHINESE"
    )
    step2 = workflow.nodes.get(node_order=2)
    assert (step2.approver_type, step2.approver_role) == ("ROLE", "JUDGE")

    revoke = [_cell("JUDGE", p["workflow.approve"], "revoke")]
    assert world["client"].post(IMPACT, {"changes": revoke}, format="json").data["conflicts"]
    with django_capture_on_commit_callbacks(execute=True):
        saved = world["client"].post(CHANGES, {"changes": revoke, "acknowledge_conflicts": True}, format="json")
    assert saved.data["saved"] == 1, saved.data

    response = _client(judge_user).post(
        f"/api/v1/workflows/{workflow.pk}/approve_node/",
        {"node_id": str(step2.pk), "verdict": "PASSED", "notes": ""}, format="json",
    )
    assert response.status_code == 403, response.content
    step2.refresh_from_db()
    assert step2.status == NodeStatus.PENDING


# ── 2b. in-flight workflows count, and a conflict must be acknowledged ─


def _live_workflow(world, template, status=None):
    soul = Soul.objects.create(name="在途者", tenant=world["tenant"])
    workflow = ApprovalWorkflow.objects.create(soul=soul, tenant=world["tenant"], workflow_name="在途 · 两级")
    WorkflowService._create_nodes(workflow, {"name": template.name, "nodes": template.nodes_json}, "CHINESE")
    if status:
        ApprovalWorkflow.objects.filter(pk=workflow.pk).update(status=status)
    return workflow


@pytest.mark.django_db
def test_impact_counts_live_workflows_whose_pending_role_node_loses_every_approver(world, cross_civ_template):
    p = world["perms"]
    live = _live_workflow(world, cross_civ_template)
    _live_workflow(world, cross_civ_template, status="COMPLETED")  # over: not counted
    decided = _live_workflow(world, cross_civ_template)
    decided.nodes.filter(node_order=2).update(status=NodeStatus.APPROVED)  # nothing pending on JUDGE
    # The template is deleted: the live workflow is still counted on its own.
    cross_civ_template.soft_delete()

    response = world["client"].post(IMPACT, {"changes": [_cell("JUDGE", p["workflow.approve"], "revoke")]}, format="json")
    assert response.status_code == 200, response.content
    assert response.data["conflicts"] == []
    wc = response.data["workflow_conflicts"]
    assert [(w["workflow_id"], w["node_order"], w["node_name"], w["approver_roles"]) for w in wc] == [
        (str(live.pk), 2, "复核", ["JUDGE"])
    ]
    assert wc[0]["caused_by"] == [
        {"index": 0, "role": "JUDGE", "permission_id": p["workflow.approve"].pk, "codename": "workflow.approve"}
    ]
    # A revoke that leaves JUDGE its approver touches no live node.
    ok = world["client"].post(IMPACT, {"changes": [_cell("JUDGE", p["workflow.read"], "revoke")]}, format="json")
    assert ok.data["workflow_conflicts"] == []


@pytest.mark.django_db
def test_a_conflicting_revoke_is_refused_until_acknowledged(world, cross_civ_template):
    p = world["perms"]
    changes = [_cell("JUDGE", p["workflow.approve"], "revoke"), _cell("SCRIBE", p["soul.read"], "grant")]
    refused = world["client"].post(CHANGES, {"changes": changes}, format="json")
    assert refused.status_code == 200, refused.content
    assert [(r["status"], r["code"]) for r in refused.data["results"]] == [
        ("refused", "conflict_unacknowledged"), ("saved", None),
    ]
    assert _held("JUDGE", "workflow.approve") is True
    assert _held("SCRIBE", "soul.read") is True

    acked = world["client"].post(
        CHANGES, {"changes": changes[:1], "acknowledge_conflicts": True}, format="json"
    )
    assert [(r["status"], r["code"]) for r in acked.data["results"]] == [("saved", None)]
    assert _held("JUDGE", "workflow.approve") is False


@pytest.mark.django_db
def test_a_live_workflow_alone_is_enough_to_need_the_acknowledgement(world, cross_civ_template):
    _live_workflow(world, cross_civ_template)
    cross_civ_template.soft_delete()
    changes = [_cell("JUDGE", world["perms"]["workflow.approve"], "revoke")]
    refused = world["client"].post(CHANGES, {"changes": changes}, format="json")
    assert [r["code"] for r in refused.data["results"]] == ["conflict_unacknowledged"]
    assert _held("JUDGE", "workflow.approve") is True


# ── 3. role table ────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_the_role_list_carries_the_three_counts(world, cross_civ_template):
    User.objects.create_user(username="pm_s1", password="x", role="SCRIBE", tenant=world["tenant"])
    User.objects.create_user(username="pm_s2", password="x", role="SCRIBE", tenant=world["tenant"], is_active=False)
    response = world["client"].get(ROLES)
    assert response.status_code == 200
    rows = {r["name"]: r for r in response.data}
    assert rows["SCRIBE"]["member_count"] == 2
    assert rows["SCRIBE"]["user_count"] == 1, "user_count 仍然只数在职的"
    assert rows["SCRIBE"]["permission_count"] == 1
    assert rows["SCRIBE"]["workflow_template_count"] == 0
    # Migrations seed JUDGE's workflow grants too, so the number is the table's.
    judge_rows = RolePermission.objects.filter(role=world["judge"]).count()
    assert judge_rows >= 3
    assert rows["JUDGE"]["permission_count"] == judge_rows
    assert rows["JUDGE"]["workflow_template_count"] == 1
    assert rows["GUARDIAN"]["workflow_template_count"] == 1
    # Same numbers when a single role is serialized (no annotations, no context).
    single = world["client"].put(f"{ROLES}{world['scribe'].pk}/", {"display_name": "书记官"}, format="json")
    assert single.status_code == 200, single.content
    assert (single.data["member_count"], single.data["permission_count"]) == (2, 1)


@pytest.mark.django_db
def test_a_roles_code_cannot_change_but_its_other_fields_can(world):
    scribe = world["scribe"]
    refused = world["client"].put(f"{ROLES}{scribe.pk}/", {"name": "ARCHIVIST"}, format="json")
    assert refused.status_code == 400, refused.content
    assert refused.data["name"][0].code == "immutable", refused.data
    same = world["client"].put(f"{ROLES}{scribe.pk}/", {"name": "scribe", "display_name": "书记官"}, format="json")
    assert same.status_code == 200, same.content
    scribe.refresh_from_db()
    assert (scribe.name, scribe.display_name) == ("SCRIBE", "书记官")


@pytest.mark.django_db
@pytest.mark.parametrize("builtin", UserRole.values)
def test_a_builtin_role_is_refused_with_its_code(world, builtin):
    role = Role.objects.get(name=builtin)
    response = world["client"].delete(f"{ROLES}{role.pk}/")
    assert response.status_code == 400
    assert response.data["code"] == "builtin_role"
    role.refresh_from_db()
    assert role.is_deleted is False


@pytest.mark.django_db
def test_a_role_a_template_designates_cannot_be_deleted(world):
    auditor = Role.objects.create(name="AUDITOR", display_name="稽核")
    tpl = WorkflowTemplate.objects.create(
        name="稽核流", civilization="CHINESE", tenant=world["tenant"],
        nodes_json=[
            {"node_name": "初核", "node_order": 1, "approver_type": "ROLE", "approver_role": "JUDGE"},
            {"node_name": "稽核", "node_order": 2, "approver_type": "ROLE", "approver_role": "AUDITOR"},
        ],
    )
    response = world["client"].delete(f"{ROLES}{auditor.pk}/")
    assert response.status_code == 400, response.content
    assert response.data["code"] == "role_referenced_by_workflow_templates"
    assert [(t["template_id"], t["template_name"], t["steps"]) for t in response.data["templates"]] == [
        (str(tpl.pk), "稽核流", [{"step_order": 2, "step_name": "稽核"}])
    ]
    auditor.refresh_from_db()
    assert auditor.is_deleted is False

    # Presence of the other half: once no template names it, it goes to the bin.
    tpl.soft_delete()
    ok = world["client"].delete(f"{ROLES}{auditor.pk}/")
    assert ok.status_code == 204, ok.content
    auditor.refresh_from_db()
    assert auditor.is_deleted is True


@pytest.mark.django_db
def test_an_inactive_template_still_blocks_deleting_the_role_it_names(world):
    auditor = Role.objects.create(name="AUDITOR", display_name="稽核")
    WorkflowTemplate.objects.create(
        name="停用的稽核流", civilization="CHINESE", tenant=world["tenant"], is_active=False,
        nodes_json=[{"node_name": "稽核", "node_order": 1, "approver_type": "ROLE", "approver_role": "AUDITOR"}],
    )
    response = world["client"].delete(f"{ROLES}{auditor.pk}/")
    assert response.status_code == 400, response.content
    assert response.data["code"] == "role_referenced_by_workflow_templates"
    assert [t["is_active"] for t in response.data["templates"]] == [False]
    auditor.refresh_from_db()
    assert auditor.is_deleted is False


BIN_RESTORE = "/api/v1/recycle-bin/restore/"


@pytest.mark.django_db
def test_restoring_a_template_whose_role_is_gone_is_refused_naming_the_role(world):
    auditor = Role.objects.create(name="AUDITOR", display_name="稽核")
    tpl = WorkflowTemplate.objects.create(
        name="稽核流", civilization="CHINESE", tenant=world["tenant"],
        nodes_json=[
            {"node_name": "初核", "node_order": 1, "approver_type": "ROLE", "approver_role": "JUDGE"},
            {"node_name": "稽核", "node_order": 2, "approver_type": "ROLE", "approver_role": "AUDITOR"},
        ],
    )
    tpl.soft_delete()
    tpl.refresh_from_db()
    # With the template in the bin, nothing live names the role: it can go.
    assert world["client"].delete(f"{ROLES}{auditor.pk}/").status_code == 204

    refused = world["client"].post(BIN_RESTORE, {"cascade_id": str(tpl.delete_cascade_id)}, format="json")
    assert refused.status_code == 400, refused.content
    body = refused.json()
    assert (body["code"], body["missing_roles"]) == ("template_role_missing", ["AUDITOR"])
    assert "AUDITOR" in body["error"] and "JUDGE" not in body["error"]
    assert WorkflowTemplate.all_objects.get(pk=tpl.pk).is_deleted is True  # nothing restored

    # Bring the role back from the bin, and the template follows.
    auditor = Role.all_objects.get(pk=auditor.pk)
    assert world["client"].post(
        BIN_RESTORE, {"cascade_id": str(auditor.delete_cascade_id)}, format="json"
    ).status_code == 200
    ok = world["client"].post(BIN_RESTORE, {"cascade_id": str(tpl.delete_cascade_id)}, format="json")
    assert ok.status_code == 200, ok.content
    assert WorkflowTemplate.objects.filter(pk=tpl.pk).exists()


@pytest.mark.django_db
def test_a_role_still_held_is_refused_with_its_code(world):
    User.objects.create_user(username="pm_h", password="x", role="SCRIBE", tenant=world["tenant"])
    response = world["client"].delete(f"{ROLES}{world['scribe'].pk}/")
    assert response.status_code == 400
    assert (response.data["code"], response.data["user_count"]) == ("role_in_use", 1)


# ── 4. copy as new role ──────────────────────────────────────────────────


@pytest.mark.django_db
def test_copy_as_new_role_gets_the_same_grants_under_a_new_code(world, django_capture_on_commit_callbacks):
    judge = world["judge"]
    source_grants = sorted(
        RolePermission.objects.filter(role=judge).values_list("permission__codename", flat=True)
    )
    # A cached denial for the new name must not outlive the copy.
    assert check_permission(RoleHolder("CLERK"), "soul.read") is False
    with django_capture_on_commit_callbacks(execute=True):
        response = world["client"].post(
            f"{ROLES}{judge.pk}/copy/", {"name": "clerk", "display_name": "书吏"}, format="json"
        )
    assert response.status_code == 201, response.content
    assert response.data["name"] == "CLERK"
    assert response.data["permission_count"] == len(source_grants)
    clerk = Role.objects.get(name="CLERK")
    assert sorted(
        RolePermission.objects.filter(role=clerk).values_list("permission__codename", flat=True)
    ) == source_grants
    assert check_permission(RoleHolder("CLERK"), "soul.read") is True
    assert sorted(
        RolePermission.objects.filter(role=judge).values_list("permission__codename", flat=True)
    ) == source_grants, "原角色被改了"


@pytest.mark.django_db
def test_copy_also_copies_field_permissions_and_row_level_scopes(world):
    from apps.perm.models import FieldPermission, RowLevelDataScope

    judge = world["judge"]
    FieldPermission.objects.create(role=judge, model_name="Soul", field_name="merit_score",
                                   visible=True, read_only=True, editable=False)
    FieldPermission.objects.create(role=judge, model_name="Soul", field_name="*", visible=False, is_active=False)
    RowLevelDataScope.objects.create(role=judge, model_name="Soul", civilization="CHINESE",
                                     filter_conditions={"current_state": "JUDGING"}, scope_type="READ", priority=3)
    other = world["scribe"]
    FieldPermission.objects.create(role=other, model_name="Soul", field_name="name", visible=False)

    response = world["client"].post(f"{ROLES}{judge.pk}/copy/", {"name": "ASSESSOR", "display_name": "陪审"}, format="json")
    assert response.status_code == 201, response.content

    def fields(role_name):
        return sorted(FieldPermission.objects.filter(role__name=role_name).values_list(
            "model_name", "field_name", "visible", "read_only", "editable", "is_active"))

    def scopes(role_name):
        return sorted(RowLevelDataScope.objects.filter(role__name=role_name).values_list(
            "model_name", "civilization", "scope_type", "priority", "is_active", "filter_conditions"), key=str)

    assert fields("ASSESSOR") == fields("JUDGE") and len(fields("ASSESSOR")) == 2
    assert scopes("ASSESSOR") == scopes("JUDGE") and len(scopes("ASSESSOR")) == 1
    # Only the source's rows: SCRIBE's rule is not dragged along.
    assert ("Soul", "name", False, False, True, True) not in fields("ASSESSOR")
    # The source keeps its own rows.
    assert FieldPermission.objects.filter(role=judge).count() == 2
    assert FieldPermission.get_field_rules("ASSESSOR", "Soul") == FieldPermission.get_field_rules("JUDGE", "Soul")


@pytest.mark.django_db
def test_copy_onto_a_taken_code_is_refused_and_creates_nothing(world):
    before = Role.all_objects.count()
    response = world["client"].post(
        f"{ROLES}{world['judge'].pk}/copy/", {"name": "SCRIBE", "display_name": "x"}, format="json"
    )
    assert response.status_code == 400, response.content
    assert Role.all_objects.count() == before
