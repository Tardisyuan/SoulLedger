"""
Tests for WorkflowTemplate API endpoints.
"""
import pytest
from rest_framework.test import APIClient

from apps.workflow.models import WorkflowTemplate


@pytest.mark.django_db
class TestWorkflowTemplateAPI:
    """Test workflow template CRUD endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, api_client, admin_user, cn_tenant):
        self.client = api_client
        self.admin_user = admin_user
        self.cn_tenant = cn_tenant
        self.client.force_authenticate(user=admin_user)

    def test_list_templates_empty(self):
        """GET /api/v1/workflow/templates/ returns empty list when no templates."""
        response = self.client.get("/api/v1/workflow/templates/")
        assert response.status_code == 200
        assert response.data == []

    def test_create_template(self):
        """POST /api/v1/workflow/templates/ creates a new template."""
        data = {
            "name": "十殿审判流程",
            "description": "完整十殿审判流程",
            "civilization": "CHINESE",
            "case_type": "ROUTINE",
            "nodes": [
                {
                    "node_name": "秦广王 · 分流",
                    "node_type": "TRIAL",
                    "court_code": "第一殿",
                    "approver_role": "JUDGE",
                    "approver_type": "ROLE",
                    "node_order": 1,
                },
                {
                    "node_name": "楚江王 · 初审",
                    "node_type": "TRIAL",
                    "court_code": "第二殿",
                    "approver_role": "JUDGE",
                    "approver_type": "ROLE",
                    "node_order": 2,
                },
            ],
        }
        response = self.client.post(
            "/api/v1/workflow/templates/",
            data,
            format="json"
        )
        assert response.status_code == 201
        assert response.data["name"] == "十殿审判流程"
        assert response.data["civilization"] == "CHINESE"
        assert response.data["case_type"] == "ROUTINE"
        assert len(response.data["nodes"]) == 2
        assert "id" in response.data

    def test_get_template(self, cn_tenant):
        """GET /api/v1/workflow/templates/{id}/ returns template details."""
        template = WorkflowTemplate.objects.create(
            name="测试模板",
            civilization="CHINESE",
            case_type="ROUTINE",
            tenant=cn_tenant,
            nodes_json=[
                {"node_name": "节点1", "node_type": "TRIAL", "court_code": "第一殿", "node_order": 1}
            ],
        )
        response = self.client.get(f"/api/v1/workflow/templates/{template.id}/")
        assert response.status_code == 200
        assert response.data["name"] == "测试模板"
        assert len(response.data["nodes"]) == 1

    def test_update_template(self, cn_tenant):
        """PATCH /api/v1/workflow/templates/{id}/ updates the template."""
        template = WorkflowTemplate.objects.create(
            name="原始模板",
            civilization="CHINESE",
            case_type="ROUTINE",
            tenant=cn_tenant,
            nodes_json=[
                {"node_name": "节点1", "node_type": "TRIAL", "court_code": "第一殿", "node_order": 1}
            ],
        )
        data = {
            "name": "更新后模板",
            "nodes": [
                {"node_name": "新节点1", "node_type": "TRIAL", "court_code": "第一殿", "node_order": 1},
                {"node_name": "新节点2", "node_type": "FINAL", "court_code": "第二殿", "node_order": 2},
            ],
        }
        response = self.client.patch(
            f"/api/v1/workflow/templates/{template.id}/",
            data,
            format="json"
        )
        assert response.status_code == 200
        assert response.data["name"] == "更新后模板"
        assert len(response.data["nodes"]) == 2

    def test_delete_template(self, cn_tenant):
        """DELETE /api/v1/workflow/templates/{id}/ soft-deletes the template."""
        template = WorkflowTemplate.objects.create(
            name="待删除模板",
            civilization="CHINESE",
            case_type="ROUTINE",
            tenant=cn_tenant,
        )
        response = self.client.delete(f"/api/v1/workflow/templates/{template.id}/")
        assert response.status_code == 204
        # Soft delete: object still exists but is marked as deleted
        template.refresh_from_db()
        assert template.is_deleted is True

    def test_list_templates_admin_sees_all(self, cn_tenant, eu_tenant):
        """ADMIN users can see templates from all tenants."""
        # Create templates for both tenants
        WorkflowTemplate.objects.create(
            name="中国模板",
            civilization="CHINESE",
            case_type="ROUTINE",
            tenant=cn_tenant,
        )
        WorkflowTemplate.objects.create(
            name="欧洲模板",
            civilization="EUROPEAN",
            case_type="ROUTINE",
            tenant=eu_tenant,
        )

        # Admin should see all templates (bypasses tenant filtering)
        response = self.client.get("/api/v1/workflow/templates/")
        assert response.status_code == 200
        assert len(response.data) == 2

    def test_list_templates_non_admin_no_access(self, cn_tenant, eu_tenant, api_client):
        """JUDGE role does not have permission to access workflow templates."""
        from django.contrib.auth import get_user_model
        User = get_user_model()

        # Create a non-admin user for eu_tenant
        eu_user = User.objects.create_user(
            username="eu_judge",
            password="pass123",
            role="JUDGE",
            tenant=eu_tenant,
        )

        # Create templates for both tenants
        WorkflowTemplate.objects.create(
            name="中国模板",
            civilization="CHINESE",
            case_type="ROUTINE",
            tenant=cn_tenant,
        )
        WorkflowTemplate.objects.create(
            name="欧洲模板",
            civilization="EUROPEAN",
            case_type="ROUTINE",
            tenant=eu_tenant,
        )

        # Create a new client for EU user (don't use self.client which is admin)
        eu_client = api_client.__class__()
        eu_client.force_authenticate(user=eu_user)
        response = eu_client.get("/api/v1/workflow/templates/")
        # JUDGE role doesn't have permission to access templates - returns 403
        assert response.status_code == 403

    def test_create_template_requires_auth(self):
        """Unauthenticated POST returns 401."""
        # Create a fresh unauthenticated client
        unauth_client = APIClient()
        data = {"name": "测试模板", "civilization": "CHINESE", "case_type": "ROUTINE"}
        response = unauth_client.post(
            "/api/v1/workflow/templates/",
            data,
            format="json"
        )
        assert response.status_code == 401

    def test_template_node_validation(self):
        """Template nodes are validated on create."""
        data = {
            "name": "测试模板",
            "civilization": "CHINESE",
            "case_type": "ROUTINE",
            "nodes": [
                {
                    "node_name": "测试节点",
                    "node_type": "INVALID_TYPE",  # Invalid node type
                    "node_order": 1,
                },
            ],
        }
        response = self.client.post(
            "/api/v1/workflow/templates/",
            data,
            format="json"
        )
        assert response.status_code == 400

    def test_workflow_templates_all_civilizations(self, cn_tenant):
        """Templates can be created for different civilizations."""
        templates_data = [
            {"civilization": "CHINESE", "case_type": "ROUTINE"},
            {"civilization": "EUROPEAN", "case_type": "CANONIZATION"},
            {"civilization": "EGYPTIAN", "case_type": "HEART_WEIGHING"},
        ]
        for tmpl_data in templates_data:
            response = self.client.post(
                "/api/v1/workflow/templates/",
                {
                    "name": f"{tmpl_data['civilization']} - {tmpl_data['case_type']}",
                    "civilization": tmpl_data["civilization"],
                    "case_type": tmpl_data["case_type"],
                    "nodes": [],
                },
                format="json"
            )
            assert response.status_code == 201
