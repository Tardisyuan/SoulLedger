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

What it cannot catch. This is a static check over the ``get_queryset`` AST: it
proves a *call node* to the helper exists, not that the result is used, and it
says nothing about ``@action`` methods that build their own querysets or about
write paths. Those still need their own tests. It closes the specific hole that
kept reopening, not every hole.

Why the AST and not the source text. Until 2026-09-12 this read
``"scope_to_tenant" in inspect.getsource(func)``. ``apps/core/viewsets.py``
has the words ``scope_to_tenant's own admin_bypass`` in a *comment* four lines
above the real call, so deleting the call left the contract green
(34 passed / 2 skipped) while Actor / Realm / Reincarnation / SoulEvent leaked
across tenants. Deleting the comment as well was what finally turned it red.
A guard that reads prose is guarding prose. ``test_a_judge_only_sees_its_own_
tenant`` below is the behavioural half: the call must also *do* something.
"""
import ast
import inspect
import textwrap

import pytest
from django.core.exceptions import FieldDoesNotExist
from django.urls import get_resolver

# ---------------------------------------------------------------------------
# Exemptions. Every entry is a viewset whose model has a `tenant` field but
# which deliberately does not route through apps/core/tenant.py. Each needs a
# reason that says why the isolation is achieved some other way — "it's fine"
# is not a reason, and neither is "the tests pass".
#
# This is NOT the `permission_codename = None` list. Those viewsets are exempt
# from *codename* enforcement, an unrelated axis; most of them are tenant-scoped
# through the helper and so do not belong here at all.
#
# This comment said "nine" until 2026-09-06. `grep -c "permission_codename = None"`
# over `apps/` returns 10, and a separate audit counted 8. Three numbers, none
# of them checked against the tree — so the count is gone and the grep stays:
# a hand-maintained tally of something nothing asserts drifts silently, and a
# stale one reads exactly like a fresh one.
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


#: 暂居只读例外(apps/core/tenant.py,2026-09-18 用户决定)的**纳入**清单:
#: 视图名 → (声明的 `residence_read_actions`, 理由)。暂居期间原属租户的官员对这些
#: 动作只读可见;其余一切动作、一切写方法照旧只按 tenant。
RESIDENCE_READABLE: dict[str, tuple[tuple[str, ...], str]] = {
    "SoulViewSet": (
        ("list", "retrieve", "karma", "records"),
        "灵魂列表、详情、功过总账与功过记录 —— 原属文明要知道自己的灵魂在别处的状况。"
        "写动作(die / transition / add_record / 确认日期警告 / archive / 更正终局)不纳入。",
    ),
    "JudgmentViewSet": (
        ("list", "retrieve", "citations"),
        "暂居地对灵魂的审判与其所引条文,即「审判进展」。不含 `next_pending`:"
        "那是待办队列,原属租户对暂居地的案子什么都不能做,出现在它的队列里只会误导。",
    ),
    "DispositionViewSet": (
        ("list", "retrieve"),
        "暂居地的处置,即「处置进展」:执行了没有、是否永久刑期决定灵魂何时回归。",
    ),
    "SoulEventViewSet": (
        ("list", "retrieve"),
        "灵魂时间线。暂居地写的事件(调拨执行、回归被拦下 DISPATCH_RETURN_BLOCKED)"
        "是原属租户跟进回归的唯一线索。",
    ),
}

#: 模型挂在灵魂上、**不纳入**暂居只读例外的视图,各自的理由。
#: 新增一个挂在灵魂上的视图,必须进两张表之一 —— 见 test_every_soul_linked_viewset_is_classified。
NOT_RESIDENCE_READABLE: dict[str, str] = {
    "ReincarnationViewSet": (
        "暂居中的灵魂不能转生(Soul.transition_to 拒绝 REINCARNATING),暂居地不会有转生行;"
        "转生归原属文明,原属租户本来就看得到自己的。"
    ),
    "ApprovalWorkflowViewSet": (
        "审批流是暂居地的办事队列(approve / advance / escalate),不是进展本身;"
        "审判与处置的结果已经经 JudgmentViewSet / DispositionViewSet 可读。"
    ),
    "DispatchRecordViewSet": "调拨记录本来就对源、目标两方可见(EXEMPT),不需要再放宽。",
    "DeathRegistrationViewSet": "死亡登记是机器对机器的入口,按 API key 隔离,与暂居无关。",
    "DeathRegistrationReadViewSet": "同上:死亡登记发生在调拨之前,属于登记它的租户。",
    "SoulAccountViewSet": "灵魂账号本来就按 soul__home_tenant 隔离,原属租户始终可见。",
    "InitialCredentialViewSet": "同上,按 soul__home_tenant;暂居地不应看到初始密码。",
    "OfficerRebirthApplicationViewSet": "同上,转生申请归原属文明审理。",
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


_HELPERS = frozenset({"scope_to_tenant", "scope_to_api_key"})


def _called_names(func):
    """Every callee name in ``func``: ``f(...)`` gives ``f``, ``x.f(...)`` gives ``f``."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(func)))
    names = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        callee = node.func
        if isinstance(callee, ast.Name):
            names.add(callee.id)
        elif isinstance(callee, ast.Attribute):
            names.add(callee.attr)
    return names


