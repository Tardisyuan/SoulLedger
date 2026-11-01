"""A failed death registration does not hold its idempotency key (review 2026-11-01 #13).

The default key is「本 Key + 请求体」, so resending the same request is the same key. It used to answer 409
`duplicate` with `existing_status: FAILED` for ever: a registration refused with NO_CITY_GOD could not go
through by resending once the hall had a city god. Now a resend runs the failed row again; a row that
succeeded stays a duplicate.
"""
import pytest
from rest_framework.test import APIClient

from apps.death_sync.models import DeathRegistrationRequest, ExternalApiKey
from apps.judgment.models import Judgment
from apps.souls.models import Soul, SoulState
from tests.city_god_support import default_city_god

pytestmark = pytest.mark.django_db

URL = "/api/v1/death-sync/register/"


def _client(tenant):
    raw, key_hash, key_prefix = ExternalApiKey.generate_key()
    ExternalApiKey.objects.create(
        tenant=tenant, name="feed", system_type="HOSPITAL", key_hash=key_hash, key_prefix=key_prefix,
    )
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"ApiKey {raw}")
    return c


def test_resending_a_failed_registration_runs_it_again_on_the_same_row(cn_tenant):
    client = _client(cn_tenant)
    soul = Soul.objects.create(name="重发", tenant=cn_tenant)
    body = {"soul_lookup": {"soul_id": str(soul.id)}, "death_date": "2026-10-01"}

    first = client.post(URL, body, format="json")
    assert first.status_code == 400, first.content
    assert first.json()["error"]["code"] == "NO_CITY_GOD"
    row = first.json()["error"]["request_id"]

    # Still no city god: the same answer, on the same row — not 409 duplicate.
    again = client.post(URL, body, format="json")
    assert again.status_code == 400, again.content
    assert (again.json()["error"]["code"], again.json()["error"]["request_id"]) == ("NO_CITY_GOD", row)

    default_city_god(cn_tenant)
    through = client.post(URL, body, format="json")
    assert through.status_code == 201, through.content
    assert through.json()["registration_id"] == row
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.JUDGING
    assert Judgment.objects.filter(soul=soul).count() == 1
    record = DeathRegistrationRequest.objects.get(pk=row)
    assert (record.status, record.error_code) == ("PROCESSED", "")

    # Succeeded once: a further resend is the duplicate it always was, and opens nothing.
    dup = client.post(URL, body, format="json")
    assert dup.status_code == 409, dup.content
    assert (dup.json()["status"], dup.json()["registration_id"]) == ("duplicate", row)
    assert DeathRegistrationRequest.objects.filter(tenant=cn_tenant).count() == 1
    assert Judgment.objects.filter(soul=soul).count() == 1
