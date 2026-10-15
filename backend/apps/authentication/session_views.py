"""登录设备(官员 Web,Design 第二十八批 W2):只看见、只退出自己的会话。

    GET  /auth/sessions/                  这台在前,其余按上次活动倒序;30 天没活动的不列出
    POST /auth/sessions/{id}/revoke/      退出一台(不输密码,立即生效);退出「这台」→ 400 current_session
    POST /auth/sessions/revoke-others/    除这台外全部退出,它们的「30 天内不再询问」一并作废

别人的会话 id 一律 404(与「不存在」同一个答案)。「这台」由 access 里的 `sid` 认;老令牌没有 `sid`,
列表里没有「这台」,`revoke-others` 答 409 `session_unknown`(重新登录一次就有了)。
"""
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import signin_sessions
from .models import SignInSession
from .officer_reset import _audit


class SignInSessionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    label = serializers.CharField()
    method = serializers.CharField()
    last_seen_at = serializers.DateTimeField()
    current = serializers.BooleanField()
    trusted_until = serializers.DateTimeField(allow_null=True)


class RevokeOthersResponseSerializer(serializers.Serializer):
    revoked = serializers.IntegerField()


class SessionRefusalSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.CharField()


def refuse(detail, code, http_status):
    return Response({"detail": detail, "code": code}, status=http_status)


def revoke_one(user, auth, session_id):
    """官员与灵魂共用:退出 `user` 名下的一台。返回 `(拒绝 Response, None)` 或 `(None, 已退出的会话)`。"""
    session = SignInSession.objects.filter(user=user, pk=session_id).first()
    if session is None:
        return refuse("没有这台设备。", "not_found", status.HTTP_404_NOT_FOUND), None
    current = signin_sessions.session_of(auth)
    if current is not None and current.pk == session.pk:
        return refuse("这台设备请在右上角退出。", "current_session", status.HTTP_400_BAD_REQUEST), None
    signin_sessions.revoke(session)
    return None, session


def revoke_others(user, auth):
    """返回 `(拒绝 Response, None)` 或 `(None, 退出的台数)`。"""
    current = signin_sessions.session_of(auth)
    if current is None:
        return refuse("请重新登录一次再试。", "session_unknown", status.HTTP_409_CONFLICT), None
    count = signin_sessions.visible(user).exclude(pk=current.pk).count()
    signin_sessions.revoke_others(user, current)
    return None, count


@extend_schema(responses={200: SignInSessionSerializer(many=True)})
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def sessions_view(request):
    current = signin_sessions.session_of(request.auth)
    return Response(signin_sessions.listing(request.user, current))


@extend_schema(request=None, responses={204: None, 400: SessionRefusalSerializer, 404: SessionRefusalSerializer})
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def revoke_session_view(request, session_id):
    refusal, session = revoke_one(request.user, request.auth, session_id)
    if refusal is not None:
        return refusal
    _audit(request.user, f"官员退出登录设备:{session.label}", request=request,
           changes={"session_revoked": str(session.pk), "label": session.label})
    return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(request=None, responses={200: RevokeOthersResponseSerializer, 409: SessionRefusalSerializer})
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def revoke_other_sessions_view(request):
    refusal, count = revoke_others(request.user, request.auth)
    if refusal is not None:
        return refusal
    _audit(request.user, f"官员退出其他全部登录设备({count} 台)", request=request, changes={"sessions_revoked": count})
    return Response({"revoked": count})
