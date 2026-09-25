"""The approver preview answers with the same resolver the engine uses.

`GET /workflow/templates/{id}/approver-preview/?node=…` must say, for every
node, exactly what `_create_nodes` then writes onto the `ApprovalNode`. The main
test builds the workflow for real and compares the two node by node, over a
graph that exercises each branch of `_resolve_approver`: a named actor, an actor
found through the label, an excused joint bench, an explicit ROLE, and a node
that names nobody.

Mutation-checked: a preview that skipped the label probe (resolving only the
`actor` key) went red on 「阎罗王 · 四审」, which the engine resolves through
its label.
"""
import io

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.souls.models import CIVILIZATION_TENANT, Civilization, Soul
from apps.tenants.managers import clear_current_tenant
from apps.tenants.models import Tenant
from apps.workflow import versioning
from apps.workflow.models import WorkflowTemplate
from apps.workflow.services import WorkflowService

TEMPLATES = "/api/v1/workflow/templates"

NODES = [
    {"id": "a", "node_name": "秦广王 · 分流", "actor": "秦广王", "node_order": 1},
    {"id": "b", "node_name": "阎罗王 · 四审", "node_order": 2},
    {"id": "c", "node_name": "十殿联审", "node_order": 3},
    {"id": "d", "node_name": "判官复核", "approver_type": "ROLE", "approver_role": "JUDGE", "node_order": 4},
    {"id": "e", "node_name": "无名之节", "approver_type": "ROLE", "approver_role": "", "node_order": 5},
]


@pytest.fixture
def seeded(db):
    clear_current_tenant()
    call_command("seed_mythology", stdout=io.StringIO())


def _bearer(user) -> APIClient:
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    return APIClient(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")


def _published(tenant, nodes=NODES):
    template = WorkflowTemplate.objects.create(
        name="预览", civilization=Civilization.CHINESE, case_type="ROUTINE", tenant=tenant,
    )
    versioning.save_draft(template, nodes)
    versioning.publish(template)
    return template


def _assigned(node) -> tuple:
    return (
        node.approver_type,
        node.approver_actor.name if node.approver_actor_id else None,
        node.approver_role or None,
    )


def _previewed(body) -> tuple:
    return (
        body["approver_type"],
        body["actor"]["name"] if body["actor"] else None,
        body["role"],
    )


@pytest.mark.django_db
def test_the_preview_equals_the_assignment_node_for_node(seeded):
    tenant = Tenant.objects.get(code=CIVILIZATION_TENANT[Civilization.CHINESE])
    User.objects.create_user(username="pv_judge", password="x", role="JUDGE", tenant=tenant)
    admin = User.objects.create_user(username="pv_admin", password="x", role="ADMIN", tenant=tenant)
    template = _published(tenant)
    client = _bearer(admin)

    previews = {}
    for node in NODES:
        res = client.get(f"{TEMPLATES}/{template.id}/approver-preview/", {"node": node["id"]})
        assert res.status_code == 200, res.data
        previews[node["node_name"]] = res.data

    soul = Soul.objects.create(name="预览魂", tenant=tenant)
    judgment = Judgment.objects.create(
        soul=soul, civilization=Civilization.CHINESE, court="—",
        verdict="PASSED", is_final=True, tenant=tenant,
    )
    workflow = WorkflowService.create_from_judgment(judgment)
    built = {n.node_name: n for n in workflow.nodes.all()}
    assert set(built) == set(previews)

    for name, node in built.items():
        assert _previewed(previews[name]) == _assigned(node), name

    # The five cases are really five cases, not five SYSTEMs agreeing.
    kinds = [_assigned(built[n["node_name"]])[0] for n in NODES]
    assert kinds == ["ACTOR", "ACTOR", "SYSTEM", "ROLE", "SYSTEM"]
    # Names and roles only: no ids anywhere in the body.
    judge = previews["判官复核"]
    assert judge["user_count"] >= 1
    assert {"display_name", "role"} == set(judge["users"][0])
    assert "id" not in (previews["阎罗王 · 四审"]["actor"] or {})


@pytest.mark.django_db
def test_the_preview_reads_the_draft_the_editor_is_showing(seeded):
    tenant = Tenant.objects.get(code=CIVILIZATION_TENANT[Civilization.CHINESE])
    admin = User.objects.create_user(username="pv_admin2", password="x", role="ADMIN", tenant=tenant)
    template = _published(tenant)
    versioning.save_draft(template, [{"id": "z", "node_name": "转轮王 · 终审", "node_order": 1}])

    res = _bearer(admin).get(f"{TEMPLATES}/{template.id}/approver-preview/", {"node": "z"})
    assert res.status_code == 200
    assert res.data["actor"]["name"] == "转轮王"


@pytest.mark.django_db
def test_admin_previews_another_civilization_in_its_own_tenant(seeded):
    cn = Tenant.objects.get(code=CIVILIZATION_TENANT[Civilization.CHINESE])
    admin = User.objects.create_user(username="pv_admin3", password="x", role="ADMIN", tenant=cn)
    template = _published(cn, [{"id": "o", "node_name": "Osiris · 称重", "node_order": 1}])

    res = _bearer(admin).get(
        f"{TEMPLATES}/{template.id}/approver-preview/",
        {"node": "o", "civilization": Civilization.EGYPTIAN},
    )
    assert res.status_code == 200, res.data
    assert res.data["tenant"] == CIVILIZATION_TENANT[Civilization.EGYPTIAN]
    assert res.data["approver_type"] == "ACTOR"
    assert res.data["actor"]["name"] == "Osiris"


@pytest.mark.django_db
def test_a_non_admin_cannot_preview_in_a_foreign_tenant(seeded):
    cn = Tenant.objects.get(code=CIVILIZATION_TENANT[Civilization.CHINESE])
    judge = User.objects.create_user(username="pv_judge2", password="x", role="JUDGE", tenant=cn)
    template = _published(cn)
    res = _bearer(judge).get(
        f"{TEMPLATES}/{template.id}/approver-preview/",
        {"node": "a", "tenant": CIVILIZATION_TENANT[Civilization.EGYPTIAN]},
    )
    assert res.status_code == 403
    own = _bearer(judge).get(f"{TEMPLATES}/{template.id}/approver-preview/", {"node": "a"})
    assert own.status_code == 200 and own.data["tenant"] == cn.code


@pytest.mark.django_db
def test_unknown_node_and_civilization_are_refused(seeded):
    cn = Tenant.objects.get(code=CIVILIZATION_TENANT[Civilization.CHINESE])
    admin = User.objects.create_user(username="pv_admin4", password="x", role="ADMIN", tenant=cn)
    template = _published(cn)
    client = _bearer(admin)
    url = f"{TEMPLATES}/{template.id}/approver-preview/"
    assert client.get(url, {"node": "nope"}).status_code == 404
    assert client.get(url).status_code == 404
    assert client.get(url, {"node": "a", "civilization": "ATLANTIS"}).status_code == 400


@pytest.mark.django_db
def test_the_preview_writes_nothing(seeded):
    cn = Tenant.objects.get(code=CIVILIZATION_TENANT[Civilization.CHINESE])
    admin = User.objects.create_user(username="pv_admin5", password="x", role="ADMIN", tenant=cn)
    template = _published(cn)
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, WorkflowTemplateVersion

    before = (ApprovalWorkflow.all_objects.count(), ApprovalNode.objects.count(),
              WorkflowTemplateVersion.objects.count())
    _bearer(admin).get(f"{TEMPLATES}/{template.id}/approver-preview/", {"node": "b"})
    after = (ApprovalWorkflow.all_objects.count(), ApprovalNode.objects.count(),
             WorkflowTemplateVersion.objects.count())
    assert before == after