def _goes_through_helper(view_cls):
    """True when the get_queryset() that actually runs reaches the helper.

    Walks the MRO in order and stops at the first implementation that does not
    delegate upward, because that is where resolution really stops at runtime.
    Checking the whole MRO unconditionally would pass any viewset that merely
    *lists* DataScopeViewSetMixin among its bases while fully overriding
    get_queryset — which is precisely what the two dispatch viewsets do, and
    what their EXEMPT entries are about.

    Both questions — "does it call the helper" and "does it call super()" —
    are asked of Call nodes, never of the text. See the module docstring.
    """
    for klass in view_cls.__mro__:
        func = klass.__dict__.get("get_queryset")
        if func is None:
            continue
        called = _called_names(func)
        if called & _HELPERS:
            return True
        if "super" not in called:
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


def test_the_helper_check_reads_calls_not_prose():
    """The check must not be satisfiable by a comment or a string literal —
    that is exactly how it was blind before (module docstring)."""

    class Prose:
        def get_queryset(self):
            # scope_to_tenant is mentioned here and nowhere else
            return "scope_to_tenant(qs, self.request)"

    class Call:
        def get_queryset(self):
            return scope_to_tenant(None, None)  # noqa: F821 - never executed

    assert not _goes_through_helper(Prose)
    assert _goes_through_helper(Call)


@pytest.mark.django_db
@pytest.mark.parametrize("path", ["/api/v1/actors/", "/api/v1/realms/"])
def test_a_judge_only_sees_its_own_tenant(path, api_client, judge_user, cn_tenant, eu_tenant):
    """The behavioural half of the contract: the call the AST found has to
    filter. A JUDGE (no ADMIN bypass) lists the endpoint and the other tenant's
    row is asserted *absent*, not merely "own row present" — ``>= 1`` stays
    green on a full cross-tenant leak."""
    from rest_framework_simplejwt.tokens import RefreshToken

    from apps.actors.models import Actor, ActorRole
    from apps.realms.models import Realm, RealmType
    from apps.souls.models import Civilization

    if path.endswith("actors/"):
        mine = Actor.objects.create(name="CN Actor", role=ActorRole.JUDGE,
                                    civilization=Civilization.CHINESE, tenant=cn_tenant)
        theirs = Actor.objects.create(name="EU Actor", role=ActorRole.JUDGE,
                                      civilization=Civilization.EUROPEAN, tenant=eu_tenant)
    else:
        mine = Realm.objects.create(realm_code="CN_R", civilization=Civilization.CHINESE,
                                    name_local="地府", realm_type=RealmType.HELL, tenant=cn_tenant)
        theirs = Realm.objects.create(realm_code="EU_R", civilization=Civilization.EUROPEAN,
                                      name_local="Hell", realm_type=RealmType.HELL, tenant=eu_tenant)

    token = RefreshToken.for_user(judge_user)
    token["tenant_code"] = cn_tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    res = api_client.get(path)
    assert res.status_code == 200, res.content
    ids = {row["id"] for row in res.json()["results"]}
    assert str(mine.id) in ids
    assert str(theirs.id) not in ids, f"{path}: other tenant's row leaked to a JUDGE"


# ---------------------------------------------------------------------------
# 暂居只读例外的契约
# ---------------------------------------------------------------------------


def _soul_linked(model):
    from apps.core.tenant import _soul_path

    return model is not None and _soul_path(model) is not None


def test_every_soul_linked_viewset_is_classified_for_the_residence_exception():
    linked = {cls.__name__ for cls in _registered_viewsets() if _soul_linked(_model_for(cls))}
    both = sorted(set(RESIDENCE_READABLE) & set(NOT_RESIDENCE_READABLE))
    assert both == [], f"同时出现在纳入与不纳入清单里:{both}"
    unclassified = sorted(linked - set(RESIDENCE_READABLE) - set(NOT_RESIDENCE_READABLE))
    assert unclassified == [], (
        f"这些视图的模型挂在灵魂上,但没有决定是否纳入暂居只读例外:{unclassified}。"
        f"写进 {__file__} 的 RESIDENCE_READABLE 或 NOT_RESIDENCE_READABLE,附理由。"
    )
    stale = sorted((set(RESIDENCE_READABLE) | set(NOT_RESIDENCE_READABLE)) - linked)
    assert stale == [], f"清单里这些名字已不是路由上挂在灵魂上的视图:{stale}"


