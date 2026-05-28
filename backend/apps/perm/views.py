"""
Permission views — full CRUD for permissions and role-permission assignment
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsAdminPermission

from .models import Permission, RolePermission, Role, DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, DEFAULT_ROLES
from .serializers import (
    PermissionSerializer,
    PermissionCreateUpdateSerializer,
    RolePermissionAssignSerializer,
    RoleSerializer,
    RoleCreateUpdateSerializer,
)


def _get_role_permissions_from_db(role_name):
    """Fetch permission codenames for a role from DB, fallback to hardcoded dict."""
    role_perms = list(
        RolePermission.objects.filter(role__name=role_name)
        .select_related("permission")
        .values_list("permission__codename", flat=True)
    )
    # Use DB entries if any exist for this role, otherwise fallback to hardcoded
    if role_perms:
        return role_perms
    return ROLE_PERMISSIONS.get(role_name, [])


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


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def create_permission(request):
    """
    POST /api/v1/perm/permissions/create/
    创建新权限（仅 ADMIN）
    """
    serializer = PermissionCreateUpdateSerializer(data=request.data)
    if serializer.is_valid():
        # Check duplicate codename
        if Permission.objects.filter(codename=serializer.validated_data["codename"]).exists():
            return Response(
                {"error": "Permission with this codename already exists"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        permission = serializer.save()
        return Response(PermissionSerializer(permission).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PUT", "DELETE"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def update_delete_permission(request, pk):
    """
    PUT /api/v1/perm/permissions/<pk>/
    DELETE /api/v1/perm/permissions/<pk>/
    更新/删除权限（仅 ADMIN）
    """
    try:
        permission = Permission.objects.get(pk=pk)
    except Permission.DoesNotExist:
        return Response({"error": "Permission not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "PUT":
        serializer = PermissionCreateUpdateSerializer(permission, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(PermissionSerializer(permission).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == "DELETE":
        # Also remove all RolePermission links
        RolePermission.objects.filter(permission=permission).delete()
        permission.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_role_permissions(request):
    """
    GET /api/v1/perm/role-permissions/
    获取当前用户的角色权限（仅返回用户自己的角色）
    """
    # 仅允许用户查询自己的角色权限，防止枚举
    role = request.user.role
    permission_codenames = _get_role_permissions_from_db(role)
    permissions = Permission.objects.filter(codename__in=permission_codenames)
    serializer = PermissionSerializer(permissions, many=True)
    return Response({
        "role": role,
        "permissions": permission_codenames,
        "details": serializer.data,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def assign_role_permissions(request):
    """
    POST /api/v1/perm/role-permissions/assign/
    为角色分配权限（替换该角色的所有权限，仅 ADMIN）
    """
    serializer = RolePermissionAssignSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    role_name = serializer.validated_data["role"]
    permission_ids = serializer.validated_data["permission_ids"]

    # Look up the Role object
    try:
        role = Role.objects.get(name=role_name)
    except Role.DoesNotExist:
        return Response(
            {"error": f"Role '{role_name}' not found"},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Validate permission IDs exist
    valid_ids = set(Permission.objects.filter(id__in=permission_ids).values_list("id", flat=True))
    invalid_ids = set(permission_ids) - valid_ids
    if invalid_ids:
        return Response(
            {"error": f"Permission IDs not found: {invalid_ids}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Replace all permissions for this role
    RolePermission.objects.filter(role=role).delete()
    created = []
    for perm_id in permission_ids:
        rp = RolePermission.objects.create(role=role, permission_id=perm_id)
        created.append(rp.id)

    return Response({
        "role": role_name,
        "assigned_count": len(created),
        "permission_ids": list(valid_ids),
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def init_permissions(request):
    """
    POST /api/v1/perm/init/
    初始化默认权限（仅 ADMIN 可操作）
    """

    created_count = 0
    for codename, name, category in DEFAULT_PERMISSIONS:
        perm, created = Permission.objects.get_or_create(
            codename=codename,
            defaults={"name": name, "category": category},
        )
        if created:
            created_count += 1

    return Response({
        "message": f"Initialized {created_count} permissions",
        "total": Permission.objects.count(),
    })


# ── Role CRUD ────────────────────────────────────────────────────────────


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_roles(request):
    """
    GET /api/v1/perm/roles/
    获取所有角色列表
    """
    roles = Role.objects.all()
    serializer = RoleSerializer(roles, many=True)
    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def create_role(request):
    """
    POST /api/v1/perm/roles/create/
    创建新角色（仅 ADMIN）
    """
    serializer = RoleCreateUpdateSerializer(data=request.data)
    if serializer.is_valid():
        if Role.objects.filter(name=serializer.validated_data["name"]).exists():
            return Response(
                {"error": "Role with this name already exists"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        role = serializer.save()
        return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PUT", "DELETE"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def update_delete_role(request, pk):
    """
    PUT /api/v1/perm/roles/<pk>/
    DELETE /api/v1/perm/roles/<pk>/
    更新/删除角色（仅 ADMIN）
    """
    try:
        role = Role.objects.get(pk=pk)
    except Role.DoesNotExist:
        return Response({"error": "Role not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "PUT":
        serializer = RoleCreateUpdateSerializer(role, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(RoleSerializer(role).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == "DELETE":
        # Also remove all RolePermission links (use Role object, not role.name string)
        RolePermission.objects.filter(role=role).delete()
        role.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def init_roles(request):
    """
    POST /api/v1/perm/roles/init/
    初始化默认角色（仅 ADMIN）
    """

    created_count = 0
    for name, display_name in DEFAULT_ROLES:
        role, created = Role.objects.get_or_create(
            name=name,
            defaults={"display_name": display_name},
        )
        if created:
            created_count += 1

    return Response({
        "message": f"Initialized {created_count} roles",
        "total": Role.objects.count(),
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def init_role_permissions(request):
    """
    POST /api/v1/perm/role-permissions/init/
    根据 ROLE_PERMISSIONS 字典为所有角色分配权限（仅 ADMIN）
    """

    # First ensure all permissions exist
    perm_count_before = Permission.objects.count()
    for codename, name, category in DEFAULT_PERMISSIONS:
        Permission.objects.get_or_create(
            codename=codename,
            defaults={"name": name, "category": category},
        )

    # Clean up phantom permissions (test entries)
    Permission.objects.filter(codename__startswith='test.').delete()

    perm_count_after = Permission.objects.count()

    # Assign permissions to roles based on ROLE_PERMISSIONS
    results = {}
    for role_name, perm_codenames in ROLE_PERMISSIONS.items():
        role = Role.objects.filter(name=role_name).first()
        if not role:
            results[role_name] = f"Role not found"
            continue

        # Get permission objects
        perms = Permission.objects.filter(codename__in=perm_codenames)
        perm_ids = list(perms.values_list('id', flat=True))

        # Remove existing and create new
        RolePermission.objects.filter(role=role).delete()
        created = []
        for perm_id in perm_ids:
            rp = RolePermission.objects.create(role=role, permission_id=perm_id)
            created.append(rp.id)

        results[role_name] = f"Assigned {len(created)} permissions"

    return Response({
        "message": "Role permissions initialized",
        "permissions_added": perm_count_after - perm_count_before,
        "permissions_total": perm_count_after,
        "roles": results,
    })


# ── Permission Export/Import ────────────────────────────────────────────


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def export_permissions(request):
    """
    GET /api/v1/perm/export/
    导出所有权限配置为 JSON（仅 ADMIN）
    """
    from .export import export_permissions_json_response
    return export_permissions_json_response()


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def import_permissions(request):
    """
    POST /api/v1/perm/import/
    导入权限配置（仅 ADMIN）
    Body: JSON from export endpoint
    """
    from .export import import_permissions as do_import

    data = request.data
    if not data:
        return Response(
            {"error": "No data provided"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    overwrite = request.data.get('overwrite', False)
    stats = do_import(data, overwrite=overwrite)

    return Response({
        "message": "Permissions imported successfully",
        "stats": stats,
    })
