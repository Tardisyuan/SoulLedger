"""第四十批 S-b:灵魂自己改联系邮箱。

密码(开了两步验证再加 6 位数字)→ 新邮箱 → 验证码发到新邮箱 → 完成,并通知旧邮箱;不验证旧邮箱。
本殿不允许自己改时三步都答 `email_in_person`。
"""
import re

import pytest
from django.core import mail
from django.core.cache import cache

from apps.soul_accounts.contact_email import SELF_SERVICE_SETTING, mask
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db

URL = "/api/v1/me/contact-email/"
PASSWORD = "Ledger-test-pass-2026"


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


def _soul(tenant, email="zhangsan@lingyun.cn"):
    account, client = ready_soul(tenant, contact_email=email)
    account.user.set_password(PASSWORD)
    account.user.save(update_fields=["password"])
    return account, client


def _code_in_last_mail():
    match = re.search(r"(\d{6})", mail.outbox[-1].body)
    assert match, mail.outbox[-1].body
    return match.group(1)


def test_the_mask_is_two_characters_stars_and_the_whole_domain():
    assert mask("zhangsan@lingyun.cn") == "zh***@lingyun.cn"
    assert mask("a@x.io") == "a***@x.io"
    assert mask("") == ""


def test_status_shows_the_masked_address_and_none_as_empty(cn_tenant):
    _, client = _soul(cn_tenant)
    assert client.get(URL).json() == {"email_masked": "zh***@lingyun.cn", "can_change": True, "mfa_enabled": False}
    _, other = _soul(cn_tenant, email="")
    assert other.get(URL).json()["email_masked"] == ""


def test_the_whole_change_sends_the_code_to_the_new_address_and_tells_the_old_one(cn_tenant):
    account, client = _soul(cn_tenant)
    assert client.post(f"{URL}verify/", {"password": PASSWORD}, format="json").status_code == 204
    res = client.post(URL, {"email": "new.box@example.org"}, format="json")
    assert res.status_code == 202 and res.json() == {"sent_to": "new.box@example.org"}
    assert mail.outbox[-1].to == ["new.box@example.org"]
    code = _code_in_last_mail()

    done = client.post(f"{URL}confirm/", {"code": code}, format="json")

    assert done.status_code == 200 and done.json()["email_masked"] == "ne***@example.org"
    account.soul.refresh_from_db()
    account.user.refresh_from_db()
    assert account.soul.contact_email == "new.box@example.org"
    assert account.user.email == "new.box@example.org", "登录邮箱没跟着改:忘记密码的验证码还会发到旧地址"
    assert mail.outbox[-1].to == ["zhangsan@lingyun.cn"]
    assert "ne***@example.org" in mail.outbox[-1].body
    assert "new.box@example.org" not in mail.outbox[-1].body, "通知旧邮箱时写出了完整的新地址"


def test_no_email_step_without_the_password_step_and_a_wrong_password_counts(cn_tenant):
    _, client = _soul(cn_tenant)
    sent = len(mail.outbox)  # 开号时初始密码可能已经发过一封
    assert client.post(URL, {"email": "x@example.org"}, format="json").json()["code"] == "proof_required"
    wrong = client.post(f"{URL}verify/", {"password": "nope"}, format="json")
    assert wrong.status_code == 400 and wrong.json()["code"] == "wrong_password"
    assert len(mail.outbox) == sent


def test_two_step_souls_must_also_give_the_six_digits(cn_tenant, monkeypatch):
    from apps.soul_accounts import mfa

    _, client = _soul(cn_tenant)
    monkeypatch.setattr(mfa, "is_enabled", lambda account: True)
    res = client.post(f"{URL}verify/", {"password": PASSWORD}, format="json")
    assert res.status_code == 400 and res.json()["code"] == "mfa_required"
    monkeypatch.setattr(mfa, "verify_second_step", lambda account, **kw: {"code": "wrong", "remaining_attempts": 4})
    assert client.post(f"{URL}verify/", {"password": PASSWORD, "code": "123456"}, format="json").json()["code"] == "wrong"
    monkeypatch.setattr(mfa, "verify_second_step", lambda account, **kw: {"code": "ok", "method": "totp"})
    assert client.post(f"{URL}verify/", {"password": PASSWORD, "code": "123456"}, format="json").status_code == 204


def test_five_wrong_codes_void_the_code(cn_tenant):
    _, client = _soul(cn_tenant)
    client.post(f"{URL}verify/", {"password": PASSWORD}, format="json")
    client.post(URL, {"email": "new@example.org"}, format="json")
    right = _code_in_last_mail()
    wrong = "000000" if right != "000000" else "111111"
    for left in (4, 3, 2, 1, 0):
        res = client.post(f"{URL}confirm/", {"code": wrong}, format="json")
        assert res.json() == {"detail": "验证码错误", "code": "reset_code_wrong", "attempts_left": left}
    assert client.post(f"{URL}confirm/", {"code": right}, format="json").json()["code"] == "reset_code_attempts_exceeded"


def test_an_address_held_by_another_account_is_refused_after_the_code(cn_tenant):
    _soul(cn_tenant, email="taken@example.org")
    account, client = _soul(cn_tenant)
    client.post(f"{URL}verify/", {"password": PASSWORD}, format="json")
    client.post(URL, {"email": "taken@example.org"}, format="json")
    res = client.post(f"{URL}confirm/", {"code": _code_in_last_mail()}, format="json")
    assert res.status_code == 409 and res.json()["code"] == "email_taken"
    account.soul.refresh_from_db()
    assert account.soul.contact_email == "zhangsan@lingyun.cn"


def test_a_hall_that_does_not_allow_it_refuses_every_step(cn_tenant):
    cn_tenant.settings = {**(cn_tenant.settings or {}), SELF_SERVICE_SETTING: False}
    cn_tenant.save(update_fields=["settings"])
    _, client = _soul(cn_tenant)
    assert client.get(URL).json()["can_change"] is False
    for path, body in ((f"{URL}verify/", {"password": PASSWORD}), (URL, {"email": "a@b.org"}), (f"{URL}confirm/", {"code": "123456"})):
        res = client.post(path, body, format="json")
        assert res.status_code == 403 and res.json()["code"] == "email_in_person"
