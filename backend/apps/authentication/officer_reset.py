"""官员「忘记密码」(邮箱重置链接)与邮箱验证。2026-10-09 用户定。

灵魂走自己的六位验证码流程(`views.reset_password_request`);这里只管官员(`role != SOUL`)。

- **邮箱必须已验证**才会收到重置信:`User.email_verified`(存的是被验证的地址,改邮箱即失效)。
  验证 = 往资料页的邮箱发一条一次性链接,点开即标记。
- 令牌是 Django 的 `PasswordResetTokenGenerator`:HMAC(SECRET_KEY, 用户 pk + 密码哈希 + last_login +
  邮箱 + 时间戳),有效期 `settings.PASSWORD_RESET_TIMEOUT`(1 小时)。改了密码、登录过、改了邮箱都使它失效,
  所以一条链接只能用一次,不需要服务端存令牌。验证邮箱的令牌换了盐,且哈希里带「已验证地址」,验证过即失效。
- 申请端不查库(交给 worker,与 `password_help_request` 同一做法),所以应答与耗时都不泄露账号是否存在。
- 重置成功:校验器 → 改密 → 吊销该用户全部刷新令牌 → 清「不再询问」设备令牌(**不关两步验证**,
  下次登录仍要动态码)→ 审计行 → 给本人发一封「密码已修改」。
"""
import logging
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from apps.audit.models import AuditAction, AuditLog
from apps.core.client_ip import get_client_ip

from .mail import fill, send_neutral_mail
from .models import MfaRememberedDevice, User, UserRole
from .passwords import end_sessions

logger = logging.getLogger(__name__)

#: 同一账号每小时最多发几封重置信(超出静默不发,应答不变)。
MAX_MAILS_PER_ACCOUNT_PER_HOUR = 3
#: 资料页「发送验证邮件」每小时几封。
MAX_VERIFY_MAILS_PER_HOUR = 5
_HOUR = 3600


class OfficerResetTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "apps.authentication.officer_reset.OfficerResetTokenGenerator"


class EmailVerifyTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "apps.authentication.officer_reset.EmailVerifyTokenGenerator"

    def _make_hash_value(self, user, timestamp):
        # 已验证的地址进哈希:验证成功后同一条链接立刻失效;改邮箱也使它失效(父类已含 email)。
        return f"{super()._make_hash_value(user, timestamp)}{user.email_verified_address}"


reset_tokens = OfficerResetTokenGenerator()
verify_tokens = EmailVerifyTokenGenerator()


def encode_uid(user) -> str:
    return urlsafe_base64_encode(force_bytes(user.pk))


def user_from_uid(uid) -> User | None:
    try:
        return User.objects.filter(pk=force_str(urlsafe_base64_decode(uid))).first()
    except (TypeError, ValueError, OverflowError, UnicodeDecodeError):
        return None


def is_officer(user) -> bool:
    return user is not None and user.is_active and user.role != UserRole.SOUL


def can_receive_reset(user) -> bool:
    return is_officer(user) and user.email_verified


def find_officer(identifier: str) -> User | None:
    """用户名或邮箱(含 `@` 当邮箱)。用户名精确匹配,邮箱不分大小写(库内唯一)。"""
    identifier = (identifier or "").strip()
    if not identifier:
        return None
    if "@" in identifier:
        return User.objects.filter(email__iexact=identifier).first()
    return User.objects.filter(username=identifier).first()


# ── 邮件 ─────────────────────────────────────────────────────────────────────

MESSAGES = {
    "zh-Hans": {
        "reset": {
            "title": "重置密码",
            "link_label": "重置链接",
            "note": "链接 1 小时内有效,只能用一次。如非本人操作,请忽略本邮件,密码不会改变。",
            "text": "重置密码的链接(1 小时内有效,只能用一次):\n{{url}}\n如非本人操作,请忽略本邮件,密码不会改变。",
        },
        "verify": {
            "title": "验证邮箱",
            "link_label": "验证链接",
            "note": "链接 1 小时内有效。验证后,忘记密码时可用此邮箱重置。如非本人操作,请忽略本邮件。",
            "text": "验证邮箱的链接(1 小时内有效):\n{{url}}\n如非本人操作,请忽略本邮件。",
        },
        "changed": {
            "title": "密码已修改",
            "note": "你的 SoulLedger 密码刚刚被修改,所有设备上的登录已退出。如非本人操作,请立即联系管理员。",
            "text": "你的 SoulLedger 密码刚刚被修改,所有设备上的登录已退出。如非本人操作,请立即联系管理员。",
        },
    },
    "en": {
        "reset": {
            "title": "Reset your password",
            "link_label": "Reset link",
            "note": "The link works once and expires in 1 hour. If you did not ask for this, ignore this email; your password stays the same.",
            "text": "Link to reset your password (works once, expires in 1 hour):\n{{url}}\nIf you did not ask for this, ignore this email; your password stays the same.",
        },
        "verify": {
            "title": "Verify your email",
            "link_label": "Verification link",
            "note": "The link expires in 1 hour. Once verified, this address can reset your password. If you did not ask for this, ignore this email.",
            "text": "Link to verify your email (expires in 1 hour):\n{{url}}\nIf you did not ask for this, ignore this email.",
        },
        "changed": {
            "title": "Your password was changed",
            "note": "Your SoulLedger password was just changed and every device was signed out. If this was not you, contact an administrator now.",
            "text": "Your SoulLedger password was just changed and every device was signed out. If this was not you, contact an administrator now.",
        },
    },
}


