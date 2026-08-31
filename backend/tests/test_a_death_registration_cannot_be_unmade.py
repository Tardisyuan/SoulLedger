"""`DeathRegistrationRequest` 说自己「创建后不可变」—— 那就不能被删、被改。

模型 docstring:「Immutable after creation. Used for idempotency, audit, and
retry.」而它的 viewset 曾经是 `ModelViewSet`。2026-08-29 实测
`DELETE .../register/{id}/` → **204**,之后 `objects` 查不到、`_base_manager`
查得到(软删除)——**外部系统能用创建那条登记的同一把 key 把它从审计里拿掉。**

幂等唯一约束 `UniqueConstraint(["source_system","idempotency_key"])` 现在带
`condition=Q(is_deleted=False)`(见 `tests/test_soft_delete_frees_unique_keys.py`),
所以「幂等键被永久占用」那半已经不成立。剩下的这半在这里钉住。
"""
import pytest
from rest_framework.test import APIClient

from apps.death_sync.models import DeathRegistrationRequest, ExternalApiKey
from apps.souls.models import Soul
from apps.tenants.models import Tenant

WRITE_METHODS = ["delete", "put", "patch"]


@pytest.fixture
def registration(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )
    raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
    key = ExternalApiKey.objects.create(
        name="test-key",
        key_hash=key_hash,
        key_prefix=key_prefix,
        tenant=tenant,
        is_active=True,
    )
    # `api_key` set: `get_queryset` scopes to the calling key
    # (`scope_to_api_key`), so a row without one is invisible even to its own
    # tenant — and the read-back assertion below would 404 for a reason that
    # has nothing to do with what this file is testing.
    row = DeathRegistrationRequest.objects.create(
        tenant=tenant,
        api_key=key,
        source_system="test-source",
        idempotency_key="key-001",
        source_payload={},
    )
    Soul.objects.create(name="张三", tenant=tenant)
    client = APIClient(HTTP_AUTHORIZATION=f"ApiKey {raw_key}")
    return client, row


@pytest.mark.django_db
@pytest.mark.parametrize("method", WRITE_METHODS)
def test_it_cannot_be_deleted_or_edited_through_the_api(registration, method):
    client, row = registration
    response = getattr(client, method)(
        f"/api/v1/death-sync/register/{row.pk}/", {}, format="json"
    )
    assert response.status_code == 405, (
        f"{method.upper()} 得到 {response.status_code};一条声称不可变的登记"
        f"被同一把 key 改动了"
    )
    row.refresh_from_db()
    assert row.is_deleted is False


@pytest.mark.django_db
def test_it_can_still_be_read(registration):
    """**断存在,不只是断缺失。** 把整个 viewset 关掉会让上面那条全绿,
    而外部系统就再也查不到自己交过什么了。"""
    client, row = registration
    response = client.get(f"/api/v1/death-sync/register/{row.pk}/")
    assert response.status_code == 200, response.status_code
    assert response.data["idempotency_key"] == "key-001"


@pytest.mark.django_db
def test_it_can_still_be_created(registration):
    client, _ = registration
    response = client.post(
        "/api/v1/death-sync/register/",
        {
            "source_system": "test-source",
            "idempotency_key": "key-002",
            "soul_lookup": {"name": "张三"},
            "death_date": "2020-01-01",
        },
        format="json",
    )
    assert response.status_code in (200, 201), (response.status_code, response.data)
