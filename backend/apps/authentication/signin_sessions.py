"""登录设备(Design 第二十八批 W2 / S1)的服务层:建、认、退、刷新时记活动。

一台设备一行 `SignInSession`,`id` 作为 `sid` 声明写进刷新令牌;SimpleJWT 轮换刷新令牌时
声明原样复制(`no_copy_claims` 里没有它),access 也带着 —— 所以「这台」就是 `request.auth["sid"]`。
官员与灵魂共用这一套:灵魂账号也是一个 `User`,两套令牌都经 `session_is_current` 判定。

**与「改密码退出其他设备」的关系**:`passwords.end_sessions` 是唯一的漏斗(官员改密码 / 邮箱重置 /
灵魂改密码 / 管理员重置 / 转世都经过它),它在这里调 `revoke_all`,于是那些路径同时把这张表里的行标成已退出。
`keep` 是改密码的那台设备 —— 它拿到带同一个 `sid` 的新令牌。

**没有 `sid` 的令牌**(这个功能上线前签发的)不在列表里,也认不出「这台」;它们到期即止,
「退出其他全部」则按「当前这台之外的所有未拉黑刷新令牌」拉黑,所以不会漏掉它们。
"""
import re
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.utils import timezone

from .models import MfaRememberedDevice, SignInSession

SID_CLAIM = "sid"
#: 超过这么久没活动的会话视为失效,不列出(Design W2)。
IDLE_DAYS = 30


# ── 设备标签 ─────────────────────────────────────────────────────────────

_OS = (
    (r"iPad", "iPad"), (r"iPhone|CFNetwork|Darwin", "iPhone"), (r"Android|okhttp", "Android"),
    (r"Windows", "Windows"), (r"Macintosh|Mac OS X", "macOS"), (r"CrOS", "ChromeOS"), (r"Linux|X11", "Linux"),
)
# 顺序有讲究:Edge / Opera 的 UA 里也有 Chrome 与 Safari,Chrome 的里也有 Safari。
_BROWSERS = (
    (r"Edg(e|A|iOS)?/", "Edge"), (r"OPR/|Opera", "Opera"), (r"Firefox/|FxiOS", "Firefox"),
    (r"Chrome/|CriOS", "Chrome"), (r"Safari/", "Safari"),
)
#: 原生 App 的请求没有浏览器标识:RN 在 iOS 上发 `…CFNetwork/…Darwin/…`,在 Android 上发 `okhttp/…`。
_NATIVE = re.compile(r"okhttp|CFNetwork|Expo", re.I)


def _first(table, ua):
    return next((name for pattern, name in table if re.search(pattern, ua)), "")


def label_for(user_agent: str, *, officer_app: bool = False, explicit: str = "") -> str:
    """「macOS · Safari」「官员 App · iPhone」「iPhone」。App 可以用 `X-Device-Label` 头自报名字(原样当文本)。"""
    explicit = re.sub(r"[\x00-\x1f]", "", explicit or "").strip()[:60]
    if explicit:
        return explicit
    ua = user_agent or ""
    os_name = _first(_OS, ua)
    if officer_app:
        return f"官员 App · {os_name}" if os_name else "官员 App"
    browser = "" if _NATIVE.search(ua) else _first(_BROWSERS, ua)
    if browser:
        return f"{os_name} · {browser}" if os_name else browser
    return os_name or "未知设备"


def request_label(request, *, officer_app: bool = False) -> str:
    meta = getattr(request, "META", {}) or {}
    return label_for(meta.get("HTTP_USER_AGENT", ""), officer_app=officer_app,
                     explicit=meta.get("HTTP_X_DEVICE_LABEL", ""))


# ── 建 / 认 ──────────────────────────────────────────────────────────────


def start(user, request, *, method="password", officer_app=False, trust_hash="") -> SignInSession:
    return SignInSession.objects.create(
        user=user, label=request_label(request, officer_app=officer_app), method=method, trust_hash=trust_hash)


