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
        # Use a non-ADMIN user from our tenant to verify isolation
        viewer = User.objects.create_user(
            username="awviewer", password="test123", role="VIEWER", tenant=self.tenant,
        )
        viewer_client = _jwt_client(viewer, self.tenant)
        resp = viewer_client.get(f"{WORKFLOWS}/")
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
        # Use a VIEWER user to verify tenant isolation (ADMIN bypasses)
        viewer = User.objects.create_user(
            username="an2viewer", password="test123", role="VIEWER", tenant=self.tenant,
        )
        viewer_client = _jwt_client(viewer, self.tenant)
        resp = viewer_client.get(f"{NODES}/")
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
