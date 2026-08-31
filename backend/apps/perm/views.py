"""
Permission views — full CRUD for permissions and role-permission assignment
"""
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.client_ip import get_client_ip
from apps.core.permissions import IsAdminPermission
from apps.perm.cache import invalidate_all_permissions, invalidate_role_permissions
from apps.perm.services import get_role_permission_codenames

from .models import DEFAULT_PERMISSIONS, DEFAULT_ROLES, ROLE_PERMISSIONS, Permission, Role, RolePermission
from .serializers import (
    PermissionCreateUpdateSerializer,
    PermissionSerializer,
    RoleCreateUpdateSerializer,
    RolePermissionAssignSerializer,
    RoleSerializer,
)

# The resolution itself lives in apps/perm/services.py, because the login
# serializer needs the same answer and a serializer should not be importing a
# private helper out of a views module. Kept as a name here so the two
# endpoints below read the same as they did.
_get_role_permissions_from_db = get_role_permission_codenames


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
        # Creating a Permission row moves its codename from the dict branch of
        # check_permission to the DB branch — the answer changes without any
        # Role or RolePermission being touched, so the signal in
        # apps/audit/signals.py does not fire. See assign_role_permissions.
        invalidate_all_permissions()
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
            # A renamed codename is a new codename to check_permission, and the
            # old one falls back to the dict again. See assign_role_permissions.
            invalidate_all_permissions()
            return Response(PermissionSerializer(permission).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == "DELETE":
        # Also remove all RolePermission links
        RolePermission.objects.filter(permission=permission).delete()
        permission.delete()
        # Deleting the Permission row hands the codename back to the dict.
        invalidate_all_permissions()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_role_permissions(request):
    """
    GET /api/v1/perm/role-permissions/
    获取当前用户的角色权限（仅返回用户自己的角色）
    """
    # 只返回请求者自己那一份 —— 但**这句话过去写的是「防止枚举」,而同一个前缀下
    # 有两个端点把那个说法拆掉了一半**:`list_permissions` 与 `list_roles` 都是
    # `[IsAuthenticated]`,任何登录用户(含 VIEWER)拿得到全部 codename 目录和全部
    # 角色名。
    #
    # 重新核过之后,真正的边界在这里,而它是成立的:**授权**(哪个角色有哪些
    # codename)只有两条读取路径 —— 这一条(只给自己)和
    # `get_permissions_for_role`(只给 ADMIN)。`RoleSerializer` 没有
    # `permissions` 字段,`list_permissions` 返回的是 codename 目录本身。
    #
    # 所以对非 ADMIN 泄漏的是**目录**,不是**授权**:codename 有哪些、角色叫什么、
    # 每个角色有多少人(`user_count`)。那是个刻意的产品决定还是没人想过,
    # 现在由 `tests/test_perm_prefix_discloses_only_the_catalogue.py` 钉住 ——
    # 一句注释是一次没被执行的断言,而上一句就是这样错了很久的。
    role = request.user.role
    permission_codenames = _get_role_permissions_from_db(role)
    permissions = Permission.objects.filter(codename__in=permission_codenames)
    serializer = PermissionSerializer(permissions, many=True)
    return Response({
        "role": role,
        "permissions": permission_codenames,
        "details": serializer.data,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def get_permissions_for_role(request, name):
    """
    GET /api/v1/perm/roles/<name>/permissions/
    读取指定角色的权限（仅 ADMIN）。

    get_role_permissions 只返回请求者自己的角色，用来防止普通用户枚举其他
    角色的权限。但管理界面需要「选中某个角色 → 查看并编辑它的权限」，而
    assign_role_permissions 本来就允许 ADMIN 改任意角色 —— 能写不能读讲不通，
    所以这里给 ADMIN 开一个对应的读取入口，枚举防护对非 ADMIN 保持不变。

    响应结构与 get_role_permissions 一致，前端两处可以共用同一个解析。
    """
    if not Role.objects.filter(name=name).exists():
        return Response(
            {"detail": f"Role '{name}' not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    permission_codenames = _get_role_permissions_from_db(name)
    permissions = Permission.objects.filter(codename__in=permission_codenames)
    serializer = PermissionSerializer(permissions, many=True)
    return Response({
        "role": name,
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
    expected_version = serializer.validated_data.get("expected_version")

    # select_for_update: the version check below and the replace-write it
    # guards have to be one atomic unit, or two concurrent requests that both
    # read the same version race each other into the check and both pass it.
    # A plain .get() would leave that window open even with expected_version
    # present.
    with transaction.atomic():
        try:
            role = Role.objects.select_for_update().get(name=role_name)
        except Role.DoesNotExist:
            return Response(
                {"error": f"Role '{role_name}' not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if expected_version is not None and role.version != expected_version:
            # 409, not 400: the request itself is well-formed, it's the
            # server's state that has moved since the client loaded it —
            # someone else's assign call landed first. Return the current
            # version so the client can reload and show the operator what
            # changed rather than just retrying blind.
            return Response(
                {
                    "error": "Role has been modified since it was loaded.",
                    "expected_version": expected_version,
                    "current_version": role.version,
                },
                status=status.HTTP_409_CONFLICT,
            )

        # Validate permission IDs exist
        valid_ids = set(Permission.objects.filter(id__in=permission_ids).values_list("id", flat=True))
        invalid_ids = set(permission_ids) - valid_ids
        if invalid_ids:
            return Response(
                {"error": f"Permission IDs not found: {invalid_ids}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Both sets, before anything is touched. They are written to a single
        # PERMISSION_CHANGE audit row below.
        #
        # WHY HERE AND NOT IN A SIGNAL. The `.delete()` on the next line fires
        # post_delete per row, and each of those does produce a
        # PERMISSION_CHANGE entry saying that grant was revoked. `bulk_create`
        # two lines further down sends **no post_save at all**, so nothing
        # records the grants. Measured end to end: a role holding
        # {asg.0, asg.1, asg.2}, assigned {asg.0} -- keeping one, dropping two:
        #
        #     PC rolepermission 20 {'permissions': {'old': ['asg.0'], 'new': []}}
        #     PC rolepermission 21 {'permissions': {'old': ['asg.1'], 'new': []}}
        #     PC rolepermission 22 {'permissions': {'old': ['asg.2'], 'new': []}}
        #
        # **Three revocations and no grant.** Anyone reading
        # `/audit-logs/timeline/` sees a role stripped bare, when in fact it
        # kept one of the three. The per-row entries are not wrong, they are
        # half of a replacement, and the half that survives is the alarming one.
        #
        # `_invalidate_permission_cache`'s Role branch cannot supply the other
        # half either -- see its comment. This function is the only place that
        # holds both sets at once.
        codenames_before = sorted(
            RolePermission.objects.filter(role=role).values_list(
                "permission__codename", flat=True
            )
        )
        codenames_after = sorted(
            Permission.objects.filter(id__in=permission_ids).values_list(
                "codename", flat=True
            )
        )

        # Replace all permissions for this role
        RolePermission.objects.filter(role=role).delete()
        to_create = [RolePermission(role=role, permission_id=pid) for pid in permission_ids]
        created = RolePermission.objects.bulk_create(to_create)

        # bulk_create sends no post_save, so _invalidate_permission_cache in
        # apps/audit/signals.py — which is what normally keeps check_permission
        # honest after a grant changes — never runs for the rows created here. The
        # .delete() above does fire post_delete and would have covered the common
        # case by accident, but not for a role that had no grants yet: its cache
        # would keep denying the codenames just granted for the rest of the 300s
        # TTL. That was invisible while _get_role_permissions_from_db read the
        # database directly; now that it reads through check_permission, the
        # admin's own role editor would show the stale answer straight back.
        invalidate_role_permissions(role_name)

        if codenames_before != codenames_after:
            from apps.audit.models import AuditAction, AuditLog

            AuditLog.objects.create(
                tenant=getattr(request, "tenant", None),
                user=request.user if request.user.is_authenticated else None,
                action=AuditAction.PERMISSION_CHANGE,
                resource="role",
                resource_id=str(role.pk),
                changes={
                    "permissions": {"old": codenames_before, "new": codenames_after}
                },
                description=f"Role {role_name} permissions replaced"[:500],
                ip_address=get_client_ip(request),
                user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
            )

        # save() (apps/core/models.py::AuditUserFields) increments `version`
        # on every update — this call is what advances it, so the response
        # below reports the version the client should send next, not the one
        # it just checked against.
        role.save()

    return Response({
        "role": role_name,
        "assigned_count": len(created),
        "permission_ids": list(valid_ids),
        "version": role.version,
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
            results[role_name] = "Role not found"
            continue

        # Get permission objects
        perms = Permission.objects.filter(codename__in=perm_codenames)
        perm_ids = list(perms.values_list('id', flat=True))

        # Remove existing and create new
        RolePermission.objects.filter(role=role).delete()
        to_create = [RolePermission(role=role, permission_id=pid) for pid in perm_ids]
        created = RolePermission.objects.bulk_create(to_create)

        results[role_name] = f"Assigned {len(created)} permissions"

    # Seeds Permission rows and bulk_creates grants — neither reaches the
    # invalidation signal. See assign_role_permissions.
    invalidate_all_permissions()

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

    # An import rewrites permissions and grants wholesale.
    invalidate_all_permissions()

    return Response({
        "message": "Permissions imported successfully",
        "stats": stats,
    })