def test_declared_residence_actions_match_the_contract_exactly():
    declared = {
        cls.__name__: tuple(cls.residence_read_actions)
        for cls in _registered_viewsets()
        if getattr(cls, "residence_read_actions", ())
    }
    expected = {name: actions for name, (actions, _reason) in RESIDENCE_READABLE.items()}
    assert declared == expected


def test_residence_actions_are_reads_only():
    """声明进例外的动作只能是 GET。一个 POST 动作混进来,方法检查仍会挡住它,
    但那样的声明读起来像「原属租户能做这件事」—— 在这里就拒绝。"""
    for cls in _registered_viewsets():
        for action in getattr(cls, "residence_read_actions", ()):
            if action in ("list", "retrieve"):
                continue
            method = getattr(cls, action, None)
            mapping = getattr(method, "mapping", None)
            assert mapping is not None, f"{cls.__name__}.{action} 不是一个 @action"
            # 同一路由可以把 POST 映射到另一个动作名(citations / cite_statute),只看映射到本动作的方法。
            methods = {m for m, name in mapping.items() if name == action}
            assert methods == {"get"}, f"{cls.__name__}.{action} 接受 {sorted(methods)}"


@pytest.mark.django_db
def test_the_residence_exception_widens_only_safe_methods_and_only_soul_linked_models(cn_tenant, eu_tenant):
    from types import SimpleNamespace

    from apps.core.tenant import scope_to_tenant
    from apps.realms.models import Realm
    from apps.souls.models import Soul

    soul = Soul.objects.create(name="暂居", tenant=cn_tenant)
    Soul.all_objects.filter(pk=soul.pk).update(tenant=eu_tenant)
    user = SimpleNamespace(is_authenticated=True, role="JUDGE")

    def scoped(method, *, model=Soul, **kwargs):
        request = SimpleNamespace(user=user, tenant=cn_tenant, method=method)
        return scope_to_tenant(model.all_objects.all(), request, **kwargs)

    assert list(scoped("GET", residence_read=True)) == [soul]
    assert list(scoped("GET")) == []
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert list(scoped(method, residence_read=True)) == [], method
    # 例外只挂在默认的 `tenant` 字段上;走别的路径的调用方不受影响。
    assert list(scoped("GET", residence_read=True, field="create_user__tenant")) == []
    # 不挂在灵魂上的模型:没有放宽,照常按 tenant 过滤。
    Realm.objects.create(realm_code="EU_ONLY", civilization="EUROPEAN", name_local="Hell",
                         realm_type="HELL", tenant=eu_tenant)
    assert list(scoped("GET", model=Realm, residence_read=True)) == []
    # 暂居结束:原属照常可见(普通隔离),暂居地一侧没有例外。
    Soul.all_objects.filter(pk=soul.pk).update(tenant=cn_tenant)
    assert list(scoped("GET", residence_read=True)) == [soul]
    eu_request = SimpleNamespace(user=user, tenant=eu_tenant, method="GET")
    assert list(scope_to_tenant(Soul.all_objects.all(), eu_request, residence_read=True)) == []


@pytest.mark.django_db
def test_the_object_level_residence_check_matches_the_queryset_one(cn_tenant, eu_tenant):
    """`TenantPermission` 的对象级判定是列表过滤之后的第二道。列表过滤先挡掉了第三租户的行,
    所以只经 API 测不到这一道 —— 在这里直接问它。"""
    from apps.core.tenant import residence_readable
    from apps.disposition.models import Disposition
    from apps.souls.models import Soul
    from apps.tenants.models import Tenant

    eg = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "EG"})[0]
    soul = Soul.objects.create(name="暂居", tenant=cn_tenant)
    Soul.all_objects.filter(pk=soul.pk).update(tenant=eg)
    soul.refresh_from_db()
    here = Disposition.objects.create(soul=soul, tenant=eg)
    third = Disposition.objects.create(soul=soul, tenant=eu_tenant)

    assert residence_readable(soul, cn_tenant) is True
    assert residence_readable(here, cn_tenant) is True
    assert residence_readable(third, cn_tenant) is False
    assert residence_readable(here, eu_tenant) is False
    assert residence_readable(here, None) is False
    Soul.all_objects.filter(pk=soul.pk).update(tenant=cn_tenant)
    soul.refresh_from_db()
    here.refresh_from_db()
    assert residence_readable(here, cn_tenant) is False
    # 无主的灵魂行(tenant 为空)不因为原属对得上就可读 —— TenantPermission 对空 tenant 一律拒绝。
    Soul.all_objects.filter(pk=soul.pk).update(tenant=None)
    soul.refresh_from_db()
    assert residence_readable(soul, cn_tenant) is False
