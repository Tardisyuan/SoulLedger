"""灵魂与官员的认证分界。

每条规则都在报告的变异证明表里:把守它的那一行改坏,这里对应的测试变红。
"""
from datetime import timedelta

import pytest
from django.urls import URLPattern, URLResolver, get_resolver
from django.utils import timezone
from rest_framework.test import APIClient

from apps.authentication.models import User, is_assignable_role
from apps.perm.checker import check_permission
from apps.soul_accounts import services as svc
from apps.soul_accounts.authentication import OfficerJWTAuthentication
from apps.soul_accounts.me_views import SoulAPIView
from tests.soul_account_support import (
    dead_soul,
    officer_client,
    provision_with_password,
    ready_soul,
    soul_client,
)

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _fresh_soul_login_counter():
    """默认缓存是真 Redis(本地一次性实例),失败次数跨测试累积;不清会让后面的登录撞 429。"""
    from django.core.cache import cache

    cache.delete("soul_login_rate:127.0.0.1")
    yield
    cache.delete("soul_login_rate:127.0.0.1")

#: 各种形状的官员接口:ViewSet 列表、详情动作、函数视图、权限模块、AllowAny 的登录。
OFFICER_ENDPOINTS = [
    ("get", "/api/v1/souls/"),
    ("get", "/api/v1/users/"),
    ("get", "/api/v1/auth/profile/"),
    ("post", "/api/v1/auth/change-password/"),
    ("get", "/api/v1/perm/roles/"),
    ("get", "/api/v1/notifications/"),
    ("get", "/api/v1/workflows/"),
    ("get", "/api/v1/soul-accounts/accounts/"),
    ("get", "/api/v1/menus/"),
    ("get", "/api/v1/audit-logs/"),
]
# 不在名单里的:/auth/login/ 与 /auth/refresh/。simplejwt 的 TokenViewBase 把
# authentication_classes 设成 ()(它们本来就不看请求头),所以令牌分界在那两处靠的是
# 令牌类型 —— 见 test_the_officer_refresh_endpoint_does_not_mint_from_a_soul_refresh_token。


@pytest.mark.parametrize("method,url", OFFICER_ENDPOINTS)
def test_a_soul_token_gets_403_on_officer_endpoints(cn_tenant, method, url):
    account, client = ready_soul(cn_tenant)
    response = getattr(client, method)(url, {}, format="json")
    assert response.status_code == 403, (url, response.status_code, response.content[:200])


@pytest.mark.parametrize("method,url", OFFICER_ENDPOINTS[:4])
def test_an_access_type_token_for_a_soul_user_is_refused_by_role(cn_tenant, method, url):
    """第二道:令牌类型对了(`access`),但用户是 SOUL。挡它的是 get_user 里的角色判断。"""
    account, _ = ready_soul(cn_tenant)
    client = officer_client(account.user)
    response = getattr(client, method)(url, {}, format="json")
    assert response.status_code == 403, (url, response.status_code)


def test_the_default_authentication_class_is_the_officer_one():
    from django.conf import settings

    assert settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] == [
        "apps.soul_accounts.authentication.OfficerJWTAuthentication"
    ]


def _routed_views():
    found = {}

    def walk(resolver, prefix=""):
        for pattern in resolver.url_patterns:
            if isinstance(pattern, URLResolver):
                walk(pattern, prefix + str(pattern.pattern))
            elif isinstance(pattern, URLPattern):
                view = getattr(pattern.callback, "cls", None) or getattr(pattern.callback, "view_class", None)
                if view is not None and hasattr(view, "authentication_classes"):
                    found.setdefault(prefix + str(pattern.pattern), view)

    walk(get_resolver())
    return found


def test_every_me_route_is_a_soul_api_view():
    me = {path: view for path, view in _routed_views().items() if path.startswith("api/v1/me/")}
    assert len(me) >= 7, me
    wrong = [path for path, view in me.items() if not issubclass(view, SoulAPIView)]
    assert wrong == []


