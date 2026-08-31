"""用户改不了自己的组织到别的租户下。

`UserSerializer`(`PATCH /auth/profile/` 用的那个)把 `organization` 放在 `fields`
里、不在 `read_only_fields` 里,而它是一个**没有租户校验的外键**。实测:一个
VIEWER `PATCH /auth/profile/ {"organization": <B 租户的组织>}` → **200**。

同一个序列化器里 `role` 与 `tenant` **是**锁住的,只漏了这一个。

诚实界定影响:`grep organization apps/perm/filters.py` **零命中**,`DataScopeFilter`
当前不读这个字段,所以今天没有把它放大成越权。**但「今天没人读的字段」不是一个
权限模型** —— 一个可以把自己挂到任意租户下的写入,在下一个读它的人出现时就变成
越权,而那时没有任何东西会提醒他。

`PrimaryKeyRelatedField` 按整张表解析外键(它从模型字段建的 queryset 没有租户
contextvar、也没有 request),所以校验只能写在序列化器里。
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.org.models import Organization
from apps.tenants.models import Tenant

PROFILE = "/api/v1/auth/profile/"


@pytest.fixture
def two_tenants(db):
    a, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "A"})
    b, _ = Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "B"})
    org_a = Organization.objects.create(name="A 组织", code="ORG_A", category="CHINESE", level=0, tenant=a)
    org_b = Organization.objects.create(name="B 组织", code="ORG_B", category="EUROPEAN", level=0, tenant=b)
    return a, b, org_a, org_b


@pytest.fixture
def viewer(two_tenants):
    a, _, org_a, _ = two_tenants
    return User.objects.create_user(
        username="org_probe", password="x", role="VIEWER", tenant=a, organization=org_a
    )


def client_for(api_client, user):
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.mark.django_db
def test_another_tenants_organization_is_refused(api_client, viewer, two_tenants):
    _, _, org_a, org_b = two_tenants
    response = client_for(api_client, viewer).patch(
        PROFILE, {"organization": str(org_b.pk)}, format="json"
    )

    assert response.status_code == 400, response.data
    viewer.refresh_from_db()
    # 断言的是**落库的值没变**,不只是状态码。一个「答 400 之后照样保存」的实现
    # 在只看状态码时看不出来。
    assert viewer.organization_id == org_a.pk


@pytest.mark.django_db
def test_an_organization_in_ones_own_tenant_is_accepted(api_client, viewer, two_tenants):
    """正对照。

    没有它,一个把 `organization` 整个设成只读的实现同样满足上面那条 ——
    而在自己租户的组织之间调动,正是这个字段存在的理由。
    """
    a, _, org_a, _ = two_tenants
    org_a2 = Organization.objects.create(
        name="A 组织二部", code="ORG_A2", category="CHINESE", level=0, tenant=a
    )
    response = client_for(api_client, viewer).patch(
        PROFILE, {"organization": str(org_a2.pk)}, format="json"
    )
    assert response.status_code == 200, response.data
    viewer.refresh_from_db()
    assert viewer.organization_id == org_a2.pk


@pytest.mark.django_db
def test_role_and_tenant_stay_locked(api_client, viewer, two_tenants):
    """这两个本来就锁着。一起断言,是因为这次改的是同一个序列化器 ——
    收紧一个字段时把另外两个放开,是这类改动最容易出的事故。"""
    _, b, _, _ = two_tenants
    response = client_for(api_client, viewer).patch(
        PROFILE, {"role": "ADMIN", "tenant": str(b.pk)}, format="json"
    )
    assert response.status_code in (200, 400), response.data
    viewer.refresh_from_db()
    assert viewer.role == "VIEWER"
    assert viewer.tenant.code == "CN_DIYU"
