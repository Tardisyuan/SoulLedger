"""两步验证的接口(A12)。规则在 mfa.py;这里只做请求 / 响应与状态码。

    POST   /auth/mfa/verify/           登录第二步(AllowAny,收待验证令牌)
    GET    /auth/mfa/status/           本人状态
    POST   /auth/mfa/setup/            向导第二步:新密钥 + otpauth 链接
    DELETE /auth/mfa/setup/            中途退出:未确认的密钥作废
    POST   /auth/mfa/confirm/          向导第三步:验一次码 → 恢复码(明文只给这一次)
    POST   /auth/mfa/complete/         向导「完成」:只有这里开启
    POST   /auth/mfa/recovery-codes/   重新生成恢复码(旧码作废)
    POST   /auth/mfa/disable/          关闭(动态码或恢复码二选一确认;只凭密码不行)

拒绝体统一是 `{"error", "code", …}`,`code` ∈ wrong / expired / locked / pending_invalid / not_enabled / already_enabled / not_verified。
"""
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError

from apps.core.schema import DetailResponseSerializer

from . import mfa, signin_sessions
from .models import LoginLog, UserRole
from .serializers import LoginResponseSerializer, issue_tokens
from .views import _get_client_ip


class MfaVerifyRequestSerializer(serializers.Serializer):
    pending_token = serializers.CharField()
    code = serializers.CharField(required=False, allow_blank=True)
    recovery_code = serializers.CharField(required=False, allow_blank=True)
    remember_device = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if not attrs.get("code") and not attrs.get("recovery_code"):
            raise serializers.ValidationError({"code": "code or recovery_code is required"})
        return attrs


class MfaRefusalSerializer(serializers.Serializer):
    """`code` is what to branch on. wrong → `remaining_attempts` + `lock_minutes`; locked → `retry_after` (seconds)."""

    error = serializers.CharField()
    code = serializers.CharField()
    remaining_attempts = serializers.IntegerField(required=False)
    lock_minutes = serializers.IntegerField(required=False)
    retry_after = serializers.IntegerField(required=False)


class MfaStatusSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
    required = serializers.BooleanField()
    confirmed_at = serializers.DateTimeField(allow_null=True)
    last_used_at = serializers.DateTimeField(allow_null=True)
    last_used_method = serializers.CharField()
    recovery_codes_remaining = serializers.IntegerField()


class MfaSetupRequestSerializer(serializers.Serializer):
    """开始设置要先输当前密码:已登录不等于是本人(偷到登录状态的人能给账号绑上自己的验证器)。
    缺省 / 空按「密码不对」算,同一个原因码。"""

    password = serializers.CharField(required=False, allow_blank=True, default="", trim_whitespace=False)


class MfaSetupResponseSerializer(serializers.Serializer):
    secret = serializers.CharField()
    otpauth_url = serializers.CharField()


class MfaCodeRequestSerializer(serializers.Serializer):
    code = serializers.CharField()


class MfaRecoveryCodesSerializer(serializers.Serializer):
    recovery_codes = serializers.ListField(child=serializers.CharField())


class MfaDisableRequestSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=mfa.OWNER_CONFIRM_METHODS)
    code = serializers.CharField(required=False, allow_blank=True)
    password = serializers.CharField(required=False, allow_blank=True)


class MfaTurnOffRequestSerializer(serializers.Serializer):
    """关闭:6 位动态码(`totp`)或一枚恢复码(`recovery`)。密码不再算数(2026-10-29)。"""

    method = serializers.ChoiceField(choices=mfa.SECOND_FACTOR_METHODS)
    code = serializers.CharField(trim_whitespace=True)


_MESSAGES = {
    "wrong": "动态码不对",
    "expired": "动态码已过期",
    "locked": "两步验证已锁定,请稍后再试",
    "login_locked": "密码尝试过于频繁,请稍后再试",
    "wrong_password": "密码不对",
}


def _refuse(code, http_status, **extra):
    body = {"error": _MESSAGES.get(code, code), "code": code, **extra}
    headers = {"Retry-After": str(extra["retry_after"])} if "retry_after" in extra else None
    return Response(body, status=http_status, headers=headers)


def _refuse_outcome(outcome: dict):
    if outcome["code"] == "locked":
        return _refuse("locked", status.HTTP_429_TOO_MANY_REQUESTS, retry_after=outcome["retry_after"])
    return _refuse(outcome["code"], status.HTTP_400_BAD_REQUEST, **{k: v for k, v in outcome.items() if k != "code"})