def _send(user, kind: str, url: str | None = None) -> None:
    from apps.notifications.tasks import email_locale

    locale = email_locale(user)
    pack = MESSAGES[locale][kind]
    rows = [(pack["link_label"], url)] if url else []
    send_neutral_mail(
        f"SoulLedger {pack['title']}", fill(pack["text"], url=url or ""),
        heading=pack["title"], rows=rows, notes=[pack["note"]], to=[user.email], locale=locale,
    )


def _link(path: str, user, generator) -> str:
    return f"{settings.DESK_URL}{path}?uid={encode_uid(user)}&token={quote(generator.make_token(user))}"


def _audit(user, description, *, request=None, changes=None, ip=None, ua=""):
    AuditLog.objects.create(
        tenant=user.tenant, user=user, action=AuditAction.EXECUTE, resource="auth", resource_id=str(user.pk),
        description=description[:500], changes=changes,
        ip_address=get_client_ip(request) if request is not None else ip,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else ua,
    )


# ── 申请重置(worker 里跑) ──────────────────────────────────────────────────


def send_reset_mail_if_eligible(identifier: str, ip=None, ua="") -> bool:
    """查人、按账号限频、发信。任何一步不满足都**静默**返回 False —— 调用方的应答不变。"""
    user = find_officer(identifier)
    if not can_receive_reset(user):
        return False
    key = f"officer_reset_mails:{user.pk}"
    sent = cache.get(key, 0)
    if sent >= MAX_MAILS_PER_ACCOUNT_PER_HOUR:
        return False
    cache.set(key, sent + 1, timeout=_HOUR)
    try:
        _send(user, "reset", _link("/reset-password", user, reset_tokens))
    except Exception:
        logger.error("officer password reset mail could not be sent", exc_info=False)
        return False
    _audit(user, "官员申请邮箱重置密码,重置信已发出", ip=ip, ua=ua)
    return True


# ── 确认重置 ─────────────────────────────────────────────────────────────────


class ResetRefusedError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def confirm_reset(uid, token, new_password, *, request=None) -> User:
    user = user_from_uid(uid)
    # 无效 / 过期 / 已用 / 非官员 / 邮箱未验证 / 已停用,一律同一个答案。
    if not can_receive_reset(user) or not reset_tokens.check_token(user, token):
        raise ResetRefusedError("reset_link_invalid", "链接无效或已过期,请重新申请")
    try:
        validate_password(new_password, user)
    except ValidationError as exc:
        raise ResetRefusedError("weak_password", " ".join(exc.messages)) from exc

    with transaction.atomic():
        user.set_password(new_password)
        user.save(update_fields=["password"])
        end_sessions(user)  # 刷新令牌进黑名单 + session_version +1:已签发的 access 也立刻失效
        # 只清「不再询问」设备令牌,不碰 OfficerMfa:两步验证仍开着,下次登录照问动态码。
        MfaRememberedDevice.objects.filter(user=user).delete()
        _audit(user, "官员通过邮箱链接重置密码", request=request,
               changes={"password_reset": True, "sessions_revoked": True, "mfa_devices_cleared": True})
    try:
        _send(user, "changed")
    except Exception:
        logger.error("officer password changed notice could not be sent", exc_info=False)
    return user


# ── 邮箱验证 ─────────────────────────────────────────────────────────────────


def send_verification(user) -> bool:
    """给资料页的邮箱发验证链接。已验证 / 无邮箱返回 False;超过频率抛 `ResetRefusedError('rate_limited')`。"""
    if not user.email or user.email_verified:
        return False
    key = f"officer_verify_mails:{user.pk}"
    sent = cache.get(key, 0)
    if sent >= MAX_VERIFY_MAILS_PER_HOUR:
        raise ResetRefusedError("rate_limited", "请求过于频繁，请稍后再试")
    cache.set(key, sent + 1, timeout=_HOUR)
    _send(user, "verify", _link("/verify-email", user, verify_tokens))
    return True


def verify_email(uid, token, *, request=None) -> User:
    user = user_from_uid(uid)
    if not is_officer(user) or not user.email or not verify_tokens.check_token(user, token):
        raise ResetRefusedError("verify_link_invalid", "链接无效或已过期,请在资料页重新发送")
    user.email_verified_address = user.email
    user.email_verified_at = timezone.now()
    user.save(update_fields=["email_verified_address", "email_verified_at"])
    _audit(user, "官员邮箱已验证", request=request, changes={"email_verified": [False, True]})
    return user
