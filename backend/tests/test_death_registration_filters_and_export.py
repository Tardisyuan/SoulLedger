"""死亡同步登记列表的筛选与导出(审计 2026-10-17 第 12 条)。

此前只能按状态筛(`filterset_fields=["status"]`),也不能导出。现在 `DeathRegistrationFilter` 加了
`search`(灵魂姓名 / 来源编号包含,幂等键整串)与收到日期起止;`registrations/export/` 用同一组筛选、
同一个租户范围(别殿的登记无论怎么筛都不在文件里),并写一条导出审计。只给 ADMIN。
"""
import datetime

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.death_sync.models import DeathRegistrationRequest, DeathRegistrationStatus, ExternalApiKey
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db
User = get_user_model()
LIST = "/api/v1/death-sync/registrations/"
EXPORT = LIST + "export/"


def _client(user, tenant):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    mine, theirs = (Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]
                    for code in ("DRF_MINE", "DRF_THEIRS"))

    def key(tenant):
        _, key_hash, prefix = ExternalApiKey.generate_key()
        return ExternalApiKey.objects.create(tenant=tenant, name=f"k-{tenant.code}", system_type="HOSPITAL",
                                             key_hash=key_hash, key_prefix=prefix)

    soul = Soul.objects.create(name="孟阿满", current_state=SoulState.ALIVE, tenant=mine)

    def row(tenant, idem, ref, status=DeathRegistrationStatus.PROCESSED, soul=None, days_ago=0):
        r = DeathRegistrationRequest.objects.create(
            tenant=tenant, api_key=key(tenant), source_system="HOSP", idempotency_key=idem,
            source_reference_id=ref, status=status, soul=soul, source_payload={})
        when = datetime.datetime(2026, 10, 1, tzinfo=datetime.timezone.utc) - datetime.timedelta(days=days_ago)
        DeathRegistrationRequest.objects.filter(pk=r.pk).update(request_timestamp=when)
        return r

    row(mine, "idem-1", "REF-100", soul=soul)
    row(mine, "idem-2", "REF-200", status=DeathRegistrationStatus.FAILED, days_ago=10)
    row(theirs, "idem-3", "REF-100")
    admin = User.objects.create_user(username="drf_admin", password="x", role="ADMIN", tenant=mine)
    return _client(admin, mine)


def _refs(client, **params):
    response = client.get(LIST, params)
    assert response.status_code == 200, response.data
    return sorted(r["source_reference_id"] for r in response.json()["results"])


def test_search_matches_soul_name_reference_or_the_whole_idempotency_key(world):
    assert _refs(world, search="阿满") == ["REF-100"]
    assert _refs(world, search="REF-") == ["REF-100", "REF-200"]  # 别殿的 REF-100 不在
    assert _refs(world, search="idem-2") == ["REF-200"]
    assert _refs(world, search="idem") == []  # 幂等键是整串比对


def test_received_dates_are_inclusive_and_status_still_refuses_unknown_values(world):
    assert _refs(world, received_after="2026-10-01") == ["REF-100"]
    assert _refs(world, received_before="2026-09-21") == ["REF-200"]
    assert _refs(world, received_after="2026-09-21", received_before="2026-10-01") == ["REF-100", "REF-200"]
    assert world.get(LIST, {"status": "NOPE"}).status_code == 400


def test_export_takes_the_same_filters_and_scope_and_is_audited(world):
    before = AuditLog.objects.filter(resource="death_registration").count()
    response = world.get(EXPORT, {"status": "FAILED"})
    assert response.status_code == 200
    body = response.content.decode("utf-8-sig")
    assert "REF-200" in body and "REF-100" not in body
    assert AuditLog.objects.filter(resource="death_registration").count() == before + 1


def test_export_is_admin_only(world):
    tenant = Tenant.objects.get(code="DRF_MINE")
    judge = User.objects.create_user(username="drf_judge", password="x", role="JUDGE", tenant=tenant)
    assert _client(judge, tenant).get(EXPORT).status_code == 403
