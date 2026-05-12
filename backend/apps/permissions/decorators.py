"""
API 权限装饰器 - 基于 SoulLedger RBAC 权限系统
"""
from functools import wraps
from rest_framework import status
from rest_framework.response import Response


def require_api_permission(permission_code: str):
    """
    API 权限检查装饰器

    用法:
    @require_api_permission('soul.create')
    def post(self, request):
        ...

    注意: 此装饰器适用于 DRF ViewSet 的 action 方法 (如 @action 装饰的方法)
    对于类级别的权限控制，请使用 permission_classes
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(view_instance, request, *args, **kwargs):
            user = getattr(request, 'user', None)

            if not user or not getattr(user, 'is_authenticated', False):
                return Response(
                    {'detail': '认证失败'},
                    status=status.HTTP_401_UNAUTHORIZED
                )

            if not check_api_permission(user, permission_code):
                return Response(
                    {'detail': f'权限不足: {permission_code}'},
                    status=status.HTTP_403_FORBIDDEN
                )

            return view_func(view_instance, request, *args, **kwargs)
        return wrapper
    return decorator


def check_api_permission(user, permission_code: str) -> bool:
    """
    检查用户是否有特定 API 权限

    检查顺序:
    1. ADMIN 角色拥有所有权限
    2. RolePermission 表中的权限
    3. ROLE_PERMISSIONS 字典中的默认权限
    """
    # ADMIN 拥有所有权限
    if getattr(user, 'role', None) == 'ADMIN':
        return True

    # 检查 RolePermission 表
    user_role = getattr(user, 'role', None)
    if not user_role:
        return False

    try:
        from apps.perm.models import RolePermission
        has_perm = RolePermission.objects.filter(
            role=user_role,
            permission__codename=permission_code
        ).exists()
        if has_perm:
            return True
    except Exception:
        pass

    # 检查 ROLE_PERMISSIONS 字典
    from apps.perm.models import ROLE_PERMISSIONS
    if permission_code in ROLE_PERMISSIONS.get(user_role, []):
        return True

    return False