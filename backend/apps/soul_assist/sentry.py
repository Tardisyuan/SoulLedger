"""Sentry 不采助手的原文(docs/ARCHITECTURE-soul-assist.md §4.6)。

`send_default_pii=False` 只挡 cookie / 用户信息,不挡请求体,也不挡栈帧里的局部变量 ——
而这个接口的请求体就是灵魂的提问,栈帧里有 `question`、`history`、`text`。
这里对 `/me/assist/`(灵魂)与 `/api/v1/assist/`(官员)的事件删掉两者。
不 import Django:settings 加载时就要用它。
"""

ASSIST_PATHS = ("/api/v1/me/assist", "/api/v1/assist")


def scrub_assist(event, hint):
    request = event.get("request") or {}
    url = request.get("url") or ""
    if not any(path in url for path in ASSIST_PATHS):
        return event
    request.pop("data", None)
    request.pop("query_string", None)
    for exception in (event.get("exception") or {}).get("values") or []:
        for frame in (exception.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
    for crumb in (event.get("breadcrumbs") or {}).get("values") or []:
        crumb.pop("data", None)
    return event
