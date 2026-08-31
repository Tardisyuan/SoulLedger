"""A viewset over a tenant-bearing model must scope its queryset through
``apps.core.tenant``.

This is a meta-test. It does not check that any particular endpoint isolates
tenants correctly; it checks that there is nowhere left for a new endpoint to
*forget* to.

Why it exists. Tenant isolation in this codebase has no ORM-level backstop:
``TenantManager.get_queryset()`` (apps/tenants/managers.py) applies
``is_deleted=False`` and nothing else, so a ``get_queryset()`` that omits
scoping returns every tenant's rows rather than an empty page. The isolation
lives entirely in the viewsets. Before apps/core/tenant.py it lived there as a
copy-pasted four-line idiom in a dozen separate methods, and the M15 audit found
gaps in it the way you find gaps in copy-pasted code: in batches, several apps
at a time, each one an independent chance to drop the fail-closed ``else``.

So the invariant worth testing is not per-endpoint behavior — that would be one
more thing to remember to write — but the structural one: every router-registered
viewset whose model carries a ``tenant`` field passes through the single helper,
or is listed in EXEMPT below with a reason. Adding a viewset without scoping it
fails this test at the moment the route is registered, which is well before it
reaches an audit.

What it cannot catch. This is a static check over ``get_queryset`` source: it
proves the helper is *called*, not that the result is used, and it says nothing
about ``@action`` methods that build their own querysets or about write paths.
Those still need their own tests. It closes the specific hole that kept
reopening, not every hole.
"""
import inspect

import pytest
from django.core.exceptions import FieldDoesNotExist
from django.urls import get_resolver

# ---------------------------------------------------------------------------
# Exemptions. Every entry is a viewset whose model has a `tenant` field but
# which deliberately does not route through apps/core/tenant.py. Each needs a
# reason that says why the isolation is achieved some other way — "it's fine"
# is not a reason, and neither is "the tests pass".
#
# This is NOT the `permission_codename = None` list. Those nine viewsets are
# exempt from *codename* enforcement, an unrelated axis; most of them are
# tenant-scoped through the helper and so do not belong here at all.
# ---------------------------------------------------------------------------
#: 这份契约**解析不出模型**的视图。它们不是豁免 —— 豁免是 EXEMPT,那里的条目
#: 有模型、有租户字段、只是走别的路。这里的条目是「这个检查根本看不见你」,
#: 而看不见比不合格更危险:输出是 SKIP,读起来和通过一模一样。
#:
#: M5 就是这么发现的:`UserViewSet` 没有类级 `queryset` 也没有 `serializer_class`,
#: 于是 `_model_for` 返回 None、这条断言 skip。**把它 `get_queryset` 里的
#: `scope_to_tenant` 删掉,这份契约照样全绿。**
MODEL_UNRESOLVABLE: dict[str, str] = {
    "LoginView": (
        "认证端点,不服务任何模型 —— 它的工作就是把凭据换成 token。"
        "没有租户可隔离:调用者此刻还没有身份。"
    ),
    "RefreshView": (
        "同 LoginView。刷新一个已签发的 token,不读任何租户数据。"
    ),
}
#: `UserViewSet` 曾经在上面这份名单里。**移除它不是因为记录写好了,是因为它现在
#: 真的受这份契约约束了** —— 给它加了类级 `queryset = User.objects.all()`,
#: `_model_for` 于是解析得出 User,断言开始求值。变异实证:把它 `get_queryset()`
#: 里的 `scope_to_tenant` 换成恒等函数,加 queryset **之前** 34 条全绿,
#: 之后 1 条红。**一条记录得很好的豁免,和一个真的会红的检查,不是一回事。**


EXEMPT: dict[str, str] = {
    "DispatchRecordViewSet": (
        "Inherently cross-tenant by design: a dispatch record is a transfer "
        "*between* two tenants, so single-tenant scoping would hide every row "
        "from at least one of its two legitimate parties. get_queryset() "
        "OR-filters across the initiating and receiving tenants instead — a "
        "shape the helper deliberately does not express, because generalising "
        "it would give every other call site a way to widen its own scope."
    ),
    "CrossTenantJudgmentViewSet": (
        "Same reason as DispatchRecordViewSet: the model exists to span "
        "tenants. Scoped to the initiating tenant OR the participating "
        "tenants, not to one."
    ),
    "LoginLogViewSet": (
        "Runs the ADMIN check inverted, so the helper cannot express it: "
        "non-ADMIN gets qs.none() outright (this is an ADMIN-only audit trail, "
        "enforced by IsAdminPermission), and it is ADMIN that then gets scoped "
        "to its own tenant's users. Everywhere else ADMIN is the role that "
        "bypasses scoping. Flattening that into scope_to_tenant's "
        "admin_bypass=False would ALSO open the view to non-ADMIN roles, which "
        "is the opposite of what this viewset is for. LoginLog reaches Tenant "
        "only via user__tenant and is scoped on a User id subquery. Left as "
        "is, deliberately — it is a different rule, not a missing one."
    ),
}


