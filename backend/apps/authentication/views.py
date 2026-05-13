"""
Auth views: register, login, logout, profile.
"""
import logging
from django.contrib.auth import get_user_model
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

User = get_user_model()
logger = logging.getLogger(__name__)

from .serializers import (
    RegisterSerializer,
    UserSerializer,
    CustomTokenObtainPairSerializer,
    ChangePasswordSerializer,
    ResetPasswordSerializer,
    SetNewPasswordSerializer,
    UserManagementSerializer,
    UserCreateSerializer,
    UserUpdateSerializer,
    LoginLogSerializer,
)
from apps.core.permissions import TenantPermission


# ---------------------------------------------------------------------------
# User Management ViewSet (Tenant Admin)
# ---------------------------------------------------------------------------


class UserViewSet(viewsets.ModelViewSet):
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
    permission_classes = [TenantPermission]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        if self.action in ['update', 'partial_update']:
            return UserUpdateSerializer
        return UserManagementSerializer

    def check_permissions(self, request):
        """Only ADMIN users can access user management endpoints."""
        # Call parent first to check base permissions (IsAuthenticated, etc.)
        super().check_permissions(request)
        # Then check role-based permission
        if getattr(request.user, 'role', None) != 'ADMIN':
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Only ADMIN users can manage users")

    def get_queryset(self):
        qs = User.objects.select_related('tenant').all()
        user = self.request.user
        # Non-ADMIN users cannot access user management (handled in check_permissions)
        if getattr(user, 'role', None) != 'ADMIN':
            return qs.none()
        # ADMIN users see all users in their tenant
        tenant = getattr(self.request, 'tenant', None)
        if tenant:
            qs = qs.filter(tenant=tenant)
        else:
            return qs.none()

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
        import secrets
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
        valid_roles = ['ADMIN', 'JUDGE', 'GUARDIAN', 'VIEWER']
        if new_role not in valid_roles:
            return Response(
                {'error': f'Invalid role. Must be one of: {valid_roles}'},
                status=status.HTTP_400_BAD_REQUEST
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

                if role not in ['ADMIN', 'JUDGE', 'GUARDIAN', 'VIEWER']:
                    errors.append(f"Row {i+2}: invalid role '{role}'")
                    continue

                if User.objects.filter(username=username, tenant=tenant).exists():
                    errors.append(f"Row {i+2}: username '{username}' already exists")
                    continue

                User.objects.create_user(
                    username=username,
                    email=email,
                    password=password or 'ChangeMe123!',
                    role=role,
                    tenant=tenant,
                )
                created += 1
            except Exception as e:
                errors.append(f"Row {i+2}: {str(e)}")

        return Response({
            'created': created,
            'errors': errors[:50],  # Limit error messages
        })


# ---------------------------------------------------------------------------
# Login Logs ViewSet (Tenant Admin)
# ---------------------------------------------------------------------------


class LoginLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    登录日志 API

    仅 ADMIN 角色可访问，只读的登录日志查询接口。

    Endpoints:
        GET /api/v1/login-logs/        - 获取登录日志列表
        GET /api/v1/login-logs/{id}/   - 获取登录日志详情
    """
    permission_classes = [TenantPermission]
    serializer_class = LoginLogSerializer

    def check_permissions(self, request):
        super().check_permissions(request)
        if getattr(request.user, 'role', None) != 'ADMIN':
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Only ADMIN users can view login logs")

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
    """Extract client IP from request, handling proxies."""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', None)


class LoginView(TokenObtainPairView):
    """
    POST /api/v1/auth/login/
    Returns access + refresh tokens with tenant info.
    Logs login success/failure to LoginLog.
    """
    serializer_class = CustomTokenObtainPairSerializer
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
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
    """
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
        return Response(UserSerializer(request.user).data)
    elif request.method == "PATCH":
        serializer = UserSerializer(request.user, data=request.data, partial=True)
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
        user = User.objects.get(email=email)
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

    # Generate secure code (8 digits)
    import secrets
    code = str(secrets.randbelow(90000000) + 10000000)

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
