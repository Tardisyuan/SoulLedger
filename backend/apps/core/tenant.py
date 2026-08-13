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

ADMIN_ROLE = "ADMIN"


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
    return qs.filter(**{field: value})


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
