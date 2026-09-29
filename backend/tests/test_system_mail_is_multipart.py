"""系统邮件 = 纯文本原件 + HTML 版(multipart/alternative),HTML 是中性皮。

后端发信的地方只有两处(2026-09-30 grep `send_mail|EmailMessage|EmailMultiAlternatives`):
密码重置验证码、灵魂账号初始密码。两处都要:
- 纯文本逐字不变(`body` 是不渲染 HTML 的客户端看到的全部);
- 恰好一个 text/html 部分,里面有同一份关键值;
- 值进 HTML 时被转义 —— `<script>` 不能原样出现;
- 中性皮:不带任何文明的匾色。
"""
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from django.core import mail
from django.core.cache import cache

from apps.soul_accounts.delivery import EmailCredentialDelivery

# 四个文明的匾色(frontend/src/__tests__/ledgerPaletteContract.test.ts 的 --color-civ-*,浅深两档)。
CIV_MAIN_COLOURS = ["#9a2f1f", "#b3402c", "#4a2a6a", "#7a52a6"]


def _html(message):
    assert len(message.alternatives) == 1, "expected exactly one HTML alternative"
    content, mimetype = message.alternatives[0]
    assert mimetype == "text/html"
    return content


def _assert_neutral(html):
    assert "#2b2724" in html and "#f4ede0" in html, "neutral plaque / paper tokens missing"
    for colour in CIV_MAIN_COLOURS:
        assert colour not in html.lower(), f"civilization colour {colour} leaked into a system mail"
    assert "border-radius" not in html and "box-shadow" not in html


@pytest.mark.django_db
def test_the_reset_mail_keeps_its_text_and_adds_a_neutral_html_part(api_client, django_user_model, cn_tenant):
    cache.clear()
    email = "forgot-html@example.com"
    django_user_model.objects.create_user(
        username="forgot-html", email=email, password="OldPass!123", role="SOUL", tenant=cn_tenant,
    )
    assert api_client.post("/api/v1/auth/reset-password/", {"email": email}, format="json").status_code == 200

    code = cache.get(f"pwd_reset:{email}")
    [message] = mail.outbox
    assert message.subject == "SoulLedger 密码重置验证码"
    assert message.body == f"您的验证码: {code}\n5 分钟内有效。如非本人操作,请忽略本邮件。"
    html = _html(message)
    assert code in html
    _assert_neutral(html)


def test_the_credential_mail_keeps_its_text_and_escapes_values_in_html():
    soul = SimpleNamespace(contact_email="zhang@example.com")
    expires = datetime(2026, 10, 7, 8, 30, tzinfo=UTC)
    hostile = "<script>alert(1)</script>&"
    EmailCredentialDelivery().send(soul, hostile, "Pw<b>x", expires)

    [message] = mail.outbox
    assert message.to == ["zhang@example.com"]
    assert message.body == (
        f"您的灵魂编号:{hostile}\n"
        "初始密码:Pw<b>x\n"
        "有效期至 2026-10-07 08:30 (UTC)。首次登录后须修改密码。\n"
        "该密码只发送这一次;过期或遗失请联系所属文明的官员重置。"
    ), "the plain-text part changed"

    html = _html(message)
    assert "<script>" not in html and "<b>x" not in html, "a value reached the HTML unescaped"
    assert "&lt;script&gt;alert(1)&lt;/script&gt;&amp;" in html
    assert "Pw&lt;b&gt;x" in html
    assert "2026-10-07 08:30 (UTC)" in html
    _assert_neutral(html)
