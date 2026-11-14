"""官员 App 的指纹登录凭据(模型见 `OfficerDeviceLogin`;灵魂端的同形在 `apps/soul_accounts/device_login.py`)。

**吊销时机**:改密码 / 邮箱重置 / 管理员重置 / 停用 / 管理员强退这个人 → `signin_sessions.revoke_all`
(全部经 `passwords.end_sessions`;改密码的这台带着 `keep` 留下)标 `password_changed`;「退出其他全部」与退出某一台
(本人或管理员)→ `signed_out`;这部手机自己关 → `turned_off`。本人在这部手机上按「退出登录」**不**作废
(便捷度研究 §1 原则 2:生物登录凭据退出时留着,「换一个账号」时清并吊销)。调用方负责事务。
"""
import secrets

from django.utils import timezone

from .mfa import _hash_device
from .models import OfficerDeviceLogin, OfficerDeviceLoginRevokeReason as Reason


def _audit(user, description, *, request=None, changes=None):
    from .officer_reset import _audit as write

    write(user, description, request=request, changes=changes)


def issue(user, session=None, request=None) -> str:
    """新凭据,明文只在这里出现一次。`session`:开启时这部手机的登录会话。"""
    raw = secrets.token_urlsafe(32)
    OfficerDeviceLogin.objects.create(user=user, credential_hash=_hash_device(raw), session=session)
    _audit(user, "开启指纹登录(这部手机)", request=request, changes={"device_login": [False, True]})
    return raw


def find(username, raw) -> OfficerDeviceLogin | None:
    """凭据哈希对上、且属于叫 `username` 的那个账号的一行(吊销的也返回,好说原因)。别人的凭据配别人的用户名 → None。"""
    digest = _hash_device(raw or "")  # 哈希先算:用户名存不存在,耗时一样
    return OfficerDeviceLogin.objects.select_related("user", "user__tenant").filter(
        credential_hash=digest, user__username=username).first()


def bind(row, session) -> None:
    """这次登录建出的会话记到凭据上:之后退出这台,它跟着失效。"""
    row.last_used_at, row.session = timezone.now(), session
    row.save(update_fields=["last_used_at", "session"])


def bind_pending(pk, user, session) -> None:
    """两步验证第二步通过后,把待验证令牌带来的那条凭据记到新会话上(只认这个人自己的)。"""
    row = OfficerDeviceLogin.objects.filter(pk=pk, user=user).first()
    if row is not None:
        bind(row, session)


def _revoke(rows, reason) -> int:
    return rows.update(revoked_at=timezone.now(), revoked_reason=reason)


def revoke_for_user(user, *, keep_session=None, reason=Reason.PASSWORD_CHANGED) -> int:
    """`signin_sessions.revoke_all` 用:这个人全部有效凭据失效,`keep_session` 上的那条除外。"""
    rows = OfficerDeviceLogin.objects.filter(user=user, revoked_at__isnull=True)
    if keep_session is not None:
        rows = rows.exclude(session=keep_session)
    count = _revoke(rows, reason)
    if count:
        _audit(user, f"指纹登录失效:{Reason(reason).label}", changes={"revoked": count, "reason": reason})
    return count


def revoke_for_session(session) -> int:
    """`signin_sessions.revoke` 用:退出的那台手机上的凭据失效。"""
    rows = OfficerDeviceLogin.objects.filter(session=session, revoked_at__isnull=True)
    count = _revoke(rows, Reason.SIGNED_OUT)
    if count:
        _audit(session.user, "指纹登录失效:登录设备被退出", changes={"revoked": count})
    return count


def turn_off(raw) -> bool:
    """这部手机自己关:持有凭据即可,不看是谁登录着。幂等:不认识 / 已吊销 → False。"""
    row = OfficerDeviceLogin.objects.select_related("user__tenant").filter(
        credential_hash=_hash_device(raw or ""), revoked_at__isnull=True).first()
    if row is None:
        return False
    _revoke(OfficerDeviceLogin.objects.filter(pk=row.pk), Reason.TURNED_OFF)
    _audit(row.user, "关闭指纹登录(这部手机)", changes={"device_login": [True, False]})
    return True
