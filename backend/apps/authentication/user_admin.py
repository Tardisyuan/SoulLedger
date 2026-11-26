"""User-administration rules, shared by the user views and the role drawer (`apps/perm/members.py`).

Moved out of `views.py` (2026-11-26) so another app does not import a presentation module for them;
`views.py` re-exports every name for the callers and tests that import them from there.
"""
from rest_framework import status

from apps.core.problems import problem
from apps.core.tenant import is_admin, is_civilization_admin, is_tenant_exempt, reaches_hall
from apps.events.realtime import close_user_sockets

from .models import is_assignable_role
from .passwords import end_push_registrations, end_sessions
from .serializers import may_assign_role, may_manage_user

#: Wrong password-reset codes accepted for one address before the code itself is
#: thrown away. Five, matching the login limiter's spirit (5 attempts / 15 min,
#: `LoginView.post`) — the point is that a six-digit code must not be guessable
#: at whatever rate the network allows, not to pick a clever number.
MAX_RESET_CODE_ATTEMPTS = 5

#: Reset codes that may be *requested* for one address per window. Paired with
#: `PasswordResetThrottle` (3 per 5 minutes per IP): this one bounds how often
#: a single mailbox can be flooded, the throttle bounds how many addresses one
#: client can test. Neither alone is the limit that matters.
MAX_RESET_REQUESTS_PER_ADDRESS = 3
RESET_REQUEST_WINDOW_SECONDS = 300


def _open_work(user):
    """交接预览(不带接手人)的件数;一件都没有、或不是某个殿的官员,返回 None。"""
    from apps.judgment import handover

    if user.role == 'SOUL' or user.tenant_id is None or not user.is_active:
        return None
    counts = handover.preview(user, None, user.tenant_id)
    counts.pop('problems')
    total = sum(len(v) if isinstance(v, list) else v for v in counts.values())
    return counts if total else None


def _open_work_refusal(open_work):
    return problem(status.HTTP_409_CONFLICT, 'officer_has_open_work',
                   'The officer still holds open work; hand it over first.', open_work=open_work)


def admin_target_refusal(request, target):
    """管理员对另一位管理员的重置 / 停用 / 删除 / 改资料或角色(2026-10-29 用户决定第 8 条):
    只许**没绑殿**的 ADMIN 做,且这一次请求要带操作人自己的第二因素(`mfa_method` = totp | recovery、`mfa_code`),
    与关闭两步验证同一套校验、计数与锁定(`mfa.confirm_second_factor`)。目标不是 ADMIN、或是自己 → None(放行)。
    拒绝时返回 Response:403 `admin_target_global_only` / `second_factor_unavailable`(自己没开两步验证)/
    `second_factor_required`(没带码),400 wrong / expired(带剩余次数),429 locked。"""
    from . import mfa
    from .mfa_views import _refuse_outcome

    if not is_admin(target) or target.pk == request.user.pk:
        return None
    # SYSTEM_ADMIN on any administrator; a civilization ADMIN on a hall's ADMIN of its civilization (§7.5).
    if not (is_tenant_exempt(request.user) or (
            is_civilization_admin(request.user) and target.tenant_id is not None
            and reaches_hall(request.user, target.tenant_id))):
        return problem(status.HTTP_403_FORBIDDEN, 'admin_target_global_only',
                       'Only the hall-less administrator may act on another administrator.')
    row = mfa.get_mfa(request.user)
    if row is None or not row.enabled:
        return problem(status.HTTP_403_FORBIDDEN, 'second_factor_unavailable',
                       'Turn on two-step verification before acting on another administrator.')
    method = request.data.get('mfa_method') or 'totp'
    code = str(request.data.get('mfa_code') or '').strip()
    if method not in mfa.SECOND_FACTOR_METHODS or not code:
        return problem(status.HTTP_403_FORBIDDEN, 'second_factor_required',
                       'Enter your own two-step verification code.')
    outcome = mfa.confirm_second_factor(row, method=method, code=code, request=request)
    return None if outcome['code'] == 'ok' else _refuse_outcome(outcome)


def _target_refusal(request, target):
    """Whether the caller may act on `target` at all: `admin_target_refusal` for another ADMIN, then the
    ceiling for everyone else (audit 2026-11-11 P-05) — a non-ADMIN holder of `user.manage` may not reset,
    deactivate, delete, edit or re-role an account holding a codename the caller lacks
    (`serializers.may_manage_user`). 403 `target_outranks_caller`."""
    refused = admin_target_refusal(request, target)
    if refused:
        return refused
    if not may_manage_user(request.user, target):
        return problem(status.HTTP_403_FORBIDDEN, 'target_outranks_caller',
                       'This account holds permissions you do not; you cannot act on it.')
    return None


def _self_refusal(code, message):
    return problem(status.HTTP_400_BAD_REQUEST, code, message)


def _end_everything(user):
    """停用 = 退出全部设备(第 9 条):刷新令牌拉黑、登录设备退出、`session_version` +1(已签发的 access 立刻失效)、
    推送登记删掉、已开的实时连接全关。单个停用、批量停用、`PATCH is_active=false`、DELETE 都走这里。调用方负责事务。"""
    end_sessions(user)
    end_push_registrations(user)
    close_user_sockets(user.pk)


def _org_subtree(root_id):
    """`root_id` and every organization under it, in one query (the tree is small)."""
    from apps.org.models import Organization

    children = {}
    for pk, parent in Organization.objects.values_list('pk', 'parent_id'):
        children.setdefault(parent, []).append(pk)
    found, todo = {root_id}, [root_id]
    while todo:
        for child in children.get(todo.pop(), []):
            if child not in found:
                found.add(child)
                todo.append(child)
    return found


def role_assignment_refusal(caller, user, new_role, extra_roles):
    """The rules `assign_roles` applies, shared with the role drawer's batch grant
    (`apps/perm/members.py`, 2026-10-29) so the two ways to give a role cannot drift.

    Returns ``(extras, refusal)``: the de-duplicated extras without the main role, and ``None`` or
    ``(error message, http status)``."""
    # Against the Role table, not a restated enum (BP-11): a built-in or a
    # live row in perm.Role.
    extras = [r for r in dict.fromkeys(extra_roles) if r != new_role]
    for name in [new_role, *extras]:
        if not is_assignable_role(name):
            return extras, (f'Invalid role {name!r}: not a built-in role and not a live row in the role table.',
                            status.HTTP_400_BAD_REQUEST)
    # ADMIN is the bypass and SOUL is the soul app's account: neither can be
    # combined with anything. The checker ignores them in extra_roles too.
    if 'ADMIN' in extras:
        return extras, ('ADMIN cannot be an additional role', status.HTTP_400_BAD_REQUEST)
    if extras and new_role == 'ADMIN':
        return extras, ('ADMIN already holds everything; no additional roles', status.HTTP_400_BAD_REQUEST)
    # Prevent privilege escalation: the caller may not assign any role more
    # privileged than their own (rank shared with create/update, see
    # ROLE_HIERARCHY). No `caller_role != 'ADMIN'` short-circuit: ADMIN
    # ranks 0, so the check never fires for it and still says what it means.
    # A hall's ADMIN may not appoint an ADMIN either (`may_assign_role`, 2026-10-29); keeping a user's
    # current role is not an appointment.
    if any(not may_assign_role(caller, r) for r in [new_role, *extras] if r != user.role):
        return extras, ('Cannot assign a role more privileged than your own', status.HTTP_403_FORBIDDEN)
    return extras, None
