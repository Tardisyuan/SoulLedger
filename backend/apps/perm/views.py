"""
Permission views — full CRUD for permissions and role-permission assignment
"""
from django.db import transaction
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.client_ip import get_client_ip
from apps.core.permissions import IsAdminPermission
from apps.core.schema import DetailResponseSerializer, ErrorResponseSerializer
from apps.perm.cache import invalidate_all_permissions, invalidate_role_permissions
from apps.perm.matrix import ADMIN_ONLY_PERMISSION, admin_only_violations
from apps.perm.services import get_role_permission_codenames

from .models import DEFAULT_PERMISSIONS, DEFAULT_ROLES, ROLE_PERMISSIONS, Permission, Role, RolePermission
from .serializers import (
    InitRolePermissionsResultSerializer,
    InitRolesResultSerializer,
    MatrixChangesRequestSerializer,
    MatrixChangesResultSerializer,
    MatrixImpactResultSerializer,
    PermissionCreateUpdateSerializer,
    PermissionExportSerializer,
    PermissionImportRequestSerializer,
    PermissionImportResultSerializer,
    PermissionSerializer,
    RoleCreateUpdateSerializer,
    RoleDeleteRefusalSerializer,
    RolePermissionAssignResultSerializer,
    RolePermissionAssignSerializer,
    RolePermissionsSerializer,
    RoleSerializer,
    RoleVersionConflictSerializer,
)

# The resolution itself lives in apps/perm/services.py, because the login
# serializer needs the same answer and a serializer should not be importing a
# private helper out of a views module. Kept as a name here so the two
# endpoints below read the same as they did.
_get_role_permissions_from_db = get_role_permission_codenames


@extend_schema(request=None, responses={200: PermissionSerializer(many=True)})
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


