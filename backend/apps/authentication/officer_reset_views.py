"""官员邮箱重置密码与邮箱验证的接口。规则在 officer_reset.py。

    POST /auth/officer-reset/request/   申请(用户名或邮箱;永远同一个 200,按 IP 限频)
    POST /auth/officer-reset/confirm/   uid + token + 新密码
    POST /auth/email/send-verification/ 本人:往资料页的邮箱发验证链接
    POST /auth/email/verify/            uid + token(邮件里的链接落在 Web 的 /verify-email)

拒绝体是 `{"error", "code"}`(`rate_limited` 另带 `retry_after`),`code` 是契约。
"""
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.core.client_ip import get_client_ip
from apps.core.schema import DetailResponseSerializer

from . import officer_reset
from .officer_reset import ResetRefusedError
from .serializers import PasswordReasonSerializer
from .views import _rate_limited, _reset_refusal, _throttle_wait

OFFICER_RESET_ACCEPTED = {"detail": "如果账号存在且邮箱已验证,重置邮件已发送"}


class OfficerResetRequestSerializer(serializers.Serializer):
    identifier = serializers.CharField(max_length=254)


class OfficerResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)
    # No min_length: the length rule is a validator too, and answers with its code
    # (`password_too_short`) like every other reason.
    new_password = serializers.CharField(write_only=True, max_length=128)


class EmailVerifySerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)


class OfficerResetRefusalSerializer(serializers.Serializer):
    """Doc-only. `code`: rate_limited / reset_link_invalid / verify_link_invalid / weak_password."""

    error = serializers.CharField()
    code = serializers.ChoiceField(
        choices=["rate_limited", "reset_link_invalid", "verify_link_invalid", "weak_password"]
    )
    retry_after = serializers.IntegerField(required=False)
    # `weak_password` only: one reason per validator, each with Django's stable code.
    new_password = PasswordReasonSerializer(many=True, required=False)


def _refusal(exc: ResetRefusedError):
    extra = {"new_password": exc.reasons} if exc.reasons else {}
    return _reset_refusal(exc.message, exc.code, status.HTTP_400_BAD_REQUEST, **extra)


@extend_schema(
    request=OfficerResetRequestSerializer,
    # 200 for an unknown / unverified / non-officer identifier too: one body for everything.
    responses={200: DetailResponseSerializer, 429: OfficerResetRefusalSerializer},
)
@api_view(["POST"])
@authentication_classes([])  # a stale token in the tab must not turn a public page into a 401
@permission_classes([AllowAny])
@throttle_classes([])
def officer_reset_request(request):
    """
    POST /api/v1/auth/officer-reset/request/
    官员「忘记密码」。不读用户表:按 IP 限频(拒绝对所有标识一视同仁),然后交给 worker 查人发信。
    账号存在与否、邮箱是否已验证、是不是灵魂,应答与耗时都看不出来。
    """
    from apps.core.throttling import AnonRateThrottle

    from .tasks import send_officer_reset_mail
    from .throttles import OfficerPasswordResetThrottle

    wait = _throttle_wait(request, [AnonRateThrottle(), OfficerPasswordResetThrottle()])
    if wait is not None:
        return _rate_limited(wait)

    serializer = OfficerResetRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    args = (
        serializer.validated_data["identifier"], get_client_ip(request),
        request.META.get("HTTP_USER_AGENT", "")[:500],
    )
    try:
        send_officer_reset_mail.delay(*args)
    except Exception:
        # Broker down: run it here, for every identifier alike (as `password_help_request`).
        send_officer_reset_mail.run(*args)
    return Response(OFFICER_RESET_ACCEPTED)


@extend_schema(
    request=OfficerResetConfirmSerializer,
    responses={200: DetailResponseSerializer, 400: OfficerResetRefusalSerializer, 429: OfficerResetRefusalSerializer},
)
@api_view(["POST"])
@authentication_classes([])  # a stale token in the tab must not turn a public page into a 401
@permission_classes([AllowAny])
@throttle_classes([])
def officer_reset_confirm(request):
    """POST /api/v1/auth/officer-reset/confirm/ — 令牌 + 新密码。成功后该官员所有设备的登录退出。"""
    from apps.core.throttling import AnonRateThrottle

    wait = _throttle_wait(request, [AnonRateThrottle()])
    if wait is not None:
        return _rate_limited(wait)
    serializer = OfficerResetConfirmSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        officer_reset.confirm_reset(**serializer.validated_data, request=request)
    except ResetRefusedError as exc:
        return _refusal(exc)
    return Response({"detail": "密码已重置,请用新密码登录"})


@extend_schema(
    request=None,
    responses={200: DetailResponseSerializer, 400: OfficerResetRefusalSerializer, 429: OfficerResetRefusalSerializer},
)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def email_send_verification(request):
    """POST /api/v1/auth/email/send-verification/ — 往本人资料页的邮箱发验证链接(每小时 5 封)。"""
    user = request.user
    if not user.email:
        return _reset_refusal("请先在资料页填写邮箱", "no_email", status.HTTP_400_BAD_REQUEST)
    if user.email_verified:
        return Response({"detail": "邮箱已验证"})
    try:
        officer_reset.send_verification(user)
    except ResetRefusedError as exc:
        return _rate_limited(3600) if exc.code == "rate_limited" else _refusal(exc)
    return Response({"detail": "验证邮件已发送"})


@extend_schema(
    request=EmailVerifySerializer,
    responses={200: DetailResponseSerializer, 400: OfficerResetRefusalSerializer, 429: OfficerResetRefusalSerializer},
)
@api_view(["POST"])
@authentication_classes([])  # a stale token in the tab must not turn a public page into a 401
@permission_classes([AllowAny])
@throttle_classes([])
def email_verify(request):
    """POST /api/v1/auth/email/verify/ — 邮件里的链接。令牌本身就是凭据,所以不要求已登录。"""
    from apps.core.throttling import AnonRateThrottle

    wait = _throttle_wait(request, [AnonRateThrottle()])
    if wait is not None:
        return _rate_limited(wait)
    serializer = EmailVerifySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        officer_reset.verify_email(**serializer.validated_data, request=request)
    except ResetRefusedError as exc:
        return _refusal(exc)
    return Response({"detail": "邮箱已验证"})
