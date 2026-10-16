"""W-11 (用户 2026-10-17): 官员可以为任一灵魂手动发起审批 —— `POST /workflows/start/`.

And the generic `POST /workflows/` is closed: it saved a bare row with no
template, no nodes and no event, i.e. the node-less workflow nobody can move.

Real JWT, not `force_authenticate`, for the reason
`tests/test_workflow_template_priority.py` gives: without it `request.tenant`
is unset and the tenant-scoped lookups measure nothing.

The double-click race (`select_for_update` on the soul inside
`WorkflowService.start_workflow(exclusive=True)`) is NOT tested here: SQLite
ignores row locks. The sequential duplicate below is the half SQLite can see.
"""
import io

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.events.models import EventType, SoulEvent
from apps.judgment.models import Judgment
from apps.souls.models import CIVILIZATION_TENANT, Civilization, Soul
from apps.tenants.managers import clear_current_tenant
from apps.tenants.models import Tenant
from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus, CaseType, WorkflowTemplate

START = "/api/v1/workflows/start/"

NODES = [
    {"id": "n1", "node_name": "手动受理", "node_type": "TRIAL", "court_code": "酆都",
     "approver_role": "", "approver_type": "ROLE", "node_order": 1},
    {"id": "n2", "node_name": "手动复核", "node_type": "TRIAL", "court_code": "酆都",
     "approver_role": "", "approver_type": "ROLE", "node_order": 2},
]


@pytest.fixture
def seeded(db):
    clear_current_tenant()
    call_command("seed_mythology", stdout=io.StringIO())


def _tenant(civilization):
    return Tenant.objects.get(code=CIVILIZATION_TENANT[civilization])


