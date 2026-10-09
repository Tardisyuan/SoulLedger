"""A13: 「官员端会话更短」. Tokens from /auth/officer-login/ expire after
OFFICER_APP_REFRESH_LIFETIME_HOURS (24 h) -- also after the 2FA second step and after rotation;
/auth/login/ (the desk) keeps SimpleJWT's 7 days (30 with 「保持登录」)."""
from datetime import timedelta

import pytest
from django.conf import settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken as StockRefreshToken

from tests.test_officer_mfa import _enable

pytestmark = pytest.mark.django_db

OFFICER = "/api/v1/auth/officer-login/"
DESK = "/api/v1/auth/login/"
REFRESH = "/api/v1/auth/refresh/"


@pytest.fixture(autouse=True)
def _clear_login_counters():
    from django.core.cache import cache

    cache.clear()


def _lifetime(refresh: str) -> timedelta:
    payload = StockRefreshToken(refresh).payload
    return timedelta(seconds=payload["exp"] - payload["iat"])


def _hours() -> timedelta:
    return timedelta(hours=settings.OFFICER_APP_REFRESH_LIFETIME_HOURS)


def test_the_officer_app_refresh_token_uses_the_shorter_lifetime_and_the_desk_does_not(judge_user):
    app = APIClient().post(OFFICER, {"username": "judge", "password": "judge123"}, format="json")
    desk = APIClient().post(DESK, {"username": "judge", "password": "judge123"}, format="json")
    assert _lifetime(app.data["refresh"]) == _hours() == timedelta(hours=24)
    assert _lifetime(desk.data["refresh"]) == timedelta(minutes=10080)
    assert _lifetime(app.data["refresh"]) < _lifetime(desk.data["refresh"])


def test_remember_does_not_lengthen_an_app_session(judge_user):
    app = APIClient().post(OFFICER, {"username": "judge", "password": "judge123", "remember": True}, format="json")
    assert _lifetime(app.data["refresh"]) == _hours()


def test_rotation_keeps_the_app_lifetime(judge_user):
    app = APIClient().post(OFFICER, {"username": "judge", "password": "judge123"}, format="json")
    rotated = APIClient().post(REFRESH, {"refresh": app.data["refresh"]}, format="json")
    assert rotated.status_code == 200, rotated.data
    assert _lifetime(rotated.data["refresh"]) == _hours()


def test_the_2fa_second_step_issues_the_app_lifetime_too(judge_user, monkeypatch):
    from apps.authentication import mfa

    _enable(judge_user)
    # The code check itself is covered by test_officer_mfa; here only which token comes out.
    monkeypatch.setattr(mfa, "verify_login_code", lambda *a, **k: {"code": "ok"})
    client = APIClient()
    verify = "/api/v1/auth/mfa/verify/"
    pending = client.post(OFFICER, {"username": "judge", "password": "judge123"}, format="json").data["pending_token"]
    done = client.post(verify, {"pending_token": pending, "code": "123456"}, format="json")
    assert done.status_code == 200, done.data
    assert _lifetime(done.data["refresh"]) == _hours()
    # the same account through the desk's 2FA step keeps the desk lifetime
    pending = client.post(DESK, {"username": "judge", "password": "judge123"}, format="json").data["pending_token"]
    desk_done = client.post(verify, {"pending_token": pending, "code": "123456"}, format="json")
    assert desk_done.status_code == 200, desk_done.data
    assert _lifetime(desk_done.data["refresh"]) == timedelta(minutes=10080)


def test_the_outstanding_row_expires_with_the_shorter_token(judge_user):
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

    app = APIClient().post(OFFICER, {"username": "judge", "password": "judge123"}, format="json")
    jti = StockRefreshToken(app.data["refresh"]).payload["jti"]
    expires = OutstandingToken.objects.get(jti=jti).expires_at
    assert expires - timezone.now() < _hours() + timedelta(minutes=1)
