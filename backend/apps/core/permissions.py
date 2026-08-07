"""
DRF permission classes for SoulLedger multi-tenant isolation.
"""
from rest_framework import permissions


class CodenamePermission(permissions.BasePermission):
    """Enforce the codenames a view declares, at the one layer that can see them.

    ``CodenameViewSetMixin.get_required_permissions()`` derives its answer from
    ``self.action`` — ``soul.delete`` for ``destroy``, ``soul.die`` for the
    ``die`` @action. That attribute is set by DRF in
    ``ViewSetMixin.initialize_request()``, which runs inside ``dispatch()``.

    ``PermissionMiddleware``, which was supposed to be doing this job, runs in
    the request phase — before Django has even resolved the URL, let alone
    instantiated the view. It reads ``request.view``, an attribute nothing in
    the pipeline sets, so it takes the ``view is None`` early return on every
    request ever made. Its ``process_view`` hook is no better: that fires
    before the view callable is invoked, so ``self.action`` still does not
    exist. There is no wiring that repairs middleware here; the codename
    contract is only satisfiable after ``initialize_request``.

    A DRF permission class is exactly that point. ``check_permissions()`` is
    called from ``APIView.initial()``, after ``initialize_request()`` has set
    ``action`` and after ``TenantMiddleware`` has set ``request.tenant``, and
    early enough that a denial costs nothing — the handler never runs, so no
    write can have landed.

    Pair it with ``TenantPermission``, do not replace it: this class answers
    "may this role do this kind of thing at all", and ``TenantPermission``
    answers "in this tenant". Both must hold.

    Declaring the codenames:

    * ViewSets get them from ``CodenameViewSetMixin`` (``permission_codename``
      plus ``extra_permissions``).
    * Plain ``APIView``s declare a ``get_required_permissions()`` method
      returning a list of codenames.

    Every declared codename must hold — the check is cumulative, matching what
    ``@require_permission`` documented and the middleware never delivered.

    Coupled to the permission cache, which is not obvious from either file.
    ``check_permission`` answers from ``apps.perm.cache`` with a 300s TTL, so
    this class is only as correct as that cache's invalidation. While the
    codenames were merely *reported* to the UI, a stale entry was a display
    bug. Now that they are *enforced*, a stale entry means a revoked permission
    keeps admitting requests for up to five minutes — the same defect promoted
    from cosmetic to security. Anything that writes ``Role``, ``RolePermission``
    or ``Permission`` rows must invalidate; note that ``bulk_create`` emits no
    ``post_save``, so the signal handlers alone are not sufficient cover.
    """

    def has_permission(self, request, view):
        from apps.perm.checker import check_permission

        if not request.user or not request.user.is_authenticated:
            return False  # Reject unauthenticated — let DRF's 401 take over

        get_perms = getattr(view, 'get_required_permissions', None)
        if not callable(get_perms):
            # The view declares nothing to enforce. Attaching this class to
            # such a view is a wiring mistake rather than a policy, and the
            # honest reading of "no codename declared" is "this class has no
            # opinion" — TenantPermission and any object-level rules still
            # apply. Kept permissive on purpose so a missing declaration
            # cannot silently lock an endpoint; the whole-project assertion in
            # apps/perm/test_codename_coverage.py is what catches the omission.
            return True

        required = get_perms()
        if not required:
            # Reachable for an action the mixin maps to nothing — an unrouted
            # or unmapped HTTP method, which DRF answers with 405 regardless.
            return True

        for codename in required:
            if not check_permission(request.user, codename):
                self.message = f"Permission denied: {codename}"
                return False
        return True


class TenantPermission(permissions.BasePermission):
    """
    Enforce tenant isolation at the DRF permission layer.

    - IsAuthenticated: unauthenticated requests are rejected (401)
    - SYS_ADMIN (role='ADMIN') bypasses tenant filtering (global read)
    - All other authenticated users: request must have a valid tenant
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False  # Reject unauthenticated — let DRF's 401 take over

        # SYS_ADMIN bypasses tenant filtering (global access)
        if getattr(request.user, 'role', None) == 'ADMIN':
            return True

        # Must have a tenant on the request (set by TenantMiddleware)
        tenant = getattr(request, 'tenant', None)
        if tenant is None:
            return False

        # request.tenant comes from the access token's tenant_code claim
        # (apps.tenants.middleware, which runs before authentication and
        # so cannot itself see request.user). This runs later, in
        # check_permissions() — request.user is now the authenticated
        # user, so cross-check the token's claim against that user's
        # actual current tenant. Without this, a token minted before an
        # admin moved the user to a different tenant keeps granting
        # access under the old tenant_code until it expires: nothing else
        # in the request pipeline re-derives tenant from the user record.
        # user_tenant_id is None counts as a mismatch (fail closed) rather
        # than "no opinion" — every non-ADMIN user is assigned a tenant on
        # creation (see UserCreateSerializer), so a null tenant here means
        # something already went wrong upstream.
        user_tenant_id = getattr(request.user, 'tenant_id', None)
        return user_tenant_id is not None and str(user_tenant_id) == str(tenant.pk)

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False

        # SYS_ADMIN bypasses
        if getattr(request.user, 'role', None) == 'ADMIN':
            return True

        tenant = getattr(request, 'tenant', None)
        if tenant is None:
            return False

        # Check if object has a tenant field
        obj_tenant = getattr(obj, 'tenant', None)
        if obj_tenant is None:
            return True  # No tenant field — allow

        return str(obj_tenant.pk) == str(tenant.pk)


class IsAdminPermission(permissions.BasePermission):
    """
    Permission class that only allows ADMIN role users.
    Use this for admin-only endpoints like user management, role management.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return getattr(request.user, 'role', None) == 'ADMIN'

    def has_object_permission(self, request, view, obj):
        return getattr(request.user, 'role', None) == 'ADMIN'


def admin_required(view_func):
    """
    Decorator for function-based views that requires ADMIN role.
    Use for @api_view decorated endpoints that need admin check.
    """
    def wrapper(request, *args, **kwargs):
        if getattr(request, 'user', None) is None:
            from rest_framework.exceptions import NotAuthenticated
            raise NotAuthenticated()
        if getattr(request.user, 'role', None) != 'ADMIN':
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Admin access required")
        return view_func(request, *args, **kwargs)
    return wrapper


def user_has_permission(user, codename):
    """
    Check if a user has a specific permission codename.
    Delegates to apps.perm.checker.check_permission (single source of truth).
    """
    from apps.perm.checker import check_permission
    return check_permission(user, codename)
