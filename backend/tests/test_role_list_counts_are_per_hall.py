"""`GET /perm/roles/` is open to any signed-in officer; its holder counts are that officer's hall only.

Before: `member_count` / `user_count` counted every hall's users, so each hall learned how many
JUDGEs (and ADMINs) every other hall has. The global admin still sees the whole count.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.perm.models import Role
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


def _client(user, tenant):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _judge_row(client):
    resp = client.get("/api/v1/perm/roles/")
    assert resp.status_code == 200, resp.content
    rows = resp.data if isinstance(resp.data, list) else resp.data["results"]
    return next(r for r in rows if r["name"] == "JUDGE")


def test_a_hall_officer_sees_only_its_own_halls_holders(django_user_model):
    Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
    a = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "A"})[0]
    b = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "B"})[0]
    reader = django_user_model.objects.create_user(username="rc_reader", password="x", role="JUDGE", tenant=a)
    for i in range(3):
        django_user_model.objects.create_user(username=f"rc_b_{i}", password="x", role="JUDGE", tenant=b)
    admin = django_user_model.objects.create_user(username="rc_admin", password="x", role="ADMIN", tenant=a)

    own = django_user_model.objects.filter(role="JUDGE", tenant=a).count()
    everywhere = django_user_model.objects.filter(role="JUDGE").count()
    assert everywhere >= own + 3

    row = _judge_row(_client(reader, a))
    assert row["member_count"] == own
    assert row["user_count"] == own

    assert _judge_row(_client(admin, a))["member_count"] == everywhere
