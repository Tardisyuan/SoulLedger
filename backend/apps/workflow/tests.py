"""
Tests for workflow domain API views.
Uses JWT auth with tenant_code so TenantMiddleware sets request.tenant.

URL layout (from apps/workflow/urls.py):
  /api/v1/workflow/templates/  -> WorkflowTemplateViewSet
  /api/v1/workflows/           -> ApprovalWorkflowViewSet
  /api/v1/nodes/               -> ApprovalNodeViewSet
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from apps.souls.models import Soul
from apps.tenants.managers import clear_current_tenant
from apps.tenants.models import Tenant

User = get_user_model()
TEMPLATES = "/api/v1/workflow/templates"
WORKFLOWS = "/api/v1/workflows"
NODES = "/api/v1/nodes"


def _jwt_client(user, tenant):
    """Return APIClient authenticated via JWT with tenant_code claim."""
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture(autouse=True)
def _clean_ctx():
    """Reset TenantManager context variable before each test."""
    clear_current_tenant()
    yield
    clear_current_tenant()


# -- WorkflowTemplate CRUD ---------------------------------------------------
@pytest.mark.django_db
class TestWorkflowTemplateCRUD:
    """WorkflowTemplate list, create, retrieve, update, delete."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        clear_current_tenant()
        self.tenant = Tenant.objects.get_or_create(
            code="WT_T1", defaults={"display_name": "WF Template Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="wtuser1", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_list_empty(self):
        resp = self.client.get(f"{TEMPLATES}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_create_template(self):
        resp = self.client.post(
            f"{TEMPLATES}/",
            {"name": "test template", "civilization": "CHINESE", "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["name"] == "test template"

    def test_retrieve_template(self):
        # Create via API so the tenant is properly set by TenantCreateMixin
        resp = self.client.post(
            f"{TEMPLATES}/",
            {"name": "retrieve me", "civilization": "EGYPTIAN", "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        pk = resp.data["id"]
        resp = self.client.get(f"{TEMPLATES}/{pk}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["name"] == "retrieve me"

    def test_update_template(self):
        resp = self.client.post(
            f"{TEMPLATES}/",
            {"name": "Old", "civilization": "CHINESE", "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        pk = resp.data["id"]
        resp = self.client.patch(
            f"{TEMPLATES}/{pk}/", {"name": "New"}, format="json"
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["name"] == "New"

    def test_delete_template(self):
        resp = self.client.post(
            f"{TEMPLATES}/",
            {"name": "Del", "civilization": "EUROPEAN", "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        pk = resp.data["id"]
        resp = self.client.delete(f"{TEMPLATES}/{pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT

    def test_retrieve_nonexistent(self):
        resp = self.client.get(f"{TEMPLATES}/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_create_template_sets_tenant(self):
        resp = self.client.post(
            f"{TEMPLATES}/",
            {"name": "Tenant Check", "civilization": "CHINESE"}, format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        # Verify tenant was set on the created object
        assert resp.data["tenant"] == self.tenant.pk


# -- ApprovalWorkflow CRUD ---------------------------------------------------
@pytest.mark.django_db
class TestApprovalWorkflowCRUD:
    """ApprovalWorkflow list, create, retrieve, update, delete."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        clear_current_tenant()
        self.tenant = Tenant.objects.get_or_create(
            code="AW_T1", defaults={"display_name": "AW Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="awuser1", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(name="Test Soul", tenant=self.tenant)
        self.client = _jwt_client(self.user, self.tenant)

    def test_list_empty(self):
        resp = self.client.get(f"{WORKFLOWS}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_create_workflow(self):
        resp = self.client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "New WF", "soul": str(self.soul.pk), "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["workflow_name"] == "New WF"

    def test_retrieve_workflow(self):
        resp = self.client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "Retrieve WF", "soul": str(self.soul.pk), "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        pk = resp.data["id"]
        resp = self.client.get(f"{WORKFLOWS}/{pk}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_update_workflow(self):
        resp = self.client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "Update WF", "soul": str(self.soul.pk), "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        pk = resp.data["id"]
        resp = self.client.patch(
            f"{WORKFLOWS}/{pk}/", {"notes": "updated"}, format="json"
        )
        assert resp.status_code == status.HTTP_200_OK

    def test_delete_workflow(self):
        resp = self.client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "Delete WF", "soul": str(self.soul.pk), "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        pk = resp.data["id"]
        resp = self.client.delete(f"{WORKFLOWS}/{pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT

    def test_retrieve_nonexistent(self):
        resp = self.client.get(f"{WORKFLOWS}/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_tenant_isolation(self):
        """Non-ADMIN user can only see their own tenant's workflows."""
        other_tenant = Tenant.objects.get_or_create(
            code="AW_T2", defaults={"display_name": "Other"}
        )[0]
        other_soul = Soul.objects.create(name="Other Soul", tenant=other_tenant)
        other_user = User.objects.create_user(
            username="awother", password="test123", role="ADMIN", tenant=other_tenant,
        )
        other_client = _jwt_client(other_user, other_tenant)
        other_client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "Other WF", "soul": str(other_soul.pk), "case_type": "ROUTINE"},
            format="json",
        )
        # Use a non-ADMIN user from our tenant to verify isolation. JUDGE, not
        # VIEWER: this test is about the tenant filter, and any role that
        # skips ADMIN's bypass proves it equally — but since
        # CodenamePermission started enforcing workflow.read, VIEWER (which
        # holds no workflow.* codename at all) is refused the list outright and
        # the isolation assertion below never runs. JUDGE holds workflow.read,
        # is equally non-ADMIN, and so still goes through get_queryset's tenant
        # filter. Nothing was granted to make this pass.
        judge = User.objects.create_user(
            username="awjudge", password="test123", role="JUDGE", tenant=self.tenant,
        )
        judge_client = _jwt_client(judge, self.tenant)
        resp = judge_client.get(f"{WORKFLOWS}/")
        # Asserted explicitly. Without it a 403 walks into `results["count"]`
        # and surfaces as a KeyError, which is how this failure first read.
        assert resp.status_code == status.HTTP_200_OK
        results = resp.data.get("results", resp.data)
        if isinstance(results, list):
            assert all(r.get("tenant") == self.tenant.pk or r.get("tenant", {}).get("id") == self.tenant.pk for r in results)
        else:
            assert results["count"] >= 0  # viewer sees only their tenant's


# -- Workflow advance action --------------------------------------------------
@pytest.mark.django_db
class TestWorkflowAdvance:
    """ApprovalWorkflow.advance action."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        clear_current_tenant()
        self.tenant = Tenant.objects.get_or_create(
            code="WA_T1", defaults={"display_name": "Advance Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="wauser1", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(name="Adv Soul", tenant=self.tenant)
        self.client = _jwt_client(self.user, self.tenant)

    def test_advance_to_next_node(self):
        resp = self.client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "Adv WF", "soul": str(self.soul.pk), "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        wf_pk = resp.data["id"]
        # Create nodes via API (ApprovalNodeViewSet)
        self.client.post(
            f"{NODES}/",
            {"workflow": wf_pk, "node_name": "Node1", "node_order": 1, "status": "APPROVED"},
            format="json",
        )
        self.client.post(
            f"{NODES}/",
            {"workflow": wf_pk, "node_name": "Node2", "node_order": 2},
            format="json",
        )
        resp = self.client.post(f"{WORKFLOWS}/{wf_pk}/advance/")
        assert resp.status_code == status.HTTP_200_OK

    def test_advance_no_next_returns_400(self):
        resp = self.client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "Done WF", "soul": str(self.soul.pk), "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        wf_pk = resp.data["id"]
        # Create a single completed node
        self.client.post(
            f"{NODES}/",
            {"workflow": wf_pk, "node_name": "Node1", "node_order": 1, "status": "APPROVED"},
            format="json",
        )
        resp = self.client.post(f"{WORKFLOWS}/{wf_pk}/advance/")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST


# -- Workflow approve_node action ---------------------------------------------
@pytest.mark.django_db
class TestWorkflowApproveNode:
    """ApprovalWorkflow.approve_node action."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        clear_current_tenant()
        self.tenant = Tenant.objects.get_or_create(
            code="AN_T1", defaults={"display_name": "Approve Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="anuser1", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(name="Appr Soul", tenant=self.tenant)
        self.client = _jwt_client(self.user, self.tenant)

    def _create_workflow_with_nodes(self, node_statuses=None):
        """Create a workflow via API and add nodes via API."""
        resp = self.client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "Appr WF", "soul": str(self.soul.pk), "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        wf_pk = resp.data["id"]
        if node_statuses is None:
            node_statuses = [("N1", 1)]
        node_pks = []
        for name, order, *rest in node_statuses:
            status_val = rest[0] if rest else None
            data = {"workflow": wf_pk, "node_name": name, "node_order": order}
            if status_val:
                data["status"] = status_val
            resp = self.client.post(f"{NODES}/", data, format="json")
            assert resp.status_code == status.HTTP_201_CREATED
            node_pks.append(resp.data["id"])
        return wf_pk, node_pks

    def test_approve_pending_node(self):
        wf_pk, node_pks = self._create_workflow_with_nodes(
            [("N1", 1)]
        )
        resp = self.client.post(
            f"{WORKFLOWS}/{wf_pk}/approve_node/",
            {"verdict": "PASSED", "notes": "Good soul"},
            format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        # Verify node status changed
        node_resp = self.client.get(f"{NODES}/{node_pks[0]}/")
        assert node_resp.data["status"] == "APPROVED"
        assert node_resp.data["verdict"] == "PASSED"

    def test_approve_no_pending_node_returns_404(self):
        """When all nodes are already processed, approve_node returns 404 (no node found)."""
        wf_pk, node_pks = self._create_workflow_with_nodes(
            [("N2", 1, "APPROVED")]
        )
        resp = self.client.post(
            f"{WORKFLOWS}/{wf_pk}/approve_node/",
            {"verdict": "PASSED"}, format="json",
        )
        # No PENDING nodes and no current_node set → get_current_node() returns None → 404
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_approve_nonexistent_node_returns_404(self):
        wf_pk, _ = self._create_workflow_with_nodes()
        resp = self.client.post(
            f"{WORKFLOWS}/{wf_pk}/approve_node/",
            {"verdict": "PASSED", "node_id": str(uuid.uuid4())},
            format="json",
        )
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_approve_rejects_node(self):
        wf_pk, node_pks = self._create_workflow_with_nodes(
            [("N3", 1)]
        )
        resp = self.client.post(
            f"{WORKFLOWS}/{wf_pk}/approve_node/",
            {"verdict": "REJECTED", "notes": "Bad karma"},
            format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        node_resp = self.client.get(f"{NODES}/{node_pks[0]}/")
        assert node_resp.data["status"] == "REJECTED"

    def test_approve_missing_verdict_returns_400(self):
        wf_pk, node_pks = self._create_workflow_with_nodes(
            [("N4", 1)]
        )
        resp = self.client.post(
            f"{WORKFLOWS}/{wf_pk}/approve_node/",
            {"notes": "no verdict"}, format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST


# -- Approver identity enforcement --------------------------------------------
@pytest.mark.django_db
class TestApproveNodeApproverIdentity:
    """`approve_node` must refuse a user who is not the node's designated approver.

    `ApprovalNode.can_approve` existed but (a) its ACTOR branch was
    `return True  # TODO: check user.actor == approver_actor` and (b) nothing
    ever called it — `approve_node` went straight to `complete_node`. So a node
    that named 阎罗王 as its approver could be decided by anyone holding
    `workflow.approve`, and the decision was recorded under *their* name.

    Both halves are asserted here: the identity comparison itself, and that the
    view actually consults it. A guard that is correct but uncalled is the
    failure mode this repo keeps hitting, so the API-level tests are the point —
    the `can_approve` unit tests below only pin the semantics.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        clear_current_tenant()
        self.tenant = Tenant.objects.get_or_create(
            code="AI_T1", defaults={"display_name": "Approver Identity Tenant"}
        )[0]
        self.soul = Soul.objects.create(name="Identity Soul", tenant=self.tenant)

        from apps.actors.models import Actor

        self.actor_designated = Actor.objects.create(
            name="阎罗王 (designated)",
            civilization="CHINESE",
            role="JUDGE",
            tenant=self.tenant,
        )
        self.actor_other = Actor.objects.create(
            name="秦广王 (other)",
            civilization="CHINESE",
            role="JUDGE",
            tenant=self.tenant,
        )

        # Every user below is ADMIN on purpose: ADMIN is this codebase's
        # tenant-exempt role (apps/core/tenant.py) and holds `workflow.approve`,
        # so if the guard still refuses them, it is refusing on approver
        # identity and not incidentally on some other permission.
        self.user_designated = User.objects.create_user(
            username="ai_designated", password="test123", role="ADMIN",
            tenant=self.tenant, actor=self.actor_designated,
        )
        self.user_impostor = User.objects.create_user(
            username="ai_impostor", password="test123", role="ADMIN",
            tenant=self.tenant, actor=self.actor_other,
        )
        self.user_no_actor = User.objects.create_user(
            username="ai_no_actor", password="test123", role="ADMIN",
            tenant=self.tenant, actor=None,
        )

    def _make_node(self, client, *, approver_type="ACTOR", approver_actor=None,
                   approver_role=""):
        """Create a workflow + one PENDING node through the API."""
        resp = client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "Identity WF", "soul": str(self.soul.pk),
             "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        wf_pk = resp.data["id"]

        payload = {
            "workflow": wf_pk,
            "node_name": "身份校验节点",
            "node_order": 1,
            "approver_type": approver_type,
            "approver_role": approver_role,
        }
        if approver_actor is not None:
            payload["approver_actor"] = str(approver_actor.pk)
        resp = client.post(f"{NODES}/", payload, format="json")
        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        return wf_pk, resp.data["id"]

    def _approve(self, client, wf_pk, node_pk, verdict="PASSED"):
        return client.post(
            f"{WORKFLOWS}/{wf_pk}/approve_node/",
            {"verdict": verdict, "node_id": str(node_pk)},
            format="json",
        )

    # -- the core assertion: a non-designated user is refused -----------------
    def test_non_designated_actor_is_denied(self):
        """THE regression test. Before the fix this returned 200 and the node
        was APPROVED under the impostor's name."""
        setup_client = _jwt_client(self.user_designated, self.tenant)
        wf_pk, node_pk = self._make_node(
            setup_client, approver_actor=self.actor_designated
        )

        impostor = _jwt_client(self.user_impostor, self.tenant)
        resp = self._approve(impostor, wf_pk, node_pk)

        assert resp.status_code == status.HTTP_403_FORBIDDEN, (
            f"non-designated approver was allowed to approve: {resp.status_code} {resp.data}"
        )

        # And the node must be untouched — not merely the response code.
        from apps.workflow.models import ApprovalNode, NodeStatus

        node = ApprovalNode.objects.get(pk=node_pk)
        assert node.status == NodeStatus.PENDING
        assert node.verdict == ""
        assert node.approver_id is None

    def test_designated_actor_can_approve(self):
        """The guard must not break the legitimate path."""
        client = _jwt_client(self.user_designated, self.tenant)
        wf_pk, node_pk = self._make_node(
            client, approver_actor=self.actor_designated
        )

        resp = self._approve(client, wf_pk, node_pk)
        assert resp.status_code == status.HTTP_200_OK, resp.data

        from apps.workflow.models import ApprovalNode, NodeStatus

        node = ApprovalNode.objects.get(pk=node_pk)
        assert node.status == NodeStatus.APPROVED
        assert node.approver_id == self.user_designated.pk

    def test_user_without_actor_is_denied(self):
        """No actor on the user means no identity to match — deny, never fall
        through to 'allow because we cannot tell'."""
        setup_client = _jwt_client(self.user_designated, self.tenant)
        wf_pk, node_pk = self._make_node(
            setup_client, approver_actor=self.actor_designated
        )

        client = _jwt_client(self.user_no_actor, self.tenant)
        resp = self._approve(client, wf_pk, node_pk)
        assert resp.status_code == status.HTTP_403_FORBIDDEN, resp.data

        from apps.workflow.models import ApprovalNode, NodeStatus

        assert ApprovalNode.objects.get(pk=node_pk).status == NodeStatus.PENDING

    def test_actor_node_without_designated_actor_keeps_codename_gate(self):
        """`approver_type=ACTOR` with `approver_actor=NULL` designates nobody.

        This is the *model default* for a node created through the API, and it
        is what every pre-existing node fixture in this file uses. There is no
        identity to compare, so the node stays governed by the `workflow.approve`
        codename permission exactly as before — the identity guard only engages
        where an approver was actually named. `can_approve` still reports False
        here (see the unit test below); the view does not treat that as a veto
        for an unconfigured node.
        """
        client = _jwt_client(self.user_no_actor, self.tenant)
        wf_pk, node_pk = self._make_node(client, approver_actor=None)

        resp = self._approve(client, wf_pk, node_pk)
        assert resp.status_code == status.HTTP_200_OK, resp.data

    def test_role_node_requires_matching_role(self):
        """The ROLE branch is enforced through the same call site."""
        setup_client = _jwt_client(self.user_designated, self.tenant)
        wf_pk, node_pk = self._make_node(
            setup_client, approver_type="ROLE", approver_role="JUDGE"
        )

        # ADMIN != JUDGE, and ADMIN is deliberately not exempt here.
        resp = self._approve(setup_client, wf_pk, node_pk)
        assert resp.status_code == status.HTTP_403_FORBIDDEN, resp.data

    def test_system_node_still_approvable(self):
        """SYSTEM nodes are what `WorkflowService` actually creates, and every
        in-flight workflow in the live data sits on one. They designate no
        approver, so they keep the codename gate — tightening this would freeze
        those workflows and is a separate product decision."""
        client = _jwt_client(self.user_no_actor, self.tenant)
        wf_pk, node_pk = self._make_node(client, approver_type="SYSTEM")

        resp = self._approve(client, wf_pk, node_pk)
        assert resp.status_code == status.HTTP_200_OK, resp.data


@pytest.mark.django_db
class TestCanApproveUnit:
    """`ApprovalNode.can_approve` semantics, asserted directly."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        clear_current_tenant()
        from apps.actors.models import Actor
        from apps.workflow.models import ApprovalNode, ApprovalWorkflow

        self.tenant = Tenant.objects.get_or_create(
            code="CA_T1", defaults={"display_name": "can_approve Tenant"}
        )[0]
        soul = Soul.objects.create(name="CA Soul", tenant=self.tenant)
        self.workflow = ApprovalWorkflow.objects.create(
            workflow_name="CA WF", soul=soul, tenant=self.tenant
        )
        self.actor_a = Actor.objects.create(
            name="Actor A", civilization="CHINESE", role="JUDGE", tenant=self.tenant
        )
        self.actor_b = Actor.objects.create(
            name="Actor B", civilization="CHINESE", role="JUDGE", tenant=self.tenant
        )
        self.node_model = ApprovalNode

    def _node(self, **kwargs):
        defaults = {
            "workflow": self.workflow,
            "node_name": "n",
            "node_order": 1,
            "approver_type": "ACTOR",
        }
        defaults.update(kwargs)
        return self.node_model.objects.create(**defaults)

    def _user(self, username, actor=None, role="JUDGE"):
        return User.objects.create_user(
            username=username, password="x", role=role,
            tenant=self.tenant, actor=actor,
        )

    def test_matching_actor_is_true(self):
        node = self._node(approver_actor=self.actor_a)
        assert node.can_approve(self._user("ca_match", actor=self.actor_a)) is True

    def test_different_actor_is_false(self):
        node = self._node(approver_actor=self.actor_a)
        assert node.can_approve(self._user("ca_diff", actor=self.actor_b)) is False

    def test_user_without_actor_is_false(self):
        node = self._node(approver_actor=self.actor_a)
        assert node.can_approve(self._user("ca_noactor", actor=None)) is False

    def test_admin_without_matching_actor_is_false(self):
        """ADMIN is tenant-exempt for *visibility*; approving as someone else is
        an authorization decision, and the audited `escalate` action is the
        sanctioned way for an admin to move a stuck flow."""
        node = self._node(approver_actor=self.actor_a)
        admin = self._user("ca_admin", actor=None, role="ADMIN")
        assert node.can_approve(admin) is False

    def test_null_approver_actor_is_false(self):
        """No designated approver → nobody satisfies the identity test. This is
        the pre-existing behaviour of this method and is preserved."""
        node = self._node(approver_actor=None)
        assert node.can_approve(self._user("ca_null", actor=self.actor_a)) is False

    def test_system_node_is_false(self):
        node = self._node(approver_type="SYSTEM")
        assert node.can_approve(self._user("ca_sys", actor=self.actor_a)) is False

    def test_non_pending_node_is_false(self):
        from apps.workflow.models import NodeStatus

        node = self._node(approver_actor=self.actor_a, status=NodeStatus.APPROVED)
        assert node.can_approve(self._user("ca_done", actor=self.actor_a)) is False

    def test_anonymous_user_is_false(self):
        from django.contrib.auth.models import AnonymousUser

        node = self._node(approver_actor=self.actor_a)
        assert node.can_approve(AnonymousUser()) is False


# -- Workflow stats action ----------------------------------------------------
@pytest.mark.django_db
class TestWorkflowStats:
    """ApprovalWorkflow.stats action."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        clear_current_tenant()
        self.tenant = Tenant.objects.get_or_create(
            code="WS_T1", defaults={"display_name": "Stats Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="wsuser1", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(name="Stats Soul", tenant=self.tenant)
        self.client = _jwt_client(self.user, self.tenant)

    def test_stats_returns_data(self):
        resp = self.client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "Stats WF", "soul": str(self.soul.pk), "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        wf_pk = resp.data["id"]
        self.client.post(
            f"{NODES}/",
            {"workflow": wf_pk, "node_name": "N1", "node_order": 1, "status": "APPROVED"},
            format="json",
        )
        self.client.post(
            f"{NODES}/",
            {"workflow": wf_pk, "node_name": "N2", "node_order": 2},
            format="json",
        )
        resp = self.client.get(f"{WORKFLOWS}/{wf_pk}/stats/")
        assert resp.status_code == status.HTTP_200_OK
        assert "total_nodes" in resp.data

    def test_stats_nonexistent_returns_404(self):
        resp = self.client.get(f"{WORKFLOWS}/{uuid.uuid4()}/stats/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


# -- ApprovalNode CRUD --------------------------------------------------------
@pytest.mark.django_db
class TestApprovalNodeCRUD:
    """ApprovalNode list, create, retrieve, update, delete."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        clear_current_tenant()
        self.tenant = Tenant.objects.get_or_create(
            code="AN2_T1", defaults={"display_name": "Node Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="an2user1", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(name="Node Soul", tenant=self.tenant)
        self.client = _jwt_client(self.user, self.tenant)
        # Create workflow via API
        resp = self.client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "Node WF", "soul": str(self.soul.pk), "case_type": "ROUTINE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        self.wf_pk = resp.data["id"]

    def test_list_nodes(self):
        self.client.post(
            f"{NODES}/",
            {"workflow": self.wf_pk, "node_name": "N1", "node_order": 1},
            format="json",
        )
        resp = self.client.get(f"{NODES}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_create_node(self):
        resp = self.client.post(
            f"{NODES}/",
            {"workflow": self.wf_pk, "node_name": "New", "node_order": 1},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["node_name"] == "New"

    def test_retrieve_node(self):
        resp = self.client.post(
            f"{NODES}/",
            {"workflow": self.wf_pk, "node_name": "R1", "node_order": 1},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        pk = resp.data["id"]
        resp = self.client.get(f"{NODES}/{pk}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_update_node(self):
        resp = self.client.post(
            f"{NODES}/",
            {"workflow": self.wf_pk, "node_name": "Old", "node_order": 1},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        pk = resp.data["id"]
        resp = self.client.patch(
            f"{NODES}/{pk}/", {"notes": "updated"}, format="json"
        )
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["notes"] == "updated"

    def test_delete_node(self):
        resp = self.client.post(
            f"{NODES}/",
            {"workflow": self.wf_pk, "node_name": "Del", "node_order": 1},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        pk = resp.data["id"]
        resp = self.client.delete(f"{NODES}/{pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT

    def test_retrieve_nonexistent(self):
        resp = self.client.get(f"{NODES}/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_tenant_isolation(self):
        """Non-ADMIN user only sees nodes from their own tenant's workflows."""
        other_tenant = Tenant.objects.get_or_create(
            code="AN2_T2", defaults={"display_name": "Other"}
        )[0]
        other_soul = Soul.objects.create(name="Other Soul", tenant=other_tenant)
        other_user = User.objects.create_user(
            username="an2other", password="test123", role="ADMIN", tenant=other_tenant,
        )
        other_client = _jwt_client(other_user, other_tenant)
        other_wf_resp = other_client.post(
            f"{WORKFLOWS}/",
            {"workflow_name": "Other WF", "soul": str(other_soul.pk), "case_type": "ROUTINE"},
            format="json",
        )
        other_client.post(
            f"{NODES}/",
            {"workflow": other_wf_resp.data["id"], "node_name": "Foreign", "node_order": 1},
            format="json",
        )
        # Use a non-ADMIN user to verify tenant isolation (ADMIN bypasses).
        # JUDGE rather than VIEWER for the reason given in
        # TestApprovalWorkflowCRUD.test_tenant_isolation: VIEWER holds no
        # workflow.* codename, so since CodenamePermission was attached to
        # ApprovalNodeViewSet it cannot read this list at all and the isolation
        # assertion below is unreachable. JUDGE holds workflow.read and is
        # still subject to the tenant filter, which is what is under test.
        judge = User.objects.create_user(
            username="an2judge", password="test123", role="JUDGE", tenant=self.tenant,
        )
        judge_client = _jwt_client(judge, self.tenant)
        resp = judge_client.get(f"{NODES}/")
        assert resp.status_code == status.HTTP_200_OK
        results = resp.data.get("results", resp.data)
        if isinstance(results, list):
            # All returned nodes should belong to workflows in our tenant
            assert len(results) == 0  # No nodes in our tenant's workflows yet
        else:
            assert results["count"] == 0


# -- Unauthenticated access ---------------------------------------------------
@pytest.mark.django_db
class TestUnauthenticatedAccess:
    """All workflow endpoints require JWT auth."""

    def test_list_templates_no_auth(self):
        client = APIClient()
        resp = client.get(f"{TEMPLATES}/")
        assert resp.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    def test_list_workflows_no_auth(self):
        client = APIClient()
        resp = client.get(f"{WORKFLOWS}/")
        assert resp.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    def test_list_nodes_no_auth(self):
        client = APIClient()
        resp = client.get(f"{NODES}/")
        assert resp.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)


# -- WorkflowService.create_from_judgment tenant scoping ---------------------
@pytest.mark.django_db
class TestCreateFromJudgmentTemplateTenantScoping:
    """
    M15/A2 regression coverage: the DB template lookup inside
    `WorkflowService.create_from_judgment` used to filter only by
    `civilization` and `case_type`, with no `tenant` filter — so a judgment
    in one tenant could pick up an active template that actually belonged to
    a different tenant. `WorkflowTemplate` is genuinely per-tenant (its own
    ViewSet enforces DataScope + tenant on every other path, and it used to
    carry a tenant+name uniqueness constraint), unlike shared/global
    resources such as Menu or the RBAC Permission/Role tables, so this is a
    real gap, not a "shared by design" case.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        clear_current_tenant()
        from apps.workflow.models import CaseType

        self.case_type = CaseType.ROUTINE
        self.tenant_a = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Chinese Diyu"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="WF_TENANT_B", defaults={"display_name": "Other Tenant"}
        )[0]
        self.soul = Soul.objects.create(name="Judged Soul", tenant=self.tenant_a)

    def _judgment(self, tenant, soul):
        from apps.judgment.models import Judgment
        from apps.souls.models import Civilization

        return Judgment.objects.create(
            soul=soul,
            civilization=Civilization.CHINESE,
            court="第一殿",
            verdict="PASSED",
            is_final=True,
            tenant=tenant,
        )

    def test_own_tenant_template_is_used(self):
        """Normal case: a template that belongs to the judgment's own tenant
        is picked up, exactly as before this fix."""
        from apps.souls.models import Civilization
        from apps.workflow.models import WorkflowTemplate
        from apps.workflow.services import WorkflowService

        WorkflowTemplate.objects.create(
            name="本租户模板",
            civilization=Civilization.CHINESE,
            case_type=self.case_type,
            is_active=True,
            nodes_json=[
                {"name": "唯一节点", "court": "本殿", "type": "TRIAL", "order": 1},
            ],
            tenant=self.tenant_a,
        )
        judgment = self._judgment(self.tenant_a, self.soul)
        workflow = WorkflowService.create_from_judgment(judgment)
        assert workflow.workflow_name == "本租户模板"
        assert workflow.tenant_id == self.tenant_a.id

    def test_other_tenant_template_is_not_picked_up(self):
        """The regression: a template belonging to tenant B for the same
        (civilization, case_type) pair must not leak into tenant A's
        workflow creation. Tenant A has no template of its own, so it must
        fall through to the hardcoded WORKFLOW_TEMPLATES default instead of
        silently adopting tenant B's."""
        from apps.souls.models import Civilization
        from apps.workflow.models import WorkflowTemplate
        from apps.workflow.services import WORKFLOW_TEMPLATES, WorkflowService

        WorkflowTemplate.objects.create(
            name="租户B的模板",
            civilization=Civilization.CHINESE,
            case_type=self.case_type,
            is_active=True,
            nodes_json=[
                {"name": "外部节点", "court": "外殿", "type": "TRIAL", "order": 1},
            ],
            tenant=self.tenant_b,
        )
        judgment = self._judgment(self.tenant_a, self.soul)
        workflow = WorkflowService.create_from_judgment(judgment)

        expected_default_name = WORKFLOW_TEMPLATES[(Civilization.CHINESE, self.case_type)]["name"]
        assert workflow.workflow_name != "租户B的模板"
        assert workflow.workflow_name == expected_default_name
        assert workflow.tenant_id == self.tenant_a.id
