"""官员 App 指纹登录的接口(规则在 `device_login.py`;灵魂端的同形是 `apps/soul_accounts/device_login_views.py`)。

    POST /auth/device-login/enable/   已登录 + 当前密码 → 201 `{credential}`(只此一次)
    POST /auth/officer-device-login/  「用户名 + 凭据」代替「用户名 + 密码」;响应与 /auth/officer-login/ 逐字段相同
    POST /auth/device-login/revoke/   关闭这部手机的凭据(幂等,不要求登录:退出之后的「换一个账号」只有凭据)

**限流**:登录就是 `OfficerLoginView`(同一个视图类、同一套按 IP / 按用户名的计数与 `LoginLog`),乱填凭据与乱填密码
花同一份预算。开启时的当前密码与改密码同一份按 IP 的计数(`login_rate:{ip}`):偷到会话的人在这里也猜不了几次。
用户 2026-11-15 接受(便捷度研究 §8 第 1 条):指纹登录让「闲置 24 小时就重输密码」(A13)实际失效;
每次批准 / 驳回前的 `deviceCheck` 不变。
"""
import math
import time

from django.core.cache import cache
from django.db import transaction
from drf_spectacular.utils import OpenApiResponse, PolymorphicProxySerializer, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.problems import Problem, ProblemSerializer, problem

from . import device_login, signin_sessions
from .serializers import (
    LoginFailedResponseSerializer,
    LoginLockedResponseSerializer,
    LoginResponseSerializer,
    MfaRequiredResponseSerializer,
    OfficerTokenObtainPairSerializer,
)
from .views import LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, OfficerLoginView, _count, _get_client_ip


class OfficerDeviceLoginEnableRequestSerializer(serializers.Serializer):
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class OfficerDeviceLoginIssuedSerializer(serializers.Serializer):
    credential = serializers.CharField(help_text="不透明凭据,只此一次;App 放进要验证生物特征才能取出的安全存储。")


class OfficerDeviceLoginCredentialSerializer(serializers.Serializer):
    credential = serializers.CharField(max_length=128)


class OfficerDeviceLoginRefusalSerializer(ProblemSerializer):
    """`code`:device_login_revoked(401,带 `reason`:password_changed / signed_out / turned_off)、
    device_login_invalid(401)、login_locked(429,见 `LoginLockedResponseSerializer`)。"""

    reason = serializers.CharField(required=False)


class OfficerDeviceTokenSerializer(OfficerTokenObtainPairSerializer):
    """`OfficerTokenObtainPairSerializer` 的第一步换成凭据:用户名 + 凭据 → 同一个 `_finish`(两步验证照常)。
    别人的凭据配这个用户名、停用的账号、灵魂账号 → 与「不认识」同一句 `device_login_invalid`。"""

    credential = serializers.CharField(max_length=128, write_only=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields.pop("password")
        self.fields.pop("tenant_code")

    def validate(self, attrs):
        row = device_login.find(attrs[self.username_field], attrs["credential"])
        user = row.user if row is not None else None
        if user is None or not user.is_active or user.role == "SOUL":
            raise Problem(status.HTTP_401_UNAUTHORIZED, "device_login_invalid", "用户名或凭据错误。")
        if row.revoked_at is not None:
            raise Problem(status.HTTP_401_UNAUTHORIZED, "device_login_revoked", "这部手机的指纹登录已失效。",
                          reason=row.revoked_reason)
        self.user = user
        return self._finish(attrs, device_login=row)


class OfficerDeviceLoginView(OfficerLoginView):
    """POST /api/v1/auth/officer-device-login/ —— `OfficerLoginView` 本身,只换了序列化器。"""

    serializer_class = OfficerDeviceTokenSerializer

    @extend_schema(
        request=OfficerDeviceTokenSerializer,
        responses={
            200: PolymorphicProxySerializer(
                component_name="LoginOutcome",
                serializers=[LoginResponseSerializer, MfaRequiredResponseSerializer],
                resource_type_field_name=None,
            ),
            401: OfficerDeviceLoginRefusalSerializer,
            429: LoginLockedResponseSerializer,
        },
    )
    def post(self, request, *args, **kwargs):
        return super().post(request, *args, **kwargs)


class DeviceLoginEnableView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=OfficerDeviceLoginEnableRequestSerializer,
                   responses={201: OfficerDeviceLoginIssuedSerializer, 400: LoginFailedResponseSerializer,
                              403: ProblemSerializer, 429: LoginLockedResponseSerializer})
    def post(self, request):
        """开启。错的当前密码 400 `wrong_password`;与改密码同一份按 IP 的计数,满了 429 `login_locked`。
        灵魂账号 403(它们有自己的 `/me/device-login/`)。每调一次发一条新凭据:App 先吊销旧的。"""
        user = request.user
        if user.role == "SOUL":
            return problem(status.HTTP_403_FORBIDDEN, None, "灵魂账号请用灵魂端的面容登录。")
        body = OfficerDeviceLoginEnableRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        ip = _get_client_ip(request)
        rate_key, until_key = f"login_rate:{ip}", f"login_rate_until:{ip}"
        attempts = cache.get(rate_key, 0)
        if attempts >= LOGIN_MAX_ATTEMPTS:
            until = cache.get(until_key)
            retry_after = max(1, math.ceil(until - time.time())) if until else LOGIN_WINDOW_SECONDS
            return problem(status.HTTP_429_TOO_MANY_REQUESTS, "login_locked", "密码尝试过于频繁,请稍后再试",
                           retry_after=retry_after, headers={"Retry-After": str(retry_after)})
        if not user.check_password(body.validated_data["password"]):
            _count(cache, rate_key, LOGIN_WINDOW_SECONDS)  # atomic, as change-password (views.py)
            cache.set(until_key, time.time() + LOGIN_WINDOW_SECONDS, timeout=LOGIN_WINDOW_SECONDS)
            return problem(status.HTTP_400_BAD_REQUEST, "wrong_password", "当前密码不对。",
                           remaining_attempts=max(0, LOGIN_MAX_ATTEMPTS - attempts - 1))
        with transaction.atomic():
            raw = device_login.issue(user, session=signin_sessions.session_of(request.auth), request=request)
        return Response({"credential": raw}, status=status.HTTP_201_CREATED)


class DeviceLoginRevokeView(APIView):
    """关闭这部手机的指纹登录。**不要求登录**:凭据本身就是证明(256 位随机数,只有这部手机有)。"""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=OfficerDeviceLoginCredentialSerializer,
                   responses={204: OpenApiResponse(description="已关闭(不认识或早已关闭也是 204)")})
    def post(self, request):
        body = OfficerDeviceLoginCredentialSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        with transaction.atomic():
            device_login.turn_off(body.validated_data["credential"])
        return Response(status=status.HTTP_204_NO_CONTENT)

