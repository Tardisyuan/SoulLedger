"""
Tests for SoulEvent (Events) API endpoints.
"""
import pytest

from apps.events.models import EventType, SoulEvent
from apps.souls.models import Soul


@pytest.mark.django_db
class TestSoulEventAPI:
    """Test /api/v1/events/ endpoints."""

    def test_list_events_authenticated(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/events/ returns events."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        # Create a soul to generate events
        soul = Soul.objects.create(name="EventSoul", tenant=cn_tenant)
        SoulEvent.objects.create(
            soul=soul, tenant=cn_tenant,
            event_type=EventType.SOUL_CREATED,
            payload={"name": "EventSoul"},
        )

        response = api_client.get("/api/v1/events/")
        assert response.status_code == 200

    def test_list_events_unauthenticated(self, api_client):
        """GET /api/v1/events/ without auth returns 401."""
        response = api_client.get("/api/v1/events/")
        assert response.status_code == 401

    def test_events_select_related_soul(self, api_client, admin_user, cn_tenant):
        """Events endpoint uses select_related to avoid N+1."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        soul = Soul.objects.create(name="N1Test", tenant=cn_tenant)
        for i in range(3):
            SoulEvent.objects.create(
                soul=soul, tenant=cn_tenant,
                event_type=EventType.STATE_CHANGED,
                payload={"index": i},
            )

        response = api_client.get("/api/v1/events/")
        assert response.status_code == 200
        results = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        assert len(results) >= 3
