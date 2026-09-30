"""两封系统邮件按收件人的语言发(2026-09-30 用户决定)。

规则(`apps/authentication/mail.py::mail_locale`):本世账号的 `PushPreference.locale`
→ 没有就按原属文明:地府 zh-Hans、埃及 egy、欧洲与希腊 en → 未知文明 zh-Hans
(这两封信此前对所有人都是中文,退回原样不需要猜)。

文案的权威是 `packages/core/messages/*.json` 的 `soul_mail`,后端是副本,这里逐字钉住。
"""
import json
from pathlib import Path

import pytest
from django.core import mail
from django.core.cache import cache

from apps.authentication.mail import MESSAGES
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin
from apps.soul_push.models import PushPreference
from apps.tenants.models import Tenant
from tests.soul_account_support import dead_soul

PACKS = Path(__file__).resolve().parents[2] / "packages" / "core" / "messages"

TENANT_LOCALE = {"CN_DIYU": "zh-Hans", "EG_DUAT": "egy", "EU_HEAVEN_HELL": "en", "GR_HADES": "en"}

# 每种语言一份完整的纯文本 —— 字面量,不从 MESSAGES 拼,否则测的是副本自己。
RESET_TEXT = {
    "zh-Hans": "您的验证码: {code}\n5 分钟内有效。如非本人操作,请忽略本邮件。",
    "en": "Your code: {code}\nValid for 5 minutes. If you did not ask for this, ignore this email.",
    "egy": "Ren Maa Ek: {code}\nWenen At 5. Nen Ek: Imen.",
}
RESET_SUBJECT = {
    "zh-Hans": "SoulLedger 密码重置验证码", "en": "SoulLedger Password reset code", "egy": "SoulLedger Ren Maa Wehem Sekhem",
}
CREDENTIAL_TEXT = {
    "zh-Hans": (
        "您的灵魂编号:{soul_code}\n初始密码:{password}\n有效期至 {expires}。首次登录后须修改密码。\n"
        "该密码只发送这一次;过期或遗失请联系所属文明的官员重置。"
    ),
    "en": (
        "Your soul code: {soul_code}\nInitial password: {password}\n"
        "Valid until {expires}. You must change the password at first sign-in.\n"
        "This password is sent only once; if it expires or is lost, ask an officer of your civilization to reset it."
    ),
    "egy": (
        "Ren Ba Ek: {soul_code}\nSekhem Tepy: {password}\n"
        "Wenen Er {expires}. Khemen Sekhem Em Aq Tepy.\n"
        "Sekhem Pen Hab Wa Djer. Mut Er Nen Gem: Sab Wehem Sekhem."
    ),
}
CREDENTIAL_SUBJECT = {"zh-Hans": "SoulLedger 灵魂账号", "en": "SoulLedger Soul account", "egy": "SoulLedger Aq Ba"}
FOOTER = {
    "zh-Hans": "这封信由系统发出，不接收回复。",
    "en": "This message was sent by the system; replies are not received.",
    "egy": "Shemes Pen Hab In Hemsu. Nen Wesheb.",
}


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    mail.outbox.clear()
    yield
    cache.clear()


def _tenant(code):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]


def _html(message):
    [(content, mimetype)] = message.alternatives
    assert mimetype == "text/html"
    return content


def _provisioned(on_commit, code, email, locale=None):
    """开号(初始密码信在 on_commit 里发出),可选地给本世账号设偏好。返回 (soul, 初始密码信)。"""
    soul = dead_soul(_tenant(code), contact_email=email)
    with on_commit(execute=True):
        account, created = svc.provision_account(soul, AccountOrigin.OFFICER)
    assert created
    [message] = mail.outbox
    mail.outbox.clear()
    if locale:
        PushPreference.objects.create(account=account, soul=soul, locale=locale)
    return soul, message


