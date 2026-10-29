"""网页的刷新令牌放 httpOnly cookie(2026-10-29 用户决定第 16 条)。

网页请求带 `X-Auth-Cookie: 1`(`packages/core` 在平台声明 `refreshCookie` 时加上,只有网页声明):
签发令牌的应答(登录、两步验证第二步、刷新、改密码)把 `refresh` 从正文拿掉,改写进 `REFRESH_COOKIE` ——
httpOnly、SameSite=Strict、非 DEBUG 时 Secure,路径 `/api/v1/auth/`(与两步验证「不再询问」cookie 同一处:
刷新、退出、改密码三处都要读它)。页面脚本读不到它,XSS 偷不走一张 30 天的令牌。
App(官员 / 灵魂)不带这个头,照旧在正文里拿 `refresh`、放 secure-store,行为不变。

CSRF:cookie 是 SameSite=Strict(别的站发起的请求不带它);用 cookie 的请求再核一次 `Origin`
必须是 `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` 里的源(DEBUG 且放开全部源时,任何非空 Origin)。
正文里带了 `refresh` 的请求不看 cookie,也不查 Origin —— 那是 App 的路径。
"""
import time

from django.conf import settings
from rest_framework_simplejwt.tokens import UntypedToken

REFRESH_COOKIE = "soulledger_refresh_http"
REFRESH_COOKIE_PATH = "/api/v1/auth/"
OPT_IN_HEADER = "X-Auth-Cookie"


def wants_cookie(request) -> bool:
    return request.headers.get(OPT_IN_HEADER) == "1"


def from_cookie(request):
    """`(令牌, 拒绝原因)`:没有 cookie → `(None, None)`;有 cookie 而 Origin 不对 → `(None, "origin_refused")`。"""
    raw = request.COOKIES.get(REFRESH_COOKIE)
    if not raw:
        return None, None
    return (raw, None) if origin_allowed(request) else (None, "origin_refused")


def origin_allowed(request) -> bool:
    origin = request.headers.get("Origin") or ""
    if not origin:
        return False
    allowed = {*getattr(settings, "CORS_ALLOWED_ORIGINS", []), *getattr(settings, "CSRF_TRUSTED_ORIGINS", [])}
    if origin in allowed:
        return True
    return bool(settings.DEBUG and getattr(settings, "CORS_ALLOW_ALL_ORIGINS", False))


def move_to_cookie(request, response):
    """网页请求的 2xx 应答:正文里的 `refresh` 搬进 cookie。其余原样返回。"""
    data = getattr(response, "data", None)
    if not (wants_cookie(request) and 200 <= response.status_code < 300 and isinstance(data, dict) and data.get("refresh")):
        return response
    raw = data.pop("refresh")
    # 「保持登录 30 天」的令牌给 cookie 同样的寿命;其余是会话 cookie(关浏览器即失),与此前网页的做法一致。
    try:
        claims = UntypedToken(raw, verify=False).payload
    except Exception:
        claims = {}
    max_age = max(0, int(claims["exp"]) - int(time.time())) if claims.get("remember") is True and "exp" in claims else None
    response.set_cookie(REFRESH_COOKIE, raw, max_age=max_age, path=REFRESH_COOKIE_PATH, httponly=True,
                        samesite="Strict", secure=not settings.DEBUG)
    return response


def clear(response):
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH, samesite="Strict")
    return response
