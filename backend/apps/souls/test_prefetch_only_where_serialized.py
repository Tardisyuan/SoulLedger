"""SoulViewSet prefetches `records` / `reincarnations` only for the actions that serialize souls
(perf review 2026-10-27 #6). Before, every action — add_record, karma, path, delete — loaded the
soul's whole record history just to run `get_object`."""
import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.souls.models import Soul
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant

BASE = "/api/v1/souls"


@pytest.fixture
def setup(db):
    tenant = Tenant.objects.get_or_create(code="PREFETCH_T", defaults={"display_name": "prefetch"})[0]
    admin = get_user_model().objects.create_user(username="prefetch_admin", password="x", role="ADMIN", tenant=tenant)
    token = RefreshToken.for_user(admin)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    soul = Soul.objects.create(name="History", tenant=tenant, birth_year=1900, death_year=1950)
    return client, soul


def _add_records(soul, n):
    for i in range(n):
        SoulRecord.objects.create(soul=soul, record_type="MERIT", civilization="CHINESE",
                                  description=f"deed {i}", weight=1, event_year=1910 + i)


def _loads_every_record(ctx, soul):
    """The prefetch's shape: every record of the soul fetched by `soul_id IN (...)`."""
    return [q for q in ctx.captured_queries
            if 'FROM "souls_soulrecord"' in q["sql"] and '"soul_id" IN (' in q["sql"]]


def test_karma_and_add_record_do_not_prefetch_the_history(setup):
    client, soul = setup
    _add_records(soul, 3)
    with CaptureQueriesContext(connection) as ctx:
        assert client.get(f"{BASE}/{soul.pk}/karma/").status_code == 200
        resp = client.post(f"{BASE}/{soul.pk}/add_record/", {
            "record_type": "MERIT", "description": "one more", "weight": 1, "event_year": 1920,
        }, format="json")
        assert resp.status_code == 201, resp.content
    assert _loads_every_record(ctx, soul) == []


def test_retrieve_still_prefetches_and_does_not_grow_with_the_history(setup):
    client, soul = setup
    _add_records(soul, 2)
    client.get(f"{BASE}/{soul.pk}/")  # warm the per-worker hall copy (apps/tenants/middleware.py)
    with CaptureQueriesContext(connection) as small:
        body = client.get(f"{BASE}/{soul.pk}/").json()
    assert len(body["records"]) == 2
    _add_records(soul, 6)
    with CaptureQueriesContext(connection) as large:
        body = client.get(f"{BASE}/{soul.pk}/").json()
    assert len(body["records"]) == 8
    assert _loads_every_record(large, soul)
    assert len(large.captured_queries) == len(small.captured_queries)
