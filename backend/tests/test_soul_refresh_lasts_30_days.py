"""灵魂端刷新令牌 30 天(2026-11-15 用户决定,便利性审计 O6);官员台仍是 7 天。

签发、轮换、OutstandingToken 的 expires_at(吊销时按它列出未过期令牌)三处都要是 30 天,
推送登记的「登录已到期」也按同一个值判断(`signin_sessions.soul_lifetime`)。
改动前签发的 7 天令牌不改写,照原 exp 到期 —— 令牌自带 exp,服务端无从也无需回改。
"""
from datetime import timedelta

import pytest
from django.conf import settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from apps.authentication import signin_sessions
from apps.soul_accounts import services as svc
from apps.soul_accounts.authentication import SoulRefreshToken
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db

THIRTY_DAYS = timedelta(days=30)


def _lifetime(raw):
    payload = SoulRefreshToken(raw).payload
    return timedelta(seconds=payload["exp"] - payload["iat"])


def test_the_default_is_thirty_days_and_the_officer_desk_keeps_seven():
    assert settings.SOUL_REFRESH_LIFETIME_DAYS == 30
    assert settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"] == timedelta(days=7)
    assert signin_sessions.soul_lifetime() == THIRTY_DAYS


def test_issued_and_rotated_soul_refresh_tokens_last_thirty_days(cn_tenant):
    account, _ = ready_soul(cn_tenant)
    issued = svc.issue_tokens(account)["refresh"]
    assert _lifetime(issued) == THIRTY_DAYS
    row = OutstandingToken.objects.get(jti=SoulRefreshToken(issued)["jti"])
    assert row.expires_at - row.created_at > timedelta(days=29)

    rotated = APIClient().post("/api/v1/soul-auth/refresh/", {"refresh": issued}, format="json")
    assert rotated.status_code == 200, rotated.data
    assert _lifetime(rotated.data["refresh"]) == THIRTY_DAYS


def test_the_lifetime_follows_the_setting(cn_tenant, settings):
    settings.SOUL_REFRESH_LIFETIME_DAYS = 3
    account, _ = ready_soul(cn_tenant)
    assert _lifetime(svc.issue_tokens(account)["refresh"]) == timedelta(days=3)
    assert signin_sessions.soul_lifetime() == timedelta(days=3)