def attach(refresh, session) -> None:
    """把会话写进刚签的刷新令牌:`sid` 声明 + 记下它的 jti。此后 access 由它派生,自带 `sid`。

    `for_user` 在这之前已把这条令牌写进 outstanding 表(那时还没有 `sid`),jti 不变,所以拉黑照样对得上。"""
    refresh[SID_CLAIM] = str(session.pk)
    session.refresh_jti = str(refresh["jti"])
    session.save(update_fields=["refresh_jti"])


def session_of(token) -> SignInSession | None:
    """令牌的 `sid` 指向的会话(没有、不是 uuid、不存在都是 None)。"""
    raw = token.get(SID_CLAIM) if token is not None else None
    if not raw:
        return None
    try:
        return SignInSession.objects.filter(pk=raw).first()
    except (ValidationError, ValueError):
        return None


def is_revoked(token) -> bool:
    """令牌所属会话已被退出。没有 `sid` 的老令牌、会话行已被清理的令牌都按「没被退出」算。
    # ponytail: 每个请求一次主键查询;撑不住时改成退出时写缓存键。"""
    raw = token.get(SID_CLAIM)
    if not raw:
        return False
    try:
        flag = SignInSession.objects.filter(pk=raw).values_list("revoked_at", flat=True).first()
    except (ValidationError, ValueError):
        return False
    return flag is not None


def visible(user):
    """列表里出现的:没退出、30 天内有活动。"""
    return SignInSession.objects.filter(
        user=user, revoked_at__isnull=True, last_seen_at__gte=timezone.now() - timedelta(days=IDLE_DAYS))


# ── 推送登记的登录是否已到期 ─────────────────────────────────────────────


def officer_app_lifetime() -> timedelta:
    from django.conf import settings

    return timedelta(hours=settings.OFFICER_APP_REFRESH_LIFETIME_HOURS)


def soul_lifetime() -> timedelta:
    from django.conf import settings

    return settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]


def expired_devices(devices, *, user_field: str, lifetime: timedelta):
    """推送设备里「登录已到期」的:登记后超过刷新令牌有效期没再登记,**且**这个用户没有任何未退出、
    在有效期内活动过的登录(刷新会更新 `last_seen_at`,所以一直在用的人不受影响)。
    推送登记没有记它属于哪个登录会话,所以同一用户另有一台设备仍在用时,这台闲置的要等整个用户都闲置才会被认出。
    # ponytail: 要精确到设备,给登记加一个 sid 外键。"""
    cutoff = timezone.now() - lifetime
    live = SignInSession.objects.filter(revoked_at__isnull=True, last_seen_at__gte=cutoff).values("user_id")
    return devices.filter(last_seen_at__lt=cutoff).exclude(**{f"{user_field}__in": live})


def live_devices(devices, *, user_field: str, lifetime: timedelta):
    """`devices` 去掉登录已到期的 —— 发送路径用,清理任务还没跑时锁屏也不再收到。"""
    return devices.exclude(pk__in=expired_devices(devices, user_field=user_field, lifetime=lifetime).values("pk"))


# ── 退 ───────────────────────────────────────────────────────────────────


def _revoke_trust(hashes) -> None:
    hashes = [h for h in hashes if h]
    if not hashes:
        return
    MfaRememberedDevice.objects.filter(token_hash__in=hashes).delete()
    from apps.soul_accounts.models import SoulMfaDevice

    SoulMfaDevice.objects.filter(token_hash__in=hashes).delete()


def _blacklist_jtis(user, *, keep_jti: str | None, only=None) -> None:
    """`only`(jti 集合)给了就只拉黑它们;否则拉黑除 `keep_jti` 之外这个用户所有未拉黑的刷新令牌。"""
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    rows = OutstandingToken.objects.filter(user=user, blacklistedtoken__isnull=True)
    rows = rows.filter(jti__in=only) if only is not None else rows.exclude(jti=keep_jti or "")
    for row in rows:
        BlacklistedToken.objects.get_or_create(token=row)