def test_no_officer_route_accepts_a_soul_token_structurally():
    """除了 /me/ 与 /soul-auth/,每个路由上的 JWT 认证类都必须是官员那一个。
    一个视图自己写 `authentication_classes = [JWTAuthentication]` 会得到 401 而不是 403,
    还会绕开角色判断 —— 这条在它被加进来的那一刻变红。"""
    from rest_framework_simplejwt.authentication import JWTAuthentication

    from apps.soul_accounts.authentication import SoulJWTAuthentication

    offenders = []
    for path, view in _routed_views().items():
        if path.startswith(("api/v1/me/", "api/v1/soul-auth/")):
            continue
        for cls in view.authentication_classes:
            if issubclass(cls, SoulJWTAuthentication) or (
                issubclass(cls, JWTAuthentication) and not issubclass(cls, OfficerJWTAuthentication)
            ):
                offenders.append((path, cls.__name__))
    assert offenders == []


def test_an_officer_token_gets_403_on_me(cn_tenant, judge_user, admin_user):
    for user in (judge_user, admin_user):
        client = officer_client(user)
        for url in ("/api/v1/me/", "/api/v1/me/life/", "/api/v1/me/rebirth-applications/"):
            response = client.get(url)
            assert response.status_code == 403, (user.role, url, response.status_code)


def test_a_soul_type_token_minted_for_an_officer_is_refused_on_me(judge_user):
    """SoulJWTAuthentication.get_user 的角色判断:令牌类型对了,人不对。"""
    from apps.soul_accounts.authentication import SoulRefreshToken

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {SoulRefreshToken.for_user(judge_user).access_token}")
    assert client.get("/api/v1/me/").status_code == 403


def test_the_web_login_refuses_a_soul_with_the_right_password(cn_tenant):
    account, password = provision_with_password(dead_soul(cn_tenant))
    response = APIClient().post(
        "/api/v1/auth/login/", {"username": account.user.username, "password": password}, format="json"
    )
    assert response.status_code == 401
    assert "access" not in response.data
    # 同一个密码在灵魂登录端点是对的 —— 被拒的原因是端点,不是密码。
    ok = APIClient().post("/api/v1/soul-auth/login/",
                          {"soul_code": account.soul.soul_code, "password": password}, format="json")
    assert ok.status_code == 200


def test_the_officer_refresh_endpoint_does_not_mint_from_a_soul_refresh_token(cn_tenant):
    account, _ = ready_soul(cn_tenant)
    refresh = svc.issue_tokens(account)["refresh"]
    response = APIClient().post("/api/v1/auth/refresh/", {"refresh": refresh}, format="json")
    assert response.status_code == 401


def test_a_soul_refresh_token_works_on_the_soul_refresh_endpoint(cn_tenant):
    account, _ = ready_soul(cn_tenant)
    refresh = svc.issue_tokens(account)["refresh"]
    response = APIClient().post("/api/v1/soul-auth/refresh/", {"refresh": refresh}, format="json")
    assert response.status_code == 200
    assert set(response.data) == {"access", "refresh"}


def test_soul_is_not_an_assignable_role_and_holds_no_permission(cn_tenant, admin_user):
    assert is_assignable_role("SOUL") is False
    account, _ = ready_soul(cn_tenant)
    for codename in ("soul.read", "notification.read", "menu.read", "soul_account.read"):
        assert check_permission(account.user, codename) is False
    # 用户管理不能把谁改成 SOUL,也看不到灵魂账号。
    client = officer_client(admin_user)
    victim = User.objects.create_user(username="v1", password="x", role="VIEWER", tenant=cn_tenant)
    assert client.post(f"/api/v1/users/{victim.pk}/assign_roles/", {"role": "SOUL"}, format="json").status_code == 400
    listed = client.get("/api/v1/users/", {"page_size": 200}).data
    rows = listed["results"] if isinstance(listed, dict) else listed
    assert account.user.username not in {row["username"] for row in rows}
    assert client.post(f"/api/v1/users/{account.user.pk}/reset_password/").status_code == 404


def test_soul_cannot_be_granted_permissions_through_a_role_row(cn_tenant):
    from apps.perm.models import Permission, Role, RolePermission

    account, _ = ready_soul(cn_tenant)
    role = Role.objects.create(name="SOUL", display_name="x")
    permission, _ = Permission.objects.get_or_create(codename="soul.read", defaults={"name": "x", "category": "soul"})
    RolePermission.objects.create(role=role, permission=permission)
    from apps.perm.cache import invalidate_all_permissions

    invalidate_all_permissions()
    assert check_permission(account.user, "soul.read") is False


