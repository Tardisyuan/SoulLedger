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
    assert first.json()["code"] == "NO_CITY_GOD"
    row = first.json()["request_id"]

    # Still no city god: the same answer, on the same row — not 409 duplicate.
    again = client.post(URL, body, format="json")
    assert again.status_code == 400, again.content
    assert (again.json()["code"], again.json()["request_id"]) == ("NO_CITY_GOD", row)

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
    assert (dup.json()["code"], dup.json()["registration_id"]) == ("duplicate", row)
    assert DeathRegistrationRequest.objects.filter(tenant=cn_tenant).count() == 1
    assert Judgment.objects.filter(soul=soul).count() == 1


def test_a_resend_spends_a_retry_and_stops_at_the_limit_until_a_new_key(cn_tenant):
    from apps.death_sync.services import DeathSyncService, RetryRefusedError

    client = _client(cn_tenant)
    soul = Soul.objects.create(name="重发到头", tenant=cn_tenant)
    body = {"soul_lookup": {"soul_id": str(soul.id)}, "death_date": "2026-10-01"}
    row = client.post(URL, body, format="json").json()["request_id"]
    assert DeathRegistrationRequest.objects.get(pk=row).retry_count == 0

    for spent in (1, 2, 3):
        again = client.post(URL, body, format="json")
        assert (again.status_code, again.json()["code"]) == (400, "NO_CITY_GOD"), again.content
        assert DeathRegistrationRequest.objects.get(pk=row).retry_count == spent

    # At the limit: the explicit code, nothing run, and the row keeps saying why it really failed.
    stopped = client.post(URL, body, format="json")
    assert stopped.status_code == 409, stopped.content
    assert (stopped.json()["code"], stopped.json()["request_id"]) == ("MAX_RETRIES", row)
    record = DeathRegistrationRequest.objects.get(pk=row)
    assert (record.retry_count, record.error_code) == (3, "NO_CITY_GOD")

    # The data is fixed: the same as the web「重试」, this row stays closed…
    default_city_god(cn_tenant)
    assert client.post(URL, body, format="json").status_code == 409
    with pytest.raises(RetryRefusedError) as web:
        DeathSyncService.retry_failed(row, cn_tenant)
    assert web.value.code == "MAX_RETRIES"
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.ALIVE
    assert not Judgment.objects.filter(soul=soul).exists()

    # …and a new key is a new row, which goes through.
    fresh = client.post(URL, body, format="json", HTTP_X_IDEMPOTENCY_KEY="after-the-limit")
    assert fresh.status_code == 201, fresh.content
    assert fresh.json()["registration_id"] != row
    assert Judgment.objects.filter(soul=soul).count() == 1


def test_a_batch_item_at_the_limit_says_so_and_the_others_still_run(cn_tenant):
    client = _client(cn_tenant)
    spent = Soul.objects.create(name="批量到头", tenant=cn_tenant)
    other = Soul.objects.create(name="批量另一个", tenant=cn_tenant)
    item = {"soul_lookup": {"soul_id": str(spent.id)}, "death_date": "2026-10-01", "idempotency_key": "batch-spent"}
    assert client.post(URL, {"batch": True, "registrations": [item]}, format="json").status_code == 207
    DeathRegistrationRequest.objects.filter(idempotency_key="batch-spent").update(retry_count=3)
    default_city_god(cn_tenant)

    res = client.post(URL, {"batch": True, "registrations": [
        item, {"soul_lookup": {"soul_id": str(other.id)}, "death_date": "2026-10-01"},
    ]}, format="json")

    assert res.status_code == 207, res.content
    first, second = res.json()["results"]
    assert (first["status"], first["error_code"]) == ("FAILED", "MAX_RETRIES")
    assert second["status"] == "PROCESSED"
    assert not Judgment.objects.filter(soul=spent).exists()
    assert DeathRegistrationRequest.objects.get(idempotency_key="batch-spent").error_code == "NO_CITY_GOD"


def test_a_tudi_resend_at_the_limit_answers_409_with_the_code(cn_tenant):
    import uuid

    from apps.death_sync.models import TudiGod
    from tests import sentence_plan_support as sp
    from tests.soul_account_support import officer_client

    clerk = sp.officer("tudi_resend_clerk", "JUDGE", cn_tenant)
    tudi = TudiGod.objects.create(tenant=cn_tenant, name="重发土地", city_god=default_city_god(cn_tenant))
    tudi.officers.add(clerk)
    client = officer_client(clerk)
    url = f"/api/v1/death-sync/tudi-gods/{tudi.pk}/register-death/"
    body = {"soul_lookup": {"soul_id": str(uuid.uuid4())}, "death_date": "2026-10-01", "idempotency_key": "tudi-spent"}
    first = client.post(url, body, format="json")
    assert (first.status_code, first.data["error_code"]) == (201, "SOUL_NOT_FOUND"), first.data
    DeathRegistrationRequest.objects.filter(pk=first.data["id"]).update(retry_count=3)

    res = client.post(url, body, format="json")

    assert (res.status_code, res.data["registration"]["id"], res.data["registration"]["error_code"]) == (409, first.data["id"], "MAX_RETRIES"), res.data
    assert DeathRegistrationRequest.objects.get(pk=first.data["id"]).error_code == "SOUL_NOT_FOUND"
