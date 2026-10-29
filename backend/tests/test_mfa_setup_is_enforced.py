"""两步验证服务端强制(用户 2026-10-29 决定 P)。

角色要求两步验证(ADMIN 始终;其余看殿设置 `mfa_required_roles`)而本人没开:登录照常成功,令牌却只开
设置两步验证 / 退出 / 读自己几个口子,其余官员接口 403 `mfa_setup_required`。开了之后立刻放开(按当下状态判,不看令牌)。

根 conftest 默认把 `MFA_SETUP_ENFORCED` 关掉(其余测试里的管理员没有验证器);这里逐条打开。
"""
import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication import mfa
from apps.authentication.models import OfficerMfa, User
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _enforced(settings):
    settings.MFA_SETUP_ENFORCED = True


@pytest.fixture
def hall(db):
    return Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]


def _client(user):
    token = RefreshToken.for_user(user)
    if user.tenant_id:
        token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _turn_on(user):
    OfficerMfa.objects.create(user=user, secret=mfa.generate_secret(), confirmed_at=timezone.now())


def test_production_setting_is_on():
    from config import settings as production

    assert production.MFA_SETUP_ENFORCED is True


def test_an_admin_without_mfa_is_held_at_setup(hall):
    admin = User.objects.create_user(username="a", password="x", role="ADMIN", tenant=hall)
    client = _client(admin)
    refused = client.get("/api/v1/souls/")
    assert refused.status_code == 403 and refused.json()["code"] == "mfa_setup_required"
    assert client.post("/api/v1/users/", {"username": "z"}, format="json").json()["code"] == "mfa_setup_required"
    profile = client.get("/api/v1/auth/profile/")
    assert profile.status_code == 200 and profile.json()["mfa_setup_required"] is True
    assert client.get("/api/v1/auth/mfa/status/").status_code == 200
    # 设置向导的入口没有被挡(密码不对是 400,不是 403)
    assert client.post("/api/v1/auth/mfa/setup/", {"password": "wrong"}, format="json").status_code == 400

    _turn_on(admin)
    assert client.get("/api/v1/souls/").status_code == 200
    assert client.get("/api/v1/auth/profile/").json()["mfa_setup_required"] is False


def test_a_role_the_hall_requires_is_held_and_others_are_not(hall):
    judge = User.objects.create_user(username="j", password="x", role="JUDGE", tenant=hall)
    assert _client(judge).get("/api/v1/souls/").status_code == 200
    hall.settings = {**(hall.settings or {}), mfa.MFA_REQUIRED_ROLES_SETTING: ["JUDGE"]}
    hall.save(update_fields=["settings"])
    judge = User.objects.get(pk=judge.pk)
    assert _client(judge).get("/api/v1/souls/").json()["code"] == "mfa_setup_required"


def test_the_login_payload_says_so(hall):
    User.objects.create_user(username="a", password="a-long-enough-password-1", role="ADMIN", tenant=hall)
    res = APIClient().post("/api/v1/auth/login/", {"username": "a", "password": "a-long-enough-password-1"}, format="json")
    assert res.status_code == 200, res.content
    assert res.json()["user"]["mfa_setup_required"] is True
