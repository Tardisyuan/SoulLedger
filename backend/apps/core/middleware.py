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
from apps.perm.models import RolePermission, ROLE_PERMISSIONS
from apps.core.request_local import set_current_user, clear_current_user


class PermissionMiddleware:
    """
    DRG permission enforcement middleware.

    This middleware only acts when a view has been decorated with
    @require_permission(). For unmarked endpoints, it passes through
    without any overhead.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self._permission_cache = {}  # (role, codename) -> bool

    def __call__(self, request):
        # Set current user in thread-local for AuditUserFields.save()
        if hasattr(request, 'user') and request.user.is_authenticated:
            set_current_user(request.user)

        try:
            # Short-circuit for unauthenticated requests — let DRF handle 401
            if not hasattr(request, 'user') or not request.user.is_authenticated:
                return self.get_response(request)

            # Short-circuit for ADMIN role — bypass all permission checks
            if getattr(request.user, 'role', None) == 'ADMIN':
                return self.get_response(request)

            # Check if the matched view has required permissions
            view = getattr(request, 'view', None)
            if view is None:
                return self.get_response(request)

            required_perms = getattr(view, '_required_permissions', None)
            if not required_perms:
                # No permissions declared on this view — pass through
                return self.get_response(request)

            # Evaluate each required permission
            user_role = getattr(request.user, 'role', None)
            if not user_role:
                return JsonResponse({'error': 'No role assigned'}, status=403)

            for perm_codename in required_perms:
                if not self._has_permission(user_role, perm_codename):
                    return JsonResponse(
                        {'error': f'Permission denied: {perm_codename}'},
                        status=403
                    )

            return self.get_response(request)
        finally:
            # Always clear thread-local at end of request
            clear_current_user()

    def _has_permission(self, role, codename):
        """
        Check if role has the given permission codename.
        Uses in-memory cache to avoid repeated DB queries.
        """
        cache_key = (role, codename)
        if cache_key in self._permission_cache:
            return self._permission_cache[cache_key]

        # Check RolePermission table first
        try:
            has_perm = RolePermission.objects.filter(
                role=role,
                permission__codename=codename
            ).exists()
        except Exception:
            # DB unavailable — fall back to dict
            has_perm = codename in ROLE_PERMISSIONS.get(role, [])

        self._permission_cache[cache_key] = has_perm
        return has_perm


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
