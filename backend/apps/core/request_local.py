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
    """
    Django middleware that sets thread-local request context.
    Uses process_request to capture request early, and process_view for auth.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            # Capture request in context as early as possible
            set_current_request(request)
            return self.get_response(request)
        finally:
            clear_current_user()

    def process_view(self, request, view_func, view_args, view_kwargs):
        """Set thread-local user after DRF authentication but before view is called."""
        import logging
        logger = logging.getLogger(__name__)

        # Get user - first check DRF request wrapper (has user set by force_authenticate)
        # then fall back to Django request
        user = getattr(request, 'user', None)
        logger.debug(f"process_view: request.user={user}, is_authenticated={getattr(user, 'is_authenticated', False) if user else 'N/A'}")

        if user is None or not getattr(user, 'is_authenticated', False):
            # Try DRF request wrapper - user is stored in _request.user for DRF
            drf_user = getattr(request, '_user', None)
            logger.debug(f"process_view: drf_user={drf_user}")
            if drf_user is not None and getattr(drf_user, 'is_authenticated', False):
                user = drf_user

        if user is not None and getattr(user, 'is_authenticated', False):
            logger.debug(f"process_view: setting thread-local user={user}")
            set_current_user(user)
        return None