def _authorship_fields():
    """Field names AuditUserFields contributes — read off the abstract base
    rather than hardcoded, so adding one there does not silently start
    flagging every model in the codebase."""
    from apps.core.models import AuditUserFields

    return {f.name for f in AuditUserFields._meta.get_fields()}


_AUTHORSHIP_FIELDS = _authorship_fields()


def _registered_viewsets():
    """Every viewset class reachable from the root URLconf.

    Walks the resolver rather than importing app urls.py modules, so a viewset
    that is defined but never routed is not policed (it cannot leak), and one
    that is routed cannot be missed by forgetting to list its app here.
    """
    found: dict[type, str] = {}

    def walk(resolver):
        for pattern in resolver.url_patterns:
            if hasattr(pattern, "url_patterns"):
                walk(pattern)
                continue
            # DRF's .as_view() stashes the class on the view function.
            cls = getattr(pattern.callback, "cls", None)
            if cls is not None and hasattr(cls, "get_queryset"):
                found.setdefault(cls, str(pattern.pattern))

    walk(get_resolver())
    return found


def _model_for(view_cls):
    """The model a viewset serves, from `queryset` or the serializer's Meta."""
    qs = getattr(view_cls, "queryset", None)
    if qs is not None:
        return qs.model
    meta = getattr(getattr(view_cls, "serializer_class", None), "Meta", None)
    return getattr(meta, "model", None)


def _tenant_path(model):
    """How this model reaches Tenant, or None if it does not.

    Direct `tenant` field first. Failing that, one FK hop — UserProfile,
    UserNotification and ApprovalNode all carry no tenant column of their own
    and are scoped through `user__tenant` / `workflow__tenant`. Those are
    exactly as leaky as a direct field when unscoped, so a check that only
    looked for a literal `tenant` column would skip three of the viewsets this
    contract most needs to cover.

    One hop, not arbitrary depth: deeper paths get ambiguous fast (several
    routes to Tenant, no way to say which is the scoping one), and every model
    in this codebase that is tenant-scoped is scoped within one hop.

    AuditUserFields' own FKs are skipped. `create_user` and `update_user` point
    at User, and User has a tenant — so without this every model in the
    codebase would look one hop from Tenant and the check would demand scoping
    on global tables like Menu. "Who touched this row" is authorship metadata,
    not a scoping path.
    """
    if model is None:
        return None
    from apps.tenants.models import Tenant

    if model is Tenant:
        # The degenerate case. Tenant has no `tenant` column because it *is*
        # the tenant, and skipping it here would leave the one viewset that
        # serves the tenant list itself unpoliced.
        return "pk"
    try:
        model._meta.get_field("tenant")
        return "tenant"
    except FieldDoesNotExist:
        pass
    for field in model._meta.get_fields():
        related = getattr(field, "related_model", None)
        if related is None or not field.concrete:
            continue
        if field.name in _AUTHORSHIP_FIELDS:
            continue
        try:
            related._meta.get_field("tenant")
        except FieldDoesNotExist:
            continue
        return f"{field.name}__tenant"
    return None


def _goes_through_helper(view_cls):
    """True when the get_queryset() that actually runs reaches the helper.

    Walks the MRO in order and stops at the first implementation that does not
    delegate upward, because that is where resolution really stops at runtime.
    Checking the whole MRO unconditionally would pass any viewset that merely
    *lists* DataScopeViewSetMixin among its bases while fully overriding
    get_queryset — which is precisely what the two dispatch viewsets do, and
    what their EXEMPT entries are about.
    """
    for klass in view_cls.__mro__:
        func = klass.__dict__.get("get_queryset")
        if func is None:
            continue
        try:
            source = inspect.getsource(func)
        except (OSError, TypeError):  # pragma: no cover - source always available here
            return False
        if "scope_to_tenant" in source or "scope_to_api_key" in source:
            return True
        if "super()" not in source:
            # Terminal implementation: nothing further up the MRO runs.
            return False
    return False


def _params():
    return [
        pytest.param(cls, pattern, id=cls.__name__)
        for cls, pattern in sorted(
            _registered_viewsets().items(), key=lambda kv: kv[0].__name__
        )
    ]


