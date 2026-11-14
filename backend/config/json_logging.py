"""One JSON object per log line, escaped by `json.dumps` (IS-22).

The production formatter used to be a `%`-template shaped like JSON. A quote
in a message ended the string early and a newline split the record in two, so
a line-oriented collector dropped or misparsed exactly the records with
exception text in them. No dependency: requirements.txt has no JSON logger.
"""
import json
import logging

#: `extra={...}` 里允许进日志行的键(2026-11-14)。白名单而不是全收:`extra` 里偶尔是整个对象,
#: 全收会把它们 `str()` 进日志,而那里可能有不该出现在日志里的东西。
EXTRA_FIELDS = ("method", "route", "status", "duration_ms", "task")


def _context_tenant():
    from apps.tenants.managers import get_current_tenant

    return getattr(get_current_tenant(), "code", None)


def _context_user_id():
    # 只读已经确定的用户:显式设置的,或 DRF 认证后写回 Django request 的那个。
    # 不碰 AuthenticationMiddleware 的惰性 user —— 在格式化器里求值它会查库,而查库本身也打日志。
    from apps.core.request_local import _request_var, _user_var
    from apps.core.trace import user_id_of

    user = _user_var.get()
    if user is not None:
        return getattr(user, "pk", None)
    request = _request_var.get()
    return user_id_of(request) if request is not None else None


class JsonFormatter(logging.Formatter):
    def format(self, record):
        entry = {
            "time": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            # `apps.core.trace.TraceIdFilter` 补上的;没挂那个 filter 的 handler 上没有。
            "trace_id": getattr(record, "trace_id", "-"),
            # 请求结束那行(`apps.access`)显式带上;其余的行从 contextvar 取,不在请求里就是 "-" / null。
            "tenant": getattr(record, "tenant", None) or _safe(_context_tenant) or "-",
            "user_id": getattr(record, "user_id", None) or _safe(_context_user_id),
        }
        for key in EXTRA_FIELDS:
            if hasattr(record, key):
                entry[key] = getattr(record, key)
        if record.exc_info:
            entry["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def _safe(read):
    # 日志配置早于 apps 加载;那时(以及任何意外)字段留空,不让一条日志因为取上下文而丢掉。
    try:
        return read()
    except Exception:
        return None