@extend_schema(
    request=PermissionCreateUpdateSerializer,
    responses={
        # PermissionSerializer, not the create serializer: the response adds
        # `id`, which is the only thing the caller cannot already know.
        201: PermissionSerializer,
        # Two different 400s share this slot — a duplicate codename answers
        # {"error": ...} and a validation failure answers DRF's field-keyed
        # {"codename": [...]}. Documented as the former because it is the one
        # this view writes itself; see OpenApiTypes.OBJECT on register_view
        # for the other shape.
        400: ErrorResponseSerializer,
    },
)
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
        codename = serializer.validated_data["codename"]
        if Permission.objects.filter(codename=codename).exists():
            return Response(
                {"error": "Permission with this codename already exists"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Permission is not in the recycle bin, so re-creating a deleted
        # codename IS its restore path: revive the row and apply the new
        # name/category, rather than shadowing it with a twin.
        binned = (
            Permission.all_objects.filter(codename=codename, is_deleted=True)
            .order_by("-deleted_at")
            .first()
        )
        if binned is not None:
            binned.restore()
            serializer = PermissionCreateUpdateSerializer(binned, data=request.data)
            serializer.is_valid(raise_exception=True)
        permission = serializer.save()
        # Creating a Permission row moves its codename from the dict branch of
        # check_permission to the DB branch — the answer changes without any
        # Role or RolePermission being touched, so the signal in
        # apps/audit/signals.py does not fire. See assign_role_permissions.
        invalidate_all_permissions()
        return Response(PermissionSerializer(permission).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@extend_schema(
    methods=["PUT"],
    request=PermissionCreateUpdateSerializer,
    responses={200: PermissionSerializer, 400: OpenApiTypes.OBJECT, 404: ErrorResponseSerializer},
)
@extend_schema(
    methods=["DELETE"],
    request=None,
    responses={204: None, 404: ErrorResponseSerializer},
)
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


@extend_schema(request=None, responses={200: RolePermissionsSerializer})
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


@extend_schema(
    request=None,
    responses={
        200: RolePermissionsSerializer,
        # `detail`, not `error`. This endpoint is the odd one out in this
        # module and the document has to say so rather than smoothing it over.
        404: DetailResponseSerializer,
    },
)
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


@extend_schema(
    request=RolePermissionAssignSerializer,
    responses={
        200: RolePermissionAssignResultSerializer,
        400: OpenApiTypes.OBJECT,
        404: ErrorResponseSerializer,
        409: RoleVersionConflictSerializer,
    },
)
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

        refused = admin_only_violations(
            role.name, Permission.objects.filter(id__in=permission_ids).values_list("codename", flat=True)
        )
        if refused:
            return Response(
                {"error": f"{', '.join(sorted(refused))} can only be granted to ADMIN",
                 "code": ADMIN_ONLY_PERMISSION},
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


@extend_schema(request=None, responses={200: RoleSerializer(many=True)})
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_roles(request):
    """
    GET /api/v1/perm/roles/
    获取所有角色列表
    """
    from django.db.models import Count, IntegerField, OuterRef, Q, Subquery
    from django.db.models.functions import Coalesce

    from apps.authentication.models import User

    from .matrix import role_template_references

    holders = (
        User.objects.filter(role=OuterRef("name")).order_by()
        .values("role").annotate(n=Count("pk")).values("n")
    )
    roles = Role.objects.annotate(
        permission_count_annotated=Count("permissions", filter=Q(permissions__is_deleted=False)),
        member_count_annotated=Coalesce(Subquery(holders, output_field=IntegerField()), 0),
    )
    serializer = RoleSerializer(
        roles, many=True, context={"template_refs": role_template_references()}
    )
    return Response(serializer.data)


@extend_schema(
    request=RoleCreateUpdateSerializer,
    responses={201: RoleSerializer, 400: ErrorResponseSerializer},
)
@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def create_role(request):
    """
    POST /api/v1/perm/roles/create/
    创建新角色（仅 ADMIN）
    """
    serializer = RoleCreateUpdateSerializer(data=request.data)
    if serializer.is_valid():
        taken = _role_name_taken(serializer.validated_data["name"])
        if taken:
            return Response({"error": taken}, status=status.HTTP_400_BAD_REQUEST)
        role = serializer.save()
        return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


def _role_name_taken(name):
    """Why `name` cannot be given to a role right now, or None.

    A live row is the obvious case. A binned row is the other: the conditional
    constraint would allow a twin, but the twin and the original collide the
    moment someone restores from the bin — so point at the bin instead.
    Unlike Permission, Role IS in the bin (apps/perm/apps.py), so an admin
    who wants the old grants back has a path, and one who does not can hard
    delete after the retention window.
    """
    if name == "SOUL":
        return "'SOUL' is reserved for soul accounts and cannot be a role table row"
    if Role.objects.filter(name=name).exists():
        return "Role with this name already exists"
    if Role.all_objects.filter(name=name, is_deleted=True).exists():
        return (
            f"A deleted role named '{name}' is in the recycle bin; restore it from "
            "there (or hard-delete it) instead of creating a second one."
        )
    return None


@extend_schema(
    methods=["PUT"],
    request=RoleCreateUpdateSerializer,
    responses={200: RoleSerializer, 400: OpenApiTypes.OBJECT, 404: ErrorResponseSerializer},
)
@extend_schema(
    methods=["DELETE"],
    request=None,
    responses={204: None, 400: RoleDeleteRefusalSerializer, 404: ErrorResponseSerializer},
)
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
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # The role code (`name`) is immutable — RoleCreateUpdateSerializer
        # refuses a different one — so this save can no longer rename. The
        # rename cascade that lived here (BP-07: User.role, Menu.roles, both
        # cache names, an audit row) went with it; `git log -S
        # _rename_role_in_menus` has it if renaming ever comes back.
        serializer.save()
        return Response(RoleSerializer(role).data)

    elif request.method == "DELETE":
        if role.is_builtin:
            return Response(
                {"error": f"'{role.name}' is a built-in role and cannot be deleted.",
                 "code": "builtin_role"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from apps.authentication.models import User

        # Every non-deleted holder, active or not: a deactivated user still
        # carries the name and would resurrect a phantom role on reactivation.
        holders = User.objects.filter(role=role.name).count()
        if holders:
            return Response(
                {
                    "error": f"Role '{role.name}' is still held by {holders} user(s); "
                             "reassign them before deleting it.",
                    "code": "role_in_use",
                    "user_count": holders,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        from .matrix import role_template_references

        # A template step that designates this role would, once the role is
        # gone, resolve to a role nobody can hold — every workflow built from
        # it stuck at that step. Refused with the list, so the operator knows
        # which templates to edit first.
        templates = role_template_references().get(role.name, [])
        if templates:
            return Response(
                {
                    "error": f"Role '{role.name}' is designated as approver by "
                             f"{len(templates)} workflow template(s); change those steps first.",
                    "code": "role_referenced_by_workflow_templates",
                    "templates": templates,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        from apps.core.recycle_bin import cascade_soft_delete

        # Grants go into the bin WITH the role under one cascade id, so a
        # restore brings them back. The old code hard-deleted the links and
        # soft-deleted the role: restorable in name only.
        with transaction.atomic():
            cascade_soft_delete(
                role, RolePermission.objects.filter(role=role), user=request.user
            )
        invalidate_role_permissions(role.name)
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(
    request=RoleCreateUpdateSerializer,
    responses={201: RoleSerializer, 400: OpenApiTypes.OBJECT, 404: ErrorResponseSerializer},
)
@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def copy_role(request, pk):
    """
    POST /api/v1/perm/roles/<pk>/copy/
    复制为新角色：新 code、同一组授权（仅 ADMIN）

    Copies the source's RolePermission rows — permission, `conditions` and
    `data_scope` — i.e. what the matrix shows for it. Not copied: `parent`,
    FieldPermission and RowLevelDataScope rows, and ADMIN's short-circuit (a
    copy of ADMIN gets ADMIN's ticks, not ADMIN's bypass).
    """
    try:
        source = Role.objects.get(pk=pk)
    except Role.DoesNotExist:
        return Response({"error": "Role not found"}, status=status.HTTP_404_NOT_FOUND)

    serializer = RoleCreateUpdateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    name = serializer.validated_data["name"]
    taken = _role_name_taken(name)
    if taken:
        return Response({"error": taken}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        role = serializer.save(
            scope=serializer.validated_data.get("scope", source.scope),
            organization=serializer.validated_data.get("organization", source.organization),
        )
        grants = list(RolePermission.objects.filter(role=source).select_related("permission"))
        # A copy is never ADMIN, so ADMIN-only codenames are left behind
        # (apps/perm/matrix.py::ADMIN_ONLY_CODENAMES).
        grants = [g for g in grants if not admin_only_violations(role.name, [g.permission.codename])]
        # bulk_create sends no post_save — so the audit row and the cache
        # invalidation are both written here, as in assign_role_permissions.
        RolePermission.objects.bulk_create([
            RolePermission(
                role=role, permission=g.permission, conditions=g.conditions, data_scope=g.data_scope
            )
            for g in grants
        ])
        from apps.audit.models import AuditAction, AuditLog

        AuditLog.objects.create(
            tenant=getattr(request, "tenant", None),
            user=request.user,
            action=AuditAction.PERMISSION_CHANGE,
            resource="role",
            resource_id=str(role.pk),
            changes={
                "copied_from": source.name,
                "permissions": {"old": [], "new": sorted(g.permission.codename for g in grants)},
            },
            description=f"Role {name} created as a copy of {source.name}"[:500],
            ip_address=get_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
        )
        # A name nobody held may still have cached denials (a user whose role
        # string pointed at no row asks too).
        transaction.on_commit(lambda: invalidate_role_permissions(name))
    return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)


# ── Permission matrix: per-cell save and "what breaks" ────────────────


@extend_schema(
    request=MatrixChangesRequestSerializer,
    responses={200: MatrixChangesResultSerializer, 400: OpenApiTypes.OBJECT},
)
@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def apply_matrix_changes(request):
    """
    POST /api/v1/perm/role-permissions/changes/
    按格保存权限矩阵的改动：每格一个结果（saved / unchanged / refused / failed）（仅 ADMIN）

    200 even when some cells were refused or failed — the per-cell `status`
    is the answer. See apps/perm/matrix.py for why cells save independently.
    """
    from .matrix import FAILED, REFUSED, SAVED, UNCHANGED, apply_changes

    serializer = MatrixChangesRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    results, versions = apply_changes(
        serializer.validated_data["changes"],
        serializer.validated_data.get("expected_versions"),
        serializer.validated_data["acknowledge_conflicts"],
    )

    def count(status_):
        return sum(1 for r in results if r["status"] == status_)

    return Response({
        "saved": count(SAVED),
        "unchanged": count(UNCHANGED),
        "refused": count(REFUSED),
        "failed": count(FAILED),
        "results": results,
        "versions": versions,
    })


@extend_schema(
    request=MatrixChangesRequestSerializer,
    responses={200: MatrixImpactResultSerializer, 400: OpenApiTypes.OBJECT},
)
@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def matrix_impact(request):
    """
    POST /api/v1/perm/role-permissions/impact/
    保存前预检：哪些审批流模板的哪一步、哪些进行中审批流的待审节点会因这些撤销而无人可批（只读，仅 ADMIN）

    Same body as `changes/`; `expected_versions` is accepted and ignored.
    """
    from .matrix import approve_codenames, impact_of_changes

    serializer = MatrixChangesRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    return Response({
        "required_codenames": approve_codenames(),
        **impact_of_changes(serializer.validated_data["changes"]),
    })


@extend_schema(request=None, responses={200: InitRolesResultSerializer})
@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def init_roles(request):
    """
    POST /api/v1/perm/roles/init/
    初始化默认角色（仅 ADMIN）
    """

    # `revive_or_create`: a built-in sitting in the recycle bin comes back
    # (with its grants) rather than raising against the old unique index (500)
    # or, under the conditional constraint, gaining a twin.
    created_count = 0
    for name, display_name in DEFAULT_ROLES:
        role, created = Role.revive_or_create(name, display_name=display_name)
        if created:
            created_count += 1

    return Response({
        "message": f"Initialized {created_count} roles",
        "total": Role.objects.count(),
    })


@extend_schema(request=None, responses={200: InitRolePermissionsResultSerializer})
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
        Permission.revive_or_create(codename, name=name, category=category)

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


@extend_schema(
    request=None,
    # Served with Content-Disposition: attachment, but the bytes are the JSON
    # document below — a client that reads the body rather than saving the
    # file gets exactly this.
    responses={(200, "application/json"): PermissionExportSerializer},
)
@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def export_permissions(request):
    """
    GET /api/v1/perm/export/
    导出所有权限配置为 JSON（仅 ADMIN）
    """
    from .export import export_permissions_json_response
    return export_permissions_json_response()


@extend_schema(
    request=PermissionImportRequestSerializer,
    responses={200: PermissionImportResultSerializer, 400: ErrorResponseSerializer},
)
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
    # A JSON list parses fine and then `.get` is an AttributeError 500.
    if not isinstance(data, dict):
        return Response(
            {"error": "Body must be a JSON object (the export document)."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Validate the whole document BEFORE touching a row. `overwrite` is three
    # `.all().delete()` calls; the shape errors this catches used to surface as
    # a KeyError after those had already run.
    serializer = PermissionImportRequestSerializer(data=data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    document = serializer.validated_data
    overwrite = document["overwrite"]

    # One transaction: an overwrite that fails half-way rolls its deletes back
    # instead of answering 500 over an empty grant table.
    with transaction.atomic():
        stats = do_import(document, overwrite=overwrite)

    # An import rewrites permissions and grants wholesale.
    invalidate_all_permissions()

    return Response({
        "message": "Permissions imported successfully",
        "stats": stats,
    })
