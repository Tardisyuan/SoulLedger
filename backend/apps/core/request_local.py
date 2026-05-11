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
