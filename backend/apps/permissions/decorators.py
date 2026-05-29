"""
API permission utilities for SoulLedger.

check_api_permission delegates to apps.perm.checker (single source of truth).
"""
from apps.perm.checker import check_permission


def check_api_permission(user, permission_code: str) -> bool:
    """
    Check if user has a specific API permission.
    Delegates to apps.perm.checker.check_permission.
    """
    return check_permission(user, permission_code)
