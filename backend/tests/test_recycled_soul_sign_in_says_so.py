"""回收站里的灵魂登录答 `soul_recycled`,面容凭据不被当成失效(流程走查 2026-11-12 F-ACCT-06)。

此前 `authenticate` 与面容登录都用默认管理器找编号,它滤掉软删行:密码登录答「编号或密码错误」并计失败
(灵魂以为密码错了去走邮箱重置,改完照样登不进);面容登录答 `device_login_invalid`,App 随即删掉本机凭据。
"""
import pytest
from rest_framework.test import APIClient

from apps.authentication.models import LoginLog
from apps.soul_accounts.models import SoulDeviceLogin
from apps.souls.models import Soul
from tests.soul_account_support import clear_soul_login_counters, ready_soul, soul_client

pytestmark = pytest.mark.django_db
PASSWORD = "a-long-test-password-1"


@pytest.fixture(autouse=True)
def _fresh_counters():
    clear_soul_login_counters()
    yield
    clear_soul_login_counters()


@pytest.fixture
def account(cn_tenant):
    account, _ = ready_soul(cn_tenant)
    account.user.set_password(PASSWORD)
    account.user.save(update_fields=["password"])
    return account


def _recycle(account):
    Soul.all_objects.filter(pk=account.soul_id).update(is_deleted=True)


def _login(account, password):
    return APIClient().post("/api/v1/soul-auth/login/",
                            {"soul_code": account.soul.soul_code, "password": password}, format="json")


def test_the_right_password_hears_soul_recycled_and_a_wrong_one_does_not(account):
    _recycle(account)
    right = _login(account, PASSWORD)
    assert right.status_code == 401 and right.data["code"] == "soul_recycled", right.data
    wrong = _login(account, "not-the-password")
    assert wrong.status_code == 401 and wrong.data["code"] == "invalid_credentials", wrong.data


def test_face_sign_in_hears_soul_recycled_and_the_credential_still_works_after_restore(account):
    credential = soul_client(account).post("/api/v1/me/device-login/", {"password": PASSWORD},
                                           format="json").data["credential"]
    _recycle(account)
    body = {"soul_code": account.soul.soul_code, "credential": credential}
    response = APIClient().post("/api/v1/soul-auth/device-login/", body, format="json")
    assert response.status_code == 401 and response.data["code"] == "soul_recycled", response.data
    assert not LoginLog.objects.filter(failure_reason="device_login_invalid").exists()
    assert SoulDeviceLogin.objects.get(account=account).revoked_at is None

    Soul.all_objects.filter(pk=account.soul_id).update(is_deleted=False)
    assert APIClient().post("/api/v1/soul-auth/device-login/", body, format="json").status_code == 200