def _reset_mail(api_client, email):
    assert api_client.post("/api/v1/auth/reset-password/", {"email": email}, format="json").status_code == 200
    [message] = mail.outbox
    return message, cache.get(f"pwd_reset:{email}")


def _assert_credential(message, soul, locale):
    account = svc.current_account_of(soul)
    expires = f"{account.initial_password_expires_at:%Y-%m-%d %H:%M} (UTC)"
    password = message.body.split("\n")[1].split(":", 1)[1].strip()
    assert message.subject == CREDENTIAL_SUBJECT[locale]
    assert message.body == CREDENTIAL_TEXT[locale].format(soul_code=soul.soul_code, password=password, expires=expires)
    assert account.user.check_password(password)
    html = _html(message)
    assert f'<html lang="{locale}">' in html and FOOTER[locale] in html
    assert MESSAGES[locale]["credential"]["note_once"] in html


def _assert_reset(message, code, locale):
    assert message.subject == RESET_SUBJECT[locale]
    assert message.body == RESET_TEXT[locale].format(code=code)
    html = _html(message)
    assert f'<html lang="{locale}">' in html and FOOTER[locale] in html and code in html


@pytest.mark.parametrize("locale", ["zh-Hans", "en", "egy"])
def test_backend_copy_equals_the_language_pack(locale):
    pack = json.loads((PACKS / f"{locale}.json").read_text(encoding="utf-8"))
    assert pack["soul_mail"] == MESSAGES[locale]


@pytest.mark.django_db
@pytest.mark.parametrize("locale", ["zh-Hans", "en", "egy"])
def test_a_preference_decides_both_mails_whatever_the_civilization(
    api_client, django_capture_on_commit_callbacks, locale
):
    # 地府的灵魂:没有偏好时是中文,所以 en / egy 两格证明是偏好在起作用。
    soul, _ = _provisioned(django_capture_on_commit_callbacks, "CN_DIYU", f"pref-{locale}@example.com", locale=locale)

    message, code = _reset_mail(api_client, f"pref-{locale}@example.com")
    _assert_reset(message, code, locale)
    for other in set(RESET_TEXT) - {locale}:
        assert FOOTER[other] not in _html(message), f"{other} footer leaked into a {locale} mail"

    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        svc.reset_credential(svc.current_account_of(soul))
    [message] = mail.outbox
    _assert_credential(message, soul, locale)


@pytest.mark.django_db
@pytest.mark.parametrize("code", sorted(TENANT_LOCALE))
def test_without_a_preference_each_civilization_has_its_default(api_client, django_capture_on_commit_callbacks, code):
    locale = TENANT_LOCALE[code]
    email = f"default-{code.lower()}@example.com"
    soul, message = _provisioned(django_capture_on_commit_callbacks, code, email)
    _assert_credential(message, soul, locale)

    message, reset_code = _reset_mail(api_client, email)
    _assert_reset(message, reset_code, locale)


@pytest.mark.django_db
def test_an_unknown_civilization_falls_back_to_chinese(api_client, django_capture_on_commit_callbacks):
    """未知文明不猜:这两封信在有语言选择之前对所有人都是中文。"""
    soul, message = _provisioned(django_capture_on_commit_callbacks, "XX_NOWHERE", "nowhere@example.com")
    _assert_credential(message, soul, "zh-Hans")
    message, code = _reset_mail(api_client, "nowhere@example.com")
    _assert_reset(message, code, "zh-Hans")


@pytest.mark.django_db
def test_a_soul_user_without_an_account_reads_its_users_tenant(api_client, django_user_model):
    """重置信的收件人找不到灵魂账号时,退回用户自己的租户。"""
    django_user_model.objects.create_user(
        username="eg-orphan", email="eg-orphan@example.com", password="OldPass!123", role="SOUL",
        tenant=_tenant("EG_DUAT"),
    )
    message, code = _reset_mail(api_client, "eg-orphan@example.com")
    _assert_reset(message, code, "egy")
