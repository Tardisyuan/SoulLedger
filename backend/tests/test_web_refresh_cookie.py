"""网页的刷新令牌改放 httpOnly cookie(2026-10-29 用户决定第 16 条,`apps/authentication/refresh_cookie.py`)。

网页请求带 `X-Auth-Cookie: 1`:应答正文里没有 `refresh`,改由 httpOnly / SameSite=Strict 的 cookie 带;刷新、退出、
改密码读这张 cookie,并核 Origin。App 不带这个头,正文照旧(反例都在下面)。
"""
import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.authentication.refresh_cookie import REFRESH_COOKIE, REFRESH_COOKIE_PATH
from tests.test_password_change_ends_other_sessions import OLD, _refresh

pytestmark = pytest.mark.django_db

LOGIN = "/api/v1/auth/login/"
REFRESH = "/api/v1/auth/refresh/"
LOGOUT = "/api/v1/auth/logout/"
CHANGE = "/api/v1/auth/change-password/"
ORIGIN = "http://localhost:3000"
WEB = {"HTTP_X_AUTH_COOKIE": "1", "HTTP_ORIGIN": ORIGIN}

_ip = iter(range(10, 250))


@pytest.fixture(autouse=True)
def _clean(settings):
    settings.CORS_ALLOWED_ORIGINS = [ORIGIN]
    settings.CORS_ALLOW_ALL_ORIGINS = False
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def officer(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="two_devices", email="two@example.com", password=OLD, role="JUDGE", tenant=cn_tenant)


def _web_login(client, remember=False):
    res = client.post(LOGIN, {"username": "two_devices", "password": OLD, "remember": remember}, format="json",
                      REMOTE_ADDR=f"198.51.100.{next(_ip)}", **WEB)
    assert res.status_code == 200, res.content
    return res


def test_web_login_puts_the_refresh_token_in_an_http_only_strict_cookie(officer):
    client = APIClient()
    res = _web_login(client)
    assert "refresh" not in res.data and res.data["access"]
    cookie = res.cookies[REFRESH_COOKIE]
    assert cookie["httponly"] and cookie["samesite"] == "Strict" and cookie["path"] == REFRESH_COOKIE_PATH
    assert not cookie["max-age"]  # not 「保持登录」: a session cookie, as before
    assert _web_login(APIClient(), remember=True).cookies[REFRESH_COOKIE]["max-age"]


def test_an_app_login_is_unchanged(officer):
    res = APIClient().post(LOGIN, {"username": "two_devices", "password": OLD}, format="json")
    assert res.status_code == 200 and res.data["refresh"]
    assert REFRESH_COOKIE not in res.cookies


def test_refresh_from_the_cookie_rotates_it(officer):
    client = APIClient()
    first = _web_login(client).cookies[REFRESH_COOKIE].value
    res = client.post(REFRESH, {}, format="json", **WEB)
    assert res.status_code == 200, res.content
    assert res.data["access"] and "refresh" not in res.data
    second = res.cookies[REFRESH_COOKIE].value
    assert second and second != first
    assert _refresh(first) == 401  # rotated and blacklisted, as on the body path


@pytest.mark.parametrize("origin", ["https://evil.example", None])
def test_refresh_from_the_cookie_with_a_foreign_or_missing_origin_is_refused(officer, origin):
    client = APIClient()
    token = _web_login(client).cookies[REFRESH_COOKIE].value
    headers = {"HTTP_X_AUTH_COOKIE": "1", **({"HTTP_ORIGIN": origin} if origin else {})}
    res = client.post(REFRESH, {}, format="json", **headers)
    assert res.status_code == 403 and res.data["code"] == "origin_refused"
    assert _refresh(token) == 200  # untouched


def test_the_body_path_still_works_for_apps(officer):
    token = APIClient().post(LOGIN, {"username": "two_devices", "password": OLD}, format="json").data["refresh"]
    res = APIClient().post(REFRESH, {"refresh": token}, format="json")
    assert res.status_code == 200 and res.data["refresh"]


def test_logout_from_the_cookie_blacklists_it_and_clears_the_cookie(officer):
    client = APIClient()
    login = _web_login(client)
    token = login.cookies[REFRESH_COOKIE].value
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    res = client.post(LOGOUT, {}, format="json", **WEB)
    assert res.status_code == 200
    assert res.cookies[REFRESH_COOKIE].value == "" and res.cookies[REFRESH_COOKIE]["max-age"] == 0
    assert _refresh(token) == 401


def test_change_password_keeps_this_web_device_through_the_cookie(officer):
    client = APIClient()
    login = _web_login(client)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    res = client.post(CHANGE, {"old_password": OLD, "new_password": "N0t-Guessable!2026-b"}, format="json", **WEB)
    assert res.status_code == 200, res.content
    assert res.data["access"] and "refresh" not in res.data
    fresh = res.cookies[REFRESH_COOKIE].value
    assert _refresh(fresh) == 200
