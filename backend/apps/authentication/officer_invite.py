"""邮件邀请官员(2026-10-25 用户决定):管理员填邮箱,官员点一次性链接自己设密码。

复用邮箱重置的那一套(`officer_reset.py`):Django 的 `PasswordResetTokenGenerator`(换了盐)、同一个发信函数、
同一种 `uid` + `token` 链接,落在 Web 的 `/accept-invite`。

- 被邀请的人先建成**在职、无可用密码**的官员(`set_unusable_password`),所以在设好密码之前登不进来。
- 令牌哈希里有密码哈希、`last_login`、邮箱:设了密码、改了邮箱,链接即失效 —— 只能用一次,服务端不存令牌。
  另外只接受「还没有可用密码」的账号:一个已经设过密码的人,旧邀请链接永远无效。
- 有效期 7 天(`INVITE_TIMEOUT`),与重置的 1 小时分开:邀请信常常隔几天才被打开。
- 设好密码 = 邮箱已验证(点链接就是证明),之后忘记密码能走邮箱重置。
- 同一殿里对同一邮箱再邀请一次 = 重发(还没接受时);邮箱已属于别的账号 → `email_taken`。
- 批量导入(`UserViewSet.import_csv`)里不写密码而写了邮箱的行,也走这里发邀请。
"""
import logging

from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from django.utils.http import base36_to_int

from .models import User, UserRole, is_assignable_role
from .officer_reset import ResetRefusedError, _audit, _link, _send, user_from_uid
from .passwords import set_officer_password, weak_password_reasons

logger = logging.getLogger(__name__)

INVITE_TIMEOUT = 7 * 24 * 3600


class InviteTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "apps.authentication.officer_invite.InviteTokenGenerator"

    def check_token(self, user, token):
        """父类同一套比较,只是有效期读 `INVITE_TIMEOUT` 而不是 `PASSWORD_RESET_TIMEOUT`。"""
        if not (user and token):
            return False
        try:
            ts = base36_to_int(token.split("-")[0])
        except ValueError:
            return False
        if not any(constant_time_compare(self._make_token_with_timestamp(user, ts, secret), token)
                   for secret in [self.secret, *self.secret_fallbacks]):
            return False
        return (self._num_seconds(self._now()) - ts) <= INVITE_TIMEOUT


invite_tokens = InviteTokenGenerator()


class InviteRefusedError(Exception):
    def __init__(self, code, message, field=None):
        super().__init__(message)
        self.code, self.message, self.field = code, message, field

    def as_payload(self):
        return {"error": self.message, "code": self.code, **({"field": self.field} if self.field else {})}


def is_pending(user) -> bool:
    """邀请了、还没设密码。"""
    return user.is_active and user.role != UserRole.SOUL and not user.has_usable_password()


def _free_username(email):
    base = (email.split("@", 1)[0] or "officer")[:140]
    name, n = base, 1
    while User.objects.filter(username=name).exists():
        n += 1
        name = f"{base}{n}"
    return name


def validate(email, role, tenant, *, username=""):
    """返回已有的、可重发的被邀请人(或 None);不合规则抛 `InviteRefusedError`。"""
    from django.core.exceptions import ValidationError
    from django.core.validators import validate_email

    try:
        validate_email(email)
    except ValidationError:
        raise InviteRefusedError("email_invalid", "invalid email", "email") from None
    if role in (UserRole.SOUL, UserRole.ADMIN) or not is_assignable_role(role):
        raise InviteRefusedError("role_invalid", f"invalid role '{role}'", "role")
    existing = User.objects.filter(email__iexact=email).first()
    if existing is not None:
        if existing.tenant_id == tenant.pk and is_pending(existing):
            return existing
        raise InviteRefusedError("email_taken", "email already belongs to another account", "email")
    if username and User.objects.filter(username=username).exists():
        raise InviteRefusedError("username_taken", f"username '{username}' already exists", "username")
    return None


def create_invitee(email, role, tenant, *, username="", display_name=""):
    return User.objects.create_user(username=username or _free_username(email), email=email, password=None,
                                    role=role, tenant=tenant, display_name=display_name)


def send_after_commit(user):
    """邀请信在提交后发(账号回滚就不发);发不出去只记日志 —— 管理员可以再点一次重发。"""
    def send():
        try:
            _send(user, "invite", _link("/accept-invite", user, invite_tokens))
        except Exception:
            logger.error("officer invite mail could not be sent", exc_info=False)

    transaction.on_commit(send)


def invite(email, role, tenant, *, actor, username="", display_name="", request=None) -> tuple[User, bool]:
    """(被邀请人, 是否新建)。"""
    email = email.strip()
    existing = validate(email, role, tenant, username=username)
    with transaction.atomic():
        user = existing or create_invitee(email, role, tenant, username=username, display_name=display_name)
        _audit(user, f"管理员邀请官员 {email}" + ("(重发)" if existing else ""), request=request,
               changes={"invited_by": str(actor.pk), "role": user.role, "resent": bool(existing)})
        send_after_commit(user)
    return user, existing is None


def accept(uid, token, new_password, *, request=None) -> User:
    user = user_from_uid(uid)
    if user is None or not is_pending(user) or not invite_tokens.check_token(user, token):
        raise ResetRefusedError("invite_link_invalid", "邀请链接无效或已过期,请联系管理员重新邀请")
    reasons = weak_password_reasons(new_password, user)
    if reasons:
        raise ResetRefusedError("weak_password", " ".join(r["message"] for r in reasons), reasons)
    with transaction.atomic():
        set_officer_password(user, new_password)
        user.email_verified_address = user.email
        user.email_verified_at = timezone.now()
        user.save(update_fields=["email_verified_address", "email_verified_at"])
        _audit(user, "官员通过邀请链接设置了密码", request=request,
               changes={"invite_accepted": True, "email_verified": [False, True]})
    return user

