"""
The single place tenant scoping is expressed.

Before this module the same four-line idiom — ADMIN bypass, read
``request.tenant``, filter, ``qs.none()`` when there is no tenant — was
copy-pasted into ten-odd ``get_queryset()`` bodies across seven apps. That is
not a style problem: it is why tenant-isolation gaps kept appearing in batches.
Each copy is an independent chance to drop the ``else`` branch, to filter the
wrong field, or to guard a check with ``if tenant is not None:`` so it never
fires. There was no single point to audit, and no single point to test.

There is no ORM-level backstop underneath any of this. ``TenantManager``
(apps/tenants/managers.py) deliberately stopped filtering by tenant — it only
applies ``is_deleted=False`` now — so a ``get_queryset()`` that forgets to
scope returns *every* tenant's rows, not an empty page. The call sites are the
whole of the isolation.

Two rules this module fixes in place:

* **Fail closed.** No resolvable tenant means ``qs.none()``, never the
  unfiltered queryset. ``apps/death_sync/views.py`` used to fail *open* on its
  API-key axis (``if api_key: qs = qs.filter(...)`` with no ``else``); see
  ``scope_to_api_key`` below.
* **ADMIN is the one global role.** ``User.role == "ADMIN"`` is the only
  tenant-exempt role in this codebase (apps/perm/models.py ``Role.scope``), and
  the check is spelled with ``getattr`` so an ``AnonymousUser`` — which has no
  ``role`` — is never mistaken for one.

``backend/tests/test_tenant_scoping_contract.py`` walks every router-registered
viewset and fails if a tenant-bearing model's queryset does not pass through
this module.
"""

from django.db.models import Q

ADMIN_ROLE = "ADMIN"

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


def is_tenant_exempt(user) -> bool:
    """True when ``user`` is the one role that sees across tenants.

    ``getattr`` rather than ``user.role`` on purpose: ``AnonymousUser`` has no
    ``role`` attribute, and ``apps/core/mixins.py`` used to raise
    ``AttributeError`` on it before its own ``is_authenticated`` guard was
    added. Anonymous is never exempt.
    """
    return getattr(user, "role", None) == ADMIN_ROLE


def scope_to_tenant(
    qs,
    request,
    *,
    field: str = "tenant",
    admin_bypass: bool = True,
    missing_field: str = "deny",
    residence_read: bool = False,
):
    """Narrow ``qs`` to the tenant on ``request``. Fails closed.

    Args:
        qs: the queryset to scope.
        request: the DRF/Django request. ``request.tenant`` is set by
            ``apps.tenants.middleware``; ``request.user`` by authentication.
        field: the lookup path from ``qs.model`` to ``Tenant``. Defaults to the
            direct ``tenant`` FK. ``apps/social/views.py``'s ``UserProfile``
            has no tenant FK of its own and passes ``"user__tenant"``.
        admin_bypass: whether ``role == "ADMIN"`` skips scoping entirely. True
            everywhere today; the knob exists so a call site that deliberately
            scopes ADMIN too (write-side cross-tenant checks in
            ``apps/social/serializers.py`` take that stance) can say so
            explicitly instead of hand-rolling the filter again.
        missing_field: what to do when ``qs.model`` has no such field.
            ``"deny"`` (default) returns ``qs.none()``. ``"allow"`` returns
            ``qs`` unscoped, for genuinely global models — ``TenantQuerySetMixin``
            is applied to ``Organization``, which has no ``tenant`` column at
            all, and filtering it used to raise ``FieldError`` on every
            non-ADMIN request. Callers must opt into ``"allow"``; the default
            is the safe answer.
        residence_read: 暂居只读例外,见 ``residence_read_q``。只在 ``field`` 是默认的
            ``"tenant"``、请求是安全方法、模型是灵魂或经 ``soul`` 外键挂在灵魂上时
            生效;任何其他情况都照常只按 ``tenant`` 过滤。调用方用
            ``residence_read_allowed(view)`` 求这个值,不要自己写 True。

    Returns:
        The scoped queryset. ``qs.none()`` for an unauthenticated user, for a
        non-ADMIN with no resolvable tenant, and — unless ``missing_field`` says
        otherwise — for a model that cannot be scoped at all.
    """
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "is_authenticated", False):
        return qs.none()

    if admin_bypass and is_tenant_exempt(user):
        return qs

    # Only the first segment can be checked cheaply; `user__tenant` is verified
    # as far as `user`, and a bad tail would raise FieldError at filter time,
    # which is the right outcome for a typo.
    root = field.split("__", 1)[0]
    if not _model_has_field(qs.model, root):
        if missing_field == "allow":
            return qs
        return qs.none()

    tenant = getattr(request, "tenant", None)
    if tenant is None:
        return qs.none()
    # A relation lookup accepts the instance and takes its pk; an identity
    # lookup does not — `Tenant.objects.filter(pk=<Tenant>)` raises TypeError
    # rather than coercing. Pass the pk when scoping Tenant against itself.
    value = tenant.pk if root == "pk" else tenant
    if residence_read and field == "tenant" and getattr(request, "method", None) in SAFE_METHODS:
        residence = residence_read_q(qs.model, tenant)
        if residence is not None:
            return qs.filter(Q(tenant=tenant) | residence)
    return qs.filter(**{field: value})