@pytest.mark.parametrize("view_cls,pattern", _params())
def test_tenant_bearing_viewset_scopes_through_the_helper(view_cls, pattern):
    model = _model_for(view_cls)
    assert model is not None or view_cls.__name__ in MODEL_UNRESOLVABLE, (
        f"{view_cls.__name__}:这份契约解析不出它服务的模型(没有类级 `queryset`,"
        f"序列化器的 Meta 也拿不到),于是 **这条断言从未被求值过**。\n"
        f"实测:删掉 `UserViewSet.get_queryset` 里的 `scope_to_tenant`,这份契约"
        f"照样通过 —— 它的 SKIP 输出就是断言从未运行的直接证据,而模块 docstring "
        f"写着「每个 router 注册的 viewset 都过这个模块」。\n"
        f"要么给它一个类级 `queryset`,要么写进 MODEL_UNRESOLVABLE 并说明"
        f"它的租户隔离由什么保证。"
    )
    if model is None:
        # 已在名单里,理由记在那儿。
        return
    path = _tenant_path(model)
    if path is None:
        pytest.skip(f"{model.__name__} cannot reach Tenant")

    name = view_cls.__name__
    if name in EXEMPT:
        assert not _goes_through_helper(view_cls), (
            f"{name} is listed in EXEMPT in {__file__}, but its get_queryset() "
            f"now calls scope_to_tenant/scope_to_api_key. If it was fixed, "
            f"delete its EXEMPT entry so the contract is enforced for real."
        )
        return

    assert _goes_through_helper(view_cls), (
        f"\n"
        f"  {name} (routed at {pattern!r}) serves {model.__name__}, which reaches "
        f"Tenant via {path!r},\n"
        f"  but no get_queryset() in its MRO calls scope_to_tenant() or "
        f"scope_to_api_key().\n"
        f"\n"
        f"  Nothing below the viewset will scope this for you: TenantManager "
        f"stopped filtering\n"
        f"  by tenant (apps/tenants/managers.py), so an unscoped get_queryset() "
        f"serves EVERY\n"
        f"  tenant's rows.\n"
        f"\n"
        f"  Fix it one of these ways:\n"
        f"    1. Inherit DataScopeViewSetMixin (apps/core/viewsets.py) or "
        f"TenantQuerySetMixin\n"
        f"       (apps/core/mixins.py) and drop the hand-written "
        f"get_queryset(). Preferred.\n"
        f"    2. Call scope_to_tenant(qs, self.request) from apps/core/tenant.py "
        f"— pass\n"
        f"       field=... if the path to Tenant is indirect (e.g. "
        f"'user__tenant').\n"
        f"    3. If this viewset is genuinely cross-tenant by design, add it to "
        f"EXEMPT in\n"
        f"       {__file__}\n"
        f"       with a reason explaining how isolation is achieved instead.\n"
    )


def test_exempt_entries_are_all_still_routed():
    """An EXEMPT entry for a viewset that no longer exists is stale — it would
    silently keep excusing a name nothing checks."""
    routed = {cls.__name__ for cls in _registered_viewsets()}
    stale = sorted(set(EXEMPT) - routed)
    assert not stale, (
        f"EXEMPT in {__file__} names viewsets that are no longer routed: "
        f"{stale}. Remove them."
    )


def test_the_contract_covers_something():
    """Guard against the check quietly policing an empty set — if the resolver
    walk or the model lookup breaks, every case would skip and this file would
    stay green while checking nothing."""
    covered = [
        cls
        for cls in _registered_viewsets()
        if _tenant_path(_model_for(cls)) is not None
    ]
    # 25 at the time of writing. The floor is a tripwire for the discovery
    # itself silently returning nothing — not a headcount to keep updated —
    # so it sits below the real number rather than pinned to it.
    assert len(covered) >= 20, (
        f"Only {len(covered)} tenant-bearing viewsets found; the discovery in "
        f"{__file__} is probably broken rather than the codebase having shrunk."
    )


def test_the_unresolvable_list_names_only_routed_viewsets():
    """名单里的名字必须还在路由上。

    一条指着已删视图的记录,读起来和一条生效的记录完全一样,而它记录的那个理由
    早已无人可依。与 EXEMPT 的同名守卫同一个道理。
    """
    routed = {cls.__name__ for cls in _registered_viewsets()}
    stale = sorted(set(MODEL_UNRESOLVABLE) - routed)
    assert stale == [], f"MODEL_UNRESOLVABLE 里这些视图已不在路由上:{stale}"


def test_the_unresolvable_list_does_not_cover_a_resolvable_viewset():
    """反方向:模型现在解析得出来了,就该受契约约束,而不是继续躺在名单里。"""
    redundant = sorted(
        name
        for cls in _registered_viewsets()
        if (name := cls.__name__) in MODEL_UNRESOLVABLE and _model_for(cls) is not None
    )
    assert redundant == [], (
        f"这些视图的模型现在解析得出来了,把它们从 MODEL_UNRESOLVABLE 里删掉,"
        f"契约才会真的对它们生效:{redundant}"
    )
