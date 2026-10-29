"""管理员看在线会话、强退(2026-10-29 用户决定;Snowy `AuthSessionController` 的对应物)。

    GET  /auth/admin/sessions/?kind=officer|soul&user=<id>&page=   在线会话,按上次活动倒序,分页
    POST /auth/admin/sessions/{id}/revoke/                           强退一台
    POST /auth/admin/sessions/revoke-user/  {"user": <id>}          强退这个人的全部会话

码门 `session.manage`(只授 ADMIN,perm/0028)。范围:绑了殿的只看本殿的人(官员与灵魂都按 `User.tenant`,
灵魂账号的 tenant 是原属殿),无殿管理员看全部 —— 走 `scope_to_tenant(field="user__tenant")`。
范围外的会话 id / 用户 id 一律 404,与「不存在」同一个答案。

「在线」= 没退出、30 天内有活动(与本人的「登录设备」列表同一口径,`signin_sessions.visible`)。
强退一台走 `signin_sessions.revoke`(拉黑刷新令牌、作废免两步验证、停推送、关这个人的实时连接);
强退一个人走 `passwords.end_sessions`(另把 `session_version` 加一,没有 `sid` 的老令牌也一并失效)。
管理员自己正在用的这台不能在这里退(400 `current_session`,与本人的接口一致),去右上角退出。
"""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.tenant import scope_to_tenant

from . import signin_sessions
from .models import SignInSession, User, UserRole
from .officer_reset import _audit
from .session_views import SessionRefusalSerializer, refuse

CODENAME = "session.manage"
KINDS = ("officer", "soul")


class CanManageSessions(permissions.BasePermission):
    def has_permission(self, request, view):
        from apps.perm.checker import check_permission

        return bool(request.user and request.user.is_authenticated and check_permission(request.user, CODENAME))


class AdminSessionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    user_id = serializers.IntegerField()
    username = serializers.CharField()
    display_name = serializers.CharField()
    tenant_code = serializers.CharField(allow_null=True)
    label = serializers.CharField()
    method = serializers.CharField()
    ip_address = serializers.IPAddressField(allow_null=True)
    created_at = serializers.DateTimeField()
    last_seen_at = serializers.DateTimeField()
    current = serializers.BooleanField()


class AdminSessionPageSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = AdminSessionSerializer(many=True)


class RevokeUserRequestSerializer(serializers.Serializer):
    user = serializers.IntegerField()


class RevokeUserResponseSerializer(serializers.Serializer):
    revoked = serializers.IntegerField()


def _live(request):
    """范围内、在线的会话。只取一次,三个接口共用。"""
    cutoff = timezone.now() - timedelta(days=signin_sessions.IDLE_DAYS)
    qs = SignInSession.objects.filter(revoked_at__isnull=True, last_seen_at__gte=cutoff, user__is_active=True)
    # 无殿管理员(ADMIN 且没有 tenant)看全部;其余按本殿。别的角色被授了这个码也只看本殿。
    bypass = getattr(request.user, "tenant_id", None) is None
    return scope_to_tenant(qs, request, field="user__tenant", admin_bypass=bypass)


def _users_in_scope(request):
    bypass = getattr(request.user, "tenant_id", None) is None
    return scope_to_tenant(User.objects.all(), request, admin_bypass=bypass)


@extend_schema(
    parameters=[
        OpenApiParameter("kind", str, enum=list(KINDS), description="officer(默认)或 soul"),
        OpenApiParameter("user", int, required=False),
        OpenApiParameter("page", int, required=False),
    ],
    responses={200: AdminSessionPageSerializer, 400: SessionRefusalSerializer},
)
@api_view(["GET"])
@permission_classes([IsAuthenticated, CanManageSessions])
def admin_sessions_view(request):
    kind = request.query_params.get("kind", "officer")
    if kind not in KINDS:
        return refuse("kind 只能是 officer 或 soul。", "invalid_kind", status.HTTP_400_BAD_REQUEST)
    qs = _live(request).select_related("user", "user__tenant")
    qs = qs.filter(user__role=UserRole.SOUL) if kind == "soul" else qs.exclude(user__role=UserRole.SOUL)
    user_id = request.query_params.get("user")
    if user_id:
        if not user_id.isdigit():
            return refuse("user 必须是数字。", "invalid_user", status.HTTP_400_BAD_REQUEST)
        qs = qs.filter(user_id=int(user_id))
    current = signin_sessions.session_of(request.auth)
    paginator = PageNumberPagination()
    page = paginator.paginate_queryset(qs.order_by("-last_seen_at", "pk"), request)
    return paginator.get_paginated_response(AdminSessionSerializer([{
        "id": s.pk, "user_id": s.user_id, "username": s.user.username,
        "display_name": s.user.display_name or "",
        "tenant_code": s.user.tenant.code if s.user.tenant_id else None,
        "label": s.label, "method": s.method, "ip_address": s.ip_address,
        "created_at": s.created_at, "last_seen_at": s.last_seen_at,
        "current": current is not None and s.pk == current.pk,
    } for s in page], many=True).data)


@extend_schema(request=None, responses={204: None, 400: SessionRefusalSerializer, 404: SessionRefusalSerializer})
@api_view(["POST"])
@permission_classes([IsAuthenticated, CanManageSessions])
def admin_revoke_session_view(request, session_id):
    session = _live(request).select_related("user").filter(pk=session_id).first()
    if session is None:
        return refuse("没有这个会话。", "not_found", status.HTTP_404_NOT_FOUND)
    current = signin_sessions.session_of(request.auth)
    if current is not None and current.pk == session.pk:
        return refuse("这台设备请在右上角退出。", "current_session", status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        signin_sessions.revoke(session)
        _audit(request.user, f"管理员强退会话:{session.user.username} · {session.label}", request=request,
               changes={"session_revoked": str(session.pk), "target_user": session.user_id, "label": session.label})
    return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(request=RevokeUserRequestSerializer,
               responses={200: RevokeUserResponseSerializer, 400: SessionRefusalSerializer,
                          404: SessionRefusalSerializer})
@api_view(["POST"])
@permission_classes([IsAuthenticated, CanManageSessions])
def admin_revoke_user_sessions_view(request):
    body = RevokeUserRequestSerializer(data=request.data)
    body.is_valid(raise_exception=True)
    target = _users_in_scope(request).filter(pk=body.validated_data["user"]).first()
    if target is None:
        return refuse("没有这个用户。", "not_found", status.HTTP_404_NOT_FOUND)
    if target.pk == request.user.pk:
        return refuse("不能在这里强退自己;请用「登录设备」退出其他设备。", "self", status.HTTP_400_BAD_REQUEST)
    from .passwords import end_sessions

    with transaction.atomic():
        count = _live(request).filter(user=target).count()
        end_sessions(target)
        _audit(request.user, f"管理员强退 {target.username} 的全部会话({count} 台)", request=request,
               changes={"target_user": target.pk, "sessions_revoked": count})
    return Response({"revoked": count})
