"""面容 / 指纹登录的接口(规则在 `device_login.py`)。

    POST /me/device-login/            开启:当前密码 → `{credential}`(只此一次)
    POST /soul-auth/device-login/revoke/  关闭这部手机的凭据(幂等,不要求登录)
    POST /soul-auth/device-login/     用「编号 + 凭据」代替「编号 + 密码」登录;响应与密码登录逐字段相同

登录的限流与密码登录同一套三层(`me_views._rate_keys`:同一编号同一 IP 5 次 / 同一编号全部 IP 20 次 / 同一 IP 50 次,
15 分钟),编号那两层**另记一份**(`scope="face"`,2026-11-01):乱填凭据不再消耗密码登录的预算,反之亦然。
被吊销的凭据不算猜错(那是过期的真凭据,不是探测),所以不计数。
"""
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.soul_accounts import device_login
from apps.soul_accounts import services as svc
from apps.soul_accounts.me_views import (
    LOGIN_OUTCOME,
    SoulAPIView,
    _rate_keys,
    count_failure,
    finish_first_step,
    rate_limited,
    sign_in_username,
)
from apps.soul_accounts.mfa_views import _client_ip, confirm_current_password
from apps.soul_accounts.serializers import (
    SoulDeviceLoginCredentialSerializer,
    SoulDeviceLoginEnableRequestSerializer,
    SoulDeviceLoginIssuedSerializer,
    SoulDeviceLoginRefusalSerializer,
    SoulDeviceLoginRequestSerializer,
    SoulMfaRefusalSerializer,
)


class MeDeviceLoginView(SoulAPIView):
    @extend_schema(request=SoulDeviceLoginEnableRequestSerializer,
                   responses={201: SoulDeviceLoginIssuedSerializer, 400: SoulMfaRefusalSerializer,
                              429: SoulMfaRefusalSerializer})
    def post(self, request):
        """开启。要当前密码(与两步验证开启向导同一套计数:错 5 次 429 `rate_limited`,错的 400 `wrong_password`)。"""
        body = SoulDeviceLoginEnableRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        refusal = confirm_current_password(request, self.account, body.validated_data["password"])
        if refusal is not None:
            return refusal
        from apps.authentication import signin_sessions

        with transaction.atomic():
            raw = device_login.issue(self.account, session=signin_sessions.session_of(request.auth))
        return Response({"credential": raw}, status=status.HTTP_201_CREATED)


class SoulDeviceLoginRevokeView(APIView):
    """关闭这部手机的面容 / 指纹登录。**不要求登录**:凭据本身就是证明(256 位随机数,只有这部手机有)。
    登录页的「换一个账号」发生在退出登录之后,那时手里只有凭据、没有令牌(2026-10-11 上模拟器前查到:
    这个接口原先挂在 /me/ 下,那一下只会 401,服务端那一行永远关不掉)。"""
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=SoulDeviceLoginCredentialSerializer,
                   responses={204: OpenApiResponse(description="已关闭(不认识或早已关闭也是 204)")})
    def post(self, request):
        body = SoulDeviceLoginCredentialSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        with transaction.atomic():
            device_login.turn_off(body.validated_data["credential"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class SoulDeviceLoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        request=SoulDeviceLoginRequestSerializer,
        responses={200: LOGIN_OUTCOME, 400: OpenApiResponse(description="字段校验失败"),
                   401: SoulDeviceLoginRefusalSerializer, 429: SoulDeviceLoginRefusalSerializer},
    )
    def post(self, request):
        from apps.authentication.models import LoginLog
        from apps.souls.models import Soul

        ip = _client_ip(request)
        body = SoulDeviceLoginRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        soul_code = body.validated_data["soul_code"]
        keys = _rate_keys(ip, soul_code, scope="face")
        if rate_limited(keys):
            return Response({"detail": "登录尝试过于频繁,请 15 分钟后再试。", "code": "rate_limited"},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        user_agent = request.META.get("HTTP_USER_AGENT", "")[:500]
        # all_objects:回收站里的灵魂也找得到(F-ACCT-06)。此前答 `device_login_invalid`,App 读成「面容有变动」
        # 删掉本机凭据,灵魂恢复后面容登录已没了,服务端那行却还有效。
        soul = Soul.all_objects.filter(soul_code=svc.normalize_soul_code(soul_code)).first()
        row = device_login.find(soul, body.validated_data["credential"])  # 哈希先算,编号存不存在耗时一样
        username = sign_in_username(soul_code)
        account = row.account if row is not None else None
        if soul is not None and soul.is_deleted and row is not None and row.revoked_at is None \
                and account.retired_at is None and account.user.is_active:
            LoginLog.objects.create(username=username, status="FAILED", ip_address=ip, user_agent=user_agent,
                                    failure_reason="soul_recycled")
            return Response({"detail": "灵魂已移入回收站,账号暂停使用。", "code": "soul_recycled"},
                            status=status.HTTP_401_UNAUTHORIZED)
        if soul is not None and soul.is_deleted:
            soul, row, account = None, None, None
        # 账号已停用而凭据没标(不该发生,转生时同事务标了):按转生答,而不是「不认识」。
        reason = (row.revoked_reason or "account_reincarnated") if row is not None and (
            row.revoked_at is not None or account.retired_at is not None) else None
        if reason:
            LoginLog.objects.create(username=username, status="FAILED", ip_address=ip, user_agent=user_agent,
                                    failure_reason=f"device_login_revoked:{reason}")
            return Response({"detail": "这部手机的面容/指纹登录已失效。", "code": "device_login_revoked",
                             "reason": reason}, status=status.HTTP_401_UNAUTHORIZED)
        if account is None or not account.user.is_active:
            count_failure(keys)
            LoginLog.objects.create(username=username, status="FAILED", ip_address=ip, user_agent=user_agent,
                                    failure_reason="device_login_invalid")
            return Response({"detail": "灵魂编号或凭据错误。", "code": "device_login_invalid"},
                            status=status.HTTP_401_UNAUTHORIZED)
        row.last_used_at = timezone.now()
        row.save(update_fields=["last_used_at"])
        return finish_first_step(account, soul_code, rate_keys=keys, ip=ip,
                                 user_agent=user_agent, device_token=body.validated_data.get("device_token"),
                                 request=request, method="face", device_login=row)
