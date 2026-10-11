"""面容 / 指纹登录的凭据(模型见 `SoulDeviceLogin`)。视图只调这里。

**吊销时机**(Design 第二十批 §一.5):灵魂在别处改密码 / 邮箱重置 → 全部 `password_changed`;
在这部手机上改密码 → 带着自己的凭据来的那一条保留、其余 `password_changed`;官员重置 →
`password_reset_by_officer`;转生 → 旧账号的 `account_reincarnated`;灵魂自己关 → `turned_off`。
调用方负责事务:吊销与引起它的那笔业务同生共死。
"""
import secrets

from django.utils import timezone

from apps.authentication.mfa import _hash_device
from apps.soul_accounts.models import DeviceLoginRevokeReason, SoulDeviceLogin
from apps.soul_accounts.services import audit


def issue(account) -> str:
    """新凭据,明文只在这里出现一次。"""
    raw = secrets.token_urlsafe(32)
    SoulDeviceLogin.objects.create(account=account, credential_hash=_hash_device(raw))
    audit("UPDATE", account.soul, "开启面容/指纹登录(这部手机)", actor=account.user, resource="device_login",
          resource_id=account.pk, changes={"device_login": [False, True]})
    return raw


def find(soul, raw) -> SoulDeviceLogin | None:
    """编号对应灵魂(任何一世)名下、哈希匹配的那一行。哈希对任何输入都先算(不论编号是否存在)。"""
    digest = _hash_device(raw or "")
    if soul is None:
        return None
    return SoulDeviceLogin.objects.select_related("account").filter(
        credential_hash=digest, account__soul=soul).first()


def revoke_all(account, reason, *, keep_credential="") -> int:
    """账号名下所有尚有效的凭据标 `reason`;`keep_credential`(明文)指向的那条留着。返回吊销条数。"""
    rows = SoulDeviceLogin.objects.filter(account=account, revoked_at__isnull=True)
    if keep_credential:
        rows = rows.exclude(credential_hash=_hash_device(keep_credential))
    count = rows.update(revoked_at=timezone.now(), revoked_reason=reason)
    if count:
        audit("UPDATE", account.soul, f"面容/指纹登录失效:{DeviceLoginRevokeReason(reason).label}",
              resource="device_login", resource_id=account.pk, changes={"revoked": count, "reason": reason})
    return count


def turn_off(raw) -> bool:
    """这部手机自己关:持有凭据即可,不看是谁登录着。幂等:不认识 / 已吊销 → False,不报错。"""
    row = SoulDeviceLogin.objects.select_related("account__soul", "account__user").filter(
        credential_hash=_hash_device(raw or ""), revoked_at__isnull=True).first()
    if row is None:
        return False
    account = row.account
    row.revoked_at, row.revoked_reason = timezone.now(), DeviceLoginRevokeReason.TURNED_OFF
    row.save(update_fields=["revoked_at", "revoked_reason"])
    audit("UPDATE", account.soul, "关闭面容/指纹登录(这部手机)", actor=account.user, resource="device_login",
          resource_id=account.pk, changes={"device_login": [True, False]})
    return True
