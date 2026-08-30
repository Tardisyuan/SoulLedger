"""
Permission views — full CRUD for permissions and role-permission assignment
"""
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

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


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def init_permissions(request):
    """
    POST /api/v1/perm/init/
    初始化默认权限（仅 ADMIN 可操作）

    Seeding a Permission row is not a neutral act. `check_permission`
    (apps/perm/checker.py) treats the database as authoritative *iff* a row for
    that codename exists, and otherwise falls back to the ROLE_PERMISSIONS
    dict. So creating a row without also creating the RolePermission grants
    flips that codename from "granted by the dict" to "seeded but ungranted" --
    which reads as denied.

    That is what this endpoint used to do. Measured on a freshly migrated
    database, 2026-08-29:

        Permission rows after migrate: 8   (DEFAULT_PERMISSIONS has 46)
        POST /perm/init/  ->  200 {"message": "Initialized 38 permissions"}
        JUDGE     lost 17 grants  (incl. soul.read, soul.die, judgment.create)
        GUARDIAN  lost 14
        MODERATOR lost 30
        VIEWER    lost  8         (incl. soul.read)
        total role-codename grants revoked: 69

    and the response says success.

    Migration 0017_seed_roles_and_grants names this failure mode verbatim in
    its own docstring -- 「已播种但未授权 = 拒绝」-- and *deliberately refuses*
    to seed the whole catalogue for exactly this reason. This endpoint did the
    refused thing. The comment that used to sit below the loop even said "Every
    codename seeded here just moved to check_permission's DB branch": the
    mechanism was seen and only the cache was invalidated.

    The fix is additive, not a delegation to `init_role_permissions`. That
    endpoint clears every existing grant and rebuilds from the dict, which is
    correct for what it is called for and would be a second, different kind of
    destruction here -- an operator asking to "initialize permissions" has not
    asked to discard grants made through the UI. So: seed the rows, then
    materialize exactly the grants the dict branch was already answering for
    the codenames that just moved. Nothing is removed.
    """

    created_count = 0
    newly_seeded = []
    for codename, name, category in DEFAULT_PERMISSIONS:
        perm, created = Permission.objects.get_or_create(
            codename=codename,
            defaults={"name": name, "category": category},
        )
        if created:
            created_count += 1
            newly_seeded.append(perm)

    # Materialize the grants that were being answered by the dict branch for
    # the codenames that just moved to the DB branch. Only for those: a
    # codename whose row already existed was already DB-authoritative, and
    # re-adding grants for it would resurrect anything an operator revoked.
    granted_count = 0
    if newly_seeded:
        by_codename = {perm.codename: perm for perm in newly_seeded}
        for role_name, perm_codenames in ROLE_PERMISSIONS.items():
            role = Role.objects.filter(name=role_name).first()
            if role is None:
                continue
            wanted = [
                by_codename[codename]
                for codename in perm_codenames
                if codename in by_codename
            ]
            if not wanted:
                continue
            already = set(
                RolePermission.objects.filter(
                    role=role, permission__in=wanted
                ).values_list("permission_id", flat=True)
            )
            to_create = [
                RolePermission(role=role, permission=perm)
                for perm in wanted
                if perm.pk not in already
            ]
            if to_create:
                RolePermission.objects.bulk_create(to_create)
                granted_count += len(to_create)

    # bulk_create does not fire post_save, so the signal-based invalidation in
    # apps/audit/signals.py never sees these — invalidate explicitly.
    invalidate_all_permissions()

    return Response({
        "message": f"Initialized {created_count} permissions",
        "total": Permission.objects.count(),
        # Reported so an operator can see that seeding a row also had to write
        # grants. A response that named only the rows is what made the
        # revocation invisible.
        "grants_materialized": granted_count,
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
