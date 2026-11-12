"""`/me/password/` 的原密码错与「确认是本人」同一份 5 次预算(流程走查 2026-11-12 F-ACCT-03)。

此前错了只答 400 `invalid_old_password`、不计数:拿着一张有效 access 的人可以在这里无限次猜,
猜中就改掉密码并把其余设备下线 —— 而开两步验证、开面容登录等都把同一个密码当作「确认是本人」的闸。
"""
import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from tests.soul_account_support import dead_soul, provision_with_password, soul_client

pytestmark = pytest.mark.django_db
NEW = "a-new-Passw0rd!"


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


def _ready(tenant):
    """初始密码当作已改过的密码用:不强制改密,`/me/mfa/setup/` 才进得去。"""
    account, password = provision_with_password(dead_soul(tenant))
    account.must_change_password = False
    account.initial_password_expires_at = None
    account.save()
    return account, password


def test_five_wrong_old_passwords_lock_the_endpoint_even_for_the_right_one(cn_tenant):
    account, password = _ready(cn_tenant)
    client = soul_client(account)
    remaining = []
    for _ in range(5):
        response = client.post("/api/v1/me/password/", {"old_password": "wrong-guess", "new_password": NEW},
                               format="json")
        assert response.status_code == 400 and response.data["code"] == "invalid_old_password", response.data
        remaining.append(response.data["remaining_attempts"])
    assert remaining == [4, 3, 2, 1, 0]

    locked = client.post("/api/v1/me/password/", {"old_password": password, "new_password": NEW}, format="json")
    assert locked.status_code == 429 and locked.data["code"] == "rate_limited", locked.data
    account.user.refresh_from_db()
    assert account.user.check_password(password)
    # 同一份预算:「确认是本人」的入口也锁着。
    assert client.post("/api/v1/me/mfa/setup/", {"password": password}, format="json").status_code == 429


def test_a_right_old_password_still_changes_it(cn_tenant):
    account, password = _ready(cn_tenant)
    response = soul_client(account).post("/api/v1/me/password/", {"old_password": password, "new_password": NEW},
                                         format="json")
    assert response.status_code == 200, response.data
    assert APIClient().post("/api/v1/soul-auth/login/", {"soul_code": account.soul.soul_code, "password": NEW},
                            format="json").status_code == 200
