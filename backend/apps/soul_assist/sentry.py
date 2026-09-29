"""Sentry 不采助手的原文(docs/ARCHITECTURE-soul-assist.md §4.6)。

`send_default_pii=False` 只挡 cookie / 用户信息,不挡请求体,也不挡栈帧里的局部变量 ——
而这个接口的请求体就是灵魂的提问,栈帧里有 `question`、`history`、`text`。
这里对 `/me/assist/`(灵魂)与 `/api/v1/assist/`(官员,也覆盖 `/api/v1/assist-admin/`)的事件删掉两者。

**没有请求 URL 的事件也要管**:评测跑在 Celery 任务 `soul_assist.run_eval` 里,栈帧里有解密后的
候选 API key 与评测的问答。所以下面任一条命中就删:请求 URL、日志器名(`apps.soul_assist.*`)、
Celery 任务名(`soul_assist.*`)、或任何一帧在 `apps.soul_assist` 里。
不 import Django:settings 加载时就要用它。
"""

ASSIST_PATHS = ("/api/v1/me/assist", "/api/v1/assist")
ASSIST_MODULE = "apps.soul_assist"
ASSIST_TASK_PREFIX = "soul_assist."


def _frames(event):
    for exception in (event.get("exception") or {}).get("values") or []:
        yield from (exception.get("stacktrace") or {}).get("frames") or []
    for thread in (event.get("threads") or {}).get("values") or []:
        yield from (thread.get("stacktrace") or {}).get("frames") or []


def _ours(event):
    url = (event.get("request") or {}).get("url") or ""
    task = ((event.get("extra") or {}).get("celery-job") or {}).get("task_name") or ""
    return (any(path in url for path in ASSIST_PATHS)
            or (event.get("logger") or "").startswith(ASSIST_MODULE)
            or task.startswith(ASSIST_TASK_PREFIX)
            or (event.get("transaction") or "").startswith(ASSIST_TASK_PREFIX)
            or any((frame.get("module") or "").startswith(ASSIST_MODULE) for frame in _frames(event)))


def scrub_assist(event, hint):
    if not _ours(event):
        return event
    request = event.get("request") or {}
    request.pop("data", None)
    request.pop("query_string", None)
    for frame in _frames(event):
        frame.pop("vars", None)
    for crumb in (event.get("breadcrumbs") or {}).get("values") or []:
        crumb.pop("data", None)
    return event