def revoke(session) -> None:
    """退出一台:标记、拉黑当前刷新令牌、作废它的免两步验证。幂等。"""
    if session.revoked_at is None:
        session.revoked_at = timezone.now()
        session.save(update_fields=["revoked_at"])
    _blacklist_jtis(session.user, keep_jti=None, only={session.refresh_jti} if session.refresh_jti else set())
    _revoke_trust([session.trust_hash])
    _close_sockets(session.user_id)


def revoke_others(user, keep) -> int:
    """除 `keep`(当前这台)外全部退出,含没有 `sid` 的老令牌。返回刚标记的行数。"""
    count = revoke_all(user, keep=keep)
    _blacklist_jtis(user, keep_jti=keep.refresh_jti if keep else None)
    _close_sockets(user.pk)
    return count


def _close_sockets(user_id) -> None:
    """已连着的实时连接一并关(关闭码 4002 让客户端重连):这台带着有效令牌重连得上,被退出的那台在握手时
    被 `session_is_current` 拒掉。不关的话,被退出的设备的 socket 要等它自己断开重连才失效。"""
    from apps.events.realtime import close_user_sockets

    close_user_sockets(user_id)


def revoke_all(user, *, keep=None) -> int:
    """`end_sessions` 用:该用户所有未退出的会话标记退出,`keep` 除外;它们的免两步验证作废。
    刷新令牌的拉黑由调用方做(`end_sessions` 拉黑全部)。"""
    rows = SignInSession.objects.filter(user=user, revoked_at__isnull=True)
    if keep is not None:
        rows = rows.exclude(pk=keep.pk)
    trust = list(rows.values_list("trust_hash", flat=True))
    count = rows.update(revoked_at=timezone.now())
    _revoke_trust(trust)
    return count


# ── 刷新 ─────────────────────────────────────────────────────────────────


class SessionAwareRefreshMixin:
    """混进两个 `TokenRefreshSerializer`(官员与灵魂):会话已退出 → 拒;成功 → 记活动与新 jti。"""

    def validate(self, attrs):
        from rest_framework_simplejwt.exceptions import InvalidToken

        old = self.token_class(attrs["refresh"])
        sid = old.payload.get(SID_CLAIM)
        session = session_of(old) if sid else None
        if session is not None and session.revoked_at is not None:
            raise InvalidToken("Token is blacklisted")
        data = super().validate(attrs)
        if session is not None:
            fields = {"last_seen_at": timezone.now()}
            if data.get("refresh"):
                fields["refresh_jti"] = str(self.token_class(data["refresh"], verify=False)["jti"])
            SignInSession.objects.filter(pk=session.pk).update(**fields)
        return data


# ── 列表(官员与灵魂共用) ───────────────────────────────────────────────


def listing(user, current) -> list[dict]:
    """这个用户的登录设备:这台在前,其余按上次活动倒序。`current` 是 `SignInSession` 或 None。
    「免两步验证至」从会话记着的设备令牌哈希查到期日,过期的不显示。"""
    from apps.soul_accounts.models import SoulMfaDevice

    rows = list(visible(user))
    hashes = [r.trust_hash for r in rows if r.trust_hash]
    now = timezone.now()
    until = {}
    for model in (MfaRememberedDevice, SoulMfaDevice):
        until.update(model.objects.filter(token_hash__in=hashes, expires_at__gt=now)
                     .values_list("token_hash", "expires_at"))
    rows.sort(key=lambda r: (r.pk != getattr(current, "pk", None), -r.last_seen_at.timestamp()))
    return [{
        "id": r.pk, "label": r.label, "method": r.method, "last_seen_at": r.last_seen_at,
        "current": r.pk == getattr(current, "pk", None), "trusted_until": until.get(r.trust_hash),
    } for r in rows]
