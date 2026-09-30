"""初始密码的发送端口。

一个渠道就是一个有 `channel`、`available_for(soul)`、`send(soul, soul_code,
password, expires_at)` 的对象。`send` 失败就抛异常 —— 调用方(services.py)把它
记成「待交付」,不吞。

`settings.SOUL_CREDENTIAL_DELIVERIES` 是按优先级排列的类路径列表,默认邮件在前、
短信在后。换服务商 = 换列表里的一项。
"""
from django.conf import settings
from django.utils.module_loading import import_string

from apps.authentication.mail import MESSAGES, fill, mail_locale, send_neutral_mail

DEFAULT_DELIVERIES = [
    "apps.soul_accounts.delivery.EmailCredentialDelivery",
    "apps.soul_accounts.delivery.SmsCredentialDelivery",
]


def _message(soul, soul_code, password, expires_at):
    """`(locale, 文案包, 纯文本, 有效期)`。明文只出现在消息正文里,从不进日志。"""
    locale = mail_locale(soul)
    pack = MESSAGES[locale]["credential"]
    expires = f"{expires_at:%Y-%m-%d %H:%M} (UTC)"
    return locale, pack, fill(pack["text"], soul_code=soul_code, password=password, expires_at=expires), expires


class EmailCredentialDelivery:
    channel = "EMAIL"

    def available_for(self, soul) -> bool:
        return bool(soul.contact_email)

    def send(self, soul, soul_code, password, expires_at):
        locale, pack, text, expires = _message(soul, soul_code, password, expires_at)
        send_neutral_mail(
            f"SoulLedger {pack['title']}",
            text,
            heading=pack["title"],
            rows=[(pack["soul_code_label"], soul_code), (pack["password_label"], password), (pack["expires_label"], expires)],
            notes=[pack["note_change"], pack["note_once"]],
            to=[soul.contact_email],
            locale=locale,
        )


class SmsCredentialDelivery:
    """实现位。`settings.SOUL_SMS_SENDER` 是一个 `(phone, text) -> None` 的类路径;
    未配置时视为不可用,于是没有邮箱的灵魂进入待交付,而不是假装发了短信。"""

    channel = "SMS"

    def _sender(self):
        path = getattr(settings, "SOUL_SMS_SENDER", "")
        return import_string(path) if path else None

    def available_for(self, soul) -> bool:
        return bool(soul.contact_phone) and self._sender() is not None

    def send(self, soul, soul_code, password, expires_at):
        self._sender()(soul.contact_phone, _message(soul, soul_code, password, expires_at)[2])


def deliveries():
    return [import_string(path)() for path in getattr(settings, "SOUL_CREDENTIAL_DELIVERIES", DEFAULT_DELIVERIES)]


def pick_delivery(soul):
    return next((d for d in deliveries() if d.available_for(soul)), None)