@extend_schema(
    request=MfaVerifyRequestSerializer,
    responses={200: LoginResponseSerializer, 400: MfaRefusalSerializer, 401: MfaRefusalSerializer, 429: MfaRefusalSerializer},
)
@api_view(["POST"])
@permission_classes([AllowAny])
def verify_view(request):
    """登录第二步:待验证令牌 + 动态码(或恢复码)→ 正常的 access / refresh / user。
    `remember_device` 为真时再下发 30 天的 httpOnly 设备 cookie。"""
    from django.contrib.auth import get_user_model

    serializer = MfaVerifyRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        pending = mfa.PendingToken(data["pending_token"])
    except TokenError:
        return _refuse("pending_invalid", status.HTTP_401_UNAUTHORIZED)
    if mfa.pending_used(pending.get("jti")):
        return _refuse("pending_invalid", status.HTTP_401_UNAUTHORIZED)
    user = get_user_model().objects.filter(pk=pending["user_id"], is_active=True).first()
    row = mfa.get_mfa(user) if user is not None else None
    if user is None or user.role == UserRole.SOUL or row is None or not row.enabled:
        return _refuse("pending_invalid", status.HTTP_401_UNAUTHORIZED)

    outcome = mfa.verify_login_code(
        row, code=data.get("code") or None, recovery_code=data.get("recovery_code") or None, request=request,
    )
    ip_address = _get_client_ip(request)
    user_agent = request.META.get("HTTP_USER_AGENT", "")[:500]
    if outcome["code"] != "ok":
        LoginLog.objects.create(
            user=user, username=user.username, status="FAILED", ip_address=ip_address, user_agent=user_agent,
            failure_reason=f"mfa_{outcome['code']}",
        )
        return _refuse_outcome(outcome)
    if not mfa.claim_pending(pending.get("jti")):
        # 两个请求拿同一张凭据同时验过了码:只有先占到的那个拿令牌。
        return _refuse("pending_invalid", status.HTTP_401_UNAUTHORIZED)

    LoginLog.objects.create(user=user, username=user.username, status="SUCCESS", ip_address=ip_address, user_agent=user_agent)
    device = mfa.remember_device(user) if data.get("remember_device") else ""
    session = signin_sessions.start(
        user, request, method="recovery" if data.get("recovery_code") else "password",
        officer_app=bool(pending.get("officer_app")), trust_hash=mfa._hash_device(device) if device else "")
    response = Response(issue_tokens(user, remember=bool(pending.get("remember")),
                                     officer_app=bool(pending.get("officer_app")), session=session))
    if device:
        mfa.set_device_cookie(response, device)
    return response


@extend_schema(responses={200: MfaStatusSerializer})
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def status_view(request):
    return Response(mfa.status_of(request.user))


@extend_schema(
    methods=["POST"], request=MfaSetupRequestSerializer,
    responses={200: MfaSetupResponseSerializer, 400: MfaRefusalSerializer, 409: MfaRefusalSerializer, 429: MfaRefusalSerializer},
)
@extend_schema(methods=["DELETE"], request=None, responses={200: DetailResponseSerializer})
@api_view(["POST", "DELETE"])
@permission_classes([IsAuthenticated])
def setup_view(request):
    """POST:当前密码 + 发一把新密钥(已开启答 409,先关闭再开)。DELETE:中途退出,未确认的密钥作废。

    密码错 → 400 `wrong_password`,不产生密钥;错的次数记进**登录页那一个**计数(同一 IP 15 分钟 5 次,
    `login_rate:{ip}`),满了答 429 `login_locked` —— 不为猜密码另开一个口子。"""
    if request.method == "DELETE":
        mfa.cancel_setup(request.user)
        return Response({"detail": "setup discarded"})
    from django.core.cache import cache

    from .views import LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, _get_client_ip

    body = MfaSetupRequestSerializer(data=request.data)
    body.is_valid(raise_exception=True)
    ip = _get_client_ip(request)
    rate_key, until_key = f"login_rate:{ip}", f"login_rate_until:{ip}"
    attempts = cache.get(rate_key, 0)
    if attempts >= LOGIN_MAX_ATTEMPTS:
        import math
        import time

        until = cache.get(until_key)
        retry_after = max(1, math.ceil(until - time.time())) if until else LOGIN_WINDOW_SECONDS
        return _refuse("login_locked", status.HTTP_429_TOO_MANY_REQUESTS, retry_after=retry_after)
    password = body.validated_data["password"]
    if not password or not request.user.check_password(password):
        import time

        cache.set(rate_key, attempts + 1, timeout=LOGIN_WINDOW_SECONDS)
        cache.set(until_key, time.time() + LOGIN_WINDOW_SECONDS, timeout=LOGIN_WINDOW_SECONDS)
        return _refuse("wrong_password", status.HTTP_400_BAD_REQUEST, remaining_attempts=max(0, LOGIN_MAX_ATTEMPTS - attempts - 1))
    if mfa.is_enabled(request.user):
        return _refuse("already_enabled", status.HTTP_409_CONFLICT)
    row = mfa.begin_setup(request.user)
    return Response({"secret": row.secret, "otpauth_url": mfa.otpauth_url(row.secret, request.user.username)})


