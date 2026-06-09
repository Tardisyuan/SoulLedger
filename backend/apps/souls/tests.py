"""
Tests for souls app - Soul CRUD + state transitions + records.
Uses JWT auth with tenant_code so TenantMiddleware sets request.tenant.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/souls"


def _jwt_client(user, tenant):
    """Return APIClient authenticated via JWT with tenant_code claim."""
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
class TestSoulCRUD:
    """Soul list, create, retrieve, update, delete."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="SOUL_T1", defaults={"display_name": "Soul Test Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="soul_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.soul = Soul.objects.create(
            name="Test Soul", tenant=self.tenant, current_state=SoulState.ALIVE
        )

    def test_list_souls(self):
        resp = self.admin_client.get(f"{BASE}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_list_souls_unauthenticated(self):
        resp = APIClient().get(f"{BASE}/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_create_soul(self):
        resp = self.admin_client.post(f"{BASE}/", {
            "name": "New Soul", "birth_date": "2000-01-01"
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["name"] == "New Soul"

    def test_retrieve_soul(self):
        resp = self.admin_client.get(f"{BASE}/{self.soul.pk}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["name"] == "Test Soul"

    def test_update_soul(self):
        resp = self.admin_client.patch(f"{BASE}/{self.soul.pk}/", {
            "name": "Updated Soul"
        }, format="json")
        assert resp.status_code == status.HTTP_200_OK
        self.soul.refresh_from_db()
        assert self.soul.name == "Updated Soul"

    def test_delete_soul(self):
        resp = self.admin_client.delete(f"{BASE}/{self.soul.pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        self.soul.refresh_from_db()
        assert self.soul.is_deleted

    def test_soul_not_found(self):
        resp = self.admin_client.get(f"{BASE}/00000000-0000-0000-0000-000000000000/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestSoulDieAction:
    """Soul die action - marks soul dead and begins judgment."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="SOUL_T2", defaults={"display_name": "Soul Die Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="die_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)

    def test_die_alive_soul(self):
        soul = Soul.objects.create(name="Die Soul", tenant=self.tenant, current_state=SoulState.ALIVE)
        resp = self.client.post(f"{BASE}/{soul.pk}/die/", {
            "location": "Underworld", "death_date": "2024-01-01"
        }, format="json")
        assert resp.status_code == status.HTTP_200_OK
        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING

    def test_die_already_dead(self):
        soul = Soul.objects.create(name="Dead Soul", tenant=self.tenant, current_state=SoulState.JUDGING)
        resp = self.client.post(f"{BASE}/{soul.pk}/die/", format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestSoulTransitionAction:
    """Soul transition action - manual state transitions."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="SOUL_T3", defaults={"display_name": "Soul Trans Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="trans_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)

    def test_transition_alive_to_judging(self):
        soul = Soul.objects.create(name="Trans Soul", tenant=self.tenant, current_state=SoulState.ALIVE)
        resp = self.client.post(f"{BASE}/{soul.pk}/transition/", {
            "new_state": SoulState.JUDGING, "reason": "Death recorded"
        }, format="json")
        assert resp.status_code == status.HTTP_200_OK
        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING

    def test_transition_invalid(self):
        soul = Soul.objects.create(name="Bad Trans", tenant=self.tenant, current_state=SoulState.ALIVE)
        resp = self.client.post(f"{BASE}/{soul.pk}/transition/", {
            "new_state": SoulState.DISPOSED, "reason": "Skip"
        }, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_transition_judging_to_disposed(self):
        soul = Soul.objects.create(name="J2D", tenant=self.tenant, current_state=SoulState.JUDGING)
        resp = self.client.post(f"{BASE}/{soul.pk}/transition/", {
            "new_state": SoulState.DISPOSED
        }, format="json")
        assert resp.status_code == status.HTTP_200_OK
        soul.refresh_from_db()
        assert soul.current_state == SoulState.DISPOSED


@pytest.mark.django_db
class TestSoulRecordsAction:
    """Soul add_record and records actions."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="SOUL_T4", defaults={"display_name": "Soul Records Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="rec_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)
        self.soul = Soul.objects.create(name="Record Soul", tenant=self.tenant)

    def test_add_record(self):
        resp = self.client.post(f"{BASE}/{self.soul.pk}/add_record/", {
            "record_type": "MERIT",
            "civilization": "CHINESE",
            "description": "Helped an old lady",
            "weight": 5,
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED
        assert SoulRecord.objects.filter(soul=self.soul).count() == 1

    def test_list_records_empty(self):
        resp = self.client.get(f"{BASE}/{self.soul.pk}/records/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data == []

    def test_list_records_with_data(self):
        SoulRecord.objects.create(
            soul=self.soul, record_type="MERIT",
            civilization="CHINESE", description="Good deed", weight=3
        )
        resp = self.client.get(f"{BASE}/{self.soul.pk}/records/")
        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 1

    def test_records_soul_not_found(self):
        resp = self.client.get(f"{BASE}/00000000-0000-0000-0000-000000000000/records/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND
