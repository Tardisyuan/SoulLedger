"""灵魂端两步验证的接口。规则在 `mfa.py`(密码学与计数在 `apps/authentication/mfa.py`,与官员共用);
这里只做请求 / 响应与状态码。

    POST   /soul-auth/mfa/verify/       登录第二步(AllowAny,收待验证凭据)
    GET    /me/mfa/                     本人状态
    POST   /me/mfa/setup/               向导:新密钥 + otpauth 链接(重复开始作废上一把)
    DELETE /me/mfa/setup/               中途退出:未确认的密钥作废
    POST   /me/mfa/confirm/             向导:验一个 6 位数字 → 开启,并**只这一次**给出 10 个恢复码
    POST   /me/mfa/recovery-codes/      重新生成恢复码(旧码立即作废;只要确认,不用输码)
    POST   /me/mfa/disable/             关闭(6 位数字或恢复码二选一;只凭密码不行)

拒绝体统一是 `{"detail", "code", …}`,`code` ∈ wrong / expired / locked / pending_invalid / rate_limited /
wrong_password / not_enabled / already_enabled / not_started。`/me/` 下的视图继承 `SoulAPIView`
(只认灵魂令牌,`must_change_password` 期间一概拒绝)。官员关闭在 `views.py::SoulAccountViewSet.reset_mfa`。
"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.soul_accounts import device_login, mfa
from apps.soul_accounts import services as svc
from apps.soul_accounts.me_views import CODE_ATTEMPTS, IP_ATTEMPTS, LOGIN_WINDOW_SECONDS, SoulAPIView, _rate_keys
from apps.soul_accounts.serializers import (
    SoulMfaCodeRequestSerializer,
    SoulMfaDisableRequestSerializer,
    SoulMfaRecoveryCodesSerializer,
    SoulMfaRefusalSerializer,
    SoulMfaSetupRequestSerializer,
    SoulMfaSetupResponseSerializer,
    SoulMfaStatusSerializer,
    SoulMfaTurnOffRequestSerializer,
    SoulMfaVerifyRequestSerializer,
    SoulMfaVerifyResponseSerializer,
)

_MESSAGES = {
    "wrong": "6 位数字不对。",
    "expired": "6 位数字已过期。",
    "locked": "试错太多次,请稍后再试。",
    "wrong_password": "密码不对。",
    "pending_invalid": "这一步超时了,请重新输入密码。",
    "rate_limited": "尝试过于频繁,请 15 分钟后再试。",
}


def _refuse(code, http_status, **extra):
    body = {"detail": _MESSAGES.get(code, code), "code": code, **extra}
    headers = {"Retry-After": str(extra["retry_after"])} if "retry_after" in extra else None
    return Response(body, status=http_status, headers=headers)


def _refuse_outcome(outcome: dict):
    """`verify_login_code` / `disable` 的拒绝 → 响应。locked 带 `locked_until`(服务器时间),
    App 据此写「几点以后可以再试」,不用自己算。"""
    code, rest = outcome["code"], {k: v for k, v in outcome.items() if k != "code"}
    if code == "locked":
        rest["locked_until"] = timezone.now() + timedelta(seconds=rest["retry_after"])
        return _refuse("locked", status.HTTP_429_TOO_MANY_REQUESTS, **rest)
    if code == "pending_invalid":
        return _refuse(code, status.HTTP_401_UNAUTHORIZED)
    return _refuse(code, status.HTTP_400_BAD_REQUEST, **rest)


def _error(exc: svc.SoulAccountError):
    return Response({"detail": str(exc), "code": exc.code}, status=exc.status)


def _client_ip(request):
    from apps.core.client_ip import get_client_ip

    return get_client_ip(request)


def _ip_key(request):
    return f"soul_mfa_rate:ip:{_client_ip(request)}"


def confirm_current_password(request, account, password, credential=""):
    """「已登录不等于是本人」:敏感动作前输当前密码。对了 → None;错了 / 满了 → 拒绝响应。
    `credential`(开了面容登录的手机认过面容后取出的凭据)可代替密码,算同一份失败预算。
    错的次数记进**密码登录的那两个计数**(同一灵魂编号 5 次 / 同一 IP 50 次,15 分钟):偷到登录状态的人在这里猜密码,
    和在登录页猜吃同一份预算,满了答 429 `rate_limited`。两步验证开启向导与面容登录开启共用这一处。"""
    ip_key, code_key = _rate_keys(_client_ip(request), account.soul.soul_code)
    ip_attempts, code_attempts = cache.get(ip_key, 0), cache.get(code_key, 0)
    if ip_attempts >= IP_ATTEMPTS or code_attempts >= CODE_ATTEMPTS:
        return _refuse("rate_limited", status.HTTP_429_TOO_MANY_REQUESTS)
    proven = device_login.holds(account, credential) if credential else bool(password) and request.user.check_password(password)
    if not proven:
        cache.set(ip_key, ip_attempts + 1, timeout=LOGIN_WINDOW_SECONDS)
        cache.set(code_key, code_attempts + 1, timeout=LOGIN_WINDOW_SECONDS)
        return _refuse("wrong_password", status.HTTP_400_BAD_REQUEST,
                       remaining_attempts=max(0, CODE_ATTEMPTS - code_attempts - 1))
    return None


class SoulMfaVerifyView(APIView):
    """登录第二步。**限流**:同一账号 5 次不通过锁 15 分钟(记在账号上,换 IP、换待验证凭据都绕不过);
    另按 IP 记失败,15 分钟 50 次 —— 与密码登录同一组数字,挡一台机器拿很多凭据扫很多账号。"""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        request=SoulMfaVerifyRequestSerializer,
        responses={200: SoulMfaVerifyResponseSerializer, 400: SoulMfaRefusalSerializer,
                   401: SoulMfaRefusalSerializer, 429: SoulMfaRefusalSerializer},
    )
    def post(self, request):
        from apps.authentication.models import LoginLog
        from apps.core.client_ip import get_client_ip

        body = SoulMfaVerifyRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        ip_key = _ip_key(request)
        ip_failures = cache.get(ip_key, 0)
        if ip_failures >= IP_ATTEMPTS:
            return _refuse("rate_limited", status.HTTP_429_TOO_MANY_REQUESTS)
        ip, agent = get_client_ip(request), request.META.get("HTTP_USER_AGENT", "")[:500]
        account = mfa.account_from_pending(data["pending_token"])
        jti = mfa.pending_jti(data["pending_token"]) if account is not None else ""
        if account is None or mfa.core.pending_used(jti):
            cache.set(ip_key, ip_failures + 1, timeout=LOGIN_WINDOW_SECONDS)
            return _refuse("pending_invalid", status.HTTP_401_UNAUTHORIZED)
        username = f"soul:{account.soul.soul_code}"[:150]
        outcome = mfa.verify_second_step(
            account, code=data.get("code") or None, recovery_code=data.get("recovery_code") or None,
            request=request)
        if outcome["code"] != "ok":
            # 过期不计 IP 次数(与账号锁同一规则:慢手或钟差不是猜)。
            if outcome["code"] != "expired":
                cache.set(ip_key, ip_failures + 1, timeout=LOGIN_WINDOW_SECONDS)
            LoginLog.objects.create(user=account.user, username=username, status="FAILED", ip_address=ip,
                                    user_agent=agent, failure_reason=f"mfa_{outcome['code']}")
            return _refuse_outcome(outcome)
        if not mfa.core.claim_pending(jti):
            # 同一张凭据的两个请求同时验过了码:只有先占到的那个拿令牌。
            return _refuse("pending_invalid", status.HTTP_401_UNAUTHORIZED)
        method = "recovery" if data.get("recovery_code") else mfa.pending_method(data["pending_token"])
        device_token = mfa.remember_device(account) if data.get("remember_device") else ""
        LoginLog.objects.create(user=account.user, username=username, status="SUCCESS", ip_address=ip,
                                user_agent=agent, method=method)
        tokens = svc.complete_login(account, request=request, method=method,
                                    trust_hash=mfa.core._hash_device(device_token) if device_token else "")
        payload = {
            **tokens,
            "soul_code": account.soul.soul_code,
            "account": {
                "cycle": account.cycle, "must_change_password": account.must_change_password,
                "initial_password_expires_at": account.initial_password_expires_at,
                "created_at": account.created_at,
            },
        }
        if device_token:
            payload["device_token"] = device_token
        return Response(payload)


class MeMfaStatusView(SoulAPIView):
    @extend_schema(responses={200: SoulMfaStatusSerializer, 403: SoulMfaRefusalSerializer})
    def get(self, request):
        return Response(mfa.status_of(self.account))


class MeMfaSetupView(SoulAPIView):
    @extend_schema(request=SoulMfaSetupRequestSerializer,
                   responses={200: SoulMfaSetupResponseSerializer, 400: SoulMfaRefusalSerializer,
                              409: SoulMfaRefusalSerializer, 429: SoulMfaRefusalSerializer})
    def post(self, request):
        """当前密码 + 开始设置。密码不对 → 400 `wrong_password`,不产生密钥。错的次数记进**密码登录的那两个计数**
        (同一灵魂编号 5 次 / 同一 IP 50 次,15 分钟):偷到登录状态的人在这里猜密码,和在登录页猜吃同一份预算,
        满了答 429 `rate_limited`。"""
        body = SoulMfaSetupRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        refusal = confirm_current_password(request, self.account, body.validated_data["password"])
        if refusal is not None:
            return refusal
        try:
            secret, url = mfa.begin_setup(self.account)
        except svc.SoulAccountError as exc:
            return _error(exc)
        return Response({"secret": secret, "otpauth_url": url})

    @extend_schema(request=None, responses={204: OpenApiResponse(description="已作废")})
    def delete(self, request):
        mfa.cancel_setup(self.account)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeMfaConfirmView(SoulAPIView):
    @extend_schema(request=SoulMfaCodeRequestSerializer,
                   responses={200: SoulMfaRecoveryCodesSerializer, 400: SoulMfaRefusalSerializer,
                              409: SoulMfaRefusalSerializer})
    def post(self, request):
        body = SoulMfaCodeRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            outcome, codes = mfa.confirm_setup(self.account, body.validated_data["code"], request=request)
        except svc.SoulAccountError as exc:
            return _error(exc)
        if outcome != "ok":
            return _refuse(outcome, status.HTTP_400_BAD_REQUEST)
        return Response({"recovery_codes": codes})


class MeMfaRecoveryCodesView(SoulAPIView):
    @extend_schema(request=SoulMfaDisableRequestSerializer,
                   responses={200: SoulMfaRecoveryCodesSerializer, 400: SoulMfaRefusalSerializer,
                              409: SoulMfaRefusalSerializer, 429: SoulMfaRefusalSerializer})
    def post(self, request):
        """重新生成要确认是本人 —— 6 位数字或密码,与「关闭」同一把锁。用恢复码确认不行。
        没带 / 错了 → 旧码原样有效。"""
        body = SoulMfaDisableRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        try:
            outcome, codes = mfa.regenerate_recovery_codes(
                self.account, method=data["method"], code=data.get("code", ""), password=data.get("password", ""),
                request=request)
        except svc.SoulAccountError as exc:
            return _error(exc)
        if outcome["code"] != "ok":
            return _refuse_outcome(outcome)
        return Response({"recovery_codes": codes})


class MeMfaDisableView(SoulAPIView):
    @extend_schema(request=SoulMfaTurnOffRequestSerializer,
                   responses={200: SoulMfaStatusSerializer, 400: SoulMfaRefusalSerializer,
                              409: SoulMfaRefusalSerializer, 429: SoulMfaRefusalSerializer})
    def post(self, request):
        body = SoulMfaTurnOffRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        try:
            outcome = mfa.disable(self.account, method=data["method"], code=data["code"], request=request)
        except svc.SoulAccountError as exc:
            return _error(exc)
        if outcome["code"] != "ok":
            return _refuse_outcome(outcome)
        return Response(mfa.status_of(self.account))
