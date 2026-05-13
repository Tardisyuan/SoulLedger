"""
Tests for karma stats endpoints.
"""
import pytest
from rest_framework.test import APIClient

from apps.souls.models import Soul, SoulState
from apps.audit.models import AuditLog, AuditAction
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestKarmaStatsOverview:
    """Test GET /api/v1/karma/stats/overview/"""

    @pytest.fixture(autouse=True)
    def setup(self, api_client, admin_user, cn_tenant):
        self.client = api_client
        self.admin_user = admin_user
        self.tenant = cn_tenant
        self.client.force_authenticate(user=admin_user)

    def test_overview_requires_admin(self, api_client, judge_user):
        """Non-admin users should get 403."""
        api_client.force_authenticate(user=judge_user)
        response = api_client.get("/api/v1/karma/stats/overview/")
        assert response.status_code == 403

    def test_overview_returns_structure(self):
        """Overview returns expected fields."""
        response = self.client.get("/api/v1/karma/stats/overview/")
        assert response.status_code == 200
        data = response.json()
        assert "total_souls" in data
        assert "state_distribution" in data
        assert "tenants" in data
        assert "karma_distribution" in data
        assert "recent_activity" in data
        assert "souls_by_realm" in data

    def test_overview_includes_recent_activity(self):
        """Overview includes recent audit log entries."""
        # Create an audit log entry
        AuditLog.objects.create(
            user=self.admin_user,
            tenant=self.tenant,
            action=AuditAction.CREATE,
            resource="soul",
            resource_id="test-123",
            description="Test audit entry",
        )
        response = self.client.get("/api/v1/karma/stats/overview/")
        assert response.status_code == 200
        data = response.json()
        assert len(data["recent_activity"]) >= 1
        assert data["recent_activity"][0]["action"] == "CREATE"

    def test_overview_includes_souls_by_realm(self):
        """Overview includes souls grouped by realm disposition."""
        response = self.client.get("/api/v1/karma/stats/overview/")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["souls_by_realm"], list)

    def test_karma_distribution_buckets(self):
        """Karma distribution has correct bucket structure."""
        # Create souls with different karma balances
        Soul.objects.create(
            name="High Karma",
            tenant=self.tenant,
            current_state=SoulState.ALIVE,
            merit_score=100,
            demerit_score=10,
        )
        Soul.objects.create(
            name="Low Karma",
            tenant=self.tenant,
            current_state=SoulState.ALIVE,
            merit_score=5,
            demerit_score=50,
        )
        response = self.client.get("/api/v1/karma/stats/overview/")
        assert response.status_code == 200
        data = response.json()
        karma_dist = data["karma_distribution"]
        assert len(karma_dist) == 7
        assert all("label" in b and "count" in b for b in karma_dist)


@pytest.mark.django_db
class TestKarmaStatsExport:
    """Test GET /api/v1/karma/stats/export/"""

    @pytest.fixture(autouse=True)
    def setup(self, api_client, admin_user, cn_tenant):
        self.client = api_client
        self.admin_user = admin_user
        self.tenant = cn_tenant
        self.client.force_authenticate(user=admin_user)

    def test_export_requires_admin(self, api_client, judge_user):
        """Non-admin users should get 403."""
        api_client.force_authenticate(user=judge_user)
        response = api_client.get("/api/v1/karma/stats/export/")
        assert response.status_code == 403

    def test_export_returns_csv(self):
        """Export returns CSV content type."""
        response = self.client.get("/api/v1/karma/stats/export/")
        assert response.status_code == 200
        assert response["Content-Type"] == "text/csv"
        assert "attachment" in response["Content-Disposition"]

    def test_export_csv_headers(self):
        """CSV has correct headers."""
        response = self.client.get("/api/v1/karma/stats/export/")
        content = response.content.decode("utf-8")
        lines = content.strip().split("\n")
        headers = lines[0]
        assert "Soul ID" in headers
        assert "Name" in headers
        assert "Civilization" in headers
        assert "Karmic Balance" in headers

    def test_export_includes_all_souls(self):
        """CSV includes all souls with their karma data."""
        Soul.objects.create(
            name="Test Soul 1",
            tenant=self.tenant,
            current_state=SoulState.ALIVE,
            merit_score=50,
            demerit_score=10,
        )
        Soul.objects.create(
            name="Test Soul 2",
            tenant=self.tenant,
            current_state=SoulState.JUDGING,
            merit_score=20,
            demerit_score=30,
        )
        response = self.client.get("/api/v1/karma/stats/export/")
        content = response.content.decode("utf-8")
        lines = content.strip().split("\n")
        # Header + 2 souls = 3 lines
        assert len(lines) >= 3
        assert "Test Soul 1" in content
        assert "Test Soul 2" in content