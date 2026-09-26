"""邮箱重置结束初始密码的生命周期(2026-09-26 Android 实测缺陷)。

此前 `set_new_password` 只 `set_password`:重置后灵魂仍被要求「修改初始密码」;
而初始密码已过期时,`services.login` 以 `initial_password_expired` 拒绝**新**密码,
灵魂无法经邮箱自救。
"""
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin, CredentialStatus, InitialCredential
from tests.soul_account_support import clear_soul_login_counters, dead_soul

pytestmark = pytest.mark.django_db

EMAIL = "lapsed@example.com"
NEW_PASSWORD = "N0t-Guessable!2026"


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    clear_soul_login_counters()
    yield
    cache.clear()
    clear_soul_login_counters()


def test_reset_with_a_lapsed_initial_password_logs_in_and_is_not_forced_to_change(cn_tenant):
    soul = dead_soul(cn_tenant)
    svc.apply_contacts(soul, EMAIL)
    account, _ = svc.provision_account(soul, AccountOrigin.OFFICER)
    account.initial_password_expires_at = timezone.now() - timedelta(hours=1)
    account.save(update_fields=["initial_password_expires_at"])

    client = APIClient()
    client.post("/api/v1/auth/reset-password/", {"email": EMAIL}, format="json")
    code = cache.get(f"pwd_reset:{EMAIL}")
    assert code
    res = client.post("/api/v1/auth/set-new-password/",
                      {"email": EMAIL, "code": code, "new_password": NEW_PASSWORD}, format="json")
    assert res.status_code == 200, res.data

    account.refresh_from_db()
    assert account.must_change_password is False and account.initial_password_expires_at is None
    # 未交付的初始密码明文随之作废,和灵魂自己改密一样。
    assert not InitialCredential.objects.filter(account=account).exclude(status=CredentialStatus.VOID).exists()

    login = client.post("/api/v1/soul-auth/login/", {"soul_code": soul.soul_code, "password": NEW_PASSWORD},
                        format="json")
    assert login.status_code == 200, login.data
    assert login.data["account"]["must_change_password"] is False
