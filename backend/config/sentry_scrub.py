"""全项目的 Sentry 打码(settings.py 里 `sentry_sdk.init` 用这一份)。

SDK 默认的 `EventScrubber` 只按**确切键名**匹配一张短表,而且**不递归**:`old_password` /
`new_password`、设备登录的 `credential`、MFA / 恢复码、webhook 的 `signing_secret`、
令牌的 `raw`,以及栈帧里嵌套的 `validated_data` / `attrs` 一配上 DSN 就会原样上报。
这里三层:
  1. `SCRUBBER` —— 默认表 + 本项目的键名,`recursive=True`;SDK 序列化前跑一次(`event_scrubber`),
     `scrub_event` 里再跑一次(给序列化后的形状兜底,也让测试不经网络就能验)。
  2. 查询串:`query_string` 与 http 面包屑的 `http.query` 是字符串,键表进不去;按参数拆开打码,
     另加附件 / 图片签名链接的 `t`(只在查询串里,不放进键表 —— 栈帧里叫 `t` 的变量太多)。
  3. 任何位置的字符串里像 JWT 的片段(`eyJ….….…`),包括别名头里的 Bearer。
最后交给 `scrub_assist`(助手的原文整段删,apps/soul_assist/sentry.py)。
不 import Django:settings 加载时就要用它。
"""

import re
from urllib.parse import parse_qsl, urlencode

from sentry_sdk.scrubber import DEFAULT_DENYLIST, EventScrubber

from apps.soul_assist.sentry import scrub_assist

PROJECT_DENYLIST = [
    "old_password", "new_password", "password_confirm", "new_password_confirm",
    "credential", "device_credential",
    "code", "mfa_code", "otp", "recovery_code", "recovery_codes", "otpauth_url",
    "signing_secret", "_signing_secret", "raw", "raw_key", "_raw_key", "key_hash",
    "access", "refresh", "access_token", "refresh_token",
    "pending_token", "confirm_token", "device_token", "push_token",
    "encryption_key", "secret_key",
]
DENYLIST = DEFAULT_DENYLIST + PROJECT_DENYLIST
QUERY_DENYLIST = {k.lower() for k in DENYLIST} | {"t"}
REDACTED = "[Filtered]"
JWT = re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")

SCRUBBER = EventScrubber(denylist=list(DENYLIST), recursive=True)


def _query(qs):
    if not isinstance(qs, str) or not qs:
        return qs
    pairs = parse_qsl(qs.lstrip("?"), keep_blank_values=True)
    return urlencode([(k, REDACTED if k.lower() in QUERY_DENYLIST else v) for k, v in pairs])


def _strings(value):
    if isinstance(value, str):
        return JWT.sub(REDACTED, value)
    if isinstance(value, dict):
        for k in list(value):
            value[k] = _strings(value[k])
    elif isinstance(value, list):
        value[:] = [_strings(v) for v in value]
    return value


def scrub_event(event, hint):
    SCRUBBER.scrub_event(event)
    request = event.get("request")
    if isinstance(request, dict) and "query_string" in request:
        request["query_string"] = _query(request["query_string"])
    for crumb in (event.get("breadcrumbs") or {}).get("values") or []:
        data = crumb.get("data")
        if isinstance(data, dict) and "http.query" in data:
            data["http.query"] = _query(data["http.query"])
    _strings(event)
    return scrub_assist(event, hint)
