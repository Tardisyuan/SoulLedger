"""邮箱登录(O4,2026-11-15 用户决定:官员与灵魂都开)。

只认**已验证**的邮箱;认不出(未验证、没有、共用)时答的与输错用户名 / 编号逐字相同。
规则在 `apps/authentication/serializers.py::login_username` 与 `apps/soul_accounts/services.py::soul_code_for_email`。
"""
import pytest
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.soul_accounts import services as svc
from tests.soul_account_support import clear_soul_login_counters, dead_soul, ready_soul

pytestmark = pytest.mark.django_db

OFFICER_LOGIN = "/api/v1/auth/officer-login/"
WEB_LOGIN = "/api/v1/auth/login/"
SOUL_LOGIN = "/api/v1/soul-auth/login/"
SOUL_PW = "Soul-pass-2026!"
NOISE = ("remaining_attempts", "instance")


@pytest.fixture(autouse=True)
def _clear_counters():
    from django.core.cache import cache

    cache.clear()
    clear_soul_login_counters()


def _body(response):
    return {k: v for k, v in response.data.items() if k not in NOISE}


def _post(url, **data):
    return APIClient().post(url, data, format="json")


def _verified(user, email):
    user.email = email
    user.email_verified_address = email
    user.save(update_fields=["email", "email_verified_address"])
    return user


# ── 官员 ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("url", [OFFICER_LOGIN, WEB_LOGIN])
def test_officer_signs_in_with_a_verified_email_in_any_case(judge_user, url):
    _verified(judge_user, "judge@diyu.example")
    response = _post(url, username="Judge@Diyu.Example", password="judge123")
    assert response.status_code == 200, response.data
    assert response.data["user"]["username"] == "judge"


@pytest.mark.parametrize("url", [OFFICER_LOGIN, WEB_LOGIN])
def test_unverified_email_answers_like_an_unknown_username(judge_user, url):
    judge_user.email = "judge@diyu.example"
    judge_user.save(update_fields=["email"])
    unverified = _post(url, username="judge@diyu.example", password="judge123")
    unknown = _post(url, username="nobody", password="judge123")
    assert unverified.status_code == unknown.status_code == 401
    assert _body(unverified) == _body(unknown)


def test_a_souls_verified_email_does_not_open_the_officer_login(cn_tenant):
    soul_user = User.objects.create_user(username="soul-x", password=SOUL_PW, role="SOUL", tenant=cn_tenant)
    _verified(soul_user, "soul@family.example")
    refused = _post(OFFICER_LOGIN, username="soul@family.example", password=SOUL_PW)
    unknown = _post(OFFICER_LOGIN, username="nobody", password=SOUL_PW)
    assert refused.status_code == 401
    assert _body(refused) == _body(unknown)


def test_a_username_that_is_an_address_still_means_that_username(judge_user, cn_tenant):
    """A literal username wins over someone else's email: existing logins never change meaning."""
    User.objects.create_user(username="old@style.example", password="other-pass-1", role="JUDGE", tenant=cn_tenant)
    _verified(judge_user, "OLD@style.example")
    response = _post(OFFICER_LOGIN, username="old@style.example", password="judge123")
    assert response.status_code == 401


# ── 灵魂 ────────────────────────────────────────────────────────────────


def _soul_with_email(tenant, email, name="亡魂甲", verified=True):
    account, _ = ready_soul(tenant, name=name, contact_email=email)
    user = account.user
    user.set_password(SOUL_PW)
    user.save(update_fields=["password"])
    assert user.email == email  # 联系邮箱已同步为登录邮箱
    if verified:
        svc.mark_login_email_verified(user, email)
    return account


def test_soul_signs_in_with_a_verified_email(cn_tenant):
    account = _soul_with_email(cn_tenant, "lone@soul.example")
    response = _post(SOUL_LOGIN, soul_code="  Lone@Soul.Example ", password=SOUL_PW)
    assert response.status_code == 200, response.data
    assert response.data["soul_code"] == account.soul.soul_code


def test_soul_unverified_email_answers_like_a_wrong_code(cn_tenant):
    _soul_with_email(cn_tenant, "lone@soul.example", verified=False)
    unverified = _post(SOUL_LOGIN, soul_code="lone@soul.example", password=SOUL_PW)
    unknown = _post(SOUL_LOGIN, soul_code="ZZZZZZZZZZ", password=SOUL_PW)
    assert unverified.status_code == unknown.status_code == 401
    assert _body(unverified) == _body(unknown)


def test_shared_family_email_is_refused_with_the_generic_error(cn_tenant):
    account = _soul_with_email(cn_tenant, "family@soul.example")
    dead_soul(cn_tenant, name="亡魂乙", contact_email="FAMILY@soul.example")  # 家人,同一个联系邮箱
    shared = _post(SOUL_LOGIN, soul_code="family@soul.example", password=SOUL_PW)
    unknown = _post(SOUL_LOGIN, soul_code="nobody@soul.example", password=SOUL_PW)
    assert shared.status_code == unknown.status_code == 401
    assert _body(shared) == _body(unknown)
    # 编号照常能登
    assert _post(SOUL_LOGIN, soul_code=account.soul.soul_code, password=SOUL_PW).status_code == 200


def test_the_rate_key_identifier_is_the_lower_cased_address():
    assert svc.normalize_soul_code(" Lone@Soul.Example ") == "lone@soul.example"
    assert svc.normalize_soul_code(" abc ") == "ABC"
