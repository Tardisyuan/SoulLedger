"""
Permission Enforcement Middleware for SoulLedger.

This module provides:
- PermissionMiddleware: A DRF middleware that enforces permission checks on
  explicitly marked endpoints.
- require_permission decorator: Marks a view with required permission codenames.

Design Rationale:
- Middleware is lightweight: only adds DB queries when a view explicitly declares
  required permissions via @require_permission().
- Works alongside existing DRF @permission_classes([IsAuthenticated]) — the
  decorator is additive, not a replacement.
- Falls back to ROLE_PERMISSIONS dict if no RolePermission DB table entry exists.
- ADMINS (role='ADMIN') bypass all permission checks.
- Uses Redis for permission caching with memory fallback.

Usage:
    from apps.core.middleware import require_permission

    @require_permission("soul.read")
    def get_souls(self, request):
        ...

    @require_permission("judgment.execute")
    class ExecuteJudgmentView(APIView):
        ...

Permission Declaration:
    Views can declare multiple required permissions as a list:
        @require_permission(["soul.read", "soul.update"])

    Permission checking is cumulative — user must have ALL declared permissions.

Middleware Position:
    Place after AuthenticationMiddleware in MIDDLEWARE list:
        "apps.core.middleware.PermissionMiddleware",
"""
from functools import wraps

from django.http import JsonResponse

from apps.core.request_local import clear_current_user, set_current_request, set_current_user


class PermissionMiddleware:
    """
    DRG permission enforcement middleware.

    This middleware only acts when a view has been decorated with
    @require_permission(). For unmarked endpoints, it passes through
    without any overhead.
    Uses Redis-backed PermissionCache with memory fallback for performance.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self._current_user = None

    def __call__(self, request):
        try:
            # Short-circuit for unauthenticated requests — let DRF handle 401
            if not hasattr(request, 'user') or not getattr(request.user, 'is_authenticated', False):
                return self.get_response(request)

            # Short-circuit for ADMIN role — bypass all permission checks
            if getattr(request.user, 'role', None) == 'ADMIN':
                return self.get_response(request)

            # Store user for _has_permission delegation
            self._current_user = request.user

            # Check if the matched view has required permissions
            view = getattr(request, 'view', None)
            if view is None:
                return self.get_response(request)

            required_perms = getattr(view, '_required_permissions', None)
            if not required_perms:
                # Fallback: check for get_required_permissions() method (ViewSet mixin)
                get_perms_fn = getattr(view, 'get_required_permissions', None)
                if callable(get_perms_fn):
                    required_perms = get_perms_fn()
                if not required_perms:
                    return self.get_response(request)

            # Evaluate each required permission via unified checker
            for perm_codename in required_perms:
                if not self._has_permission(None, perm_codename):
                    return JsonResponse(
                        {'error': f'Permission denied: {perm_codename}'},
                        status=403
                    )

            return self.get_response(request)
        finally:
            # Always clear context-variable at end of request
            clear_current_user()

    def process_view(self, request, view_func, view_args, view_kwargs):
        """
        Set context-variable user after DRF request is set up but before view is called.

        DRF's force_authenticate sets request.user on the DRF Request object,
        which is created in APIView.initialize_request() before process_view runs.
        """
        import logging
        logger = logging.getLogger(__name__)

        # Try to get user from DRF Request (if available via view.request)
        view = getattr(request, 'view', None)
        user = None
        drf_request = None

        if view is not None:
            # view.request is the DRF Request after initialize_request
            drf_request = getattr(view, 'request', None)
            if drf_request is not None:
                user = getattr(drf_request, 'user', None)
                logger.debug(f"process_view: got DRF user={user}, is_auth={getattr(user, 'is_authenticated', False) if user else 'N/A'}")

        # Fallback to Django request user
        if user is None:
            user = getattr(request, 'user', None)
            logger.debug(f"process_view: fallback to Django user={user}")

        if user is not None and getattr(user, 'is_authenticated', False):
            logger.debug(f"process_view: setting context-variable user={user}")
            set_current_user(user)
            set_current_request(request)

        return None

    def _has_permission(self, role, codename):
        """
        Check if role has the given permission codename.
        Delegates to apps.perm.checker.check_permission (single source of truth).
        Uses self._current_user when available, falls back to role-based check.
        """
        from apps.perm.checker import check_permission
        if self._current_user:
            return check_permission(self._current_user, codename)
        # Fallback for direct role-based calls (e.g., tests)
        from types import SimpleNamespace
        fake_user = SimpleNamespace(is_authenticated=True, role=role)
        return check_permission(fake_user, codename)


def require_permission(codename_or_list):
    """
    Decorator that marks a view with required permission(s).

    Args:
        codename_or_list: A single permission codename (str) or a list of
                         codenames. All declared permissions are required.

    Usage:
        @require_permission("soul.read")
        def my_view(request):
            ...

        @require_permission(["soul.read", "soul.update"])
        class MyView(APIView):
            ...
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapped_view(view_instance, request, *args, **kwargs):
            return view_func(view_instance, request, *args, **kwargs)

        # Attach required permissions to the view function/class
        if isinstance(codename_or_list, list):
            permissions = codename_or_list
        else:
            permissions = [codename_or_list]

        # Store on the view's attribute so middleware can access it
        wrapped_view._required_permissions = permissions

        # For class-based views, also set on the class
        if hasattr(view_instance, 'view_class'):
            view_instance.view_class._required_permissions = permissions

        return wrapped_view

    # Handle case where decorator is applied directly to a class
    if callable(codename_or_list):
        # Applied without parentheses: @require_permission
        view_class = codename_or_list
        view_class._required_permissions = []
        return view_class

    return decorator
