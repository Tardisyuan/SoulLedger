"""
Permission views
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Permission, RolePermission, DEFAULT_PERMISSIONS, ROLE_PERMISSIONS
from .serializers import PermissionSerializer


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_permissions(request):
    """
    GET /api/v1/perm/permissions/
    获取所有权限列表
    """
    permissions = Permission.objects.all()
    serializer = PermissionSerializer(permissions, many=True)
    return Response(serializer.data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_role_permissions(request):
    """
    GET /api/v1/perm/role-permissions/?role=ADMIN
    获取指定角色的权限列表
    """
    role = request.query_params.get("role", request.user.role)
    if role not in ROLE_PERMISSIONS:
        return Response(
            {"error": f"Invalid role: {role}"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # 获取该角色的所有权限 codename
    permission_codenames = ROLE_PERMISSIONS.get(role, [])
    permissions = Permission.objects.filter(codename__in=permission_codenames)
    serializer = PermissionSerializer(permissions, many=True)

    return Response({
        "role": role,
        "permissions": [p.codename for p in permissions],
        "details": serializer.data
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def init_permissions(request):
    """
    POST /api/v1/perm/init/
    初始化默认权限（仅 ADMIN 可操作）
    """
    if request.user.role != "ADMIN":
        return Response(
            {"error": "Only ADMIN can initialize permissions"},
            status=status.HTTP_403_FORBIDDEN
        )

    created_count = 0
    for codename, name, category in DEFAULT_PERMISSIONS:
        perm, created = Permission.objects.get_or_create(
            codename=codename,
            defaults={"name": name, "category": category}
        )
        if created:
            created_count += 1

    return Response({
        "message": f"Initialized {created_count} permissions",
        "total": Permission.objects.count()
    })
