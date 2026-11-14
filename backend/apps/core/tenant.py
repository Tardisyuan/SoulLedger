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
* **Only SYSTEM_ADMIN is global.** ``User.role == "SYSTEM_ADMIN"`` (no hall)
  is the only tenant-exempt user in this codebase. A hall-less ADMIN is a
  *civilization* administrator: it sees every hall of ``User.civilization``
  and nothing else — no other civilization's halls, no hall-less rows
  (docs/ARCHITECTURE-tenant-sharding.md §7.5, user 2026-11-15). An ADMIN bound
  to a hall is scoped to that hall like every other role (user, 2026-10-29).
  The checks are spelled with ``getattr`` so an ``AnonymousUser`` — which has
  no ``role`` — is never mistaken for one.

Every caller of ``is_tenant_exempt`` is classified in
``backend/tests/tenancy_exempt_sites.py`` (SYSTEM_ADMIN-only, or widened to the
civilization ADMIN through ``reaches_hall`` / ``is_hall_less_admin``).

``backend/tests/test_tenant_scoping_contract.py`` walks every router-registered
viewset and fails if a tenant-bearing model's queryset does not pass through
this module.
"""

from django.db.models import Q

ADMIN_ROLE = "ADMIN"
SYSTEM_ADMIN_ROLE = "SYSTEM_ADMIN"
#: Every role that passes an "is this an administrator" gate (``IsAdminPermission``, the checker's bypass,
#: ``ROLE_HIERARCHY`` rank 0). SYSTEM_ADMIN passes every gate ADMIN passes.
ADMIN_ROLES = frozenset({ADMIN_ROLE, SYSTEM_ADMIN_ROLE})

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


def is_admin(user) -> bool:
    """Any administrator — a hall's ADMIN, a civilization ADMIN or SYSTEM_ADMIN. Says nothing about *where*."""
    return getattr(user, "role", None) in ADMIN_ROLES


def _hall_less(user) -> bool:
    # 进殿查看(`apps/authentication/impersonation.py::start_hall`):这一次请求里管理员只看那一殿。
    return getattr(user, "tenant_id", None) is None and not getattr(user, "hall_view", None)


def is_tenant_exempt(user) -> bool:
    """True when ``user`` is the one role that sees across every hall and every civilization: SYSTEM_ADMIN.

    ``getattr`` rather than ``user.role`` on purpose: ``AnonymousUser`` has no
    ``role`` attribute, and ``apps/core/mixins.py`` used to raise
    ``AttributeError`` on it before its own ``is_authenticated`` guard was
    added. Anonymous is never exempt.
    """
    # 2026-11-15(§7.5):无殿 ADMIN 不再是全局的,收到本文明;全局只剩 SYSTEM_ADMIN。这里一处改,
    # `scope_to_tenant`、`TenantPermission` 与各处豁免判定一起跟着变 —— 各处怎么跟,见 tests/tenancy_exempt_sites.py。
    return getattr(user, "role", None) == SYSTEM_ADMIN_ROLE and _hall_less(user)


def is_civilization_admin(user) -> bool:
    """A hall-less ADMIN: administrator of every hall of ``user.civilization`` (§7.5). Not while viewing one hall."""
    return getattr(user, "role", None) == ADMIN_ROLE and _hall_less(user)


def is_hall_less_admin(user) -> bool:
    """SYSTEM_ADMIN or a civilization ADMIN — the callers the old ``is_tenant_exempt`` answered True for."""
    return is_tenant_exempt(user) or is_civilization_admin(user)


def request_civilization(request):
    """The civilization a civilization ADMIN's request is confined to; None for everyone else.

    None also for a civilization ADMIN whose ``civilization`` is blank or not a member of the enum: such an
    account reaches no hall (fail closed), the same answer ``civilization_halls`` gives.
    """
    from apps.souls.models import Civilization

    user = getattr(request, "user", None)
    if not is_civilization_admin(user):
        return None
    civ = getattr(user, "civilization", None)
    return civ if civ in Civilization.values else None


def civilization_halls(civilization):
    """Every hall whose ``Tenant.civilization`` is ``civilization`` — soft-deleted halls included, as a queryset.

    The same rule as the property, as a ``Q``: a seeded code answers from ``TENANT_CIVILIZATION`` and wins over
    ``declared_civilization``; any other hall answers from ``declared_civilization``. An unknown or blank
    civilization has no halls.
    """
    from apps.souls.models import TENANT_CIVILIZATION, Civilization
    from apps.tenants.models import Tenant

    if civilization not in Civilization.values:
        return Tenant._base_manager.none()
    seeded = [code for code, civ in TENANT_CIVILIZATION.items() if civ == civilization]
    return Tenant._base_manager.filter(
        Q(code__in=seeded) | (Q(declared_civilization=civilization) & ~Q(code__in=list(TENANT_CIVILIZATION)))
    )


def user_civilization_halls(user):
    from apps.souls.models import Civilization

    civ = getattr(user, "civilization", None)
    return civilization_halls(civ if civ in Civilization.values else None)


def admin_hall_ids(user):
    """A hall-less administrator's reach: None = every hall (SYSTEM_ADMIN); else a frozenset of hall pks.

    Empty for a civilization ADMIN with no (known) civilization, and for anyone who is not a hall-less admin —
    callers branch on ``is_hall_less_admin`` first; this never answers "everything" by mistake.
    """
    if is_tenant_exempt(user):
        return None
    if is_civilization_admin(user):
        return frozenset(user_civilization_halls(user).values_list("pk", flat=True))
    return frozenset()