def _client(role, tenant, username):
    from rest_framework_simplejwt.tokens import RefreshToken

    user = User.objects.create_user(username=username, password="x", role=role, tenant=tenant)
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    return APIClient(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")


@pytest.fixture
def cn(seeded):
    tenant = _tenant(Civilization.CHINESE)
    return {
        "tenant": tenant,
        "soul": Soul.objects.create(name="手动发起魂", tenant=tenant),
        "moderator": _client("MODERATOR", tenant, "w11_moderator"),
    }


@pytest.mark.django_db
def test_start_from_a_template_builds_its_nodes_event_and_audit(cn):
    template = WorkflowTemplate.objects.create(
        name="手动模板", civilization=Civilization.CHINESE, case_type=CaseType.SPECIAL,
        nodes_json=NODES, is_active=True, priority=1, tenant=cn["tenant"],
    )
    response = cn["moderator"].post(
        START, {"soul": str(cn["soul"].pk), "template": str(template.pk), "reason": "  家属申请复查  "},
        format="json",
    )
    assert response.status_code == 201, response.data
    workflow = ApprovalWorkflow.objects.get(pk=response.data["id"])
    assert workflow.soul_id == cn["soul"].pk
    assert workflow.case_type == CaseType.SPECIAL
    assert workflow.priority == 1  # template default, nothing sent
    assert workflow.notes == "家属申请复查"  # trimmed
    assert workflow.judgment_id is None
    assert [n.node_name for n in workflow.nodes.order_by("node_order")] == ["手动受理", "手动复核"]
    assert workflow.current_node is not None
    assert SoulEvent.objects.filter(soul=cn["soul"], event_type=EventType.WORKFLOW_CREATED).count() == 1
    audit = AuditLog.objects.get(resource="workflow.start", resource_id=str(workflow.pk))
    assert audit.changes["reason"] == "家属申请复查"


@pytest.mark.django_db
def test_start_from_a_case_type_resolves_like_the_judgment_path(cn):
    response = cn["moderator"].post(
        START, {"soul": str(cn["soul"].pk), "case_type": CaseType.ROUTINE, "reason": "例行", "priority": 2},
        format="json",
    )
    assert response.status_code == 201, response.data
    workflow = ApprovalWorkflow.objects.get(pk=response.data["id"])
    assert workflow.priority == 2
    assert workflow.nodes.count() > 0  # the built-in 十殿 flow, never a node-less row


@pytest.mark.django_db
@pytest.mark.parametrize("body", [{"reason": ""}, {"reason": "   "}, {}], ids=["empty", "blank", "absent"])
def test_a_reason_is_required(cn, body):
    response = cn["moderator"].post(
        START, {"soul": str(cn["soul"].pk), "case_type": CaseType.ROUTINE, **body}, format="json",
    )
    assert response.status_code == 400
    assert "reason" in response.data
    assert not ApprovalWorkflow.objects.filter(soul=cn["soul"]).exists()


@pytest.mark.django_db
def test_exactly_one_of_case_type_or_template(cn):
    neither = cn["moderator"].post(START, {"soul": str(cn["soul"].pk), "reason": "x"}, format="json")
    assert neither.status_code == 400
    assert not ApprovalWorkflow.objects.filter(soul=cn["soul"]).exists()


@pytest.mark.django_db
def test_a_case_type_the_civilization_does_not_admit_is_400(cn):
    response = cn["moderator"].post(
        START, {"soul": str(cn["soul"].pk), "case_type": CaseType.HEART_WEIGHING, "reason": "x"}, format="json",
    )
    assert response.status_code == 400
    assert response.data["code"] == "invalid_case_type"
    assert not ApprovalWorkflow.objects.filter(soul=cn["soul"]).exists()


@pytest.mark.django_db
def test_another_tenant_s_soul_is_404(cn):
    foreign = Soul.objects.create(name="别殿之魂", tenant=_tenant(Civilization.EGYPTIAN))
    response = cn["moderator"].post(
        START, {"soul": str(foreign.pk), "case_type": CaseType.ROUTINE, "reason": "x"}, format="json",
    )
    assert response.status_code == 404
    assert response.data["code"] == "soul_not_found"
    assert not ApprovalWorkflow.objects.filter(soul=foreign).exists()


@pytest.mark.django_db
def test_another_tenant_s_template_is_404(cn):
    eg = _tenant(Civilization.EGYPTIAN)
    template = WorkflowTemplate.objects.create(
        name="别殿模板", civilization=Civilization.CHINESE, case_type=CaseType.SPECIAL,
        nodes_json=NODES, is_active=True, tenant=eg,
    )
    response = cn["moderator"].post(
        START, {"soul": str(cn["soul"].pk), "template": str(template.pk), "reason": "x"}, format="json",
    )
    assert response.status_code == 404
    assert response.data["code"] == "template_not_found"


@pytest.mark.django_db
def test_a_soul_with_a_workflow_of_the_same_case_type_in_progress_is_409(cn):
    first = cn["moderator"].post(
        START, {"soul": str(cn["soul"].pk), "case_type": CaseType.ROUTINE, "reason": "第一次"}, format="json",
    )
    assert first.status_code == 201, first.data
    second = cn["moderator"].post(
        START, {"soul": str(cn["soul"].pk), "case_type": CaseType.ROUTINE, "reason": "第二次"}, format="json",
    )
    assert second.status_code == 409
    assert second.data["code"] == "workflow_in_progress"
    assert second.data["workflow"] == first.data["id"]
    assert second.data["status"] == first.data["status"]
    assert ApprovalWorkflow.objects.filter(soul=cn["soul"]).count() == 1

    # A finished one does not block a new one.
    ApprovalWorkflow.objects.filter(pk=first.data["id"]).update(status=ApprovalWorkflowStatus.COMPLETED)
    third = cn["moderator"].post(
        START, {"soul": str(cn["soul"].pk), "case_type": CaseType.ROUTINE, "reason": "第三次"}, format="json",
    )
    assert third.status_code == 201, third.data


@pytest.mark.django_db
def test_a_different_case_type_in_progress_does_not_block(cn):
    """User, 2026-10-17: only the same case type dedupes; different types coexist."""
    first = cn["moderator"].post(
        START, {"soul": str(cn["soul"].pk), "case_type": CaseType.ROUTINE, "reason": "例行"}, format="json",
    )
    assert first.status_code == 201, first.data
    other = cn["moderator"].post(
        START, {"soul": str(cn["soul"].pk), "case_type": CaseType.SPECIAL, "reason": "特案"}, format="json",
    )
    assert other.status_code == 201, other.data
    assert set(ApprovalWorkflow.objects.filter(soul=cn["soul"]).values_list("case_type", flat=True)) == {
        CaseType.ROUTINE, CaseType.SPECIAL,
    }


CASE_TYPES = "/api/v1/workflows/case-types/"


@pytest.mark.django_db
def test_case_types_by_civilization_are_the_validator_s_set(cn):
    from apps.workflow.templates import VALID_CASE_TYPES_BY_CIVILIZATION, WORKFLOW_TEMPLATES

    for civilization, valid in VALID_CASE_TYPES_BY_CIVILIZATION.items():
        response = cn["moderator"].get(CASE_TYPES, {"civilization": civilization})
        assert response.status_code == 200, response.data
        assert {row["value"] for row in response.data} == {c.value for c in valid}
        for row in response.data:
            builtin = bool((WORKFLOW_TEMPLATES.get((civilization, row["value"])) or {}).get("nodes"))
            assert row["builtin"] is builtin, (civilization, row)
    # REBIRTH_APPLICATION is never offered: it is not started by hand.
    chinese = cn["moderator"].get(CASE_TYPES, {"civilization": Civilization.CHINESE}).data
    assert CaseType.REBIRTH_APPLICATION not in {row["value"] for row in chinese}
    assert {row["value"]: row["builtin"] for row in chinese}[CaseType.ROUTINE] is True


@pytest.mark.django_db
def test_case_types_by_soul_use_the_soul_s_civilization(cn):
    by_soul = cn["moderator"].get(CASE_TYPES, {"soul": str(cn["soul"].pk)})
    by_civ = cn["moderator"].get(CASE_TYPES, {"civilization": Civilization.CHINESE})
    assert by_soul.status_code == 200, by_soul.data
    assert by_soul.data == by_civ.data


@pytest.mark.django_db
def test_case_types_refusals(cn):
    foreign = Soul.objects.create(name="别殿之魂乙", tenant=_tenant(Civilization.EGYPTIAN))
    assert cn["moderator"].get(CASE_TYPES, {"soul": str(foreign.pk)}).status_code == 404
    assert cn["moderator"].get(CASE_TYPES, {"soul": "not-a-uuid"}).status_code == 404
    assert cn["moderator"].get(CASE_TYPES).status_code == 400
    assert cn["moderator"].get(CASE_TYPES, {"civilization": "ATLANTEAN"}).status_code == 400
    both = cn["moderator"].get(CASE_TYPES, {"civilization": Civilization.CHINESE, "soul": str(cn["soul"].pk)})
    assert both.status_code == 400
    judge = _client("JUDGE", cn["tenant"], "w11_judge_ct")
    assert judge.get(CASE_TYPES, {"civilization": Civilization.CHINESE}).status_code == 403


@pytest.mark.django_db
def test_a_judge_without_workflow_create_is_403(cn):
    judge = _client("JUDGE", cn["tenant"], "w11_judge")
    response = judge.post(
        START, {"soul": str(cn["soul"].pk), "case_type": CaseType.ROUTINE, "reason": "x"}, format="json",
    )
    assert response.status_code == 403
    assert not ApprovalWorkflow.objects.filter(soul=cn["soul"]).exists()


@pytest.mark.django_db
def test_the_generic_create_is_closed(cn):
    response = cn["moderator"].post(
        "/api/v1/workflows/", {"soul": str(cn["soul"].pk), "workflow_name": "裸行"}, format="json",
    )
    assert response.status_code == 405
    assert not ApprovalWorkflow.objects.filter(soul=cn["soul"]).exists()


@pytest.mark.django_db
def test_create_from_judgment_still_works(cn):
    judgment = Judgment.objects.create(
        soul=cn["soul"], civilization=Civilization.CHINESE, court="—",
        verdict="PASSED", is_final=True, tenant=cn["tenant"],
    )
    response = cn["moderator"].post(
        "/api/v1/workflows/create_from_judgment/", {"judgment_id": str(judgment.pk)}, format="json",
    )
    assert response.status_code == 201, response.data
    workflow = ApprovalWorkflow.objects.get(pk=response.data["id"])
    assert workflow.judgment_id == judgment.pk
    assert workflow.nodes.count() > 0
    assert SoulEvent.objects.filter(soul=cn["soul"], event_type=EventType.WORKFLOW_CREATED).count() == 1


# The two fields the start dialog reads (Design 第三十七批 W-11b): which judgments already carry a workflow (greyed
# out, 「已有审批」), and which hall a template belongs to (a global admin's template list spans halls).


@pytest.mark.django_db
def test_a_judgment_row_names_the_workflow_it_already_has(cn):
    taken = Judgment.objects.create(
        soul=cn["soul"], civilization=Civilization.CHINESE, court="—",
        verdict="PASSED", is_final=True, tenant=cn["tenant"],
    )
    free = Judgment.objects.create(
        soul=cn["soul"], civilization=Civilization.CHINESE, court="—", tenant=cn["tenant"],
    )
    created = cn["moderator"].post(
        "/api/v1/workflows/create_from_judgment/", {"judgment_id": str(taken.pk)}, format="json",
    )
    assert created.status_code == 201, created.data
    response = cn["moderator"].get("/api/v1/judgment/", {"soul": str(cn["soul"].pk)})
    assert response.status_code == 200, response.data
    rows = {row["id"]: row for row in response.data["results"]}
    assert rows[str(taken.pk)]["workflow"] == created.data["id"]
    assert rows[str(free.pk)]["workflow"] is None


@pytest.mark.django_db
def test_a_template_list_row_names_its_tenant(cn):
    template = WorkflowTemplate.objects.create(
        name="带殿的模板", civilization=Civilization.CHINESE, case_type=CaseType.SPECIAL,
        nodes_json=NODES, is_active=True, tenant=cn["tenant"],
    )
    response = cn["moderator"].get("/api/v1/workflow/templates/")
    assert response.status_code == 200, response.data
    row = next(r for r in response.data if r["id"] == str(template.pk))
    assert row["tenant"] == cn["tenant"].pk
