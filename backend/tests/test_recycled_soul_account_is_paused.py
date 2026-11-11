"""灵魂进回收站,它的 App 会话随之失效;恢复后照常(审计 2026-11-11 A2-01)。

此前软删不动账号,`SoulJWTAuthentication` 与刷新只看 is_active / retired_at / session_version,
已登录的 App 可继续读写并无限续期。
"""
import pytest
from rest_framework.test import APIClient

from apps.core.recycle_bin import restore_cascade
from apps.soul_accounts import services as svc
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db


def _me(access):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return client.get("/api/v1/me/")


def _refresh(refresh):
    return APIClient().post("/api/v1/soul-auth/refresh/", {"refresh": refresh}, format="json")


def test_a_recycled_soul_is_signed_out_and_a_restored_one_is_not(cn_tenant):
    account, _ = ready_soul(cn_tenant)
    tokens = svc.issue_tokens(account)
    assert _me(tokens["access"]).status_code == 200

    cascade_id = account.soul.delete_with_cascade()

    me = _me(tokens["access"])
    assert me.status_code == 401, me.data
    assert me.data["code"] == "soul_recycled"
    refreshed = _refresh(tokens["refresh"])
    assert refreshed.status_code == 401, refreshed.data
    assert refreshed.data["code"] == "soul_recycled"

    restore_cascade(cascade_id)

    assert _me(tokens["access"]).status_code == 200
    assert _refresh(tokens["refresh"]).status_code == 200
