"""角色侧管理成员(用户 2026-10-29 决定第 6 条,对照 Snowy 的 ownUser / grantUser)。

GET  /perm/roles/<id>/members/  持这个角色的人(主角色与兼任都算),分页、搜索。
POST /perm/roles/<id>/members/  一批人授为主角色或兼任,或移除兼任。

规则不在这里另写一份:每个人都过 `assign_roles` 那一套(`role_assignment_refusal`:角色存在、ADMIN 不兼任、
不授高于自己的、绑殿 ADMIN 不任命 ADMIN)。人从 `scope_to_tenant` 后的用户里找,所以绑殿 ADMIN 只碰得到本殿,
别殿的 id 与不存在的一样答 `not_found`。任何一人被拒,整批不动 —— 拒绝清单逐人列出。
审计:每个被改的人一条通用 UPDATE 行(User 的 post_save 信号,事务提交时写,带 role / extra_roles 的前后值),
与 assign_roles 相同;没有变化的人不 save,也就不写行。
"""
from django.db import transaction
from django.db.models import Q
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.authentication.serializers import UserManagementSerializer
from apps.core.permissions import IsAdminPermission
from apps.core.schema import ErrorResponseSerializer
from apps.events.realtime import push_permission_refresh

from .models import Role

MAX_BATCH = 200


class RoleMembersChangeSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["add", "remove"])
    #: primary = 主角色(替换原主角色);extra = 兼任。主角色不能直接移除 —— 先给他授别的主角色。
    kind = serializers.ChoiceField(choices=["primary", "extra"])
    user_ids = serializers.ListField(child=serializers.IntegerField(), min_length=1, max_length=MAX_BATCH)


class RoleMemberRefusalSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    username = serializers.CharField(allow_blank=True)
    code = serializers.CharField()
    error = serializers.CharField()


class RoleMembersChangeResultSerializer(serializers.Serializer):
    changed = serializers.IntegerField()
    unchanged = serializers.IntegerField()


class RoleMembersRefusedSerializer(serializers.Serializer):
    code = serializers.CharField()
    refusals = RoleMemberRefusalSerializer(many=True)


class RoleMembersPageSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = UserManagementSerializer(many=True)


class _Page(PageNumberPagination):
    page_size_query_param = "page_size"
    max_page_size = 100


def _users(request):
    from apps.authentication.models import User
    from apps.core.tenant import scope_to_tenant

    qs = User.objects.select_related("tenant", "organization", "mfa").exclude(role="SOUL")
    return scope_to_tenant(qs, request)


def _holders(request, name):
    # JSON `contains` is not on SQLite; the text match narrows it, the exact check below decides.
    # ponytail: filtered in Python before paging — fine for hundreds of holders, push into SQL past that.
    qs = _users(request).filter(Q(role=name) | Q(extra_roles__icontains=f'"{name}"'))
    search = request.query_params.get("search", "").strip()
    if search:
        qs = qs.filter(
            Q(username__icontains=search) | Q(email__icontains=search)
            | Q(first_name__icontains=search) | Q(last_name__icontains=search)
        )
    rows = [u for u in qs.order_by("username") if u.role == name or name in (u.extra_roles or [])]
    return sorted(rows, key=lambda u: u.role != name)  # main-role holders first, stable by username


def _change(user, name, action, kind):
    """(new_role, extras) the request asks for, or a refusal code."""
    extras = list(user.extra_roles or [])
    if action == "add" and kind == "primary":
        return name, extras, None
    if action == "add":
        return user.role, extras + [name], None
    if kind == "primary":
        return None, None, "primary_needs_replacement"
    return user.role, [r for r in extras if r != name], None


@extend_schema(
    methods=["GET"],
    parameters=[
        OpenApiParameter("search", str, description="username / email / name, contains"),
        OpenApiParameter("page", int),
        OpenApiParameter("page_size", int),
    ],
    responses={200: RoleMembersPageSerializer, 404: ErrorResponseSerializer},
)
@extend_schema(
    methods=["POST"],
    request=RoleMembersChangeSerializer,
    responses={
        200: RoleMembersChangeResultSerializer,
        400: RoleMembersRefusedSerializer,
        403: RoleMembersRefusedSerializer,
        404: ErrorResponseSerializer,
    },
)
@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated, IsAdminPermission])
def role_members(request, pk):
    from apps.authentication.views import role_assignment_refusal

    role = Role.objects.filter(pk=pk).first()
    if role is None:
        return Response({"error": "Role not found"}, status=status.HTTP_404_NOT_FOUND)
    name = role.name

    if request.method == "GET":
        paginator = _Page()
        page = paginator.paginate_queryset(_holders(request, name), request)
        return paginator.get_paginated_response(UserManagementSerializer(page, many=True).data)

    body = RoleMembersChangeSerializer(data=request.data)
    body.is_valid(raise_exception=True)
    action, kind = body.validated_data["action"], body.validated_data["kind"]
    ids = list(dict.fromkeys(body.validated_data["user_ids"]))

    with transaction.atomic():
        found = {u.pk: u for u in _users(request).select_for_update(of=("self",)).filter(pk__in=ids)}
        refusals, plans, http = [], [], status.HTTP_400_BAD_REQUEST
        for uid in ids:
            user = found.get(uid)
            if user is None:
                refusals.append({"user_id": uid, "username": "", "code": "not_found", "error": "No such user here"})
                continue
            new_role, extras, code = _change(user, name, action, kind)
            if code:
                refusals.append({"user_id": uid, "username": user.username, "code": code,
                                 "error": "Give this user another main role instead"})
                continue
            extras, refusal = role_assignment_refusal(request.user, user, new_role, extras)
            if refusal:
                if refusal[1] == status.HTTP_403_FORBIDDEN:
                    http = status.HTTP_403_FORBIDDEN
                refusals.append({"user_id": uid, "username": user.username,
                                 "code": "forbidden" if refusal[1] == status.HTTP_403_FORBIDDEN else "invalid",
                                 "error": refusal[0]})
                continue
            plans.append((user, new_role, extras))
        if refusals:
            return Response({"code": "refused", "refusals": refusals}, status=http)
        changed = 0
        for user, new_role, extras in plans:
            if user.role == new_role and list(user.extra_roles or []) == extras:
                continue
            user.role, user.extra_roles = new_role, extras
            user.save(update_fields=["role", "extra_roles"])  # audit: the generic UPDATE row, on commit
            # Their open sockets re-resolve after commit (decision 10); the HTTP checks change at once.
            push_permission_refresh(user.pk)
            changed += 1
    return Response({"changed": changed, "unchanged": len(plans) - changed})
