"""Sentry 不采助手的原文(docs/ARCHITECTURE-soul-assist.md §4.6)。

`send_default_pii=False` 只挡 cookie / 用户信息,不挡请求体,也不挡栈帧里的局部变量 ——
而这个接口的请求体就是灵魂的提问,栈帧里有 `question`、`history`、`text`。
这里对 `/me/assist/` 的事件删掉两者。不 import Django:settings 加载时就要用它。
"""

ASSIST_PATH = "/api/v1/me/assist"


def scrub_assist(event, hint):
    request = event.get("request") or {}
    if ASSIST_PATH not in (request.get("url") or ""):
        return event
    request.pop("data", None)
    request.pop("query_string", None)
    for exception in (event.get("exception") or {}).get("values") or []:
        for frame in (exception.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
    for crumb in (event.get("breadcrumbs") or {}).get("values") or []:
        crumb.pop("data", None)
    return event
