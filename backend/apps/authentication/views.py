"""
Auth views: register, login, logout, profile.
"""
import logging
import math
import secrets
import time

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import transaction
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, PolymorphicProxySerializer, extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import (
    action,
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.fields import empty
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

User = get_user_model()
logger = logging.getLogger(__name__)

from apps.audit.models import AuditAction
from apps.audit.signals import create_batch_audit_log
from apps.authentication.mail import MESSAGES as MAIL_MESSAGES
from apps.authentication.mail import fill, mail_locale, send_neutral_mail
from apps.authentication.models import UserRole, is_assignable_role
from apps.core.csv_safe import csv_safe
from apps.core.exports import record_export
from apps.core.permissions import CodenamePermission, IsAdminPermission, TenantPermission
from apps.core.schema import DetailResponseSerializer, ErrorResponseSerializer
from apps.core.tenant import is_tenant_exempt, scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin
from apps.events.realtime import close_user_sockets, push_permission_refresh
from apps.notifications import categories as notification_categories
from apps.perm.filters import DataScopeFilter

from . import refresh_cookie, signin_sessions
from .officer_reset import _audit
from .passwords import (
    RoleMinimumLengthValidator,
    end_push_registrations,
    end_sessions,
    set_officer_password,
    weak_password_reasons,
)
from .serializers import (
    AssignRolesSerializer,
    ChangePasswordRefusalSerializer,
    ChangePasswordResponseSerializer,
    ChangePasswordSerializer,
    CustomTokenObtainPairSerializer,
    HallChoiceResponseSerializer,
    LoginFailedResponseSerializer,
    LoginLockedResponseSerializer,
    LoginLogSerializer,
    LoginResponseSerializer,
    LogoutRequestSerializer,
    MfaRequiredResponseSerializer,
    OfficerHasOpenWorkSerializer,
    OfficerInviteSerializer,
    OfficerTokenObtainPairSerializer,
    PasswordHelpRequestSerializer,
    PasswordResetRefusalSerializer,
    PasswordResetResultSerializer,
    PublicCivilizationSerializer,
    ResetPasswordSerializer,
    SecondFactorProofSerializer,
    SetNewPasswordSerializer,
    TokenRefreshSerializer,
    UserBatchDeactivateResultSerializer,
    UserBatchUpdateResultSerializer,
    UserCreateSerializer,
    UserDeactivateSerializer,
    UserImportResultSerializer,
    UserManagementSerializer,
    UserMfaResetSerializer,
    UserPreferencesSerializer,
    UserRoleSerializer,
    UserSerializer,
    UserUpdateSerializer,
    default_officer_organization,
    email_already_registered,
    may_assign_role,
    reissue_for_device,
)

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

# ---------------------------------------------------------------------------
# User Management ViewSet (Tenant Admin)
# ---------------------------------------------------------------------------


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
    return Response({'error': 'The officer still holds open work; hand it over first.',
                     'code': 'officer_has_open_work', 'open_work': open_work}, status=status.HTTP_409_CONFLICT)


def _admin_target_refusal(request, target):
    """管理员对另一位管理员的重置 / 停用 / 删除 / 改资料或角色(2026-10-29 用户决定第 8 条):
    只许**没绑殿**的 ADMIN 做,且这一次请求要带操作人自己的第二因素(`mfa_method` = totp | recovery、`mfa_code`),
    与关闭两步验证同一套校验、计数与锁定(`mfa.confirm_second_factor`)。目标不是 ADMIN、或是自己 → None(放行)。
    拒绝时返回 Response:403 `admin_target_global_only` / `second_factor_unavailable`(自己没开两步验证)/
    `second_factor_required`(没带码),400 wrong / expired(带剩余次数),429 locked。"""
    from . import mfa
    from .mfa_views import _refuse_outcome

    if target.role != UserRole.ADMIN or target.pk == request.user.pk:
        return None
    if request.user.role != UserRole.ADMIN or request.user.tenant_id is not None:
        return Response({'error': 'Only the hall-less administrator may act on another administrator.',
                         'code': 'admin_target_global_only'}, status=status.HTTP_403_FORBIDDEN)
    row = mfa.get_mfa(request.user)
    if row is None or not row.enabled:
        return Response({'error': 'Turn on two-step verification before acting on another administrator.',
                         'code': 'second_factor_unavailable'}, status=status.HTTP_403_FORBIDDEN)
    method = request.data.get('mfa_method') or 'totp'
    code = str(request.data.get('mfa_code') or '').strip()
    if method not in mfa.SECOND_FACTOR_METHODS or not code:
        return Response({'error': 'Enter your own two-step verification code.', 'code': 'second_factor_required'},
                        status=status.HTTP_403_FORBIDDEN)
    outcome = mfa.confirm_second_factor(row, method=method, code=code, request=request)
    return None if outcome['code'] == 'ok' else _refuse_outcome(outcome)


def _self_refusal(code, message):
    return Response({'error': message, 'code': code}, status=status.HTTP_400_BAD_REQUEST)


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


class UserViewSet(AuditUserViewSetMixin, CodenameViewSetMixin, viewsets.ModelViewSet):
    """
    用户管理 API

    仅 ADMIN 角色可访问，支持完整的 CRUD 操作以及激活/停用/重置密码等操作。

    Endpoints:
        GET    /api/v1/users/           - 获取用户列表
        POST   /api/v1/users/           - 创建新用户
        GET    /api/v1/users/{id}/      - 获取用户详情
        PATCH  /api/v1/users/{id}/      - 更新用户
        DELETE /api/v1/users/{id}/      - 删除用户
        POST   /api/v1/users/{id}/activate/     - 激活用户
        POST   /api/v1/users/{id}/deactivate/   - 停用用户
        POST   /api/v1/users/{id}/reset_password/ - 重置密码
    """
    # By codename since 2026-10-29 (user item 2): the web page gates on `user.manage`, and so does this.
    # ADMIN holds it by the checker's short-circuit; MODERATOR may never hold it (ROLE_FORBIDDEN_CODENAMES);
    # anyone else granted it manages users of their own hall only (`scope_to_tenant` below), never an ADMIN
    # (`get_queryset`), and assigns nothing above their own rank (`may_assign_role`).
    permission_classes = [TenantPermission, CodenamePermission]
    # BINARY, not CRUD. `user.manage` is the only user codename that exists —
    # it is in DEFAULT_PERMISSIONS and held by ADMIN — and this viewset
    # behaves that way: the one codename gates reads and writes alike.
    #
    # The declarations this replaces (user.read, user.create, user.update,
    # user.delete, user.activate, user.deactivate, user.reset_password,
    # user.assign_roles) were eight codenames that existed nowhere and were
    # held by nobody — a CRUD shape asserted against a policy that never had
    # one. Splitting user.manage into eight real codenames means a seeding
    # migration and eight grant decisions; binding to the codename that exists
    # reproduces today's ADMIN-only reality exactly and defers that split.
    #
    # Every action is listed explicitly, standard CRUD included, because the
    # mixin would otherwise fall back to ACTION_PERM_MAP and resurrect
    # user.read / user.create / user.update / user.delete.
    #
    # NOTE for whoever splits this later: migration 0015's docstring records
    # why MODERATOR is withheld user.manage — this viewset carries no tenant
    # mixin, so the codename spans every tenant and puts no bound on the role
    # being assigned. Any finer-grained family has to solve that first.
    permission_codename = "user"
    extra_permissions = {
        'list': ['user.manage'],
        'retrieve': ['user.manage'],
        'create': ['user.manage'],
        'update': ['user.manage'],
        'partial_update': ['user.manage'],
        'destroy': ['user.manage'],
        'activate': ['user.manage'],
        'deactivate': ['user.manage'],
        'reset_password': ['user.manage'],
        'batch_activate': ['user.manage'],
        'batch_deactivate': ['user.manage'],
        'own_roles': ['user.manage'],
        'assign_roles': ['user.manage'],
        'export_csv': ['user.manage'],
        'import_csv': ['user.manage'],
        'reset_mfa': ['user.manage'],
        'invite': ['user.manage'],
    }

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        if self.action in ['update', 'partial_update']:
            return UserUpdateSerializer
        return UserManagementSerializer

    #: 类级 queryset,给 `tests/test_tenant_scoping_contract.py` 用。
    #:
    #: 这个视图按 action 选 queryset 与 serializer,所以两者都没有类级默认值 ——
    #: 而那份契约靠它们解析「这个视图服务哪个模型」。解析不出来时它 **skip**,
    #: 于是这个视图的租户隔离**从未被那份契约检查过**:实测把下面
    #: `get_queryset()` 里的 `scope_to_tenant` 换成恒等函数,契约 34 条全绿。
    #:
    #: 运行时行为不变:DRF 定义了 `get_queryset()` 就不会读这个属性。
    queryset = User.objects.all()

    def get_queryset(self):
        # 灵魂账号不归用户管理:它们的开通 / 重置走 `/api/v1/soul-accounts/`,
        # 那里有 72 小时、首登改密、只发一次三道保护;这里的 reset_password 会
        # 把明文直接交给官员,绕过全部三道。
        qs = User.objects.select_related('tenant', 'mfa').exclude(role='SOUL')

        # The hall-less ADMIN is the only global user (apps/core/tenant.py; an ADMIN
        # bound to a hall is scoped to it, 2026-10-29); every other role is tenant-scoped and must never see another
        # tenant's users. This mirrors the ADMIN bypass used by
        # TenantQuerySetMixin/DataScopeViewSetMixin everywhere else in the
        # codebase — previously this method filtered ADMIN by tenant too
        # (unlike every other viewset) while UserCreateSerializer let ADMIN
        # create a user in ANY tenant, so an ADMIN-created user outside the
        # creator's own tenant became invisible and unmanageable through
        # this API ("can create, can't manage"). Bypassing tenant filtering
        # for ADMIN here removes that asymmetry.
        #
        # Since 2026-10-29 the HTTP gate is the `user.manage` codename, so a
        # non-ADMIN holder reaches this method: this filter is what keeps them
        # in their own hall. (Scoping itself lives in apps/core/tenant.py.)
        qs = scope_to_tenant(qs, self.request)
        # A non-ADMIN holder of `user.manage` never sees — so never edits, resets, deactivates or deletes — an
        # ADMIN account (2026-10-29: the codename is grantable now; ADMIN-on-ADMIN rules live with ADMIN).
        if getattr(self.request.user, 'role', None) != 'ADMIN':
            qs = qs.exclude(role='ADMIN')
        # 数据范围(B5):按人的机构收窄,本人恒可见;范围外的人列表里没有,按 id 访问 404。
        qs = DataScopeFilter.filter_queryset(self.request, qs, User)

        # Apply query params if present
        params = self.request.query_params

        # Search by username or email
        search = params.get('search', '').strip()
        if search:
            qs = qs.filter(username__icontains=search) | qs.filter(email__icontains=search)

        # One account by its exact username: the password-help notification's
        # 「去用户页」 lands on `/users?username=<u>` (第三类 F 组 2.6).
        username = params.get('username', '').strip()
        if username:
            qs = qs.filter(username=username)

        # One organization's people and its sub-organizations' (the org page's 「查看人员」, the user page's
        # org tree; Snowy-style 含下级, 2026-10-29). Users are tenant-scoped above, so the walk need not be.
        organization = params.get('organization', '').strip()
        if organization.isdigit():
            qs = qs.filter(organization_id__in=_org_subtree(int(organization)))

        # Filter by role
        role = params.get('role', '').strip()
        if role:
            qs = qs.filter(role=role)

        # 两步验证筛选签(A12):enabled / disabled;`missing` = 角色被要求而没开(ADMIN 始终被要求,
        # 其余角色读本殿设置里的 mfa_required_roles)。
        mfa_filter = params.get('mfa', '').strip()
        if mfa_filter == 'enabled':
            qs = qs.filter(mfa__confirmed_at__isnull=False)
        elif mfa_filter == 'disabled':
            qs = qs.filter(mfa__confirmed_at__isnull=True)
        elif mfa_filter == 'missing':
            from django.db.models import Q

            from apps.authentication.mfa import MFA_REQUIRED_ROLES_SETTING
            from apps.tenants.models import Tenant

            required = Q(role='ADMIN')
            for tenant in Tenant.objects.exclude(settings={}):
                roles = (tenant.settings or {}).get(MFA_REQUIRED_ROLES_SETTING) or []
                if roles:
                    required |= Q(tenant=tenant, role__in=roles)
            qs = qs.filter(required, mfa__confirmed_at__isnull=True)

        # Filter by is_active
        is_active = params.get('is_active', '').strip()
        if is_active in ('true', '1'):
            qs = qs.filter(is_active=True)
        elif is_active in ('false', '0'):
            qs = qs.filter(is_active=False)

        # Ordering
        ordering = params.get('ordering', '-create_time').strip()
        allowed_orders = ['username', '-username', 'email', '-email',
                          'create_time', '-create_time', 'role', '-role']
        if ordering in allowed_orders:
            qs = qs.order_by(ordering)

        return qs

    def update(self, request, *args, **kwargs):
        """改用户。对另一位管理员:只许没绑殿的 ADMIN + 自己的两步验证码(改邮箱再走邮箱重置 = 接管,所以任何字段都算)。
        `is_active=false` 与 `POST deactivate/` 同一套(第 9 条 / M-2):不能停用自己;手上有在途的事 → 409
        `officer_has_open_work`(交接要走 deactivate 的 `handover_to`);停用后退出全部设备。"""
        target = self.get_object()
        refused = _admin_target_refusal(request, target)
        if refused:
            return refused
        if target.is_active and 'is_active' in request.data:
            try:
                deactivating = serializers.BooleanField().to_internal_value(request.data['is_active']) is False
            except DRFValidationError:
                deactivating = False  # 序列化器自己会答 400
            if deactivating:
                if target.pk == request.user.pk:
                    return _self_refusal('cannot_deactivate_self', 'You cannot deactivate your own account.')
                work = _open_work(target)
                if work:
                    return _open_work_refusal({str(target.pk): work})
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        before = serializer.instance
        was_active, old_roles = before.is_active, (before.role, list(before.extra_roles or []), before.organization_id)
        with transaction.atomic():
            super().perform_update(serializer)
            user = serializer.instance
            if was_active and not user.is_active:
                _end_everything(user)
        # 换机构也推:已开连接按新机构重算数据范围(B5)。
        if (user.role, list(user.extra_roles or []), user.organization_id) != old_roles:
            push_permission_refresh(user.pk)

    def destroy(self, request, *args, **kwargs):
        """删除 = 软删,与停用同一套(第 9 条 / M-2):不能删自己;对管理员同 `update` 的规则;
        手上有在途的事 → 409;删后退出全部设备。"""
        target = self.get_object()
        if target.pk == request.user.pk:
            return _self_refusal('cannot_delete_self', 'You cannot delete your own account.')
        refused = _admin_target_refusal(request, target)
        if refused:
            return refused
        work = _open_work(target)
        if work:
            return _open_work_refusal({str(target.pk): work})
        with transaction.atomic():
            self.perform_destroy(target)
            _end_everything(target)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=UserMfaResetSerializer, responses={200: DetailResponseSerializer, 400: OpenApiTypes.OBJECT, 409: ErrorResponseSerializer})
    @action(detail=True, methods=['post'], url_path='reset-mfa')
    def reset_mfa(self, request, pk=None):
        """管理员重置两步验证(A12):验证器、恢复码、「不再询问」设备令牌全清,该用户所有刷新令牌吊销。
        理由必填,进审计。只对已开启的账号有意义(未开启答 409)。"""
        from apps.authentication import mfa

        user = self.get_object()
        serializer = UserMfaResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refused = _admin_target_refusal(request, user)
        if refused:
            return refused
        if not mfa.is_enabled(user):
            return Response({"error": "该账号未开启两步验证", "code": "not_enabled"}, status=status.HTTP_409_CONFLICT)
        mfa.admin_reset(user, actor=request.user, reason=serializer.validated_data["reason"], request=request)
        return Response({"detail": "两步验证已重置"})

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        """激活指定用户"""
        user = self.get_object()
        user.is_active = True
        user.save(update_fields=['is_active'])
        return Response(UserManagementSerializer(user).data)

    @extend_schema(request=UserDeactivateSerializer,
                   responses={200: UserManagementSerializer, 400: OpenApiTypes.OBJECT, 409: OfficerHasOpenWorkSerializer})
    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        """停用指定用户。

        手上还有在途的事(认领中的审判、复核中的申诉、城隍名下、经办的书信 —— 与交接预览同一套计数)的官员:
        不带 `handover_to` 是 409 `officer_has_open_work` 附件数;带上本殿一位在职官员,则交接与停用在同一个事务里,
        交接的审计行也在里面 —— 任何一步失败,两件都不发生(2026-10-27 用户决定,检查业务 #10)。
        """
        from apps.judgment import handover

        user = self.get_object()
        body = UserDeactivateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        if user.pk == request.user.pk:
            return _self_refusal('cannot_deactivate_self', 'You cannot deactivate your own account.')
        refused = _admin_target_refusal(request, user)
        if refused:
            return refused
        to = body.validated_data.get('handover_to')
        try:
            with transaction.atomic():
                # 计数在锁住这一行之后、同一个事务里做:检查与停用之间不留空档。
                # ponytail: 认领不锁官员行,与之并发的一次认领仍可能落在刚停用的人名下;
                # 交接不看 is_active,管理员之后照样能移交。要彻底就让认领也锁认领人行。
                user = User.objects.select_for_update().get(pk=user.pk, tenant_id=user.tenant_id)
                if to is None:
                    work = _open_work(user)
                    if work:
                        return _open_work_refusal({str(user.pk): work})
                if to is not None:
                    target = User.objects.filter(pk=to, tenant_id=user.tenant_id).first()  # 别殿的人与不存在的人同一个 400
                    handover.commit(user, target, user.tenant_id, actor=request.user, request=request)
                user.is_active = False
                user.save(update_fields=['is_active'])
                _end_everything(user)
        except handover.HandoverRefusedError as exc:
            return Response(exc.as_payload(), status=exc.status)
        return Response(UserManagementSerializer(user).data)

    @extend_schema(request=SecondFactorProofSerializer,
                   responses={200: PasswordResetResultSerializer, 400: OpenApiTypes.OBJECT, 403: ErrorResponseSerializer,
                              429: OpenApiTypes.OBJECT})
    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        """重置密码(第 8 条):旧密码当场作废、所有设备退出,返回 24 小时、只能用一次的设置链接,由管理员转交本人。
        不再返回明文密码。对另一位管理员:只许没绑殿的 ADMIN,并带自己的两步验证码(`_admin_target_refusal`)。"""
        from . import officer_invite

        user = self.get_object()
        refused = _admin_target_refusal(request, user)
        if refused:
            return refused
        link, seconds = officer_invite.issue_setup_link(user, actor=request.user, request=request)
        return Response({'link': link, 'expires_in': seconds})

    def _batch_targets(self, user_ids):
        """The users a batch toggle may touch (BP-17).

        Was `User.objects.filter(id__in=ids, tenant=request.tenant)`: for an
        ADMIN with no tenant claim that is `tenant IS NULL` — the other ADMINs
        and the caller, and none of the tenant users actually selected. Now the
        ids go through `get_queryset()` (the scope `/users/{id}/deactivate/`
        uses), and a batch never includes an ADMIN account or the caller;
        toggling an ADMIN stays a deliberate single-user action.
        """
        return (
            User.objects.filter(pk__in=self.get_queryset().filter(id__in=user_ids).values('pk'))
            .exclude(role='ADMIN')
            .exclude(pk=self.request.user.pk)
        )

    def _batch_set_active(self, request, active):
        user_ids = request.data.get('user_ids', [])
        if not user_ids:
            return Response({'error': 'user_ids is required'}, status=status.HTTP_400_BAD_REQUEST)
        # `.update()` fires no signals, so the audit row is written by hand
        # (one BATCH_UPDATE row naming every user), from the same list the
        # update runs on.
        held = []
        with transaction.atomic():
            if active:
                targets = list(self._batch_targets(user_ids))
            else:
                # 批量不做交接(接手人是逐个选的):手上没事的人停用;有事的人留着、连同件数列出来,
                # 让管理员逐个停用并移交(2026-10-27 用户决定)。计数在锁住这些行之后做,同单个停用。
                targets = []
                for u in self._batch_targets(user_ids).select_for_update().order_by('pk'):
                    work = _open_work(u)
                    if work:
                        held.append({'id': str(u.pk), 'username': u.username, 'open_work': work})
                    else:
                        targets.append(u)
            updated = User.objects.filter(pk__in=[u.pk for u in targets]).update(is_active=active)
            if targets:
                create_batch_audit_log(AuditAction.BATCH_UPDATE, targets, {'is_active': active})
            if not active:
                for target in targets:
                    _end_everything(target)
        if active:
            return Response({'updated': updated})
        return Response({'updated': updated, 'held': held})

    @extend_schema(responses=UserBatchUpdateResultSerializer)
    @action(detail=False, methods=['post'])
    def batch_activate(self, request):
        """批量激活用户"""
        return self._batch_set_active(request, True)

    @extend_schema(responses=UserBatchDeactivateResultSerializer)
    @action(detail=False, methods=['post'])
    def batch_deactivate(self, request):
        """批量停用用户"""
        return self._batch_set_active(request, False)

    @extend_schema(responses=UserRoleSerializer)
    @action(detail=True, methods=['get'])
    def own_roles(self, request, pk=None):
        """获取用户的角色"""
        user = self.get_object()
        return Response({'role': user.role, 'extra_roles': user.extra_roles})

    @extend_schema(request=AssignRolesSerializer, responses=UserManagementSerializer)
    @action(detail=True, methods=['post'])
    def assign_roles(self, request, pk=None):
        """分配角色给用户:主角色 `role`、兼任角色 `extra_roles`(权限取并集)"""
        user = self.get_object()
        body = AssignRolesSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        refused = _admin_target_refusal(request, user)
        if refused:
            return refused
        if 'role' not in data and 'extra_roles' not in data:
            return Response({'error': 'role or extra_roles is required'}, status=status.HTTP_400_BAD_REQUEST)
        new_role = data.get('role', user.role)
        extras, refusal = role_assignment_refusal(
            request.user, user, new_role, data.get('extra_roles', user.extra_roles or []))
        if refusal:
            return Response({'error': refusal[0]}, status=refusal[1])
        # The generic UPDATE audit row carries the role / extra_roles diff.
        user.role = new_role
        user.extra_roles = extras
        user.save(update_fields=['role', 'extra_roles'])
        # 已开的实时连接按新角色重算权限(第 10 条 / M-1):不断开,推一次 permission.refresh。
        push_permission_refresh(user.pk)
        return Response(UserManagementSerializer(user).data)

    @extend_schema(request=OfficerInviteSerializer, responses={201: UserManagementSerializer, 200: UserManagementSerializer,
                                                                400: ErrorResponseSerializer})
    @action(detail=False, methods=['post'])
    def invite(self, request):
        """邮件邀请官员(`officer_invite.py`):建一个还没有密码的账号,发 7 天有效的一次性设密码链接。
        同一殿里对还没接受的邮箱再邀请一次 = 重发(200);新建 201。"""
        from apps.tenants.models import Tenant

        from . import officer_invite

        body = OfficerInviteSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        tenant = getattr(request, 'tenant', None)
        # 指定殿只给没绑殿的全局管理员用;绑殿的 ADMIN 只能邀请进本殿(2026-10-29),别殿的 code 与不存在的同样答。
        if data.get('tenant') and not (tenant is not None and data['tenant'] == tenant.code):
            tenant = Tenant.objects.filter(code=data['tenant']).first() if is_tenant_exempt(request.user) else None
        if tenant is None:
            return Response({'error': 'No tenant found', 'code': 'no_tenant'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            user, created = officer_invite.invite(
                data['email'], data['role'], tenant, actor=request.user, username=data.get('username', ''),
                display_name=data.get('display_name', ''), request=request)
        except officer_invite.InviteRefusedError as exc:
            return Response(exc.as_payload(), status=status.HTTP_400_BAD_REQUEST)
        return Response(UserManagementSerializer(user).data,
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @extend_schema(
        responses={
            (200, "text/csv"): OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="A CSV attachment, not JSON. Documented as such "
                "because a generated client that expects a user object here "
                "will try to parse a spreadsheet.",
            )
        }
    )
    @action(detail=False, methods=['get'])
    def export_csv(self, request):
        """导出用户列表为CSV文件"""
        import csv

        from django.http import HttpResponse

        from apps.core.exports import refuse_if_too_many

        qs = self.get_queryset()
        refuse_if_too_many(qs)
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="users.csv"'
        writer = csv.writer(response)
        writer.writerow(['username', 'email', 'role', 'is_active', 'tenant', 'create_time'])
        rows = 0
        for user in qs:
            rows += 1
            writer.writerow([
                # `csv_safe` on every free-text cell (apps/core/csv_safe.py).
                # `username` came from whoever created the account (the public
                # `/auth/register/` is gone since 2026-10-27, but older rows remain) — and `email` by whoever edits their own profile,
                # while this file is opened by an administrator on their own
                # machine. The ledger export has neutralised formula cells
                # since 2026-08-29; this one was written without that guard
                # and nothing pointed the two at a shared rule (DB-02).
                csv_safe(user.username),
                csv_safe(user.email),
                csv_safe(user.role),
                user.is_active,
                csv_safe(user.tenant.code if user.tenant else ''),
                user.create_time.isoformat() if hasattr(user, 'create_time') else '',
            ])
        record_export(request, resource='user', rows=rows)
        return response

    @extend_schema(responses=UserImportResultSerializer)
    @action(detail=False, methods=['post'])
    def import_csv(self, request):
        """从CSV文件批量导入用户"""
        import csv
        import io

        from django.core.exceptions import ValidationError
        from django.core.validators import validate_email

        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'No file uploaded'}, status=status.HTTP_400_BAD_REQUEST)

        # Check file extension
        if not file.name.endswith('.csv'):
            return Response({'error': 'File must be a .csv'}, status=status.HTTP_400_BAD_REQUEST)

        tenant = getattr(request, 'tenant', None)
        if not tenant:
            return Response({'error': 'No tenant found'}, status=status.HTTP_400_BAD_REQUEST)

        # The soul import's limits (2 MB / 1000 rows): each row here costs a password hash and
        # several queries inside this request, so an unbounded file was an unbounded request.
        from apps.souls.importer import MAX_BYTES, MAX_ROWS

        if file.size > MAX_BYTES:
            return Response({'error': 'File is too large', 'code': 'file_too_large', 'max_bytes': MAX_BYTES},
                            status=status.HTTP_400_BAD_REQUEST)
        # `utf-8-sig`: the downloadable template starts with a BOM so Excel opens it as UTF-8.
        try:
            decoded_file = file.read().decode('utf-8-sig')
        except UnicodeDecodeError:
            return Response(
                {'error': 'File is not UTF-8', 'code': 'bad_encoding'}, status=status.HTTP_400_BAD_REQUEST
            )
        reader = csv.DictReader(io.StringIO(decoded_file))
        if not reader.fieldnames:
            return Response({'error': 'File is empty', 'code': 'empty_file'}, status=status.HTTP_400_BAD_REQUEST)
        if 'username' not in reader.fieldnames:
            return Response(
                {'error': 'Missing column: username', 'code': 'missing_columns', 'columns': ['username']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        all_rows = list(reader)
        if len(all_rows) > MAX_ROWS:
            return Response({'error': f'More than {MAX_ROWS} rows', 'code': 'too_many_rows', 'max_rows': MAX_ROWS},
                            status=status.HTTP_400_BAD_REQUEST)
        # `dry_run=1`: the same row checks, nothing written -- the web import
        # dialog's preview step (batch 34 W-5), shaped like the soul import's.
        dry_run = str(request.query_params.get('dry_run') or request.data.get('dry_run', '')).lower() in ('1', 'true', 'yes')
        created = 0
        invited = 0
        errors = []
        rows = []
        seen_usernames, seen_emails = set(), set()

        for i, row in enumerate(all_rows):
            n = i + 2
            username = (row.get('username') or '').strip()
            email = (row.get('email') or '').strip()
            display_name = (row.get('display_name') or '').strip()
            role = (row.get('role') or 'VIEWER').strip().upper()
            password = (row.get('password') or '').strip()
            problems = []  # (field, code, message)
            try:
                if not username:
                    problems.append(('username', 'username_required', 'username is required'))
                if email:
                    try:
                        validate_email(email)
                    except ValidationError:
                        problems.append(('email', 'email_invalid', f"invalid email '{email}'"))
                if not problems and not is_assignable_role(role):
                    problems.append(('role', 'role_invalid', f"invalid role '{role}'"))
                if not problems and (
                    username in seen_usernames
                    # Usernames are unique across the whole table, other halls and soft-deleted officers included:
                    # the preview must refuse what the commit would (2026-10-27).
                    or User.all_objects.filter(username=username).exists()
                ):
                    problems.append(('username', 'username_taken', f"username '{username}' already exists"))
                # Same rule as every other write path (BP-04). A row earlier in
                # this file counts too: dry-run writes nothing, so the database
                # alone cannot see the first of two rows carrying one address.
                if not problems and email and (
                    email.lower() in seen_emails or email_already_registered(email)
                ):
                    problems.append(('email', 'email_taken', f"email '{email}' already belongs to another account"))
                # 不写密码而写了邮箱:不设初始密码,发邀请信让本人设(2026-10-25,`officer_invite.py`)。
                invite_row = not password and bool(email)
                if not problems and not password and not email:
                    problems.append(('password', 'password_required', 'password is required'))
                if not problems and not may_assign_role(request.user, role):
                    problems.append(('role', 'role_forbidden', f"you may not assign role '{role}'"))
                if not problems and invite_row and role == 'ADMIN':
                    problems.append(('role', 'role_invalid', 'an ADMIN cannot be invited; give a password'))
                if not problems and not invite_row:
                    try:
                        RoleMinimumLengthValidator().validate(password, User(username=username, role=role))
                    except ValidationError as exc:
                        problems.append(('password', 'password_weak', ' '.join(exc.messages)))
                if not problems:
                    seen_usernames.add(username)
                    if email:
                        seen_emails.add(email.lower())
                    if not dry_run and invite_row:
                        from . import officer_invite

                        with transaction.atomic():
                            invitee = officer_invite.create_invitee(
                                email, role, tenant, username=username, display_name=display_name)
                            officer_invite.send_after_commit(invitee)
                        invited += 1
                    elif not dry_run:
                        User.objects.create_user(
                            username=username,
                            email=email,
                            password=password,
                            role=role,
                            tenant=tenant,
                            display_name=display_name,
                            must_change_password=True,  # an admin chose it: the officer picks their own at first login
                            organization=default_officer_organization(tenant, role, None),
                        )
                        created += 1
            except Exception as e:
                problems.append(('', 'unknown', str(e)))
            for _field, _code, message in problems:
                errors.append(f"Row {n}: {message}")
            if dry_run:
                rows.append({
                    'row': n,
                    'status': 'error' if problems else 'ok',
                    'values': {'username': username, 'display_name': display_name},
                    'delivery': 'invite' if invite_row else 'password',
                    'errors': [{'field': f, 'code': c} for f, c, _m in problems],
                })

        if dry_run:
            bad = sum(1 for r in rows if r['status'] == 'error')
            return Response({
                'total': len(rows),
                'ok_count': len(rows) - bad,
                'error_count': bad,
                'rows': rows,
            })
        return Response({
            'created': created + invited,
            'invited': invited,
            'errors': errors[:50],
        })


# ---------------------------------------------------------------------------
# Login Logs ViewSet (Tenant Admin)
# ---------------------------------------------------------------------------


class LoginLogViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    登录日志 API

    仅 ADMIN 角色可访问，只读的登录日志查询接口。

    Endpoints:
        GET /api/v1/login-logs/        - 获取登录日志列表
        GET /api/v1/login-logs/{id}/   - 获取登录日志详情
    """
    permission_classes = [TenantPermission, IsAdminPermission]
    # EXEMPT. No `login_log.*` codename exists in DEFAULT_PERMISSIONS or
    # ROLE_PERMISSIONS, and none was ever seeded; the old "login_log"
    # declaration produced `login_log.read`, held by nobody. Unlike users,
    # there is no adjacent codename to fold this into — `user.manage` is about
    # editing users, not reading their sign-in history, and reusing it would
    # quietly make "may administer users" mean "may read the audit trail".
    # A real `login_log.read` needs seeding and granting; queued, not invented.
    # ADMIN-only access is unaffected: IsAdminPermission above is what actually
    # returns 403 here today, and it keeps doing so.
    permission_codename = None
    serializer_class = LoginLogSerializer
    # The console's login-log tab filters on these. Before 2026-10-04 the
    # viewset declared none, so `?status=FAILED` was silently ignored by
    # DjangoFilterBackend and the one test that "covered" it passed on an
    # empty result set.
    filterset_fields = ["status"]
    search_fields = ["username"]
    ordering_fields = ["timestamp"]
    ordering = ["-timestamp"]

    def get_queryset(self):
        from .models import LoginLog
        qs = LoginLog.objects.select_related('user').all()
        user = self.request.user
        if getattr(user, 'role', None) != 'ADMIN':
            return qs.none()
        if is_tenant_exempt(user):
            return qs
        # An ADMIN bound to a hall: that hall's users only, nothing when no hall resolves (fail closed).
        tenant = getattr(self.request, 'tenant', None)
        if tenant is None:
            return qs.none()
        from django.contrib.auth import get_user_model
        tenant_user_ids = get_user_model().objects.filter(tenant=tenant).values_list('id', flat=True)
        return qs.filter(user_id__in=tenant_user_ids)


#: The login brute-force limiter: failures per client IP inside one window.
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 900
#: ...and per username, across all IPs (same window). The IP counter alone let
#: many addresses guess one officer's password at 5 tries each; the soul login
#: (`soul_accounts/me_views.py`) has had both layers since 2026-09-17.
LOGIN_MAX_ATTEMPTS_PER_USERNAME = 20


def _username_rate_key(username):
    """Hashed, as in `soul_accounts.me_views._rate_keys`: key names show up in Redis MONITOR / backups."""
    import hashlib

    digest = hashlib.sha256(str(username).strip().lower().encode()).hexdigest()[:32]
    return f"login_rate:user:{digest}"


def _get_client_ip(request):
    """Delegates to the one validated implementation.

    This keys the login brute-force limiter (5 attempts / 15 minutes). It used
    to return `X-Forwarded-For`'s first entry unchecked, so rotating that
    header reset the counter and the limiter counted nothing. See
    apps/core/client_ip.py.
    """
    from apps.core.client_ip import get_client_ip

    return get_client_ip(request)


class LoginView(TokenObtainPairView):
    """
    POST /api/v1/auth/login/
    Returns access + refresh tokens with tenant info.
    Logs login success/failure to LoginLog.
    """
    serializer_class = CustomTokenObtainPairSerializer
    permission_classes = [AllowAny]

    @extend_schema(
        request=CustomTokenObtainPairSerializer,
        responses={
            # Two 200 shapes: tokens, or `mfa_required` + a pending token for /auth/mfa/verify/.
            200: PolymorphicProxySerializer(
                component_name="LoginOutcome",
                serializers=[LoginResponseSerializer, MfaRequiredResponseSerializer],
                resource_type_field_name=None,
            ),
            # simplejwt's AuthenticationFailed: {"detail": "No active account ..."}
            401: LoginFailedResponseSerializer,
            429: LoginLockedResponseSerializer,
        },
    )
    def post(self, request, *args, **kwargs):
        # Set request context for audit logging before any database operations
        from apps.core.request_local import set_current_request
        set_current_request(request)

        # Login rate limiting: max 5 attempts per 15 minutes per IP
        ip_address = _get_client_ip(request)
        from django.core.cache import cache
        rate_key = f"login_rate:{ip_address}"
        # When the window ends, as an epoch second. The counter's own TTL is
        # not readable through Django's cache API (LocMem has no `ttl`), and
        # `/login` needs it to say 「M 分钟后再试」 rather than a bare refusal.
        until_key = f"login_rate_until:{ip_address}"
        attempts = cache.get(rate_key, 0)
        username = request.data.get('username', '')
        user_key = _username_rate_key(username)
        user_until_key = f"{user_key}:until"
        user_attempts = cache.get(user_key, 0)
        if user_attempts >= LOGIN_MAX_ATTEMPTS_PER_USERNAME:
            attempts, until_key = LOGIN_MAX_ATTEMPTS, user_until_key
        if attempts >= LOGIN_MAX_ATTEMPTS:
            until = cache.get(until_key)
            retry_after = max(1, math.ceil(until - time.time())) if until else LOGIN_WINDOW_SECONDS
            return Response(
                {"error": "登录尝试过于频繁，请稍后再试", "code": "login_locked", "retry_after": retry_after},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": str(retry_after)},
            )

        def _count_failure():
            cache.set(rate_key, attempts + 1, timeout=LOGIN_WINDOW_SECONDS)
            cache.set(until_key, time.time() + LOGIN_WINDOW_SECONDS, timeout=LOGIN_WINDOW_SECONDS)
            cache.set(user_key, user_attempts + 1, timeout=LOGIN_WINDOW_SECONDS)
            cache.set(user_until_key, time.time() + LOGIN_WINDOW_SECONDS, timeout=LOGIN_WINDOW_SECONDS)
            return max(0, min(LOGIN_MAX_ATTEMPTS - (attempts + 1),
                              LOGIN_MAX_ATTEMPTS_PER_USERNAME - (user_attempts + 1)))

        # Capture request metadata before authentication
        user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]

        from .models import LoginLog
        try:
            response = super().post(request, *args, **kwargs)
            if response.status_code == 200 and response.data.get("mfa_required"):
                # 密码对了,还要验码:计数清掉(第二步有自己的锁),登录日志等验码通过再写。
                cache.delete(rate_key)
                cache.delete(user_key)
            elif response.status_code == 200:
                # Login success - clear rate limit counter
                cache.delete(rate_key)
                cache.delete(user_key)
                user = response.data.get('user', {})
                user_id = user.get('id')
                LoginLog.objects.create(
                    user_id=user_id,
                    username=username,
                    status='SUCCESS',
                    ip_address=ip_address,
                    user_agent=user_agent,
                )
                refresh_cookie.move_to_cookie(request, response)
            else:
                # Login failed (but returned response) - increment rate counter
                _count_failure()
                LoginLog.objects.create(
                    username=username,
                    status='FAILED',
                    ip_address=ip_address,
                    user_agent=user_agent,
                    failure_reason=f"status_{response.status_code}",
                )
            return response
        except Exception as e:
            # Login failed due to exception - increment rate counter
            remaining = _count_failure()
            LoginLog.objects.create(
                username=username,
                status='FAILED',
                ip_address=ip_address,
                user_agent=user_agent,
                # Only the class name for anything but wrong credentials: an
                # unexpected exception's message can carry SQL, paths or the
                # submitted values, and LoginLog is readable from the admin UI.
                failure_reason=(str(e) if isinstance(e, AuthenticationFailed) else type(e).__name__)[:200],
            )
            if isinstance(e, AuthenticationFailed):
                # Wrong credentials: the same `detail` as before, plus how many
                # tries this address has left before the 429 above.
                e.detail = {"detail": e.detail, "remaining_attempts": remaining}
            raise


class OfficerLoginView(LoginView):
    """
    POST /api/v1/auth/officer-login/
    The officer app's login: username + password, no hall chosen. Same throttling and
    LoginLog as `LoginView` (it is that view); the serializer finds the hall. See
    `OfficerTokenObtainPairSerializer` for the 409 `hall_required` case.
    """
    serializer_class = OfficerTokenObtainPairSerializer

    @extend_schema(
        request=OfficerTokenObtainPairSerializer,
        responses={
            # Same two 200 shapes as /auth/login/: tokens, or `mfa_required` + pending token
            # (then POST /auth/mfa/verify/).
            200: PolymorphicProxySerializer(
                component_name="LoginOutcome",
                serializers=[LoginResponseSerializer, MfaRequiredResponseSerializer],
                resource_type_field_name=None,
            ),
            401: LoginFailedResponseSerializer,
            409: HallChoiceResponseSerializer,
            429: LoginLockedResponseSerializer,
        },
    )
    def post(self, request, *args, **kwargs):
        return super().post(request, *args, **kwargs)


class RefreshView(TokenRefreshView):
    """
    POST /api/v1/auth/refresh/
    Returns new access token from refresh token.

    On this app's `RefreshToken`, so a rotated 「保持登录 30 天」 token is
    issued for 30 days again rather than for SimpleJWT's default 7.
    """
    permission_classes = [AllowAny]
    serializer_class = TokenRefreshSerializer

    def post(self, request, *args, **kwargs):
        """App 在正文里带 `refresh`;网页不带,用 httpOnly cookie(`refresh_cookie.py`,核 Origin),新令牌写回 cookie。"""
        from rest_framework_simplejwt.exceptions import InvalidToken

        if request.data.get("refresh"):
            return refresh_cookie.move_to_cookie(request, super().post(request, *args, **kwargs))
        raw, refusal = refresh_cookie.from_cookie(request)
        if refusal:
            return Response({"detail": "Origin not allowed", "code": refusal}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data={"refresh": raw} if raw else {})
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as exc:
            raise InvalidToken(exc.args[0]) from exc
        return refresh_cookie.move_to_cookie(request, Response(serializer.validated_data, status=status.HTTP_200_OK))


@extend_schema(
    request=LogoutRequestSerializer,
    responses={
        200: DetailResponseSerializer,
        # Same key, not `error`: the except branch answers
        # {"detail": "Invalid token"}.
        400: DetailResponseSerializer,
    },
)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    """
    POST /api/v1/auth/logout/
    Blacklist the refresh token: the one in the body (apps), or the web's httpOnly cookie (cleared in the answer).
    The token must be the caller's own (L-6): someone else's is refused and stays valid.
    """
    refresh_token = request.data.get("refresh")
    from_cookie = False
    if not refresh_token:
        refresh_token, refusal = refresh_cookie.from_cookie(request)
        if refusal:
            return Response({"detail": "Origin not allowed", "code": refusal}, status=status.HTTP_403_FORBIDDEN)
        from_cookie = bool(refresh_token)
    try:
        if refresh_token:
            from . import signin_sessions

            if not isinstance(refresh_token, str):  # a JSON number / object in the body
                raise TokenError("not a token")
            token = RefreshToken(refresh_token)
            if str(token.payload.get("user_id")) != str(request.user.pk):
                raise TokenError("not this user's token")
            token.blacklist()
            signin_sessions.sign_out(token)
        response = Response({"detail": "Logged out successfully"}, status=status.HTTP_200_OK)
    # Only a bad token is the caller's 400; anything else (database, sign_out) is ours and surfaces as a 500
    # instead of reading "Invalid token" while the refresh token stays valid (cq-backend 第 10 条).
    except TokenError:
        response = Response({"detail": "Invalid token"}, status=status.HTTP_400_BAD_REQUEST)
    return refresh_cookie.clear(response) if from_cookie or refresh_cookie.wants_cookie(request) else response


@extend_schema(
    methods=["GET"],
    request=None,
    responses={200: UserSerializer},
)
@extend_schema(
    methods=["PATCH"],
    request=UserSerializer,
    responses={200: UserSerializer, 400: OpenApiTypes.OBJECT},
)
@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def profile_view(request):
    """
    GET /api/v1/auth/profile/ — get current user
    PATCH /api/v1/auth/profile/ — update current user
    """
    if request.method == "GET":
        return Response(UserSerializer(request.user, context={"request": request}).data)
    elif request.method == "PATCH":
        # `context={"request": request}` is not decoration: `validate_organization`
        # scopes the FK against the caller's tenant and has no other way to
        # learn who is calling. Without it the serializer refuses **every**
        # organization change with "cannot determine the current tenant" --
        # which reads like the guard working and is the guard failing closed on
        # the legitimate case too. `change_password` sixteen lines below already
        # passed context; this one did not.
        serializer = UserSerializer(
            request.user, data=request.data, partial=True, context={"request": request}
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@extend_schema(
    request=ChangePasswordSerializer,
    responses={200: ChangePasswordResponseSerializer, 400: ChangePasswordRefusalSerializer},
)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    """
    POST /api/v1/auth/change-password/
    Change password — requires old password verification. Every OTHER device is signed out
    at once (refresh tokens blacklisted, `session_version` bumped so their access tokens stop
    working too). This device keeps its login: send its `refresh` token and the response
    carries a new `access` / `refresh` pair to swap in. No `refresh` -> this device is signed
    out as well and the response has no tokens.
    """
    # A wrong current password spends the SAME budget as a wrong login password (`login_rate:{ip}`,
    # 5 per 15 minutes): a stolen session must not get unlimited guesses at the password here.
    ip = _get_client_ip(request)
    rate_key, until_key = f"login_rate:{ip}", f"login_rate_until:{ip}"
    attempts = cache.get(rate_key, 0)
    if attempts >= LOGIN_MAX_ATTEMPTS:
        until = cache.get(until_key)
        retry_after = max(1, math.ceil(until - time.time())) if until else LOGIN_WINDOW_SECONDS
        return Response(
            {"error": "密码尝试过于频繁,请稍后再试", "code": "login_locked", "retry_after": retry_after},
            status=status.HTTP_429_TOO_MANY_REQUESTS, headers={"Retry-After": str(retry_after)},
        )
    serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
    try:
        serializer.is_valid(raise_exception=True)
    except DRFValidationError as exc:
        if "old_password" in exc.detail:
            cache.set(rate_key, attempts + 1, timeout=LOGIN_WINDOW_SECONDS)
            cache.set(until_key, time.time() + LOGIN_WINDOW_SECONDS, timeout=LOGIN_WINDOW_SECONDS)
        raise

    user = request.user
    current = None
    raw = serializer.validated_data.get("refresh")
    if not raw and refresh_cookie.wants_cookie(request):
        raw, _refusal = refresh_cookie.from_cookie(request)  # Origin 不对 = 没带:这台也退出
    if raw:
        try:
            current = RefreshToken(raw)
        except TokenError:
            current = None
        if current is None or str(current.payload.get("user_id")) != str(user.pk):
            return Response({"refresh": ["刷新令牌无效"]}, status=status.HTTP_400_BAD_REQUEST)

    # 这台设备的登录设备行留着(其余在 `end_sessions` 里标成已退出);没带刷新令牌 = 这台也退出。
    keep = None
    if current is not None:
        keep = signin_sessions.session_of(current) or signin_sessions.start(user, request, officer_app=bool(
            current.payload.get("officer_app")))
    with transaction.atomic():
        set_officer_password(user, serializer.validated_data["new_password"])
        end_sessions(user, keep_session=keep)
        end_push_registrations(user, keep_token=serializer.validated_data.get("token", ""))
        _audit(user, "官员修改密码,其他设备已退出", request=request,
               changes={"password_changed": True, "sessions_revoked": True})

    body = {"detail": "密码修改成功"}
    if current is not None:
        body.update(reissue_for_device(user, current, keep))
    return refresh_cookie.move_to_cookie(request, Response(body))


def _reset_refusal(error, code, http_status, retry_after=None, **extra):
    """A refusal of the email-reset endpoints: `{error, code}`, plus
    `retry_after` when throttled. Clients branch on `code`; see
    `PasswordResetRefusalSerializer` for the full set."""
    body = {"error": error, "code": code, **extra}
    headers = None
    if retry_after is not None:
        body["retry_after"] = retry_after
        headers = {"Retry-After": str(retry_after)}
    return Response(body, status=http_status, headers=headers)


def _rate_limited(retry_after):
    return _reset_refusal(
        "请求过于频繁，请稍后再试", "rate_limited", status.HTTP_429_TOO_MANY_REQUESTS, retry_after
    )


def _throttle_wait(request, throttles):
    """Whole seconds until every refusing throttle would admit `request`, or
    None when none refuses. All are consulted, as DRF's `check_throttles` does.

    The two reset views declare `@throttle_classes([])` and call this instead,
    so the default anonymous throttle's 429 carries `code` and `retry_after`
    too rather than DRF's bare `{detail}`."""
    waits = [t.wait() or 1 for t in throttles if not t.allow_request(request, None)]
    return max(1, math.ceil(max(waits))) if waits else None


#: The only role that may reset its own password by email (2026-09 product
#: decision). Officers have their own email flow (a one-hour link, verified
#: addresses only: `officer_reset.py`, 2026-10-09) and `password_help_request`.
SELF_RESET_ROLE = UserRole.SOUL


@extend_schema(
    request=ResetPasswordSerializer,
    responses={
        # 200 for an address with no account too — the view returns the same
        # body deliberately, so the document must not promise a 404 that
        # would tell an enumerator the difference.
        200: DetailResponseSerializer,
        429: PasswordResetRefusalSerializer,
    },
)
@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([])
def reset_password_request(request):
    """
    POST /api/v1/auth/reset-password/
    Forgot password — generate 6-digit code and send to email.
    Stores code in Redis cache with 5-minute TTL.
    """
    from django.core.cache import cache

    from apps.core.throttling import AnonRateThrottle

    from .throttles import PasswordResetThrottle

    # BOTH limits run BEFORE the lookup, and both refuse identically.
    #
    # The address counter used to sit *below* the `matches != 1` early return,
    # so only a registered address was ever counted: ask four times and a
    # registered address answered 429 while an unregistered one answered 200
    # forever. The limiter was a registration oracle — for exactly the question
    # the comment below says this endpoint refuses to answer (BP-03).
    #
    # The per-IP half is new. An address counter bounds how often one mailbox
    # is flooded; it does nothing about one client walking a list of addresses,
    # which is the enumeration itself. `PasswordResetThrottle` is keyed by
    # `apps/core/client_ip.py`, so rotating `X-Forwarded-For` does not reset it.
    #
    # Every 429 here says when to come back (`retry_after`). That number is a
    # function of this client's and this address's request history only —
    # both counters run before the lookup — so it discloses nothing either.
    wait = _throttle_wait(request, [AnonRateThrottle(), PasswordResetThrottle()])
    if wait is not None:
        return _rate_limited(wait)

    serializer = ResetPasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    # Case-folded once, here and in `set_new_password`: the rate buckets, the code's own key
    # and the lookup all agree, so `Soul@Example.com` neither dodges a limit nor silently
    # gets no mail (the lookup below is `iexact`, as the unique index on `User.email` is).
    email = serializer.validated_data["email"].strip().lower()
    rate_limit_key = f"pwd_reset_rate:{email.strip().lower()}"
    # When that window ends, as an epoch second — the counter's own TTL is not
    # readable through Django's cache API (as in `LoginView.post`).
    until_key = f"pwd_reset_rate_until:{email.strip().lower()}"
    attempts = cache.get(rate_limit_key, 0)
    if attempts >= MAX_RESET_REQUESTS_PER_ADDRESS:
        until = cache.get(until_key)
        return _rate_limited(
            max(1, math.ceil(until - time.time())) if until else RESET_REQUEST_WINDOW_SECONDS
        )
    cache.set(rate_limit_key, attempts + 1, timeout=RESET_REQUEST_WINDOW_SECONDS)
    cache.set(until_key, time.time() + RESET_REQUEST_WINDOW_SECONDS, timeout=RESET_REQUEST_WINDOW_SECONDS)

    # Check if user exists (but always return success for security)
    #
    # `.filter()[:2]`, not `.get()`. Since authentication 0016 `User.email`
    # is unique among live rows (case-insensitively), and `User.objects` sees only
    # live rows, so more than one match should no longer happen; exactly-one is
    # kept because a `.get()` that ever did meet two would be an uncaught 500.
    # The one row is kept (not just counted) because the mail's language is
    # chosen from it — see `apps/authentication/mail.py::mail_locale`.
    #
    # A soul's address gets here only through `sync_login_email`
    # (apps/soul_accounts/services.py), which copies the soul's contact email to
    # its current account and skips an address another account already holds. A
    # family sharing one contact address therefore resets through the first
    # account that got it; the others are flagged `email_not_synced` for the hall.
    #
    # Zero and many are both answered with the same success sentence as one: this
    # endpoint deliberately does not disclose whether an address is registered,
    # and "your address is ambiguous" would disclose it.
    #
    # SOUL ACCOUNTS ONLY. This six-digit code is the souls' path; officers reset
    # through `/auth/officer-reset/request/` (a link, verified addresses only)
    # or page their administrator via `/auth/password-help/`. An officer's
    # address is therefore treated exactly like an unregistered one here — same statements, same body —
    # so this endpoint does not become an "is this an officer?" oracle either.
    matches = list(User.objects.filter(email__iexact=email, role=SELF_RESET_ROLE, is_active=True)[:2])
    # A code is stored for EVERY address, registered or not (secure 6 digits, 5-minute TTL).
    # `set_new_password` answers "expired" when no code is live and "wrong" when one is, and
    # counts guesses against it; storing a code only for registered addresses made those two
    # answers an account-existence oracle. An address with no single account gets a code
    # nobody was ever sent, so every later answer is the same as for a real one.
    code = f"{secrets.randbelow(900000) + 100000:06d}"
    cache.set(f"pwd_reset:{email}", code, timeout=300)
    if len(matches) == 1:

        # BP-12: this was a comment, so no reset could ever be completed.
        # The code goes to the mailbox only — never the log, never the
        # response. A send failure is logged without the code and answered
        # like success: a 500 only for registered addresses would disclose
        # exactly what the identical responses above exist to hide.
        try:
            locale = mail_locale(user=matches[0])
            pack = MAIL_MESSAGES[locale]["reset_code"]
            send_neutral_mail(
                f"SoulLedger {pack['title']}",
                fill(pack["text"], code=code),
                heading=pack["title"],
                rows=[(pack["code_label"], code)],
                notes=[pack["note"]],
                to=[email],
                locale=locale,
            )
        except Exception:
            logger.error("password reset mail could not be sent", exc_info=False)

    return Response({"detail": "验证码已发送到邮箱"})


@extend_schema(
    request=SetNewPasswordSerializer,
    responses={
        200: DetailResponseSerializer,
        400: PasswordResetRefusalSerializer,
        404: PasswordResetRefusalSerializer,
        409: PasswordResetRefusalSerializer,
        429: PasswordResetRefusalSerializer,
    },
)
@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([])
def set_new_password(request):
    """
    POST /api/v1/auth/set-new-password/
    Set new password via email + verification code from Redis.

    Every refusal carries a stable `code` (`PASSWORD_RESET_REFUSAL_CODES`);
    the `error` sentence is for people and may change. A field-validation 400
    is DRF's `{field: [...]}` shape instead.
    """
    from apps.core.throttling import AnonRateThrottle

    wait = _throttle_wait(request, [AnonRateThrottle()])
    if wait is not None:
        return _rate_limited(wait)

    serializer = SetNewPasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    email = serializer.validated_data["email"].strip().lower()
    code = serializer.validated_data["code"]
    new_password = serializer.validated_data["new_password"]

    # Verify code from Redis
    cached_code = cache.get(f"pwd_reset:{email}")

    if cached_code is None:
        return _reset_refusal("验证码已过期,请重新获取", "reset_code_expired", status.HTTP_400_BAD_REQUEST)

    # Cap the number of GUESSES, not just the number of codes sent.
    #
    # `reset_password_request` above limits sending to 3 per 5 minutes per
    # address. Nothing limited *checking*: a wrong code returned 400 and left
    # the code live for its full 5-minute TTL, so the only ceiling on guessing
    # was `AnonRateThrottle` (60/min) — which, until IS-01, DRF keyed on the
    # client's own `X-Forwarded-For`, so rotating one header reset it. The code
    # is six digits; an unmetered guesser is the whole attack. (That throttle
    # now keys on `apps/core/client_ip.py`; this counter is still the limit
    # that matters, because it is per address rather than per client.)
    #
    # On the last allowed failure the CODE IS DELETED, not merely rejected.
    # Counting alone would leave a live code and let the attacker wait out the
    # counter; deleting forces a new request, which is itself rate-limited.
    #
    # The counter is bumped BEFORE the code is compared, with `cache.add` + `cache.incr`
    # (atomic in Redis). Reading it, comparing, then writing `tries + 1` let N parallel
    # guesses all read the same value and spend one try between them.
    attempts_key = f"pwd_reset_tries:{email}"
    cache.add(attempts_key, 0, timeout=300)  # `timeout` is the code's own TTL: the counter must outlive it
    try:
        tries = cache.incr(attempts_key)
    except ValueError:  # expired between the two calls
        cache.add(attempts_key, 1, timeout=300)
        tries = 1
    if tries > MAX_RESET_CODE_ATTEMPTS:
        cache.delete(f"pwd_reset:{email}")
        cache.delete(attempts_key)
        # No `retry_after`: there is nothing to wait for. The code is gone and
        # only a new one (`reset-password`, itself limited) helps.
        return _reset_refusal(
            "验证码错误次数过多,请重新获取", "reset_code_attempts_exceeded", status.HTTP_429_TOO_MANY_REQUESTS
        )

    def wrong():
        # How many more checks this code will take: the App says 「还可以再试 N 次」.
        # Zero means the next submission, right or wrong, is `reset_code_attempts_exceeded`.
        return _reset_refusal(
            "验证码错误", "reset_code_wrong", status.HTTP_400_BAD_REQUEST,
            attempts_left=MAX_RESET_CODE_ATTEMPTS - tries,
        )

    if not secrets.compare_digest(str(cached_code), code):
        return wrong()

    # Correct code: the counter has no further job, and leaving it would let a
    # previous run's failures shorten the next legitimate reset.
    cache.delete(attempts_key)

    # Get user
    #
    # A code exists for addresses with no single live soul account too (see
    # `reset_password_request`), but nobody was ever sent it, so reaching here with one is a
    # lucky guess at a six-digit number. It is answered as an ordinary wrong code — "no such
    # account" / "ambiguous address" would turn that guess into the oracle the fake code closes.
    #
    # Restricted to soul accounts like `reset_password_request`: a code that
    # somehow exists for an officer's address (one issued before this rule,
    # or planted by anything else that writes the key) must not change an
    # officer's password.
    users = list(User.objects.filter(email__iexact=email, role=SELF_RESET_ROLE, is_active=True)[:2])
    if len(users) != 1:
        return wrong()
    user = users[0]

    # Validate password strength
    reasons = weak_password_reasons(new_password, user)
    if reasons:
        return _reset_refusal(
            " ".join(r["message"] for r in reasons), "weak_password", status.HTTP_400_BAD_REQUEST,
            new_password=reasons,
        )

    # Set new password — through the same path as a soul changing its initial
    # password, so the reset also ends the initial-password lifecycle: not
    # forced to change it again, and an initial password that had already
    # lapsed no longer makes `soul_accounts.services.authenticate` refuse the new one.
    # 「其他设备上的登录已全部退出」: every refresh token this account holds is
    # blacklisted there. An access token already issued lives out its lifetime
    # (`ACCESS_TOKEN_LIFETIME`, 30 minutes by default) and cannot be renewed.
    from apps.authentication.passwords import end_sessions
    from apps.soul_accounts.models import SoulAccount
    from apps.soul_accounts.services import set_password_chosen_by_soul

    account = SoulAccount.objects.filter(user=user).first()
    if account is not None:
        account.user = user
        set_password_chosen_by_soul(account, new_password)
    else:  # a SOUL-role user with no soul account (none are created that way now)
        user.set_password(new_password)
        user.save(update_fields=["password"])
        end_sessions(user)

    # Invalidate the code
    cache.delete(f"pwd_reset:{email}")

    return Response({"detail": "密码重置成功"})


#: The one body `password_help_request` ever answers 200 with. A module
#: constant so the tests compare against the thing itself.
PASSWORD_HELP_ACCEPTED = {"detail": "请求已受理"}


@extend_schema(
    request=None,
    responses={200: PublicCivilizationSerializer(many=True)},
)
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def civilizations_view(request):
    """
    GET /api/v1/auth/civilizations/
    The login page's civilization rows: active tenants that speak for a
    civilization, in the order the civilizations are declared.

    Public (the page is shown before anyone signs in) and therefore minimal —
    see `PublicCivilizationSerializer`. No authentication at all, so a stale
    access token left in the tab cannot turn the login page's list into a 401.
    """
    from apps.souls.models import TENANT_CIVILIZATION, Civilization
    from apps.tenants.models import Tenant

    order = {value: i for i, value in enumerate(Civilization.values)}
    tenants = Tenant.objects.filter(is_active=True, code__in=TENANT_CIVILIZATION).only("code")
    rows = sorted(
        ({"code": t.code, "civilization": TENANT_CIVILIZATION[t.code].value} for t in tenants),
        key=lambda row: order[row["civilization"]],
    )
    return Response(PublicCivilizationSerializer(rows, many=True).data)


@extend_schema(
    request=PasswordHelpRequestSerializer,
    responses={
        # One 200 body for every username — existing, unknown, inactive, a
        # soul account. See the view.
        200: DetailResponseSerializer,
        400: OpenApiTypes.OBJECT,
        429: ErrorResponseSerializer,
    },
)
@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def password_help_request(request):
    """
    POST /api/v1/auth/password-help/
    「忘记密码」 on a console whose accounts an administrator opens: the
    administrators and realm leads (殿主) of the account's tenant get an in-app
    notification and an audit row is written. No code, no link, no mail — the
    recipient resets the password through user management as they would anyway.

    NO USER ENUMERATION, BY CONSTRUCTION. This view never reads the user
    table. The per-IP limit is counted before anything else and refuses
    every username identically; then the username is handed to
    `tasks.notify_password_help`, which does the lookup in the worker, and
    the same body goes back. Known and unknown usernames take the same path
    through this function, statement for statement.
    """
    from apps.core.client_ip import get_client_ip

    from .tasks import notify_password_help
    from .throttles import PasswordHelpThrottle

    too_frequent = Response(
        {"error": "请求过于频繁，请稍后再试"}, status=status.HTTP_429_TOO_MANY_REQUESTS
    )
    if not PasswordHelpThrottle().allow_request(request, None):
        return too_frequent

    serializer = PasswordHelpRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    username = serializer.validated_data["username"]

    # NO PER-USERNAME LIMIT (removed 2026-09-25, product owner's decision).
    # There was one — 3 per hour per username, counted here — and it was a
    # denial of service aimed at somebody else: anyone could send three
    # requests naming a colleague and that colleague's own 「忘记密码」 then
    # answered 429 for an hour. The per-IP throttle above bounds how many
    # usernames one client can try, which is what an enumerator needs; a
    # username counter bounded only the account's real owner.

    args = (username, get_client_ip(request), request.META.get("HTTP_USER_AGENT", "")[:500])
    try:
        notify_password_help.delay(*args)
    except Exception:
        # Broker down. Run it here rather than drop a request the page is
        # about to tell the operator was delivered. This path is taken for
        # every username alike, so it discloses nothing about any one of them
        # beyond "the broker is down".
        logger.warning("password help: enqueue failed, running inline", exc_info=False)
        notify_password_help.run(*args)

    return Response(PASSWORD_HELP_ACCEPTED)


@extend_schema(
    methods=["GET"],
    request=None,
    responses={200: UserPreferencesSerializer},
)
@extend_schema(
    methods=["PATCH"],
    request=UserPreferencesSerializer,
    responses={200: UserPreferencesSerializer, 400: OpenApiTypes.OBJECT},
)
@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def preferences_view(request):
    """
    GET   /api/v1/auth/profile/preferences/ — the caller's own preferences
    PATCH /api/v1/auth/profile/preferences/ — merge into them

    Always `request.user`. There is no id in the path or the body to address
    anyone else by, and an unknown key (a `user`, say) is a 400 rather than
    ignored — see `UserPreferencesSerializer`.
    """
    user = request.user
    if request.method == "PATCH":
        serializer = UserPreferencesSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = user.preferences or {}
        changes = dict(serializer.validated_data)
        if "notifications" in changes:
            changes["notifications"] = notification_categories.merge(user, changes["notifications"])
        user.preferences = {**before, **changes}
        user.save(update_fields=["preferences"])
    return Response(UserPreferencesSerializer(_preferences_with_defaults(user)).data)


def _preferences_with_defaults(user):
    """Every declared key present — the field's default where unset, else null — so a client reads one shape."""
    stored = user.preferences or {}
    out = {
        name: stored.get(name, None if field.default is empty else field.default)
        for name, field in UserPreferencesSerializer().fields.items()
    }
    out["notifications"] = notification_categories.resolved(user)  # the whole table, locked cells on
    return out
