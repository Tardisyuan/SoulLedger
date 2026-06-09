"""
Tests for karma domain API views.
Uses JWT auth with tenant_code so TenantMiddleware sets request.tenant.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/karma"


def _jwt_client(user, tenant):
    """Return APIClient authenticated via JWT with tenant_code claim."""
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
class TestKarmaBalanceView:
    """GET /karma/balance/<soul_id>/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KB_T1", defaults={"display_name": "Karma Balance Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="kb_user", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(
            name="Buddhist Monk",
            current_state=SoulState.JUDGING,
            merit_score=100,
            demerit_score=20,
            tenant=self.tenant,
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_balance_returns_karmic_summary(self):
        resp = self.client.get(f"{BASE}/balance/{self.soul.id}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["soul_id"] == str(self.soul.id)
        assert resp.data["soul_name"] == "Buddhist Monk"
        assert "merit_score" in resp.data
        assert "demerit_score" in resp.data
        assert "karmic_balance" in resp.data

    def test_balance_404_for_nonexistent_soul(self):
        resp = self.client.get(f"{BASE}/balance/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND
        assert resp.data["error"] == "NOT_FOUND"

    def test_balance_tenant_isolation(self):
        """Soul from tenant B should not be accessible by tenant A."""
        tenant_b = Tenant.objects.get_or_create(
            code="KB_T2", defaults={"display_name": "Other Tenant"}
        )[0]
        foreign_soul = Soul.objects.create(
            name="Foreign Soul",
            current_state=SoulState.ALIVE,
            tenant=tenant_b,
        )
        resp = self.client.get(f"{BASE}/balance/{foreign_soul.id}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_balance_no_auth_returns_401(self):
        client = APIClient()
        resp = client.get(f"{BASE}/balance/{self.soul.id}/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
class TestKarmaRecalculateView:
    """POST /karma/calculate/<soul_id>/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KR_T1", defaults={"display_name": "Karma Recalc Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="kr_user", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(
            name="Recalc Soul",
            current_state=SoulState.JUDGING,
            merit_score=50,
            demerit_score=10,
            tenant=self.tenant,
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_recalculate_returns_updated_scores(self):
        resp = self.client.post(f"{BASE}/calculate/{self.soul.id}/", format="json")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["soul_id"] == str(self.soul.id)
        assert "merit_score" in resp.data
        assert "demerit_score" in resp.data
        assert "karmic_balance" in resp.data

    def test_recalculate_404_for_nonexistent_soul(self):
        resp = self.client.post(f"{BASE}/calculate/{uuid.uuid4()}/", format="json")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_recalculate_tenant_isolation(self):
        tenant_b = Tenant.objects.get_or_create(
            code="KR_T2", defaults={"display_name": "Other Tenant"}
        )[0]
        foreign_soul = Soul.objects.create(
            name="Foreign Soul",
            current_state=SoulState.ALIVE,
            tenant=tenant_b,
        )
        resp = self.client.post(f"{BASE}/calculate/{foreign_soul.id}/", format="json")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestKarmaEffectiveView:
    """GET /karma/effective/<soul_id>/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KE_T1", defaults={"display_name": "Karma Effective Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="ke_user", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(
            name="Effective Soul",
            current_state=SoulState.JUDGING,
            merit_score=80,
            demerit_score=30,
            tenant=self.tenant,
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_effective_returns_effective_karma(self):
        resp = self.client.get(f"{BASE}/effective/{self.soul.id}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["soul_id"] == str(self.soul.id)
        assert "effective_merit" in resp.data
        assert "effective_demerit" in resp.data
        assert "effective_balance" in resp.data

    def test_effective_404_for_nonexistent_soul(self):
        resp = self.client.get(f"{BASE}/effective/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestKarmaInheritanceView:
    """GET /karma/inheritance/<soul_id>/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KI_T1", defaults={"display_name": "Karma Inherit Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="ki_user", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(
            name="Inherit Soul",
            current_state=SoulState.REINCARNATING,
            merit_score=60,
            demerit_score=10,
            tenant=self.tenant,
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_inheritance_returns_inherited_karma(self):
        resp = self.client.get(f"{BASE}/inheritance/{self.soul.id}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["soul_id"] == str(self.soul.id)
        assert "inherited_merit" in resp.data
        assert "inherited_demerit" in resp.data
        assert "inheritance_note" in resp.data

    def test_inheritance_404_for_nonexistent_soul(self):
        resp = self.client.get(f"{BASE}/inheritance/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestKarmaOverviewStatsView:
    """GET /karma/stats/overview/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KO_T1", defaults={"display_name": "Karma Stats Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="ko_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.viewer = User.objects.create_user(
            username="ko_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        # Create some souls for stats
        Soul.objects.create(name="S1", current_state=SoulState.ALIVE, merit_score=10, demerit_score=2, tenant=self.tenant)
        Soul.objects.create(name="S2", current_state=SoulState.JUDGING, merit_score=50, demerit_score=5, tenant=self.tenant)
        Soul.objects.create(name="S3", current_state=SoulState.DISPOSED, merit_score=5, demerit_score=80, tenant=self.tenant)
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.viewer_client = _jwt_client(self.viewer, self.tenant)

    def test_admin_can_access_overview(self):
        resp = self.admin_client.get(f"{BASE}/stats/overview/")
        assert resp.status_code == status.HTTP_200_OK
        assert "total_souls" in resp.data
        assert "state_distribution" in resp.data
        assert "tenants" in resp.data
        assert "karma_distribution" in resp.data
        assert "recent_activity" in resp.data
        assert "souls_by_realm" in resp.data

    def test_overview_includes_soul_count(self):
        resp = self.admin_client.get(f"{BASE}/stats/overview/")
        assert resp.data["total_souls"] == 3

    def test_non_admin_gets_403(self):
        resp = self.viewer_client.get(f"{BASE}/stats/overview/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN
        assert resp.data["error"] == "FORBIDDEN"

    def test_overview_tenant_scoping(self):
        """Admin with tenant sees only their tenant's souls."""
        tenant_b = Tenant.objects.get_or_create(
            code="KO_T2", defaults={"display_name": "Other Tenant"}
        )[0]
        Soul.objects.create(name="Foreign", current_state=SoulState.ALIVE, tenant=tenant_b)
        resp = self.admin_client.get(f"{BASE}/stats/overview/")
        # Should see 3 (own tenant), not 4 (total)
        assert resp.data["total_souls"] == 3


@pytest.mark.django_db
class TestKarmaExportStatsView:
    """GET /karma/stats/export/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KX_T1", defaults={"display_name": "Karma Export Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="kx_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.viewer = User.objects.create_user(
            username="kx_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        Soul.objects.create(
            name="Export Soul",
            current_state=SoulState.ALIVE,
            merit_score=15,
            demerit_score=3,
            tenant=self.tenant,
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.viewer_client = _jwt_client(self.viewer, self.tenant)

    def test_admin_can_export_csv(self):
        resp = self.admin_client.get(f"{BASE}/stats/export/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp["Content-Type"] == "text/csv"
        assert "attachment" in resp["Content-Disposition"]
        content = resp.content.decode()
        assert "Soul ID" in content
        assert "Export Soul" in content

    def test_export_contains_csv_header(self):
        resp = self.admin_client.get(f"{BASE}/stats/export/")
        content = resp.content.decode()
        header = content.split("\n")[0]
        assert "Soul ID,Name,Civilization,State" in header

    def test_non_admin_gets_403(self):
        resp = self.viewer_client.get(f"{BASE}/stats/export/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_export_includes_soul_data(self):
        resp = self.admin_client.get(f"{BASE}/stats/export/")
        content = resp.content.decode()
        assert "15" in content  # merit_score
        assert "3" in content   # demerit_score
        assert "Export Soul" in content


@pytest.mark.django_db
class TestKarmaTenantIsolation:
    """Cross-tenant soul visibility across karma endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.get_or_create(
            code="KA_T1", defaults={"display_name": "Tenant A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="KA_T2", defaults={"display_name": "Tenant B"}
        )[0]
        self.user_a = User.objects.create_user(
            username="ka_user_a", password="test123", role="ADMIN", tenant=self.tenant_a
        )
        self.user_b = User.objects.create_user(
            username="ka_user_b", password="test123", role="ADMIN", tenant=self.tenant_b
        )
        self.soul_a = Soul.objects.create(
            name="Soul A",
            current_state=SoulState.ALIVE,
            merit_score=50,
            demerit_score=10,
            tenant=self.tenant_a,
        )
        self.soul_b = Soul.objects.create(
            name="Soul B",
            current_state=SoulState.JUDGING,
            merit_score=30,
            demerit_score=5,
            tenant=self.tenant_b,
        )
        self.client_a = _jwt_client(self.user_a, self.tenant_a)
        self.client_b = _jwt_client(self.user_b, self.tenant_b)

    def test_balance_tenant_isolation(self):
        """Tenant A cannot access Tenant B's soul."""
        resp = self.client_a.get(f"{BASE}/balance/{self.soul_b.id}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_balance_own_tenant_works(self):
        resp = self.client_a.get(f"{BASE}/balance/{self.soul_a.id}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_recalculate_tenant_isolation(self):
        resp = self.client_a.post(f"{BASE}/calculate/{self.soul_b.id}/", format="json")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_effective_tenant_isolation(self):
        resp = self.client_a.get(f"{BASE}/effective/{self.soul_b.id}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_inheritance_tenant_isolation(self):
        resp = self.client_a.get(f"{BASE}/inheritance/{self.soul_b.id}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND
