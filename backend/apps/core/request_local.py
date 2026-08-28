"""
Context-variable storage for current request context.

Allows accessing the current Django request and user from anywhere
(e.g., in model save() methods, signals) without passing request objects
through the entire call stack.

Uses contextvars.ContextVar instead of threading.local to properly
support async contexts and Celery workers.

Usage:
    from apps.core.request_local import set_current_user, get_current_user

    # In middleware (at request start):
    set_current_user(request.user)

    # In model save() or signals:
    user = get_current_user()
"""
import contextvars

# Context variables for request context (Celery-safe)
_user_var: contextvars.ContextVar[object | None] = contextvars.ContextVar('user', default=None)
_request_var: contextvars.ContextVar[object | None] = contextvars.ContextVar('request', default=None)


def set_current_user(user):
    """Store the current authenticated user in context variable."""
    _user_var.set(user)


def get_current_user():
    """Get the current authenticated user from context variable."""
    return _user_var.get()


def set_current_request(request):
    """Store the current Django request in context variable."""
    _request_var.set(request)


def get_current_request():
    """Get the current Django request from context variable."""
    return _request_var.get()


def clear_current_user():
    """Clear the context variable user (call at end of request)."""
    _user_var.set(None)
    _request_var.set(None)


class RequestContextMiddleware:
    """把当前 request 放进 context-var,并在请求结束时清掉当前 user。

    这是 HTTP 侧唯一的 request-context 中间件。它做两件事,都在 ``__call__`` 里:
    进入时 ``set_current_request``,离开时 ``clear_current_user``。清理写在
    ``finally`` 里不是保险而是必需 —— 一个活过请求边界的 context-var,会让同一个
    worker 处理的下一个请求把自己的写入记到上一个用户名下。

    **它不设置当前 user,那件事由 ``apps/core/viewsets.py`` 的 mixin 做**,在
    ``perform_create`` / ``perform_update`` / ``perform_destroy`` 里,各自带自己的
    ``try/finally``。那个位置能拿到已认证的用户,这里拿不到 —— 原因见下。

    ``process_view`` 曾经在这里,2026-08-28 删除。它读 ``request.user``,读不到就
    退回 ``request._user``,凡是认证过的就 ``set_current_user``。看起来无懈可击,
    **而它一次都没有成功过**:DRF 的认证发生在 ``APIView.initial()``,比
    ``process_view`` 晚;那一刻 ``request.user`` 还是匿名,``_user`` 还不存在。

    这不是推断出来的。给 ``set_current_user`` 装上探针,跑一次 ``force_authenticate``
    的请求和一次**真实 JWT** 请求(先登录拿 token,再带 Bearer 头),两次的调用次数
    都是 **0**。同样的 ``process_view`` 当时在仓库里有三份拷贝 —— 这里一份、
    ``apps/core/middleware.py`` 一份、以及后者 ``__call__`` 里那段永远不可达的权限
    检查里的第三份 —— 三份都从未执行。整个 ``apps/core/middleware.py`` 模块因此
    删除:它做的每一件事,要么是死的,要么这个类已经在做且做得更早。

    留下的教训与 ``apps/perm/cache.py`` 里记的那条同源:**一段代码通篇看不出毛病,
    不代表它跑过**。这三份 ``process_view`` 逻辑正确、防御周全、有日志、有回退分支,
    唯独没有人问过「它执行的时候,它要读的东西已经存在了吗」。
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            set_current_request(request)
            return self.get_response(request)
        finally:
            clear_current_user()