@extend_schema(request=MfaCodeRequestSerializer, responses={200: MfaRecoveryCodesSerializer, 400: MfaRefusalSerializer, 409: MfaRefusalSerializer})
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def confirm_view(request):
    """向导第三步。码对了 → 十个恢复码,明文只出现在这一个响应里。"""
    serializer = MfaCodeRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    row = mfa.OfficerMfa.objects.filter(user=request.user, confirmed_at__isnull=True).first()
    if row is None:
        return _refuse("not_started", status.HTTP_409_CONFLICT)
    outcome, codes = mfa.confirm_setup(row, serializer.validated_data["code"])
    if outcome != "ok":
        return _refuse(outcome, status.HTTP_400_BAD_REQUEST)
    return Response({"recovery_codes": codes})


@extend_schema(request=None, responses={200: MfaStatusSerializer, 409: MfaRefusalSerializer})
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def complete_view(request):
    """向导「完成」。没走过第三步(`verified_at` 空)不能完成。

    幂等:已经开启(上一次「完成」成功而响应没回来)再点,回同样的状态 200,不再 409 到永远 ——
    「完成」要的结果已经在了,手机上的第四步才有出路。"""
    row = mfa.OfficerMfa.objects.filter(user=request.user, confirmed_at__isnull=True, verified_at__isnull=False).first()
    if row is None:
        if mfa.is_enabled(request.user):
            return Response(mfa.status_of(request.user))
        return _refuse("not_verified", status.HTTP_409_CONFLICT)
    mfa.complete_setup(row, request=request)
    return Response(mfa.status_of(request.user))


@extend_schema(
    request=MfaDisableRequestSerializer,
    responses={200: MfaRecoveryCodesSerializer, 400: MfaRefusalSerializer, 409: MfaRefusalSerializer, 429: MfaRefusalSerializer},
)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def recovery_codes_view(request):
    """重新生成:先确认是本人(6 位数字或密码,与「关闭」同一把锁;不收恢复码),过了才作废旧码。"""
    serializer = MfaDisableRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    row = mfa.get_mfa(request.user)
    if row is None or not row.enabled:
        return _refuse("not_enabled", status.HTTP_409_CONFLICT)
    outcome = mfa.confirm_owner(
        row, request.user, method=data["method"], code=data.get("code") or "", password=data.get("password") or "",
        request=request)
    if outcome["code"] != "ok":
        return _refuse_outcome(outcome)
    return Response({"recovery_codes": mfa.regenerate_recovery_codes(row, request=request)})


@extend_schema(request=MfaTurnOffRequestSerializer,
               responses={200: MfaStatusSerializer, 400: MfaRefusalSerializer, 409: MfaRefusalSerializer, 429: MfaRefusalSerializer})
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def disable_view(request):
    """关闭:`method=totp` 验一个动态码,`method=recovery` 验一枚恢复码。只凭密码不行。错了计入同一个锁。"""
    serializer = MfaTurnOffRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    row = mfa.get_mfa(request.user)
    if row is None or not row.enabled:
        return _refuse("not_enabled", status.HTTP_409_CONFLICT)
    outcome = mfa.confirm_second_factor(row, method=data["method"], code=data["code"], request=request)
    if outcome["code"] != "ok":
        return _refuse_outcome(outcome)
    mfa.disable(request.user, request=request)
    return Response(mfa.status_of(request.user))