# ---------------------------------------------------------------------------
# 暂居只读例外(2026-09-18 用户决定)
#
# 跨文明调拨是暂居:`Soul.tenant` 是暂居地,`Soul.home_tenant` 是原属。暂居期间原属
# 租户的官员对这个灵魂**只读**可见 —— 灵魂本身,以及暂居地对它的审判、处置、事件。
# 这是租户隔离唯一的放宽,所以写在这里一次:
#
# * 放宽只作用于读。`scope_to_tenant` 只在安全方法上加这个 OR;对象级的
#   `TenantPermission.has_object_permission` 用 `residence_readable` 做同一个判定。
#   写路径(POST/PUT/PATCH/DELETE,以及 GET 之外的一切自定义动作)照旧只按 tenant,
#   原属租户拿到 404。
# * 每个视图显式声明哪些动作纳入:`residence_read_actions`。没有声明就没有例外。
#   纳入清单与理由见 tests/test_tenant_scoping_contract.py::RESIDENCE_READABLE。
# * 暂居结束(`tenant` 回到 `home_tenant`)例外自然失效:暂居地那些行不再满足
#   「这一行属于灵魂此刻所在的租户」。
# ---------------------------------------------------------------------------


def residence_read_allowed(view) -> bool:
    """这个视图的当前动作是否声明为暂居只读例外。方法检查在 ``scope_to_tenant`` 里。"""
    request = getattr(view, "request", None)
    return (
        getattr(request, "method", None) in SAFE_METHODS
        and getattr(view, "action", None) in getattr(view, "residence_read_actions", ())
    )


def _soul_path(model):
    """``""`` 对 Soul 本身,``"soul__"`` 对经 ``soul`` 外键挂在灵魂上的模型,否则 None。"""
    from django.core.exceptions import FieldDoesNotExist

    from apps.souls.models import Soul

    if model is Soul:
        return ""
    try:
        field = model._meta.get_field("soul")
    except FieldDoesNotExist:
        return None
    return "soul__" if getattr(field, "related_model", None) is Soul and field.many_to_one else None


def residence_read_q(model, tenant):
    """原属租户 ``tenant`` 经暂居例外额外可读的行;模型不适用时 None。

    灵魂:原属是 ``tenant``。
    挂在灵魂上的行:灵魂原属是 ``tenant``,**且这一行属于灵魂此刻所在的租户** ——
    第三个租户的行、上一段暂居留下的别处的行,都不放宽。

    不需要再写「此刻在别处」:灵魂在原属时,这两个条件选出的行本来就是原属租户自己的,
    与 ``Q(tenant=tenant)`` 重合 —— 所以暂居结束后例外自然失效,不必另判。
    """
    from django.db.models import F

    path = _soul_path(model)
    if path is None:
        return None
    away = Q(**{f"{path}home_tenant": tenant}) & Q(**{f"{path}tenant__isnull": False})
    if path:
        away &= Q(tenant=F(f"{path}tenant"))
    return away


def residence_readable(obj, tenant) -> bool:
    """对象级的同一个判定,给 ``TenantPermission.has_object_permission`` 用。"""
    path = _soul_path(type(obj))
    if path is None or tenant is None:
        return False
    soul = obj if not path else obj.soul
    return (
        soul.home_tenant_id == tenant.pk
        and soul.tenant_id is not None
        and obj.tenant_id == soul.tenant_id
    )


# ---------------------------------------------------------------------------
# 暂居写例外(Q7,docs/ARCHITECTURE-sentence-plan.md §2.5、§4.3)—— 唯一一条
#
# 原属租户为**暂居在外**的灵魂开一件「重开审判」(`Judgment.kind=REOPEN`)。原审判官批准了
# 一条 REOPEN 请求之后,原属地立刻开审(图 3),即使灵魂在外地。其他写路径照旧:原属租户对
# 暂居灵魂只读(上面那段)。
#
# 只有一个调用方:`apps/sentence_plan/requests.py::_open_reopen_judgment`,在
# `SentencePlanViewSet.decide` 批准 REOPEN 请求的同一事务里。视图用 `residence_write_actions`
# 声明它,清单钉在 tests/test_tenant_scoping_contract.py::RESIDENCE_WRITABLE,并断言
# 没有别的视图 / 动作声明写例外。`POST /judgment/` 不走这里:原属租户经它给暂居灵魂开案仍是 400。
# ---------------------------------------------------------------------------

