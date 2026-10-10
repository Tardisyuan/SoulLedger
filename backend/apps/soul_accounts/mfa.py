"""灵魂端两步验证的写路径(2026-10-11)。视图只调这里。

**密码学与尝试计数不在这里。** TOTP 校验、±1 步判对、过期 / 错误分开报、同一时间步不能用两次、
恢复码的生成与哈希、连续 5 次不通过锁 15 分钟 —— 全是 `apps/authentication/mfa.py` 的函数,
官员与灵魂共用同一份;`SoulMfa` 的字段名与 `OfficerMfa` 一一相同,那些函数按鸭子类型读写它。
这里只做灵魂独有的三件事:状态挂在**账号**上(跟着这一世走)、没有 cookie 所以「不再询问」是
App 自己保管的不透明令牌、以及官员关闭。

**并发**:每个会改状态的函数先锁账号行(`SELECT … FOR UPDATE`),于是同一账号的两次并发验证串行 ——
失败计数、`last_step` 的读—改—写不会丢更新(官员那套没有这层锁)。

**会话**:开启 / 关闭 / 重新生成恢复码**不动**已登录的其它设备(最小惊讶:灵魂在设置里自己做的事,
不该把自己踢下线)。官员关闭、转世、改密码则吊销刷新令牌 —— 这三处原本就是「这个账号的信任变了」。

**记住的设备令牌在这些时机全部作废**:关闭、(重新)开启、官员关闭、转世、改密码 / 邮箱重置密码 / 官员重置初始密码。
官员那套只在管理员重置时清;灵魂端更保守,因为令牌是明文放在手机里的,而改密码正是
「怀疑别人拿到了凭据」的时刻。
"""
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.tokens import Token

from apps.authentication import mfa as core
from apps.soul_accounts.models import SoulAccount, SoulMfa, SoulMfaDevice, SoulMfaRecoveryCode
from apps.soul_accounts.services import SoulAccountError, audit

#: 登录第一步通过、第二步没做完时发的凭据。类型与官员的 `mfa_pending` 不同:官员的验证端点不收它,
#: 灵魂的认证类(`soul_access`)与官员默认认证类(`access`)也都不收它 —— 它只开一扇门。
PENDING_TOKEN_TYPE = "soul_mfa_pending"
DEVICE_LIFETIME = timedelta(days=30)


class SoulMfaPendingToken(Token):
    token_type = PENDING_TOKEN_TYPE
    lifetime = core.PENDING_TOKEN_LIFETIME


def issue_pending(account) -> str:
    token = SoulMfaPendingToken()
    token["soul_account_id"] = str(account.pk)
    return str(token)


def account_from_pending(raw) -> SoulAccount | None:
    """凭据对、账号仍是当前世、用户仍启用 → 账号;否则 None(调用方统一答 `pending_invalid`)。"""
    from rest_framework_simplejwt.exceptions import TokenError

    try:
        token = SoulMfaPendingToken(raw)
    except TokenError:
        return None
    account = (
        SoulAccount.objects.select_related("user", "soul")
        .filter(pk=token.get("soul_account_id"), retired_at__isnull=True).first()
    )
    return account if account is not None and account.user.is_active else None


def _lock(account) -> SoulAccount:
    return SoulAccount.objects.select_for_update(of=("self",)).select_related("user", "soul").get(pk=account.pk)


def get_mfa(account) -> SoulMfa | None:
    return SoulMfa.objects.filter(account=account).first()


def is_enabled(account) -> bool:
    mfa = get_mfa(account)
    return mfa is not None and mfa.enabled


def status_of(account) -> dict:
    mfa = get_mfa(account)
    enabled = mfa is not None and mfa.enabled
    return {
        "enabled": enabled,
        "confirmed_at": mfa.confirmed_at if enabled else None,
        "last_used_at": mfa.last_used_at if enabled else None,
        "last_used_method": mfa.last_used_method if enabled else "",
        "recovery_codes_remaining": mfa.recovery_codes.filter(used_at__isnull=True).count() if enabled else 0,
    }


def lock_remaining(account) -> int:
    mfa = get_mfa(account)
    return core._lock_remaining(mfa) if mfa is not None else 0


# ── 设备令牌 ───────────────────────────────────────────────────────────────


def remember_device(account) -> str:
    raw = secrets.token_urlsafe(32)
    SoulMfaDevice.objects.create(
        account=account, token_hash=core._hash_device(raw), expires_at=timezone.now() + DEVICE_LIFETIME)
    return raw


def device_remembered(account, raw) -> bool:
    if not raw:
        return False
    row = SoulMfaDevice.objects.filter(
        account=account, token_hash=core._hash_device(raw), expires_at__gt=timezone.now()).first()
    if row is None:
        return False
    row.last_used_at = timezone.now()
    row.save(update_fields=["last_used_at"])
    return True


def void_devices(account):
    SoulMfaDevice.objects.filter(account=account).delete()


def void_all(account) -> bool:
    """密钥、恢复码(级联)、设备令牌一起删。返回此前是否开启。转世与官员关闭共用。"""
    was = is_enabled(account)
    SoulMfa.objects.filter(account=account).delete()
    void_devices(account)
    return was


# ── 向导 ───────────────────────────────────────────────────────────────────


