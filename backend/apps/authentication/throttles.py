"""
Custom throttle classes for authentication endpoints.
"""
from rest_framework.throttling import AnonRateThrottle


class RegisterThrottle(AnonRateThrottle):
    """Rate limit for user registration: max 5 per hour per IP."""
    scope = "register"


class LoginThrottle(AnonRateThrottle):
    """Rate limit for login attempts: max 10 per minute per IP."""
    scope = "login"


class PasswordResetThrottle(AnonRateThrottle):
    """Rate limit for password reset requests: max 3 per 5 minutes per IP."""
    scope = "password_reset"
