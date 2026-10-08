"""
Unified permission checking for SoulLedger.

Single source of truth for all permission evaluation.
All permission checks (middleware, mixin, decorator, view) should use this module.

Design:
- ADMIN bypass (role='ADMIN' → always True)
- DB lookup (Permission + RolePermission) for seeded codenames
- ROLE_PERMISSIONS dict fallback for unseeded codenames
- Redis-backed caching with memory fallback
"""
from apps.perm.cache import get_permission_cache

_permission_cache = get_permission_cache()

#: {role name: codenames that role may never hold} — a server rule, not a
#: default (maintainer decision, 2026-09-25). `check_permission` answers False
#: for these whatever the grant table says, and the matrix, `assign` and import
#: refuse to write them (`role_forbidden_permission`, apps/perm/matrix.py).
#: MODERATOR (殿主): see the reasons above its entry in ROLE_PERMISSIONS.
ROLE_FORBIDDEN_CODENAMES = {
    "MODERATOR": frozenset({"workflow.approve", "workflow.advance", "user.manage"}),
}


def check_permission(user, codename):
    """
    Check if a user has a specific permission codename.

    Priority: cache → DB (Permission + RolePermission) → ROLE_PERMISSIONS dict.

    Args:
        user: Django User instance (or None for unauthenticated)
        codename: Permission codename string (e.g., "soul.read")

    Returns:
        True if user has the permission, False otherwise
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return False

    role = getattr(user, 'role', None)
    if not role:
        return False

    # ADMIN bypasses all permission checks
    if role == 'ADMIN':
        return True
    # 灵魂不持有任何官员权限,也不能经权限矩阵被授予 —— 即使有人建了一行叫
    # SOUL 的 Role 并挂上 RolePermission。
    if role == 'SOUL':
        return False

    # 多角色:权限是 `role` 与 `extra_roles` 各自答案的并集 —— 并集只在这里算。
    # 硬规则排在并集之前:持有的任何一个角色禁用该 codename,整个人就答 False
    # (殿主兼任判官也不能 approve)。ADMIN / SOUL 即使被写进 extra_roles 也无视,
    # 它们只能是主角色。
    roles = [role, *_live_extra_roles(user)]
    if any(codename in ROLE_FORBIDDEN_CODENAMES.get(r, ()) for r in roles):
        return False
    return any(_role_has(r, codename) for r in roles)


def _live_extra_roles(user):
    """`user.extra_roles` minus anything that may not be a second role.

    One query, and only for a user who has extras: a role sitting in the
    recycle bin no longer counts (the default manager hides it), though its
    RolePermission rows still exist.
    """
    extras = {r for r in (getattr(user, 'extra_roles', None) or ()) if r not in ('ADMIN', 'SOUL')}
    if not extras:
        return []
    from apps.perm.models import Role

    return sorted(Role.objects.filter(name__in=extras).values_list('name', flat=True))


def _role_has(role, codename):
    """One role's own answer, cached under (role, codename). No user in the key."""
    # Check cache first
    cached = _permission_cache.get(role, codename)
    if cached is not None:
        return cached

    # Imported here rather than at module scope: this module is pulled in from
    # middleware and DRF permission classes, and apps.perm.models must not be
    # touched before the app registry is ready.
    from apps.perm.models import ROLE_PERMISSIONS, Permission, RolePermission

    if Permission.objects.filter(codename=codename).exists():
        # DB is authoritative for seeded codenames. `role` is the role NAME
        # string, so the join goes through Role.name (filtering `role=role`
        # fed a string into the FK's id column and raised ValueError, which a
        # bare `except` used to turn into the dict's answer -- so this branch
        # never decided anything for months).
        #
        # Nothing is caught here on purpose: anything these queries raise is a
        # database or programming fault, and answering a permission question
        # from a stale dict while the database is unreachable is how that
        # stayed invisible. Note a role with no Role row matches nothing and is
        # denied every seeded codename, whatever the dict says.
        has_perm = RolePermission.objects.filter(
            role__name=role,
            permission__codename=codename,
        ).exists()
    else:
        # Fallback to ROLE_PERMISSIONS dict (unseeded codenames)
        has_perm = codename in ROLE_PERMISSIONS.get(role, [])

    _permission_cache.set(role, codename, has_perm)
    return has_perm


def check_permissions(user, codenames, require_all=True):
    """
    Check if a user has multiple permission codenames.

    Args:
        user: Django User instance
        codenames: List of permission codename strings
        require_all: If True, user must have ALL permissions. If False, ANY is sufficient.

    Returns:
        True if user has the required permissions, False otherwise
    """
    if require_all:
        return all(check_permission(user, cod) for cod in codenames)
    return any(check_permission(user, cod) for cod in codenames)


# Backward-compatible alias for existing code
user_has_permission = check_permission
