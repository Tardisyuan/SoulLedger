"""
Tests for Ledger API endpoints.
"""
import pytest


@pytest.mark.django_db
class TestLedgerAPI:
    """Test ledger endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, api_client, admin_user, cn_tenant):
        self.client = api_client
        self.admin_user = admin_user
        self.cn_tenant = cn_tenant
        # Use JWT auth so TenantMiddleware sets request.tenant from tenant_code claim
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        token["tenant_code"] = cn_tenant.code
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

    def test_balance_via_soul_karma_action(self, soul_data):
        """GET /api/v1/souls/{soul_id}/karma/ returns 200.

        The souls viewset keeps its `karma` action name and path: the rename
        moved apps.karma to apps.ledger, and this endpoint belongs to the
        souls app.
        """
        # Create a soul
        create_resp = self.client.post("/api/v1/souls/", soul_data, format="json")
        soul_id = create_resp.data["id"]

        # Get the ledger via the soul endpoint
        response = self.client.get(f"/api/v1/souls/{soul_id}/karma/")
        assert response.status_code == 200
        assert "merit_score" in response.data
        assert "demerit_score" in response.data
        assert "karmic_balance" in response.data

    def test_balance_via_ledger_endpoint(self, soul_data):
        """GET /api/v1/ledger/balance/{soul_id}/ returns 200."""
        # Create a soul
        create_resp = self.client.post("/api/v1/souls/", soul_data, format="json")
        soul_id = create_resp.data["id"]

        # Get the ledger via the dedicated ledger endpoint
        response = self.client.get(f"/api/v1/ledger/balance/{soul_id}/")
        assert response.status_code == 200
        assert "merit_score" in response.data
        assert "demerit_score" in response.data
        assert "karmic_balance" in response.data

    def test_ledger_nonexistent_soul(self):
        """GET the ledger for a nonexistent soul returns 404."""
        import uuid
        fake_id = uuid.uuid4()
        response = self.client.get(f"/api/v1/ledger/balance/{fake_id}/")
        assert response.status_code == 404

    def test_ledger_recalculate(self, soul_data):
        """POST /api/v1/ledger/calculate/{soul_id}/ returns 200."""
        # Create a soul
        create_resp = self.client.post("/api/v1/souls/", soul_data, format="json")
        soul_id = create_resp.data["id"]

        # Recalculate the ledger
        response = self.client.post(f"/api/v1/ledger/calculate/{soul_id}/")
        assert response.status_code == 200
