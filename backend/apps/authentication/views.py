"""
Auth views: register, login, logout, profile.
"""
import logging
import math
import secrets
import time

from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import (
    action,
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

User = get_user_model()
logger = logging.getLogger(__name__)

from apps.authentication.models import UserRole, is_assignable_role
from apps.core.csv_safe import csv_safe
from apps.core.permissions import IsAdminPermission, TenantPermission
from apps.core.schema import DetailResponseSerializer, ErrorResponseSerializer
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin

from .serializers import (
    ChangePasswordSerializer,
    CustomTokenObtainPairSerializer,
    LoginFailedResponseSerializer,
    LoginLockedResponseSerializer,
    LoginLogSerializer,
    LoginResponseSerializer,
    LogoutRequestSerializer,
    PasswordHelpRequestSerializer,
    PasswordResetRefusalSerializer,
    PasswordResetResultSerializer,
    PublicCivilizationSerializer,
    RegisterSerializer,
    ResetPasswordSerializer,
    SetNewPasswordSerializer,
    TokenRefreshSerializer,
    UserBatchUpdateResultSerializer,
    UserCreateSerializer,
    UserImportResultSerializer,
    UserManagementSerializer,
    UserPreferencesSerializer,
    UserRoleSerializer,
    UserSerializer,
    UserUpdateSerializer,
    email_already_registered,
    role_rank,
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
    permission_classes = [TenantPermission, IsAdminPermission]
    # BINARY, not CRUD. `user.manage` is the only user codename that exists —
    # it is in DEFAULT_PERMISSIONS and held by ADMIN — and this viewset already
    # behaves that way: IsAdminPermission above gates reads and writes alike,
    # so ADMIN can do everything here and nobody else can do anything.
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
        qs = User.objects.select_related('tenant').exclude(role='SOUL')

        # ADMIN is the only global-scope role (apps/perm/models.py Role.scope);
        # every other role is tenant-scoped and must never see another
        # tenant's users. This mirrors the ADMIN bypass used by
        # TenantQuerySetMixin/DataScopeViewSetMixin everywhere else in the
        # codebase — previously this method filtered ADMIN by tenant too
        # (unlike every other viewset) while UserCreateSerializer let ADMIN
        # create a user in ANY tenant, so an ADMIN-created user outside the
        # creator's own tenant became invisible and unmanageable through
        # this API ("can create, can't manage"). Bypassing tenant filtering
        # for ADMIN here removes that asymmetry.
        #
        # Access for non-ADMIN roles is gated today at the HTTP layer by
        # IsAdminPermission, so in practice only ADMIN reaches this method —
        # but the filter below is a second line of defense for whenever
        # that gate is loosened to a permission-codename check instead.
        # (Scoping itself now lives in apps/core/tenant.py.)
        qs = scope_to_tenant(qs, self.request)

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

        # Filter by role
        role = params.get('role', '').strip()
        if role:
            qs = qs.filter(role=role)

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

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        """激活指定用户"""
        user = self.get_object()
        user.is_active = True
        user.save(update_fields=['is_active'])
        return Response(UserManagementSerializer(user).data)

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        """停用指定用户"""
        user = self.get_object()
        user.is_active = False
        user.save(update_fields=['is_active'])
        return Response(UserManagementSerializer(user).data)

    @extend_schema(responses=PasswordResetResultSerializer)
    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        """重置用户密码，返回随机生成的新密码"""
        user = self.get_object()
        new_password = secrets.token_urlsafe(12)
        user.set_password(new_password)
        user.save(update_fields=['password'])
        return Response({'password': new_password})

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

    @extend_schema(responses=UserBatchUpdateResultSerializer)
    @action(detail=False, methods=['post'])
    def batch_activate(self, request):
        """批量激活用户"""
        user_ids = request.data.get('user_ids', [])
        if not user_ids:
            return Response({'error': 'user_ids is required'}, status=status.HTTP_400_BAD_REQUEST)
        updated = self._batch_targets(user_ids).update(is_active=True)
        return Response({'updated': updated})

    @extend_schema(responses=UserBatchUpdateResultSerializer)
    @action(detail=False, methods=['post'])
    def batch_deactivate(self, request):
        """批量停用用户"""
        user_ids = request.data.get('user_ids', [])
        if not user_ids:
            return Response({'error': 'user_ids is required'}, status=status.HTTP_400_BAD_REQUEST)
        updated = self._batch_targets(user_ids).update(is_active=False)
        return Response({'updated': updated})

    @extend_schema(responses=UserRoleSerializer)
    @action(detail=True, methods=['get'])
    def own_roles(self, request, pk=None):
        """获取用户的角色"""
        user = self.get_object()
        return Response({'role': user.role})

    @action(detail=True, methods=['post'])
    def assign_roles(self, request, pk=None):
        """分配角色给用户"""
        user = self.get_object()
        new_role = request.data.get('role')
        # Against the Role table, not a restated enum. This and its twin in
        # import_csv were two hand-written copies of UserRole that both missed
        # MODERATOR; then they were `UserRole.values`, which made every role
        # created through /perm/roles/create/ unholdable (BP-11).
        if not is_assignable_role(new_role):
            return Response(
                {'error': f'Invalid role {new_role!r}: not a built-in role and not a live row in the role table.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        # Prevent privilege escalation: assigning user's role must be >= target role.
        # Shares apps/authentication/serializers.py's ROLE_HIERARCHY so this
        # stays in sync with the same check applied on create/update.
        # No `caller_role != 'ADMIN'` short-circuit.
        #
        # `IsAdminPermission` gates this action, so that clause guaranteed the
        # whole check was **dead**: by the time control reaches here the caller
        # is ADMIN, and the condition's first half is always False. Harmless
        # today — and silently unprotective the day the ADMIN gate becomes a
        # codename check, which the comments around here describe as planned.
        #
        # Removing it costs nothing: ADMIN ranks 0, the most privileged, so
        # `role_rank('ADMIN') > role_rank(anything)` is never true. The check
        # now says what it means — you cannot assign above your own rank —
        # instead of naming one role for which it does not apply.
        caller_role = getattr(request.user, 'role', None)
        if role_rank(caller_role) > role_rank(new_role):
            return Response(
                {'error': 'Cannot assign a role more privileged than your own'},
                status=status.HTTP_403_FORBIDDEN,
            )
        user.role = new_role
        user.save(update_fields=['role'])
        return Response(UserManagementSerializer(user).data)

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

        qs = self.get_queryset()
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="users.csv"'
        writer = csv.writer(response)
        writer.writerow(['username', 'email', 'role', 'is_active', 'tenant', 'create_time'])
        for user in qs:
            writer.writerow([
                # `csv_safe` on every free-text cell (apps/core/csv_safe.py).
                # `username` is picked by whoever registers — `/auth/register/`
                # is AllowAny — and `email` by whoever edits their own profile,
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

        decoded_file = file.read().decode('utf-8')
        reader = csv.DictReader(io.StringIO(decoded_file))
        created = 0
        errors = []

        for i, row in enumerate(reader):
            try:
                username = row.get('username', '').strip()
                email = row.get('email', '').strip()
                role = row.get('role', 'VIEWER').strip().upper()
                password = row.get('password', '').strip()

                if not username:
                    errors.append(f"Row {i+2}: username is required")
                    continue

                # Validate email format
                if email:
                    try:
                        validate_email(email)
                    except ValidationError:
                        errors.append(f"Row {i+2}: invalid email '{email}'")
                        continue

                if not is_assignable_role(role):
                    errors.append(f"Row {i+2}: invalid role '{role}'")
                    continue

                if User.objects.filter(username=username, tenant=tenant).exists():
                    errors.append(f"Row {i+2}: username '{username}' already exists")
                    continue

                # Same rule as every other write path (BP-04). Checked per row
                # rather than once: rows are created as they are read, so the
                # second of two rows carrying one address sees the first.
                if email_already_registered(email):
                    errors.append(f"Row {i+2}: email '{email}' already belongs to another account")
                    continue

                # Require password in CSV
                if not password:
                    errors.append(f"Row {i+2}: password is required")
                    continue

                User.objects.create_user(
                    username=username,
                    email=email,
                    password=password,
                    role=role,
                    tenant=tenant,
                )
                created += 1
            except Exception as e:
                errors.append(f"Row {i+2}: {str(e)}")

        return Response({
            'created': created,
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

    def get_queryset(self):
        from .models import LoginLog
        qs = LoginLog.objects.select_related('user').all()
        user = self.request.user
        if getattr(user, 'role', None) != 'ADMIN':
            return qs.none()
        tenant = getattr(self.request, 'tenant', None)
        if tenant:
            # Filter by users in the same tenant
            from django.contrib.auth import get_user_model
            User = get_user_model()
            tenant_user_ids = User.objects.filter(tenant=tenant).values_list('id', flat=True)
            qs = qs.filter(user_id__in=tenant_user_ids)
        return qs


#: The login brute-force limiter: failures per client IP inside one window.
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 900


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
            200: LoginResponseSerializer,
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
            return max(0, LOGIN_MAX_ATTEMPTS - (attempts + 1))

        # Capture request metadata before authentication
        user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]
        username = request.data.get('username', '')

        from .models import LoginLog
        try:
            response = super().post(request, *args, **kwargs)
            if response.status_code == 200:
                # Login success - clear rate limit counter
                cache.delete(rate_key)
                user = response.data.get('user', {})
                user_id = user.get('id')
                LoginLog.objects.create(
                    user_id=user_id,
                    username=username,
                    status='SUCCESS',
                    ip_address=ip_address,
                    user_agent=user_agent,
                )
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
                failure_reason=str(e)[:200],
            )
            if isinstance(e, AuthenticationFailed):
                # Wrong credentials: the same `detail` as before, plus how many
                # tries this address has left before the 429 above.
                e.detail = {"detail": e.detail, "remaining_attempts": remaining}
            raise


class RefreshView(TokenRefreshView):
    """
    POST /api/v1/auth/refresh/
    Returns new access token from refresh token.

    On this app's `RefreshToken`, so a rotated 「保持登录 30 天」 token is
    issued for 30 days again rather than for SimpleJWT's default 7.
    """
    permission_classes = [AllowAny]
    serializer_class = TokenRefreshSerializer


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
    Blacklist the refresh token.
    """
    try:
        refresh_token = request.data.get("refresh")
        if refresh_token:
            token = RefreshToken(refresh_token)
            token.blacklist()
        return Response({"detail": "Logged out successfully"}, status=status.HTTP_200_OK)
    except Exception:
        return Response({"detail": "Invalid token"}, status=status.HTTP_400_BAD_REQUEST)


@extend_schema(
    request=RegisterSerializer,
    responses={
        # The created user is rendered by UserSerializer, not by the
        # RegisterSerializer that validated the input — the two differ
        # (no password out, tenant/organization refs in).
        201: UserSerializer,
        400: OpenApiTypes.OBJECT,
        429: ErrorResponseSerializer,
    },
)
@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request):
    """
    POST /api/v1/auth/register/
    Create a new user account.
    Rate limited via DRF throttle (RegisterThrottle: 5/hour per IP).
    """
    from .throttles import RegisterThrottle

    # DRF throttle check
    throttle = RegisterThrottle()
    if not throttle.allow_request(request, None):
        return Response(
            {"error": "Registration attempts too frequent, try again later"},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    serializer = RegisterSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()
        return Response(
            UserSerializer(user).data,
            status=status.HTTP_201_CREATED,
        )
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


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
    responses={200: DetailResponseSerializer},
)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    """
    POST /api/v1/auth/change-password/
    Change password — requires old password verification.
    """
    serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)

    user = request.user
    user.set_password(serializer.validated_data["new_password"])
    user.save(update_fields=["password"])

    return Response({"detail": "密码修改成功"})


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
#: decision). Officers are admin-provisioned: see `password_help_request`.
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

    email = serializer.validated_data["email"]

    # Normalised, so a case variant is not a fresh bucket. The lookup below
    # stays exact, as does the code's own key — `set_new_password` reads it
    # back under the address as typed.
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
    # `.filter().count()`, not `.get()`. `User.email` has no unique constraint
    # (it is `AbstractUser`'s, and only `username` is unique), so `.get()` raises
    # `MultipleObjectsReturned` on a duplicate — an uncaught 500. Registration is
    # `AllowAny`, so anyone could create a second account on someone else's
    # address and take that address's password reset offline permanently. Every
    # write path now refuses a duplicate (BP-04), but rows predating that are
    # still possible, so both counts stay handled here.
    #
    # Zero and many are both answered with the same success sentence as one: this
    # endpoint deliberately does not disclose whether an address is registered,
    # and "your address is ambiguous" would disclose it.
    #
    # SOUL ACCOUNTS ONLY. Email self-reset is the souls' path; officers are
    # provisioned by an administrator and use `/auth/password-help/`, which
    # pages that administrator instead. An officer's address is therefore
    # treated exactly like an unregistered one — same statements, same body —
    # so this endpoint does not become an "is this an officer?" oracle either.
    if User.objects.filter(email=email, role=SELF_RESET_ROLE).count() == 1:
        # Generate secure 6-digit code, stored in the cache with a 5-minute TTL
        code = f"{secrets.randbelow(900000) + 100000:06d}"
        cache.set(f"pwd_reset:{email}", code, timeout=300)

        # BP-12: this was a comment, so no reset could ever be completed.
        # The code goes to the mailbox only — never the log, never the
        # response. A send failure is logged without the code and answered
        # like success: a 500 only for registered addresses would disclose
        # exactly what the identical responses above exist to hide.
        try:
            send_mail(
                "SoulLedger 密码重置验证码",
                f"您的验证码: {code}\n5 分钟内有效。如非本人操作,请忽略本邮件。",
                None,
                [email],
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

    email = serializer.validated_data["email"]
    code = serializer.validated_data["code"]
    new_password = serializer.validated_data["new_password"]

    # Verify code from Redis
    from django.core.cache import cache
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
    attempts_key = f"pwd_reset_tries:{email}"
    tries = cache.get(attempts_key, 0)
    if tries >= MAX_RESET_CODE_ATTEMPTS:
        cache.delete(f"pwd_reset:{email}")
        cache.delete(attempts_key)
        # No `retry_after`: there is nothing to wait for. The code is gone and
        # only a new one (`reset-password`, itself limited) helps.
        return _reset_refusal(
            "验证码错误次数过多,请重新获取", "reset_code_attempts_exceeded", status.HTTP_429_TOO_MANY_REQUESTS
        )

    if cached_code != code:
        # `timeout` matches the code's own TTL: the counter must outlive the
        # code it guards, or a guesser could simply wait for the counter to
        # expire while the code is still valid.
        cache.set(attempts_key, tries + 1, timeout=300)
        # How many more checks this code will take: the App says 「还可以再试 N 次」.
        # Zero means the next submission, right or wrong, is `reset_code_attempts_exceeded`.
        return _reset_refusal(
            "验证码错误", "reset_code_wrong", status.HTTP_400_BAD_REQUEST,
            attempts_left=MAX_RESET_CODE_ATTEMPTS - (tries + 1),
        )

    # Correct code: the counter has no further job, and leaving it would let a
    # previous run's failures shorten the next legitimate reset.
    cache.delete(attempts_key)

    # Get user
    #
    # `MultipleObjectsReturned` must be caught alongside `DoesNotExist`: `email`
    # carries no unique constraint (see reset_password_request above). Refusing
    # is the only safe answer — with two accounts on one address there is no way
    # to know whose password this code was meant to change, and picking `.first()`
    # would hand one user's account to whoever else registered the address.
    #
    # Restricted to soul accounts like `reset_password_request`: a code that
    # somehow exists for an officer's address (one issued before this rule,
    # or planted by anything else that writes the key) must not change an
    # officer's password.
    try:
        user = User.objects.get(email=email, role=SELF_RESET_ROLE)
    except User.DoesNotExist:
        return _reset_refusal("用户不存在", "no_soul_account", status.HTTP_404_NOT_FOUND)
    except User.MultipleObjectsReturned:
        return _reset_refusal(
            "该邮箱对应多个账号,无法重置密码,请联系管理员", "ambiguous_email", status.HTTP_409_CONFLICT
        )

    # Validate password strength
    from django.contrib.auth.password_validation import validate_password
    try:
        validate_password(new_password, user)
    except Exception as e:
        return _reset_refusal(str(e), "weak_password", status.HTTP_400_BAD_REQUEST)

    # Set new password
    user.set_password(new_password)
    user.save(update_fields=["password"])
    # 「其他设备上的登录已全部退出」: every refresh token this account holds is
    # blacklisted, as when a soul sets its own password after an officer's
    # reset. An access token already issued lives out its lifetime
    # (`ACCESS_TOKEN_LIFETIME`, 30 minutes by default) and cannot be renewed.
    from apps.soul_accounts.services import _revoke_refresh_tokens

    _revoke_refresh_tokens(user)

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
        user.preferences = {**(user.preferences or {}), **serializer.validated_data}
        user.save(update_fields=["preferences"])
    return Response(UserPreferencesSerializer(_preferences_with_defaults(user)).data)


def _preferences_with_defaults(user):
    """Every declared key present, null where unset, so a client reads one shape."""
    stored = user.preferences or {}
    return {name: stored.get(name) for name in UserPreferencesSerializer().fields}
