"""S2 (2026-11-15): a finished email reset gives the soul its number back.

`/auth/set-new-password/` answers `soul_code` on its 200 -- only after a live code for the address matched -- and the
reset-code mail carries the number too, so a soul that lost both the number and the password gets in again.
Every refusal stays as it was: no number, and a wrong code reads the same for a registered address as for one
nobody holds (the reset must not become an "is this address a soul?" oracle).
"""
import json

import pytest
from django.core import mail
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin
from tests.soul_account_support import clear_soul_login_counters, dead_soul

pytestmark = pytest.mark.django_db

EMAIL = "found@example.com"
NOBODY = "nobody@example.com"
NEW_PASSWORD = "N0t-Guessable!2026"
REQUEST = "/api/v1/auth/reset-password/"
CONFIRM = "/api/v1/auth/set-new-password/"


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    clear_soul_login_counters()
    yield
    cache.clear()
    clear_soul_login_counters()


def _soul(tenant):
    soul = dead_soul(tenant)
    svc.apply_contacts(soul, EMAIL)
    svc.provision_account(soul, AccountOrigin.OFFICER)
    return soul


def _body(res):
    body = json.loads(res.content)
    body.pop("instance", None)  # the request id: differs per request by design
    return body


def _wrong_code(code):
    return "000000" if code != "000000" else "111111"


def test_success_answers_the_soul_code(cn_tenant):
    soul = _soul(cn_tenant)
    client = APIClient()
    client.post(REQUEST, {"email": EMAIL}, format="json")
    code = cache.get(f"pwd_reset:{EMAIL}")
    res = client.post(CONFIRM, {"email": EMAIL, "code": code, "new_password": NEW_PASSWORD}, format="json")
    assert res.status_code == 200, res.content
    assert json.loads(res.content) == {"detail": "密码重置成功", "soul_code": soul.soul_code}


def test_a_wrong_code_carries_no_soul_code_and_reads_as_for_an_unknown_address(cn_tenant):
    soul = _soul(cn_tenant)
    client = APIClient()
    for address in (EMAIL, NOBODY):
        client.post(REQUEST, {"email": address}, format="json")
    known = client.post(CONFIRM, {"email": EMAIL, "code": _wrong_code(cache.get(f"pwd_reset:{EMAIL}")),
                                  "new_password": NEW_PASSWORD}, format="json")
    unknown = client.post(CONFIRM, {"email": NOBODY, "code": _wrong_code(cache.get(f"pwd_reset:{NOBODY}")),
                                    "new_password": NEW_PASSWORD}, format="json")
    assert known.status_code == unknown.status_code == 400
    assert _body(known) == _body(unknown)
    assert "soul_code" not in _body(known)
    assert soul.soul_code not in known.content.decode()


def test_an_expired_code_and_a_weak_password_carry_no_soul_code(cn_tenant):
    soul = _soul(cn_tenant)
    client = APIClient()
    expired = client.post(CONFIRM, {"email": EMAIL, "code": "123456", "new_password": NEW_PASSWORD}, format="json")
    assert expired.status_code == 400 and _body(expired)["code"] == "reset_code_expired"
    client.post(REQUEST, {"email": EMAIL}, format="json")
    code = cache.get(f"pwd_reset:{EMAIL}")
    weak = client.post(CONFIRM, {"email": EMAIL, "code": code, "new_password": "password"}, format="json")
    assert weak.status_code == 400 and _body(weak)["code"] == "weak_password"
    for res in (expired, weak):
        assert "soul_code" not in _body(res)
        assert soul.soul_code not in res.content.decode()


def test_the_reset_code_mail_carries_the_soul_code(cn_tenant):
    soul = _soul(cn_tenant)
    mail.outbox.clear()
    APIClient().post(REQUEST, {"email": EMAIL}, format="json")
    [message] = [m for m in mail.outbox if m.to == [EMAIL]]
    assert cache.get(f"pwd_reset:{EMAIL}") in message.body
    assert f"你的灵魂编号：{soul.soul_code}" in message.body
