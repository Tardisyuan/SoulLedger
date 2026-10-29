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
#: 「设计流程的人不审批」不再按角色名写在这里,改成下面按码组合的规则(用户 2026-10-29 第 13 条)。
ROLE_FORBIDDEN_CODENAMES = {
    "MODERATOR": frozenset({"user.manage"}),
}

#: 「设计流程的人不审批」按能力(用户 2026-10-29 第 13 条):同一个角色持有设计类码,就不能再持有审批类码
#: —— 不论角色叫什么(复制殿主、自建角色都一样)。按角色各算:殿主兼任判官,判官那份审批照算。
#: 殿主的 dispatch.approve / workflow.escalate / judgment.execute 不在审批类里(不是审批流节点)。
WORKFLOW_DESIGN_CODENAMES = frozenset({"workflow.create", "workflow.update"})
WORKFLOW_APPROVE_CODENAMES = frozenset({"workflow.approve", "workflow.advance"})

#: Codenames only the ADMIN role may hold (maintainer decisions 2026-09-25 / 2026-10-29). `check_permission`
#: denies them to every other role whatever the grant table says; the matrix, assign, copy and import refuse
#: to write them (`admin_only_permission`, apps/perm/matrix.py).
ADMIN_ONLY_CODENAMES = frozenset({
    "recycle_bin.restore", "recycle_bin.hard_delete",
    # SETTLED 是终态,撤销它是一次单独授权的更正(rbac-be3 M-7)。
    "soul.correct_settlement",
    # 菜单是所有殿共用的导航;定时任务的全局行影响每一殿(用户 2026-10-29 第 2 条)。
    "menu.manage", "scheduler.manage",
})


def capability_conflicts(requested, held=()):
    """The codenames in `requested` a role may not take on next to `held` (its other grants), by the
    design / approve rule above. Granting approve beside design refuses the approve side; granting design
    beside an approve the role already holds refuses the design side. Empty when there is no conflict."""
    requested, held = set(requested), set(held)
    combined = requested | held
    if not (combined & WORKFLOW_DESIGN_CODENAMES and combined & WORKFLOW_APPROVE_CODENAMES):
        return set()
    return (requested & WORKFLOW_APPROVE_CODENAMES) or (requested & WORKFLOW_DESIGN_CODENAMES)


#: Codenames that change configuration shared by every hall. Held only by the hall-less ADMIN.
GLOBAL_ONLY_CODENAMES = frozenset({"menu.manage"})


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

    # 全站配置(菜单是所有殿共用的一棵树)只给没绑殿的全局 ADMIN,任何角色都不能经授予拿到(2026-10-29)。
    if codename in GLOBAL_ONLY_CODENAMES:
        from apps.core.tenant import is_tenant_exempt

        return is_tenant_exempt(user)
    # ADMIN bypasses all permission checks
    if role == 'ADMIN':
        return True
    # 灵魂不持有任何官员权限,也不能经权限矩阵被授予 —— 即使有人建了一行叫
    # SOUL 的 Role 并挂上 RolePermission。
    if role == 'SOUL':
        return False

    # 多角色:每个持有的角色先过自己的硬规则,再对各角色的答案取并集。
    # 殿主的禁用清单只剔掉「来自殿主这个角色」的授予;殿主兼任判官,判官的授予照算
    # (用户 2026-10-09 定)。ADMIN / SOUL 即使被写进 extra_roles 也无视,它们只能是主角色。
    if codename in ADMIN_ONLY_CODENAMES:
        return False
    roles = [role, *_live_extra_roles(user)]
    return any(_role_allows(r, codename) for r in roles)


def _role_allows(role, codename):
    """One role's answer after its hard rules: the name-keyed forbidden list, then design-vs-approve."""
    if codename in ROLE_FORBIDDEN_CODENAMES.get(role, ()) or not _role_has(role, codename):
        return False
    if codename in WORKFLOW_APPROVE_CODENAMES:
        return not any(_role_has(role, d) for d in WORKFLOW_DESIGN_CODENAMES)
    return True


#: Pseudo-codename under which a role's "is it live" answer is cached. Same
#: (role, codename) key space as the grants, so `invalidate_role` (`perm:<role>:*`)
#: and `invalidate_all` clear it with them; no real codename starts with `__`.
_ROLE_LIVE_KEY = "__role_live__"


def _live_extra_roles(user):
    """`user.extra_roles` minus anything that may not be a second role.

    A role sitting in the recycle bin no longer counts (the default manager
    hides it), though its RolePermission rows still exist. The answer is cached
    per role like a grant (RBAC review L3, 2026-10-29): before, every check for
    a user with extras paid one Role query even when every grant was a cache hit.
    Deleting a role calls `invalidate_role_permissions`, which clears this key.
    """
    extras = {r for r in (getattr(user, 'extra_roles', None) or ()) if r not in ('ADMIN', 'SOUL')}
    if not extras:
        return []
    live = {name: _permission_cache.get(name, _ROLE_LIVE_KEY) for name in extras}
    missing = [name for name, value in live.items() if value is None]
    if missing:
        from apps.perm.models import Role

        found = set(Role.objects.filter(name__in=missing).values_list('name', flat=True))
        for name in missing:
            live[name] = name in found
            _permission_cache.set(name, _ROLE_LIVE_KEY, live[name])
    return sorted(name for name, value in live.items() if value)


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
