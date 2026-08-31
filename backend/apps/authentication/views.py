"""
Auth views: register, login, logout, profile.
"""
import logging
import secrets

from django.contrib.auth import get_user_model
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

User = get_user_model()
logger = logging.getLogger(__name__)

from apps.authentication.models import UserRole
from apps.core.permissions import IsAdminPermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin

from .serializers import (
    ChangePasswordSerializer,
    CustomTokenObtainPairSerializer,
    LoginLogSerializer,
    RegisterSerializer,
    ResetPasswordSerializer,
    SetNewPasswordSerializer,
    UserCreateSerializer,
    UserManagementSerializer,
    UserSerializer,
    UserUpdateSerializer,
    role_rank,
)

# ---------------------------------------------------------------------------
# User Management ViewSet (Tenant Admin)
# ---------------------------------------------------------------------------


class UserViewSet(CodenameViewSetMixin, viewsets.ModelViewSet):
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
        qs = User.objects.select_related('tenant').all()

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

    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        """重置用户密码，返回随机生成的新密码"""
        user = self.get_object()
        new_password = secrets.token_urlsafe(12)
        user.set_password(new_password)
        user.save(update_fields=['password'])
        return Response({'password': new_password})

    @action(detail=False, methods=['post'])
    def batch_activate(self, request):
        """批量激活用户"""
        user_ids = request.data.get('user_ids', [])
        if not user_ids:
            return Response({'error': 'user_ids is required'}, status=status.HTTP_400_BAD_REQUEST)
        updated = User.objects.filter(id__in=user_ids, tenant=self.request.tenant).update(is_active=True)
        return Response({'updated': updated})

    @action(detail=False, methods=['post'])
    def batch_deactivate(self, request):
        """批量停用用户"""
        user_ids = request.data.get('user_ids', [])
        if not user_ids:
            return Response({'error': 'user_ids is required'}, status=status.HTTP_400_BAD_REQUEST)
        updated = User.objects.filter(id__in=user_ids, tenant=self.request.tenant).update(is_active=False)
        return Response({'updated': updated})

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
        # Derived, not restated. This list and its twin below were two
        # hand-written copies of UserRole that both missed MODERATOR, so a
        # role the permission layer fully honoured could not be assigned
        # through any API path.
        valid_roles = list(UserRole.values)
        if new_role not in valid_roles:
            return Response(
                {'error': f'Invalid role. Must be one of: {valid_roles}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        # Prevent privilege escalation: assigning user's role must be >= target role.
        # Shares apps/authentication/serializers.py's ROLE_HIERARCHY so this
        # stays in sync with the same check applied on create/update.
        caller_role = getattr(request.user, 'role', None)
        if caller_role != 'ADMIN' and role_rank(caller_role) > role_rank(new_role):
            return Response(
                {'error': 'Cannot assign a role more privileged than your own'},
                status=status.HTTP_403_FORBIDDEN,
            )
        user.role = new_role
        user.save(update_fields=['role'])
        return Response(UserManagementSerializer(user).data)

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
                user.username,
                user.email,
                user.role,
                user.is_active,
                user.tenant.code if user.tenant else '',
                user.create_time.isoformat() if hasattr(user, 'create_time') else '',
            ])
        return response

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

                if role not in UserRole.values:
                    errors.append(f"Row {i+2}: invalid role '{role}'")
                    continue

                if User.objects.filter(username=username, tenant=tenant).exists():
                    errors.append(f"Row {i+2}: username '{username}' already exists")
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

    def post(self, request, *args, **kwargs):
        # Set request context for audit logging before any database operations
        from apps.core.request_local import set_current_request
        set_current_request(request)

        # Login rate limiting: max 5 attempts per 15 minutes per IP
        ip_address = _get_client_ip(request)
        from django.core.cache import cache
        rate_key = f"login_rate:{ip_address}"
        attempts = cache.get(rate_key, 0)
        if attempts >= 5:
            return Response({"error": "登录尝试过于频繁，请15分钟后再试"}, status=status.HTTP_429_TOO_MANY_REQUESTS)

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
                cache.set(rate_key, attempts + 1, timeout=900)
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
            cache.set(rate_key, attempts + 1, timeout=900)
            LoginLog.objects.create(
                username=username,
                status='FAILED',
                ip_address=ip_address,
                user_agent=user_agent,
                failure_reason=str(e)[:200],
            )
            raise


class RefreshView(TokenRefreshView):
    """
    POST /api/v1/auth/refresh/
    Returns new access token from refresh token.
    """
    permission_classes = [AllowAny]


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


@api_view(["POST"])
@permission_classes([AllowAny])
def reset_password_request(request):
    """
    POST /api/v1/auth/reset-password/
    Forgot password — generate 6-digit code and send to email.
    Stores code in Redis cache with 5-minute TTL.
    """
    serializer = ResetPasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    email = serializer.validated_data["email"]

    # Check if user exists (but always return success for security)
    try:
        User.objects.get(email=email)
    except User.DoesNotExist:
        # Security: return success even if user doesn't exist
        return Response({"detail": "验证码已发送到邮箱"})

    # Rate limiting: max 3 requests per 5 minutes per email
    from django.core.cache import cache
    rate_limit_key = f"pwd_reset_rate:{email}"
    attempts = cache.get(rate_limit_key, 0)
    if attempts >= 3:
        return Response({"error": "请求过于频繁，请稍后再试"}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(rate_limit_key, attempts + 1, timeout=300)

    # Generate secure 6-digit code
    code = f"{secrets.randbelow(900000) + 100000:06d}"

    # Store in Redis cache, 5 minutes TTL
    cache.set(f"pwd_reset:{email}", code, timeout=300)

    # In production, send email here (DO NOT log the code):
    # send_mail("密码重置验证码", f"您的验证码: {code}", ...)

    return Response({"detail": "验证码已发送到邮箱"})


@api_view(["POST"])
@permission_classes([AllowAny])
def set_new_password(request):
    """
    POST /api/v1/auth/set-new-password/
    Set new password via email + verification code from Redis.
    """
    serializer = SetNewPasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    email = serializer.validated_data["email"]
    code = serializer.validated_data["code"]
    new_password = serializer.validated_data["new_password"]

    # Verify code from Redis
    from django.core.cache import cache
    cached_code = cache.get(f"pwd_reset:{email}")

    if cached_code is None:
        return Response({"error": "验证码已过期,请重新获取"}, status=status.HTTP_400_BAD_REQUEST)

    if cached_code != code:
        return Response({"error": "验证码错误"}, status=status.HTTP_400_BAD_REQUEST)

    # Get user
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return Response({"error": "用户不存在"}, status=status.HTTP_404_NOT_FOUND)

    # Validate password strength
    from django.contrib.auth.password_validation import validate_password
    try:
        validate_password(new_password, user)
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    # Set new password
    user.set_password(new_password)
    user.save(update_fields=["password"])

    # Invalidate the code
    cache.delete(f"pwd_reset:{email}")

    return Response({"detail": "密码重置成功"})
