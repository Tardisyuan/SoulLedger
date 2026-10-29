"""用户改不了自己的组织到别的租户下。

`UserSerializer`(`PATCH /auth/profile/` 用的那个)把 `organization` 放在 `fields`
里、不在 `read_only_fields` 里,而它是一个**没有租户校验的外键**。实测:一个
VIEWER `PATCH /auth/profile/ {"organization": <B 租户的组织>}` → **200**。

同一个序列化器里 `role` 与 `tenant` **是**锁住的,只漏了这一个。

影响:写这段时 `DataScopeFilter` 还不读这个字段;**2026-10-29 数据范围 B2 起它读了**
(`apps/perm/data_scope.py` 按 `user.organization` 求「本机构 / 本机构及下级」),
所以这条路径若再打开,就是给自己扩大数据范围的越权 —— 当时那句「下一个读它的人」已经来了。

`PrimaryKeyRelatedField` 按整张表解析外键(它从模型字段建的 queryset 没有租户
contextvar、也没有 request),所以校验只能写在序列化器里。

2026-10-16(用户定):组织与职务在这条路径上整个只读,只有管理员能改 ——
改了值就 400 点名字段,原样回传不拒。
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
def test_an_organization_in_ones_own_tenant_is_refused_too(api_client, viewer, two_tenants):
    """2026-10-16 起(用户定)组织与职务只有管理员能改:自己租户里的组织也不行。
    400 要点名字段,落库值不变。"""
    a, _, org_a, _ = two_tenants
    org_a2 = Organization.objects.create(  # 每殿一个活根(数据范围 B1):二部挂在 A 组织下
        name="A 组织二部", code="ORG_A2", category="CHINESE", tenant=a, parent=org_a
    )
    response = client_for(api_client, viewer).patch(
        PROFILE, {"organization": str(org_a2.pk)}, format="json"
    )
    assert response.status_code == 400, response.data
    assert "organization" in response.data
    viewer.refresh_from_db()
    assert viewer.organization_id == org_a.pk


@pytest.mark.django_db
def test_position_cannot_be_changed_by_oneself(api_client, viewer):
    viewer.position = "判官"
    viewer.save(update_fields=["position"])
    response = client_for(api_client, viewer).patch(PROFILE, {"position": "阎罗"}, format="json")
    assert response.status_code == 400, response.data
    assert "position" in response.data
    viewer.refresh_from_db()
    assert viewer.position == "判官"


@pytest.mark.django_db
def test_echoing_the_current_values_back_is_not_a_change(api_client, viewer, two_tenants):
    """客户端把读到的资料原样回传(连同组织、职务)不该被拒 —— 只拒「改了」。"""
    _, _, org_a, _ = two_tenants
    response = client_for(api_client, viewer).patch(
        PROFILE,
        {"organization": str(org_a.pk), "position": viewer.position, "first_name": "新"},
        format="json",
    )
    assert response.status_code == 200, response.data
    viewer.refresh_from_db()
    assert viewer.first_name == "新"


@pytest.mark.django_db
def test_an_admin_can_still_set_both(api_client, viewer, two_tenants):
    """管理员走 `PATCH /users/{id}/`(`UserUpdateSerializer`),不受上面的锁影响。"""
    a, _, org_a, _ = two_tenants
    org_a2 = Organization.objects.create(  # 每殿一个活根(数据范围 B1):二部挂在 A 组织下
        name="A 组织二部", code="ORG_A2", category="CHINESE", tenant=a, parent=org_a
    )
    admin = User.objects.create_user(username="org_admin", password="x", role="ADMIN", tenant=a)
    response = client_for(api_client, admin).patch(
        f"/api/v1/users/{viewer.pk}/",
        {"organization": str(org_a2.pk), "position": "阎罗"},
        format="json",
    )
    assert response.status_code == 200, response.data
    viewer.refresh_from_db()
    assert viewer.organization_id == org_a2.pk
    assert viewer.position == "阎罗"


@pytest.mark.django_db
def test_an_admin_cannot_hang_a_user_under_another_tenants_organization(api_client, viewer, two_tenants):
    """管理员那条路也只收被编辑者本租户的组织(用户 2026-10-16 定)。"""
    a, _, org_a, org_b = two_tenants
    admin = User.objects.create_user(username="org_admin_x", password="x", role="ADMIN", tenant=a)
    response = client_for(api_client, admin).patch(
        f"/api/v1/users/{viewer.pk}/", {"organization": str(org_b.pk)}, format="json"
    )
    assert response.status_code == 400, response.data
    assert "organization" in response.data
    viewer.refresh_from_db()
    assert viewer.organization_id == org_a.pk


@pytest.mark.django_db
def test_an_admin_can_set_organization_and_position_when_creating_a_user(api_client, two_tenants):
    """新建也能带机构与职务(2026-10-17);机构仍须与新账号同租户。"""
    a, b, org_a, org_b = two_tenants
    admin = User.objects.create_user(username="org_admin_c", password="x", role="ADMIN", tenant=a)
    c = client_for(api_client, admin)
    body = {"username": "fresh_one", "email": "fresh_one@example.com", "password": "Str0ng-pass-phrase!",
            "role": "VIEWER", "tenant": a.pk, "position": "判官"}

    refused = c.post("/api/v1/users/", {**body, "organization": str(org_b.pk)}, format="json")
    assert refused.status_code == 400 and "organization" in refused.data, refused.data
    assert not User.objects.filter(username="fresh_one").exists()

    ok = c.post("/api/v1/users/", {**body, "organization": str(org_a.pk)}, format="json")
    assert ok.status_code == 201, ok.data
    made = User.objects.get(username="fresh_one")
    assert made.organization_id == org_a.pk and made.position == "判官"


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
