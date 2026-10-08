"""官员两步验证(TOTP,A12)。规则与数字都在这一个文件里;模型在 models.py,视图在 mfa_views.py。

TOTP 是 RFC 6238 的 SHA-1 / 6 位 / 30 秒,标准库 hmac 就够,没有引 pyotp。

**过期与不对分开报(用户 2026-10-09 决定)**:当前时间步 ±1 判对;再往前 2–4 步(60–120 秒内)
对得上判 `expired`;都对不上判 `wrong`。同一个时间步只能通过一次(`last_step`),重放判 `expired`
—— 那个码确实用过了,对用户是「等下一个」。

**锁定**:连续 5 次不通过(过期与重放也计),锁 15 分钟,与登录页的 5 次 / 15 分钟同一组数字,
按账号记在 OfficerMfa 行上(不按 IP:第二步只有持 pending token 的人到得了)。

**待验证令牌**:密码对了、还没验码时发的 simplejwt Token,`token_type="mfa_pending"`,5 分钟。
默认认证类只认 `access`,所以它打不开任何接口;只有 `/auth/mfa/verify/` 收它。

**设备令牌**:「30 天内不再询问」是**另一个**令牌,不是刷新令牌 —— 32 字节随机值放 httpOnly cookie,
库里存 sha256。登出不清它;管理员重置时连同验证器、恢复码一起清,并吊销刷新令牌。
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from datetime import timedelta
from urllib.parse import quote

from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.tokens import Token

from apps.audit.models import AuditAction, AuditLog
from apps.core.client_ip import get_client_ip

from .models import MfaRecoveryCode, MfaRememberedDevice, OfficerMfa, UserRole

TOTP_STEP_SECONDS = 30
TOTP_DIGITS = 6
#: ±N 步判对。
TOTP_VALID_SKEW = 1
#: 比有效窗口更早、但还判「过期」的步数(2..4 → 60–120 秒前)。
TOTP_EXPIRED_STEPS = 4

MFA_MAX_ATTEMPTS = 5
MFA_LOCK_SECONDS = 900

RECOVERY_CODE_COUNT = 10
#: 不含 0/O/1/I/L 的小写字母数字:手抄不会错。
RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"

PENDING_TOKEN_LIFETIME = timedelta(minutes=5)
DEVICE_COOKIE = "soulledger_mfa_device"
DEVICE_LIFETIME = timedelta(days=30)
DEVICE_COOKIE_PATH = "/api/v1/auth/"

ISSUER = "SoulLedger"

#: `Tenant.settings` 里的键:要求开启两步验证的角色名列表。ADMIN 不在列表里也始终要求。
MFA_REQUIRED_ROLES_SETTING = "mfa_required_roles"


# ── TOTP ─────────────────────────────────────────────────────────────────────


def generate_secret() -> str:
    """160 位随机,base32 无填充(验证器 App 都认)。"""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_at(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** TOTP_DIGITS)
    return f"{code:0{TOTP_DIGITS}d}"


def otpauth_url(secret: str, username: str) -> str:
    label = quote(f"{ISSUER}:{username}", safe="")
    return f"otpauth://totp/{label}?secret={secret}&issuer={ISSUER}&algorithm=SHA1&digits={TOTP_DIGITS}&period={TOTP_STEP_SECONDS}"


def normalize_code(raw) -> str:
    """去掉空格与连字符;粘贴来的「123 456」「123-456」照收。"""
    return "".join(ch for ch in str(raw or "") if ch not in " -‑–")


def classify_code(secret: str, code: str, *, now: float | None = None, last_step: int | None = None):
    """→ ("ok", step) | ("expired", None) | ("wrong", None)。常数时间比较。"""
    code = normalize_code(code)
    if len(code) != TOTP_DIGITS or not code.isdigit():
        return "wrong", None
    current = int((time.time() if now is None else now) // TOTP_STEP_SECONDS)
    for delta in range(-TOTP_VALID_SKEW, TOTP_VALID_SKEW + 1):
        step = current + delta
        if hmac.compare_digest(totp_at(secret, step), code):
            if last_step is not None and step <= last_step:
                return "expired", None
            return "ok", step
    for delta in range(TOTP_VALID_SKEW + 1, TOTP_EXPIRED_STEPS + 1):
        if hmac.compare_digest(totp_at(secret, current - delta), code):
            return "expired", None
    return "wrong", None


# ── 状态 ─────────────────────────────────────────────────────────────────────


def get_mfa(user) -> OfficerMfa | None:
    return OfficerMfa.objects.filter(user=user).first()


def is_enabled(user) -> bool:
    mfa = get_mfa(user)
    return mfa is not None and mfa.enabled


def required_roles(tenant) -> list[str]:
    roles = ((tenant.settings if tenant is not None else None) or {}).get(MFA_REQUIRED_ROLES_SETTING) or []
    return [r for r in roles if isinstance(r, str)]


def is_required(user) -> bool:
    """ADMIN 始终要求;其余看殿设置。灵魂账号永远不要求。"""
    role = getattr(user, "role", None)
    if role == UserRole.SOUL:
        return False
    if role == UserRole.ADMIN:
        return True
    return role in required_roles(getattr(user, "tenant", None))


def status_of(user) -> dict:
    mfa = get_mfa(user)
    enabled = mfa is not None and mfa.enabled
    return {
        "enabled": enabled,
        "required": is_required(user),
        "confirmed_at": mfa.confirmed_at if enabled else None,
        "last_used_at": mfa.last_used_at if enabled else None,
        "last_used_method": mfa.last_used_method if enabled else "",
        "recovery_codes_remaining": mfa.recovery_codes.filter(used_at__isnull=True).count() if enabled else 0,
    }


# ── 审计 ─────────────────────────────────────────────────────────────────────


def audit(action, user, description, *, actor=None, request=None, changes=None):
    AuditLog.objects.create(
        tenant=getattr(user, "tenant", None),
        user=actor if actor is not None else user,
        action=action,
        resource="mfa",
        resource_id=str(user.pk),
        description=description[:500],
        changes=changes,
        ip_address=get_client_ip(request) if request is not None else None,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else "",
    )


# ── 向导 ─────────────────────────────────────────────────────────────────────


def begin_setup(user) -> OfficerMfa:
    """新密钥,未确认。已开启的不走这里(视图答 409);上一次没走完的直接丢掉。"""
    OfficerMfa.objects.filter(user=user, confirmed_at__isnull=True).delete()
    return OfficerMfa.objects.create(user=user, secret=generate_secret())


def _issue_recovery_codes(mfa) -> list[str]:
    mfa.recovery_codes.all().delete()
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(8))
        codes.append(f"{raw[:4]}-{raw[4:]}")
        MfaRecoveryCode.objects.create(mfa=mfa, code_hash=make_password(raw))
    return codes


def confirm_setup(mfa, code) -> tuple[str, list[str]]:
    """第三步:验一次码。对了 → 记 verified_at、生成恢复码并返回明文(只此一次)。"""
    outcome, step = classify_code(mfa.secret, code)
    if outcome != "ok":
        return outcome, []
    mfa.verified_at = timezone.now()
    mfa.last_step = step
    mfa.save(update_fields=["verified_at", "last_step"])
    return "ok", _issue_recovery_codes(mfa)


def complete_setup(mfa, *, request=None) -> OfficerMfa:
    """第四步「完成」:只有这里把它打开。"""
    mfa.confirmed_at = timezone.now()
    mfa.failed_attempts = 0
    mfa.locked_until = None
    mfa.save(update_fields=["confirmed_at", "failed_attempts", "locked_until"])
    audit(AuditAction.UPDATE, mfa.user, "两步验证已开启", request=request, changes={"mfa_enabled": [False, True]})
    return mfa


def cancel_setup(user) -> bool:
    """中途退出:未确认的密钥作废。已开启的不动。"""
    deleted, _ = OfficerMfa.objects.filter(user=user, confirmed_at__isnull=True).delete()
    return deleted > 0


def regenerate_recovery_codes(mfa, *, request=None) -> list[str]:
    codes = _issue_recovery_codes(mfa)
    audit(AuditAction.UPDATE, mfa.user, "恢复码已重新生成,旧码作废", request=request)
    return codes


def disable(user, *, request=None, actor=None):
    """关闭:密钥、恢复码、设备令牌一起删。"""
    with transaction.atomic():
        OfficerMfa.objects.filter(user=user).delete()
        MfaRememberedDevice.objects.filter(user=user).delete()
    audit(AuditAction.UPDATE, user, "两步验证已关闭", request=request, actor=actor, changes={"mfa_enabled": [True, False]})


def admin_reset(user, *, actor, reason, request=None):
    """管理员重置:验证器、恢复码、「不再询问」设备令牌全清,并吊销该用户所有刷新令牌。
    理由进审计行的 changes。"""
    from apps.soul_accounts.services import _revoke_refresh_tokens

    was_enabled = is_enabled(user)
    with transaction.atomic():
        OfficerMfa.objects.filter(user=user).delete()
        MfaRememberedDevice.objects.filter(user=user).delete()
        _revoke_refresh_tokens(user)
    audit(
        AuditAction.EXECUTE, user, f"管理员重置两步验证:{reason}", actor=actor, request=request,
        changes={"mfa_enabled": [was_enabled, False], "reason": reason, "sessions_revoked": True},
    )


# ── 登录第二步 ─────────────────────────────────────────────────────────────────


class PendingToken(Token):
    token_type = "mfa_pending"
    lifetime = PENDING_TOKEN_LIFETIME


def _lock_remaining(mfa) -> int:
    if mfa.locked_until is None:
        return 0
    return max(0, int((mfa.locked_until - timezone.now()).total_seconds()))


def _count_failure(mfa, outcome, *, request=None) -> dict:
    mfa.failed_attempts += 1
    remaining = MFA_MAX_ATTEMPTS - mfa.failed_attempts
    if remaining <= 0:
        mfa.locked_until = timezone.now() + timedelta(seconds=MFA_LOCK_SECONDS)
        mfa.failed_attempts = 0
        mfa.save(update_fields=["failed_attempts", "locked_until"])
        audit(AuditAction.LOGIN, mfa.user, f"两步验证连续 {MFA_MAX_ATTEMPTS} 次不通过,锁定 {MFA_LOCK_SECONDS // 60} 分钟", request=request)
        return {"code": "locked", "retry_after": MFA_LOCK_SECONDS}
    mfa.save(update_fields=["failed_attempts"])
    audit(AuditAction.LOGIN, mfa.user, f"两步验证不通过({outcome})", request=request)
    return {"code": outcome, "remaining_attempts": remaining, "lock_minutes": MFA_LOCK_SECONDS // 60}


def verify_login_code(mfa, *, code=None, recovery_code=None, request=None) -> dict:
    """登录第二步的一次尝试。→ {"code": "ok", "method": …} 或 {"code": wrong|expired|locked, …}。"""
    if _lock_remaining(mfa) > 0:
        return {"code": "locked", "retry_after": _lock_remaining(mfa)}
    now = timezone.now()
    if recovery_code is not None:
        raw = normalize_code(recovery_code).lower()
        for row in mfa.recovery_codes.filter(used_at__isnull=True):
            if check_password(raw, row.code_hash):
                row.used_at = now
                row.save(update_fields=["used_at"])
                mfa.last_used_at, mfa.last_used_method, mfa.failed_attempts = now, "recovery", 0
                mfa.save(update_fields=["last_used_at", "last_used_method", "failed_attempts"])
                audit(AuditAction.LOGIN, mfa.user, "用恢复码通过两步验证", request=request)
                return {"code": "ok", "method": "recovery"}
        return _count_failure(mfa, "wrong", request=request)
    outcome, step = classify_code(mfa.secret, code, last_step=mfa.last_step)
    if outcome != "ok":
        return _count_failure(mfa, outcome, request=request)
    mfa.last_step, mfa.last_used_at, mfa.last_used_method, mfa.failed_attempts = step, now, "totp", 0
    mfa.save(update_fields=["last_step", "last_used_at", "last_used_method", "failed_attempts"])
    return {"code": "ok", "method": "totp"}


# ── 设备令牌 ───────────────────────────────────────────────────────────────────


def _hash_device(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def remember_device(user) -> str:
    raw = secrets.token_urlsafe(32)
    MfaRememberedDevice.objects.create(user=user, token_hash=_hash_device(raw), expires_at=timezone.now() + DEVICE_LIFETIME)
    return raw


def device_remembered(request, user) -> bool:
    raw = request.COOKIES.get(DEVICE_COOKIE) if request is not None else None
    if not raw:
        return False
    row = MfaRememberedDevice.objects.filter(user=user, token_hash=_hash_device(raw), expires_at__gt=timezone.now()).first()
    if row is None:
        return False
    row.last_used_at = timezone.now()
    row.save(update_fields=["last_used_at"])
    return True


def set_device_cookie(response, raw: str):
    from django.conf import settings

    response.set_cookie(
        DEVICE_COOKIE, raw, max_age=int(DEVICE_LIFETIME.total_seconds()), path=DEVICE_COOKIE_PATH,
        httponly=True, samesite="Lax", secure=not settings.DEBUG,
    )