def begin_setup(account):
    """新密钥,未确认。已开启的 409(先关再开);上一次没走完的密钥直接作废。→ (secret, otpauth_url)。"""
    with transaction.atomic():
        account = _lock(account)
        if is_enabled(account):
            raise SoulAccountError("两步验证已开启。", "already_enabled", 409)
        SoulMfa.objects.filter(account=account, confirmed_at__isnull=True).delete()
        row = SoulMfa.objects.create(account=account, secret=core.generate_secret())
    return row.secret, core.otpauth_url(row.secret, account.soul.soul_code)


def cancel_setup(account) -> bool:
    deleted, _ = SoulMfa.objects.filter(account=account, confirmed_at__isnull=True).delete()
    return deleted > 0


def confirm_setup(account, code, *, request=None):
    """向导第二步:验一个 6 位数字。对了 → 开启,并返回 10 个恢复码明文(**只此一次**);
    不对 → `("wrong" | "expired", [])`。"""
    with transaction.atomic():
        account = _lock(account)
        row = SoulMfa.objects.filter(account=account, confirmed_at__isnull=True).first()
        if row is None:
            if is_enabled(account):
                raise SoulAccountError("两步验证已开启。", "already_enabled", 409)
            raise SoulAccountError("请先开始设置。", "not_started", 409)
        outcome, step = core.classify_code(row.secret, code)
        if outcome != "ok":
            return outcome, []
        row.confirmed_at = timezone.now()
        row.last_step = step
        row.failed_attempts = 0
        row.locked_until = None
        row.save(update_fields=["confirmed_at", "last_step", "failed_attempts", "locked_until"])
        void_devices(account)  # 重新开启:此前记住的手机一律重新问
        pairs = core.new_recovery_codes()
        SoulMfaRecoveryCode.objects.bulk_create(SoulMfaRecoveryCode(mfa=row, code_hash=h) for _, h in pairs)
        core.audit(core.AuditAction.UPDATE, account.user, "灵魂两步验证已开启", request=request,
                   changes={"mfa_enabled": [False, True]})
    return "ok", [shown for shown, _ in pairs]


def regenerate_recovery_codes(account, *, request=None) -> list[str]:
    with transaction.atomic():
        account = _lock(account)
        row = get_mfa(account)
        if row is None or not row.enabled:
            raise SoulAccountError("两步验证未开启。", "not_enabled", 409)
        row.recovery_codes.all().delete()
        pairs = core.new_recovery_codes()
        SoulMfaRecoveryCode.objects.bulk_create(SoulMfaRecoveryCode(mfa=row, code_hash=h) for _, h in pairs)
        core.audit(core.AuditAction.UPDATE, account.user, "灵魂恢复码已重新生成,旧码作废", request=request)
    return [shown for shown, _ in pairs]


# ── 登录第二步 / 关闭 ──────────────────────────────────────────────────────────


def verify_second_step(account, *, code=None, recovery_code=None, request=None) -> dict:
    """→ {"code": "ok", "method"} 或 {"code": wrong|expired|locked|pending_invalid, …}。"""
    with transaction.atomic():
        account = _lock(account)
        row = get_mfa(account)
        if row is None or not row.enabled:
            return {"code": "pending_invalid"}
        return core.verify_login_code(row, code=code, recovery_code=recovery_code, request=request)


def disable(account, *, method, code="", password="", request=None) -> dict:
    """关闭。`method=totp` 验一个 6 位数字;`method=password` 验密码。两条的失败都记进同一个锁
    (官员那套的密码路径不计次;灵魂端偷到会话的人能无限猜密码来关掉它,所以这里计)。"""
    with transaction.atomic():
        account = _lock(account)
        row = get_mfa(account)
        if row is None or not row.enabled:
            raise SoulAccountError("两步验证未开启。", "not_enabled", 409)
        if method == "totp":
            outcome = core.verify_login_code(row, code=code or "", request=request)
            if outcome["code"] != "ok":
                return outcome
        else:
            if core._lock_remaining(row) > 0:
                return {"code": "locked", "retry_after": core._lock_remaining(row)}
            if not account.user.check_password(password or ""):
                return core._count_failure(row, "wrong_password", request=request)
        void_all(account)
        core.audit(core.AuditAction.UPDATE, account.user, "灵魂两步验证已关闭", request=request,
                   changes={"mfa_enabled": [True, False], "method": method})
    return {"code": "ok"}


# ── 官员关闭 ───────────────────────────────────────────────────────────────


def reset_by_officer(account, *, actor, reason, request=None):
    """官员替灵魂关闭:密钥、恢复码、设备令牌全清,吊销刷新令牌(灵魂重新登录时用密码,
    并在通知记录里看到是谁关的)。理由进审计行。**只能关,不能替灵魂开。**
    通知行在同一事务里写(回滚则一起不存在),推送在提交之后才入队。"""
    from apps.soul_accounts.services import _revoke_refresh_tokens
    from apps.soul_push import services as push

    with transaction.atomic():
        account = _lock(account)
        if account.retired_at is not None:
            raise SoulAccountError("该账号已随转世停用。", "account_retired", 409)
        if not is_enabled(account):
            raise SoulAccountError("该灵魂没有开启两步验证。", "not_enabled", 409)
        void_all(account)
        _revoke_refresh_tokens(account.user)
        audit("EXECUTE", account.soul, f"官员关闭灵魂两步验证:{reason}", actor=actor, request=request,
              resource_id=account.pk, resource="mfa",
              changes={"mfa_enabled": [True, False], "reason": reason, "sessions_revoked": True})
        name = (actor.display_name or actor.username)[:100]
        ids = push.record_mfa_reset(account, name)
        if ids:
            transaction.on_commit(lambda: push.enqueue(ids))
