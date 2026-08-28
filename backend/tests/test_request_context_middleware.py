"""`RequestContextMiddleware` 守卫:钉住它真的做的那件事,和三段没做过的代码。

这个文件替代了 `tests/test_codename_viewset.py` 里删掉的
`TestPermissionMiddlewareFallback`。那两个测试写着

    request.view = mock_view

然后断言中间件读到了 `view.get_required_permissions()`。它们一直是绿的,而它们
证明的那条分支在生产环境**一次都没有执行过** —— Django 不设置 `request.view`,
仓库里也没有任何代码设置它。测试自己造出了让分支可达的唯一前提。

CLAUDE.md 把这种东西写成规则:「A test double that behaves like the bug is worse
than no test」。所以下面的测试**不去证明某个分支能工作**,而去测量那些分支赖以
存在的前提 —— 并且它们会红:前提哪天变了,断言立刻失败,那才是重新审视的时候。
"""
import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_django_never_sets_request_view(django_user_model):
    """被删掉的权限分支所依赖的前提,现在被测量而不是被假设。

    `grep` 只能说明「仓库里没有写者」,这个测试说明「真实请求里读者一次都没读到」。
    后者更强 —— 前者管不住框架内部,后者管得住。
    """
    seen: list[bool] = []

    user = django_user_model.objects.create_user(
        username="ctx_probe", password="x", role="ADMIN"
    )
    client = APIClient()
    client.force_authenticate(user)
    from django.core.handlers.base import BaseHandler

    original = BaseHandler._get_response

    def spy(self, request):
        seen.append(hasattr(request, "view"))
        return original(self, request)

    BaseHandler._get_response = spy
    try:
        for path in ("/api/v1/souls/", "/api/v1/actors/", "/api/v1/judgments/"):
            client.get(path)
    finally:
        BaseHandler._get_response = original

    assert seen, (
        "探针一次都没跑 —— 空集合会让下面那条断言恒真,先在这里拦住。"
    )
    assert not any(seen), (
        f"`request.view` 现在存在了({sum(seen)}/{len(seen)} 次)。"
        f"apps/core/request_local.py 的类注释以「Django 从不设置它」为依据删掉了三段"
        f"代码;这个前提一旦改变,那些删除都要重新审视。"
    )


@pytest.mark.django_db
def test_a_read_request_leaves_no_user_behind(django_user_model):
    """中间件不设置当前 user —— 它办不到 —— 所以读请求之后 context-var 必须是空的。

    `process_view` 曾经想干这件事。DRF 的认证发生在 `APIView.initial()`,比
    `process_view` 晚;那一刻 `request.user` 还是匿名,`_user` 还不存在,所以
    `set_current_user` 一次都没被调用过(实测:`force_authenticate` 与真实 JWT
    请求各跑一次,调用次数都是 0)。

    真正设置它的是 `apps/core/viewsets.py::AuditUserViewSetMixin`,在
    `perform_create` / `perform_update` / `perform_destroy` 里,各自带 `try/finally`。
    那条路径由审计相关的测试覆盖(`tests/test_audit.py`),这里不重复;这里守的是
    另一半 —— **一次不写任何东西的请求,不应该在 context-var 里留下人**。留下了就
    意味着同一个 worker 处理的下一个请求会把写入记到他名下。
    """
    from apps.core.request_local import get_current_user

    user = django_user_model.objects.create_user(
        username="ctx_user", password="x", role="ADMIN"
    )
    client = APIClient()
    client.force_authenticate(user)
    client.get("/api/v1/souls/")

    assert get_current_user() is None, (
        "一次 GET 之后 context-var 里有人。中间件不设置 user,所以这里出现的任何人"
        "都是没被清掉的残留 —— `__call__` 的 finally 是最后一道清理点。"
    )


def test_the_dead_permission_module_is_gone():
    """`apps.core.middleware` 不该回来。

    它整个模块 2026-08-28 删除,因为它做的每一件事要么是死的、要么与
    `apps.core.request_local.RequestContextMiddleware` 重复且更晚执行:

      * `require_permission` 一应用就抛 `NameError`(在 `decorator` 作用域里读
        `view_instance`,而那是内层 `wrapped_view` 的参数),所以从未被用过 ——
        仓库里九处 `@require_permission` 全在 docstring 里。它的无括号分支更糟:
        不带参数会静默设 `_required_permissions = []` 并返回原类,等于声明「本视图
        不需要任何权限」。
      * `__call__` 的权限检查读 `request.view`,该属性从不存在。
      * `process_view` 与 `request_local` 里那份逐字相同,同样从不触发。

    权限执行在 `apps/core/permissions.py`(DRF permission class,对每个声明的
    codename 累积判断)。WebSocket 侧另有一个**真的**在解析权限的
    `apps/core/ws_permissions.py::PermissionMiddleware`;两个同名类曾经并存,正是
    惰性那个长期没被检查的原因之一。
    """
    import importlib

    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("apps.core.middleware")

    from django.conf import settings

    registered = [m for m in settings.MIDDLEWARE if "apps.core" in m]
    assert registered == ["apps.core.request_local.RequestContextMiddleware"], (
        f"apps.core 下注册的中间件变了:{registered}。曾经有两个并排挂着,后者是前者"
        f"的严格子集 —— 重复本身没有报错,所以谁都没发现其中一个多余。"
    )
