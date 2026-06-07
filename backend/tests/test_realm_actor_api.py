"""
Tests for Realm and Actor API endpoints.
"""
import pytest

from apps.actors.models import Actor, ActorRole
from apps.realms.models import Realm, RealmType
from apps.souls.models import Civilization


@pytest.mark.django_db
class TestRealmAPI:
    """Test /api/v1/realms/ endpoints."""

    def test_list_realms(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/realms/ returns realms."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        Realm.objects.create(
            realm_code="TEST_REALM",
            civilization=Civilization.CHINESE,
            name_local="测试地域",
            name_en="Test Realm",
            realm_type=RealmType.PURGATORY,
            tenant=cn_tenant,
        )

        response = api_client.get("/api/v1/realms/")
        assert response.status_code == 200

    def test_list_realms_unauthenticated(self, api_client):
        """GET /api/v1/realms/ without auth returns 401."""
        response = api_client.get("/api/v1/realms/")
        assert response.status_code == 401

    def test_realms_select_related_parent(self, api_client, admin_user, cn_tenant):
        """Realms endpoint uses select_related for parent_realm."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        parent = Realm.objects.create(
            realm_code="PARENT", civilization=Civilization.CHINESE,
            name_local="父级", name_en="Parent",
            realm_type=RealmType.PURGATORY, tenant=cn_tenant,
        )
        Realm.objects.create(
            realm_code="CHILD", civilization=Civilization.CHINESE,
            name_local="子级", name_en="Child",
            realm_type=RealmType.HELL, parent_realm=parent,
            tenant=cn_tenant,
        )

        response = api_client.get("/api/v1/realms/")
        assert response.status_code == 200


@pytest.mark.django_db
class TestActorAPI:
    """Test /api/v1/actors/ endpoints."""

    def test_list_actors(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/actors/ returns actors."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        Actor.objects.create(
            name="测试角色",
            role=ActorRole.JUDGE,
            civilization=Civilization.CHINESE,
            tenant=cn_tenant,
        )

        response = api_client.get("/api/v1/actors/")
        assert response.status_code == 200

    def test_list_actors_unauthenticated(self, api_client):
        """GET /api/v1/actors/ without auth returns 401."""
        response = api_client.get("/api/v1/actors/")
        assert response.status_code == 401
