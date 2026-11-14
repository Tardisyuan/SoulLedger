"""一个请求一个 id(请求头与响应头 `X-Request-ID`,2026-10-29 用户决定)。

* 中间件:请求头里的 id 合法就沿用,否则新生成;放进 contextvar,响应头回给客户端。
* 日志:`TraceIdFilter` 给每条记录补 `trace_id`,两份 formatter 都打印它(`config/settings.py`)。
* 审计:`AuditLog.save` 与 `apps/audit/signals._get_trace_id` 取这里的值 —— 同一个请求的审计行与日志对得上。
* Celery:发任务时把当前 id 写进消息头 `trace_id`,worker 跑任务前取出来放进 contextvar;
  没有发起请求的任务(定时任务)各自生成一个。
* 度量(2026-11-14):中间件在请求结束时按「方法 + 路由模板 + 状态类」计数、记耗时桶,
  并写一行 `apps.access` 日志;任务结束按「任务名 + 状态」计数。累加在进程内,定时刷进 Redis(`apps/core/obs.py`)。

本模块不 import 任何模型:日志配置在 apps 加载之前就会引用它。
"""
import contextvars
import logging
import re
import time
import uuid

from celery.signals import before_task_publish, task_postrun, task_prerun, worker_process_shutdown

from apps.core import obs

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


access_logger = logging.getLogger("apps.access")


def route_of(request) -> str:
    """路由模板(`api/v1/souls/<int:pk>/`),基数有界;没匹配上任何路由的(404)一律记 `-`,不记原始路径。"""
    match = getattr(request, "resolver_match", None)
    return (getattr(match, "route", None) or "-") if match else "-"


def user_id_of(request):
    """已认证用户的 id。不去求值 AuthenticationMiddleware 的惰性 user:那会为每个匿名请求多查一次会话。"""
    from django.utils.functional import SimpleLazyObject, empty

    user = getattr(request, "user", None)
    if isinstance(user, SimpleLazyObject) and user._wrapped is empty:
        return None
    return user.pk if getattr(user, "is_authenticated", False) else None


class TraceIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        trace_id = accept(request.META.get("HTTP_X_REQUEST_ID"))
        request.trace_id = trace_id
        token = _trace_var.set(trace_id)
        started = time.monotonic()
        try:
            response = self.get_response(request)
            _observe(request, response, (time.monotonic() - started) * 1000)
        finally:
            _trace_var.reset(token)
        response[HEADER] = trace_id
        return response


def _observe(request, response, ms):
    # 度量与访问日志都不许让请求失败:任何意外只记一条 warning。
    try:
        route = route_of(request)
        obs.record_request(request.method, route, response.status_code, ms)
        tenant = getattr(request, "tenant", None)
        access_logger.info(
            "http_request",
            extra={
                "method": request.method,
                "route": route,
                "status": response.status_code,
                "duration_ms": round(ms, 1),
                "tenant": getattr(tenant, "code", None) or "-",
                "user_id": user_id_of(request),
            },
        )
        obs.maybe_flush()
    except Exception:
        logging.getLogger(__name__).warning("request metrics failed", exc_info=True)


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
def _leave_task(task_id=None, task=None, state=None, **_):
    token = _task_tokens.pop(task_id, None)
    if token is not None:
        _trace_var.reset(token)
    try:
        obs.incr("task", getattr(task, "name", None) or "-", state or "-")
        obs.maybe_flush()
    except Exception:
        logging.getLogger(__name__).warning("task metrics failed", exc_info=True)


@worker_process_shutdown.connect(weak=False)
def _flush_on_exit(**_):
    obs.flush()
