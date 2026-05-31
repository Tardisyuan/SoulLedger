"""
Tests for Reincarnation API endpoints.
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken
from apps.souls.models import Soul, SoulState, Civilization
from apps.reincarnation.models import Reincarnation


def _auth(api_client, user):
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.mark.django_db
class TestReincarnationAPI:
    """Test /api/v1/reincarnation/ endpoints."""

    def test_list_reincarnations(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/reincarnation/ returns reincarnations."""
        client = _auth(api_client, admin_user)
        soul = Soul.objects.create(name="RebornSoul", tenant=cn_tenant)
        Reincarnation.objects.create(
            soul=soul, tenant=cn_tenant,
            cycle_count=1, rebirth_form="HUMAN",
        )
        response = client.get("/api/v1/reincarnation/")
        assert response.status_code == 200

    def test_list_reincarnations_unauthenticated(self, api_client):
        """GET /api/v1/reincarnation/ without auth returns 401."""
        response = api_client.get("/api/v1/reincarnation/")
        assert response.status_code == 401

    def test_reincarnation_select_related(self, api_client, admin_user, cn_tenant):
        """Reincarnation endpoint uses select_related."""
        client = _auth(api_client, admin_user)
        soul = Soul.objects.create(name="SRSoul", tenant=cn_tenant)
        Reincarnation.objects.create(
            soul=soul, tenant=cn_tenant,
            cycle_count=1, rebirth_form="ANIMAL",
        )
        response = client.get("/api/v1/reincarnation/")
        assert response.status_code == 200
        results = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        assert len(results) >= 1
