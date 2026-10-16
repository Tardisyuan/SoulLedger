"""`PATCH /auth/profile/` 改自己的显示名(官员端「我的」、Web 个人资料页)。

带了 `display_name` 就不能是空(或全是空格);不带就不查 —— 改邮箱的请求不因为显示名本来就空而被拒。
长度上限是模型的 `max_length=100`,ModelSerializer 自己就会拒。
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.tenants.models import Tenant

PROFILE = "/api/v1/auth/profile/"


@pytest.fixture
def hall(db):
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "A"})
    return tenant


@pytest.fixture
def officer(hall):
    return User.objects.create_user(username="name_probe", password="x", role="JUDGE", tenant=hall, display_name="旧名")


def as_user(api_client, user):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.mark.django_db
def test_display_name_is_saved_trimmed(api_client, officer):
    response = as_user(api_client, officer).patch(PROFILE, {"display_name": "  新名  "}, format="json")

    assert response.status_code == 200, response.data
    assert response.data["display_name"] == "新名"
    officer.refresh_from_db()
    assert officer.display_name == "新名"


@pytest.mark.django_db
@pytest.mark.parametrize("blank", ["", "   "], ids=["empty", "spaces"])
def test_blank_display_name_is_refused(api_client, officer, blank):
    response = as_user(api_client, officer).patch(PROFILE, {"display_name": blank}, format="json")

    assert response.status_code == 400
    assert "display_name" in response.data
    officer.refresh_from_db()
    assert officer.display_name == "旧名"


@pytest.mark.django_db
def test_too_long_display_name_is_refused(api_client, officer):
    response = as_user(api_client, officer).patch(PROFILE, {"display_name": "名" * 101}, format="json")

    assert response.status_code == 400
    assert "display_name" in response.data


@pytest.mark.django_db
def test_a_patch_without_display_name_does_not_check_it(api_client, hall):
    nameless = User.objects.create_user(username="nameless_probe", password="x", role="JUDGE", tenant=hall)
    assert nameless.display_name == ""

    response = as_user(api_client, nameless).patch(PROFILE, {"first_name": "甲"}, format="json")

    assert response.status_code == 200, response.data
