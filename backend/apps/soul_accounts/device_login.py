"""面容 / 指纹登录的凭据(模型见 `SoulDeviceLogin`)。视图只调这里。

**吊销时机**(Design 第二十批 §一.5):灵魂在别处改密码 / 邮箱重置 → 全部 `password_changed`;
在这部手机上改密码 → 带着自己的凭据来的那一条保留、其余 `password_changed`;退出那部手机的登录设备 →
`turned_off`(`revoke_signed_out`);官员重置 →
`password_reset_by_officer`;转生 → 旧账号的 `account_reincarnated`;灵魂自己关 → `turned_off`。
调用方负责事务:吊销与引起它的那笔业务同生共死。
"""
import secrets

from django.utils import timezone

from apps.authentication.mfa import _hash_device
from apps.soul_accounts.models import DeviceLoginRevokeReason, SoulDeviceLogin
from apps.soul_accounts.services import audit


def issue(account, session=None) -> str:
    """新凭据,明文只在这里出现一次。`session`:开启时这部手机的登录会话(退出它时凭据一并失效)。"""
    raw = secrets.token_urlsafe(32)
    SoulDeviceLogin.objects.create(account=account, credential_hash=_hash_device(raw), session=session)
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


def holds(account, raw) -> bool:
    """`raw` 是这个账号**尚有效**的一条面容 / 指纹登录凭据。敏感动作(导出资料)用它代替输密码:
    凭据放在要验证生物特征才能取出的安全存储里,持有它 = 刚刚认过面容。"""
    if not raw:
        return False
    return SoulDeviceLogin.objects.filter(account=account, credential_hash=_hash_device(raw),
                                          revoked_at__isnull=True).exists()


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


def revoke_signed_out(account, *, sessions=None, keep_session=None) -> int:
    """退出登录设备时,那部手机的面容 / 指纹登录一并失效(review-2026-11-01 P2 #17:此前只退会话,
    丢的手机还能刷脸登进来)。标 `turned_off`(App 把它读作「这部手机的凭据在别处被关了」)。
    `sessions`:退出的那几台;`keep_session`:「除这台外全部退出」时留下的这台 —— 其余凭据**全部**失效,
    包括记不清是哪台的(开启早于 2026-11-01、或这台后来改用密码登录过)。返回失效条数。"""
    rows = SoulDeviceLogin.objects.filter(account=account, revoked_at__isnull=True)
    if sessions is not None:
        rows = rows.filter(session__in=sessions)
    if keep_session is not None:
        # ponytail: 凭据只记「开启 / 最近一次刷脸登录」那次的会话;这台之后改用密码登录的话,它自己的凭据也会失效,
        # 重新开一次即可。要精确就得让密码登录也带上凭据。
        rows = rows.exclude(session=keep_session)
    count = rows.update(revoked_at=timezone.now(), revoked_reason=DeviceLoginRevokeReason.TURNED_OFF)
    if count:
        audit("UPDATE", account.soul, "面容/指纹登录失效:登录设备被退出", resource="device_login",
              resource_id=account.pk, changes={"revoked": count, "reason": DeviceLoginRevokeReason.TURNED_OFF})
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
