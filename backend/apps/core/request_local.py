"""
Thread-local storage for current request context.

Allows accessing the current Django request and user from anywhere
(e.g., in model save() methods, signals) without passing request objects
through the entire call stack.

Usage:
    from apps.core.request_local import set_current_user, get_current_user

    # In middleware (at request start):
    set_current_user(request.user)

    # In model save() or signals:
    user = get_current_user()
"""
import threading
from typing import Optional

_thread_locals = threading.local()


def set_current_user(user):
    """Store the current authenticated user in thread-local storage."""
    _thread_locals.user = user


def get_current_user():
    """Get the current authenticated user from thread-local storage."""
    return getattr(_thread_locals, 'user', None)


def set_current_request(request):
    """Store the current Django request in thread-local storage."""
    _thread_locals.request = request


def get_current_request():
    """Get the current Django request from thread-local storage."""
    return getattr(_thread_locals, 'request', None)


def clear_current_user():
    """Clear the thread-local user (call at end of request)."""
    _thread_locals.user = None
    _thread_locals.request = None


class RequestContextMiddleware:
    """
    Django middleware that sets thread-local user from Django's request user.
    Uses process_view to set user AFTER DRF authentication has run,
    so that request.user is properly set even when using force_authenticate.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
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
            set_current_request(request)
        return None