def reaches_hall(user, *tenant_ids) -> bool:
    """Whether a hall-less administrator may act in any of ``tenant_ids``: SYSTEM_ADMIN always; a civilization
    ADMIN when one of them is a hall of its civilization. False for everyone else — a hall-bound caller's own
    rule (``tenant.pk == …``) stays at the call site."""
    if is_tenant_exempt(user):
        return True
    if not is_civilization_admin(user):
        return False
    wanted = {pk for pk in tenant_ids if pk is not None}
    return bool(wanted) and user_civilization_halls(user).filter(pk__in=wanted).exists()


def hall_less_admins_q(tenant_id=None):
    """A ``Q`` over ``User``: the hall-less administrators a notification falls back to.

    SYSTEM_ADMIN always. With ``tenant_id`` (the hall the news is about), also the civilization ADMINs of that
    hall's civilization — never another civilization's (§7.5). ``tenant_id=None`` is global news (a global
    scheduled job, the assistant's configuration): SYSTEM_ADMIN only.
    """
    q = Q(role=SYSTEM_ADMIN_ROLE, tenant__isnull=True)
    if tenant_id is not None:
        from apps.tenants.models import Tenant

        hall = Tenant._base_manager.filter(pk=tenant_id).first()
        civ = hall.known_civilization if hall is not None else None
        if civ:
            q |= Q(role=ADMIN_ROLE, tenant__isnull=True, civilization=civ)
    return q


def request_tenant(request):
    """The caller's hall: ``request.tenant``, else the user's own ``tenant`` column.

    One place for the idiom that sat in 26 views and serializers (refactor audit 2026-11-08).

    In production the two agree: ``TenantMiddleware`` sets ``request.tenant`` from the token's
    ``tenant_code`` claim, and the token is issued for the user's own hall. The fallback exists for
    DRF's ``force_authenticate``, which skips the middleware and is used by over a hundred tests —
    without it those tests would exercise the "no tenant" branch instead of the one they mean to.
    Kept deliberately rather than rewriting that test surface; it is here and nowhere else, so a
    later decision to drop it is one line.

    Not ``scope_to_tenant``'s rule: that one reads ``request.tenant`` only and fails closed. A caller
    that must fail closed on a middleware-less request should use it, not this.
    """
    tenant = getattr(request, "tenant", None)
    if tenant is not None:
        return tenant
    return getattr(getattr(request, "user", None), "tenant", None)


def within_reach(qs, request, *, field: str = "tenant"):
    """``qs`` narrowed to the halls the caller reaches: SYSTEM_ADMIN all rows; a civilization ADMIN its
    civilization's halls; anyone else ``request_tenant(request)``'s hall, nothing without one. Fails closed.

    The rule the ``exempt = is_tenant_exempt(user); tenant = None if exempt else request_tenant(request)``
    idiom spelled at hand-written aggregate views (the ledger overview, …). ``field="pk"`` scopes ``Tenant``.
    """
    user = getattr(request, "user", None)
    if is_tenant_exempt(user):
        return qs
    if is_civilization_admin(user):
        halls = user_civilization_halls(user)
        return qs.filter(**{f"{field}__in": halls.values("pk") if field == "pk" else halls})
    tenant = request_tenant(request)
    if tenant is None:
        return qs.none()
    return qs.filter(**{field: tenant.pk if field == "pk" else tenant})


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
        admin_bypass: whether a hall-less administrator is scoped by its reach (SYSTEM_ADMIN: nothing;
            civilization ADMIN: its civilization's halls) rather than by ``request.tenant``. True
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

    if admin_bypass and is_civilization_admin(user):
        # 文明管理员(§7.5):本文明每一殿 —— 与那几殿的殿管理员各自所见之并相同(暂居只读例外也按殿并起来)。
        halls = user_civilization_halls(user)
        if root == "pk":
            return qs.filter(pk__in=halls.values("pk"))
        if residence_read and field == "tenant" and getattr(request, "method", None) in SAFE_METHODS:
            residence = residence_read_q(qs.model, halls)
            if residence is not None:
                return qs.filter(Q(tenant__in=halls) | residence)
        return qs.filter(**{f"{field}__in": halls})

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
    from django.db.models import QuerySet

    home = f"{path}home_tenant__in" if isinstance(tenant, QuerySet) else f"{path}home_tenant"
    away = Q(**{home: tenant}) & Q(**{f"{path}tenant__isnull": False})
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
        ``Q()`` — matches everything — for the one tenant-exempt role (SYSTEM_ADMIN), so its count matches its
        unscoped queryset; ``field__in=<its civilization's halls>`` for a civilization ADMIN. ``Q(pk__in=[])``
        — matches nothing, so every count is 0 — for an unauthenticated user
        and for a non-ADMIN with no resolvable tenant. Never an unfiltered
        aggregate for someone who cannot see the rows.
    """
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "is_authenticated", False):
        return Q(pk__in=[])

    if is_tenant_exempt(user):
        return Q()
    if is_civilization_admin(user):
        return Q(**{f"{field}__in": user_civilization_halls(user)})

    tenant = getattr(request, "tenant", None)
    if tenant is None:
        return Q(pk__in=[])

    return Q(**{field: tenant})