def test_must_change_password_blocks_everything_but_the_password_endpoint(cn_tenant):
    account, password = provision_with_password(dead_soul(cn_tenant))
    login = APIClient().post("/api/v1/soul-auth/login/",
                             {"soul_code": account.soul.soul_code, "password": password}, format="json")
    assert login.status_code == 200 and login.data["account"]["must_change_password"] is True
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    for url in ("/api/v1/me/", "/api/v1/me/life/", "/api/v1/me/past-lives/", "/api/v1/me/rebirth-applications/"):
        response = client.get(url)
        assert response.status_code == 403 and response.data["code"] == "password_change_required", url
    assert client.post("/api/v1/me/rebirth-applications/", {"desired_form": "HUMAN"},
                       format="json").status_code == 403

    changed = client.post("/api/v1/me/password/",
                          {"old_password": password, "new_password": "a-new-Passw0rd!"}, format="json")
    assert changed.status_code == 200, changed.data
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {changed.data['access']}")
    assert client.get("/api/v1/me/").status_code == 200
    account.refresh_from_db()
    assert account.must_change_password is False and account.initial_password_expires_at is None
    # 旧的初始密码不再能登录。
    assert APIClient().post("/api/v1/soul-auth/login/", {"soul_code": account.soul.soul_code,
                                                         "password": password}, format="json").status_code == 401


def test_the_initial_password_expires_after_72_hours(cn_tenant):
    account, password = provision_with_password(dead_soul(cn_tenant))
    expires = account.initial_password_expires_at
    assert timedelta(hours=71, minutes=59) < expires - timezone.now() <= timedelta(hours=72)

    body = {"soul_code": account.soul.soul_code, "password": password}
    account.initial_password_expires_at = timezone.now() - timedelta(seconds=1)
    account.save()
    response = APIClient().post("/api/v1/soul-auth/login/", body, format="json")
    assert response.status_code == 401 and response.data["code"] == "initial_password_expired"
    # 已登录的会话也不能在过期之后再改密或读数据。
    client = soul_client(account)
    assert client.get("/api/v1/me/").data["code"] == "initial_password_expired"
    assert client.post("/api/v1/me/password/", {"old_password": password, "new_password": "x-New-pass-9"},
                       format="json").status_code == 403


def test_a_wrong_password_and_an_unknown_code_answer_identically(cn_tenant):
    account, _ = provision_with_password(dead_soul(cn_tenant))
    a = APIClient().post("/api/v1/soul-auth/login/",
                         {"soul_code": account.soul.soul_code, "password": "nope-nope"}, format="json")
    b = APIClient().post("/api/v1/soul-auth/login/", {"soul_code": "ZZZZZZZZZZ", "password": "nope-nope"},
                         format="json")
    assert a.status_code == b.status_code == 401
    assert a.data == b.data


def test_soul_login_is_rate_limited_per_ip(cn_tenant):
    client = APIClient()
    for _ in range(5):
        client.post("/api/v1/soul-auth/login/", {"soul_code": "ZZZZZZZZZZ", "password": "x"}, format="json")
    response = client.post("/api/v1/soul-auth/login/", {"soul_code": "ZZZZZZZZZZ", "password": "x"}, format="json")
    assert response.status_code == 429 and response.data["code"] == "rate_limited"


def test_login_is_logged(cn_tenant):
    from apps.authentication.models import LoginLog

    account, password = provision_with_password(dead_soul(cn_tenant))
    code = account.soul.soul_code
    APIClient().post("/api/v1/soul-auth/login/", {"soul_code": code, "password": "wrong-one"}, format="json")
    APIClient().post("/api/v1/soul-auth/login/", {"soul_code": code, "password": password}, format="json")
    rows = list(LoginLog.objects.filter(username=f"soul:{code}").values_list("status", "user_id"))
    assert ("FAILED", None) in rows and ("SUCCESS", account.user_id) in rows


@pytest.mark.django_db(transaction=True)
def test_websocket_auth_refuses_soul_users(cn_tenant):
    from rest_framework_simplejwt.tokens import RefreshToken

    from apps.core.ws_auth import JWTAuthMiddleware

    account, _ = ready_soul(cn_tenant)
    middleware = JWTAuthMiddleware(inner=None)
    assert middleware._authenticate_token_sync(svc.issue_tokens(account)["access"]) is None
    assert middleware._authenticate_token_sync(str(RefreshToken.for_user(account.user).access_token)) is None
