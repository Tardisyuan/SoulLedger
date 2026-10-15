"""官员改密码、邮箱重置密码共用的两件事:密码强度的逐条原因,与让旧会话作废。

**强度** 走 Django 的 `AUTH_PASSWORD_VALIDATORS`(带 `user`,「与用户名太像」才生效)。
原因按条返回,每条带校验器自己的稳定 `code`(`password_too_short` / `password_too_common` /
`password_entirely_numeric` / `password_too_similar`):客户端按码显示本地化文案,
`message` 是 Django 的英文原句,只作兜底。

**作废** 两层:刷新令牌进黑名单(`_revoke_refresh_tokens`,灵魂端、两步验证重置也用它),
再把 `User.session_version` +1 —— 官员令牌带 `sv` 声明,比对不上的 access 立刻 401
(`OfficerJWTAuthentication`、WebSocket 握手),不等 access 自然过期。
"""
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import F
from django.utils import timezone

#: 官员不能重复使用的最近几个密码(含当前这个):库里留 `PASSWORD_HISTORY_KEEP - 1` 条旧哈希 + 当前。
PASSWORD_HISTORY_KEEP = 5
#: 管理员(ADMIN)密码的最短长度;其余官员与灵魂是 Django 默认的 8。
ADMIN_MIN_PASSWORD_LENGTH = 12
#: 密码已过期 / 必须先改时,仍可访问的官员接口(其余一律 403 `password_change_required`)。
PASSWORD_CHANGE_ALLOWED = frozenset({
    ("POST", "/api/v1/auth/change-password/"), ("POST", "/api/v1/auth/logout/"), ("GET", "/api/v1/auth/profile/"),
})


def _is_officer(user) -> bool:
    return getattr(user, "pk", None) is not None and getattr(user, "role", None) != "SOUL"


class RoleMinimumLengthValidator:
    """管理员的最短长度比普通官员长(12 对 8)。用户还没建出来(管理员开通)时按 `user` 的 role 判。"""

    def validate(self, password, user=None):
        if getattr(user, "role", None) == "ADMIN" and len(password) < ADMIN_MIN_PASSWORD_LENGTH:
            raise DjangoValidationError(
                f"This password is too short. It must contain at least {ADMIN_MIN_PASSWORD_LENGTH} characters.",
                code="password_too_short",
            )

    def get_help_text(self):
        return f"Administrators need at least {ADMIN_MIN_PASSWORD_LENGTH} characters."


class PasswordHistoryValidator:
    """新密码不能是官员当前的、也不能是最近用过的几个。灵魂账号与还没建出来的用户不查。"""

    def validate(self, password, user=None):
        if not _is_officer(user):
            return
        from .models import PasswordHistory

        hashes = [user.password] + list(
            PasswordHistory.objects.filter(user=user).values_list("password_hash", flat=True)[: PASSWORD_HISTORY_KEEP - 1]
        )
        if any(check_password(password, h) for h in hashes if h):
            raise DjangoValidationError(
                "This password was used recently. Choose one you have not used lately.", code="password_reused"
            )

    def get_help_text(self):
        return "Your recent passwords cannot be reused."


def set_officer_password(user, raw: str, *, must_change: bool = False) -> None:
    """官员设新密码的唯一入口:旧哈希进历史(只留最近几条)、记 `password_changed_at`、
    `must_change_password` 按调用方(本人改 → 假;管理员开通 / 重置 → 真)。调用方负责事务与其余 `save`;
    这里保存 password / password_changed_at / must_change_password 三个字段。"""
    from .models import PasswordHistory

    with transaction.atomic():
        old = user.password
        user.set_password(raw)
        user.password_changed_at = timezone.now()
        user.must_change_password = must_change
        user.save(update_fields=["password", "password_changed_at", "must_change_password"])
        if _is_officer(user) and old:
            PasswordHistory.objects.create(user=user, password_hash=old)
            keep = list(PasswordHistory.objects.filter(user=user).values_list("pk", flat=True)[: PASSWORD_HISTORY_KEEP - 1])
            PasswordHistory.objects.filter(user=user).exclude(pk__in=keep).delete()


def password_change_required(user) -> bool:
    """官员须先改密码:被标记(首次登录 / 管理员重置),或开了 `OFFICER_PASSWORD_MAX_AGE_DAYS` 且已超期。"""
    if getattr(user, "role", None) == "SOUL":
        return False
    if user.must_change_password:
        return True
    days = getattr(settings, "OFFICER_PASSWORD_MAX_AGE_DAYS", 0)
    return days > 0 and user.password_changed_at < timezone.now() - timedelta(days=days)


def weak_password_reasons(password: str, user) -> list[dict]:
    """空列表 = 通过。每条 `{"code", "message"}`。"""
    try:
        validate_password(password, user)
    except DjangoValidationError as exc:
        return [{"code": e.code or "password_invalid", "message": " ".join(e.messages)} for e in exc.error_list]
    return []


def end_sessions(user, keep_session=None) -> None:
    """该官员此前签发的全部令牌作废。调用方负责事务;之后给当前设备签的新令牌带新的 `sv`。

    「登录设备」表(`SignInSession`)同步:除 `keep_session`(改密码的这台,它拿带同一个 `sid` 的新令牌)
    外全部标成已退出,它们的「30 天内不再询问」一并作废。官员与灵魂、改密码 / 邮箱重置 / 管理员重置 /
    转世都经过这里,所以只在这一处同步。"""
    from apps.soul_accounts.services import _revoke_refresh_tokens

    from . import signin_sessions

    _revoke_refresh_tokens(user)
    signin_sessions.revoke_all(user, keep=keep_session)
    user.session_version = F("session_version") + 1
    user.save(update_fields=["session_version"])
    user.refresh_from_db(fields=["session_version"])
    # 已经连上的 socket 握手时版本更低:提交后关掉它们,不等下次重连才被拒。
    # 当前设备的 socket 也在其中 —— 它带着新令牌重连即可(客户端对 4002 会重连)。
    from apps.events.realtime import close_user_sockets

    close_user_sockets(user.pk, user.session_version)


def end_push_registrations(user, keep_token: str = "") -> None:
    """Delete the user's officer-app push registrations, except the one holding `keep_token`.

    Their logins just ended (`end_sessions`), so a signed-out device must not keep receiving pushes.
    `keep_token` is the device that changed the password and stays signed in. A token that is not
    this user's matches nothing here, so it keeps nothing: the same result as sending none, and no
    error that would reveal whose token it is. Caller owns the transaction.
    """
    from apps.officer_app.models import OfficerPushDevice

    rows = OfficerPushDevice.objects.filter(user=user)
    if keep_token:
        rows = rows.exclude(token=keep_token)
    rows.delete()
