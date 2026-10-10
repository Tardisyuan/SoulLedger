"""官员改密码、邮箱重置密码共用的两件事:密码强度的逐条原因,与让旧会话作废。

**强度** 走 Django 的 `AUTH_PASSWORD_VALIDATORS`(带 `user`,「与用户名太像」才生效)。
原因按条返回,每条带校验器自己的稳定 `code`(`password_too_short` / `password_too_common` /
`password_entirely_numeric` / `password_too_similar`):客户端按码显示本地化文案,
`message` 是 Django 的英文原句,只作兜底。

**作废** 两层:刷新令牌进黑名单(`_revoke_refresh_tokens`,灵魂端、两步验证重置也用它),
再把 `User.session_version` +1 —— 官员令牌带 `sv` 声明,比对不上的 access 立刻 401
(`OfficerJWTAuthentication`、WebSocket 握手),不等 access 自然过期。
"""
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import F


def weak_password_reasons(password: str, user) -> list[dict]:
    """空列表 = 通过。每条 `{"code", "message"}`。"""
    try:
        validate_password(password, user)
    except DjangoValidationError as exc:
        return [{"code": e.code or "password_invalid", "message": " ".join(e.messages)} for e in exc.error_list]
    return []


def end_sessions(user) -> None:
    """该官员此前签发的全部令牌作废。调用方负责事务;之后给当前设备签的新令牌带新的 `sv`。"""
    from apps.soul_accounts.services import _revoke_refresh_tokens

    _revoke_refresh_tokens(user)
    user.session_version = F("session_version") + 1
    user.save(update_fields=["session_version"])
    user.refresh_from_db(fields=["session_version"])


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