#: 例外唯一覆盖的那个写动作。
RESIDENCE_WRITE_REOPEN = "open_reopen_judgment"


def residence_writable(soul, tenant, action) -> bool:
    """``tenant`` 能否对暂居在外的 ``soul`` 做 ``action``。只有 (原属租户, 开重开审判) 为 True。"""
    return (
        action == RESIDENCE_WRITE_REOPEN
        and tenant is not None
        and soul.home_tenant_id == tenant.pk
    )


def scope_to_api_key(qs, request):
    """Narrow ``qs`` to the API key that authenticated ``request``. Fails closed.

    The ``death_sync`` machine-to-machine endpoints scope by ``api_key`` rather
    than by tenant: ``APIKeyAuthentication`` returns ``AnonymousUser`` on
    success (so ``request.user`` carries no tenant), and the key is the caller's
    identity. What stood at ``DeathRegistrationViewSet.get_queryset`` and
    ``WebhookViewSet.get_queryset`` was::

        if api_key:
            qs = qs.filter(api_key=api_key)
        return qs

    — fail *open*: no key meant every tenant's death registrations and every
    tenant's webhook configs, signing secrets included. ``HasValidApiKey``
    happens to reject those requests first, so nothing leaked in practice, but
    the queryset was one permission-class edit away from being the breach. This
    returns ``qs.none()`` instead.
    """
    api_key = getattr(request, "api_key", None)
    if api_key is None:
        return qs.none()
    return qs.filter(api_key=api_key)


def _model_has_field(model, name: str) -> bool:
    """True when ``model`` really declares ``name`` as a concrete field.

    ``hasattr(model, "tenant")`` — what the call sites used — is not the same
    question: it also answers True for reverse accessors and plain attributes,
    and False for a deferred descriptor. Ask the meta API.

    Only ``FieldDoesNotExist`` is caught. Anything else coming out of
    ``_meta.get_field`` is a broken model, and a broken model must not quietly
    read as "unscopable".
    """
    from django.core.exceptions import FieldDoesNotExist

    # "pk" is Django's universal alias, not a declared field, so
    # _meta.get_field("pk") raises. Every model has one. This is what
    # apps/tenants/views.py scopes on — the degenerate case where the tenant
    # scope *is* the row.
    if name == "pk":
        return True

    try:
        model._meta.get_field(name)
    except FieldDoesNotExist:
        return False
    return True


def tenant_aggregate_filter(request, *, field: str) -> "Q":
    """A ``Q`` that narrows an *aggregate* to the same rows ``scope_to_tenant``
    would return. Fails closed.

    WHY THIS EXISTS SEPARATELY. ``scope_to_tenant`` narrows a queryset; it has
    nothing to say about ``Count(..., filter=...)``, and that gap is not
    cosmetic. A reverse aggregate is resolved by the ORM against the *relation*,
    not through the related model's manager, so

        Statute.objects.annotate(n=Count("citations"))

    counts every tenant's citations on a statute row even when the statute
    queryset itself is correctly scoped. The page renders one tenant's articles
    with a number computed from all of them. Nothing raises, nothing is missing
    from the response, and the leak is a single integer per row — which is
    exactly the shape that survives review.

    There is no ORM-level backstop to catch it either: ``TenantManager``
    stopped filtering by tenant (see this module's header), so the annotation
    has no second line of defence. The filter has to be written, and writing it
    at each call site is how the copy-paste isolation gaps in this codebase
    happened the first time. Hence: here, once.

    Args:
        request: the DRF/Django request, as for ``scope_to_tenant``.
        field: the lookup path **from the annotated model** to ``Tenant``,
            through the relation being aggregated — e.g. ``"citations__tenant"``
            when annotating ``Statute`` over ``JudgmentCitation``. Required and
            has no default on purpose: the correct path depends on the join
            being counted, and a default would invite the wrong one.

    Returns:
        ``Q()`` — matches everything — for the one tenant-exempt role, so an
        ADMIN's count matches the ADMIN's unscoped queryset. ``Q(pk__in=[])``
        — matches nothing, so every count is 0 — for an unauthenticated user
        and for a non-ADMIN with no resolvable tenant. Never an unfiltered
        aggregate for someone who cannot see the rows.
    """
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "is_authenticated", False):
        return Q(pk__in=[])

    if is_tenant_exempt(user):
        return Q()

    tenant = getattr(request, "tenant", None)
    if tenant is None:
        return Q(pk__in=[])

    return Q(**{field: tenant})
