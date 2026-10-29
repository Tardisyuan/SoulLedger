"""一个请求一个 id(请求头与响应头 `X-Request-ID`,2026-10-29 用户决定)。

* 中间件:请求头里的 id 合法就沿用,否则新生成;放进 contextvar,响应头回给客户端。
* 日志:`TraceIdFilter` 给每条记录补 `trace_id`,两份 formatter 都打印它(`config/settings.py`)。
* 审计:`AuditLog.save` 与 `apps/audit/signals._get_trace_id` 取这里的值 —— 同一个请求的审计行与日志对得上。
* Celery:发任务时把当前 id 写进消息头 `trace_id`,worker 跑任务前取出来放进 contextvar;
  没有发起请求的任务(定时任务)各自生成一个。

本模块不 import 任何模型:日志配置在 apps 加载之前就会引用它。
"""
import contextvars
import logging
import re
import uuid

from celery.signals import before_task_publish, task_postrun, task_prerun

HEADER = "X-Request-ID"
TASK_HEADER = "trace_id"
#: 客户端给的 id:8–64 个字母数字与 `._:-`。64 是 `AuditLog.trace_id` 的列宽;不合法的(过长、含空格或换行,
#: 可用来往日志里注入一行)一律换成新的,不报错。
_VALID = re.compile(r"^[A-Za-z0-9._:-]{8,64}$")

_trace_var: contextvars.ContextVar[str] = contextvars.ContextVar("trace_id", default="")


def new_trace_id() -> str:
    return uuid.uuid4().hex


def get_trace_id() -> str:
    """当前请求 / 任务的 id;不在请求或任务里时为空串。"""
    return _trace_var.get()


def accept(raw: str | None) -> str:
    return raw if raw and _VALID.match(raw) else new_trace_id()


class TraceIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        trace_id = accept(request.META.get("HTTP_X_REQUEST_ID"))
        request.trace_id = trace_id
        token = _trace_var.set(trace_id)
        try:
            response = self.get_response(request)
        finally:
            _trace_var.reset(token)
        response[HEADER] = trace_id
        return response


class TraceIdFilter(logging.Filter):
    def filter(self, record):
        record.trace_id = _trace_var.get() or "-"
        return True


# ── Celery ──────────────────────────────────────────────────────────────


@before_task_publish.connect(weak=False)
def _stamp_task(headers=None, **_):
    trace_id = _trace_var.get()
    if trace_id and headers is not None:
        headers.setdefault(TASK_HEADER, trace_id)


_task_tokens: dict = {}


@task_prerun.connect(weak=False)
def _enter_task(task_id=None, task=None, **_):
    trace_id = getattr(getattr(task, "request", None), TASK_HEADER, None)
    if trace_id:
        _task_tokens[task_id] = _trace_var.set(accept(trace_id))
    elif not _trace_var.get():
        # 定时任务没有发起请求。eager 执行(测试)时调用方的 id 已在 contextvar 里,不覆盖。
        _task_tokens[task_id] = _trace_var.set(new_trace_id())


@task_postrun.connect(weak=False)
def _leave_task(task_id=None, **_):
    token = _task_tokens.pop(task_id, None)
    if token is not None:
        _trace_var.reset(token)
