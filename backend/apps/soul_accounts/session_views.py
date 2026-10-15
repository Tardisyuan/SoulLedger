"""灵魂 App 的「登录设备与记录」(Design 第二十八批 S1)。与官员 Web 同一套规则(`authentication.session_views`)。

    GET  /me/sessions/                 登录设备
    POST /me/sessions/{id}/revoke/     退出一台
    POST /me/sessions/revoke-others/   除这部手机外全部退出
    GET  /me/sign-ins/                 最近 90 天的登录记录,成功与失败都有,连续的失败合成一行带次数

记录来自 `LoginLog`(登录各条路径本来就在写,密码错也写),不另建表;90 天之外的由
`authentication.prune_soul_sign_ins` 每天清掉。
"""
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.response import Response

from apps.authentication import session_views as shared
from apps.authentication import signin_sessions
from apps.authentication.models import LoginLog
from apps.soul_accounts.me_views import SoulAPIView
from apps.soul_accounts.serializers import SoulErrorSerializer
from apps.soul_accounts.services import audit

#: 登录记录只保留这么久(Design S1)。
HISTORY_DAYS = 90
HISTORY_LIMIT = 100


class SignInRecordSerializer(serializers.Serializer):
    at = serializers.DateTimeField()
    ok = serializers.BooleanField()
    #: password / face / recovery / mfa(第二步没过)
    method = serializers.CharField()
    device = serializers.CharField()
    #: 连续失败合并后的次数;成功的行恒为 1
    count = serializers.IntegerField()
    #: 失败的原因码(`invalid_credentials` / `mfa_wrong` …);成功为空
    reason = serializers.CharField(allow_blank=True)


def _failed_method(reason: str) -> str:
    if reason.startswith("device_login"):
        return "face"
    return "mfa" if reason.startswith("mfa_") else "password"


def sign_in_history(account, *, now=None) -> list[dict]:
    """新的在前。相邻的、原因相同的失败合成一行(时间取最近一次,`count` 为次数)。"""
    now = now or timezone.now()
    username = f"soul:{account.soul.soul_code}"
    rows = (LoginLog.objects.filter(timestamp__gte=now - timedelta(days=HISTORY_DAYS))
            .filter(Q(user=account.user) | Q(user__isnull=True, username__iexact=username))
            .order_by("timestamp", "pk"))
    merged: list[dict] = []
    for row in rows:
        ok = row.status == "SUCCESS"
        reason = "" if ok else row.failure_reason
        last = merged[-1] if merged else None
        if last is not None and not ok and not last["ok"] and last["reason"] == reason:
            last["count"] += 1
            last["at"] = row.timestamp
            continue
        merged.append({
            "at": row.timestamp, "ok": ok, "count": 1, "reason": reason,
            "method": (row.method or "password") if ok else _failed_method(reason),
            "device": signin_sessions.label_for(row.user_agent),
        })
    return merged[::-1][:HISTORY_LIMIT]


class MeSessionsView(SoulAPIView):
    @extend_schema(responses={200: shared.SignInSessionSerializer(many=True), 403: SoulErrorSerializer})
    def get(self, request):
        return Response(signin_sessions.listing(request.user, signin_sessions.session_of(request.auth)))


class MeSessionRevokeView(SoulAPIView):
    @extend_schema(request=None, responses={204: None, 400: shared.SessionRefusalSerializer,
                                            403: SoulErrorSerializer, 404: shared.SessionRefusalSerializer})
    def post(self, request, session_id):
        refusal, session = shared.revoke_one(request.user, request.auth, session_id)
        if refusal is not None:
            return refusal
        audit("UPDATE", self.account.soul, f"灵魂退出登录设备:{session.label}", actor=request.user,
              request=request, resource="soul_session", resource_id=session.pk,
              changes={"session_revoked": str(session.pk), "label": session.label})
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeSessionsRevokeOthersView(SoulAPIView):
    @extend_schema(request=None, responses={200: shared.RevokeOthersResponseSerializer,
                                            403: SoulErrorSerializer, 409: shared.SessionRefusalSerializer})
    def post(self, request):
        refusal, count = shared.revoke_others(request.user, request.auth)
        if refusal is not None:
            return refusal
        audit("UPDATE", self.account.soul, f"灵魂退出其他全部登录设备({count} 台)", actor=request.user,
              request=request, resource="soul_session", resource_id=self.account.pk,
              changes={"sessions_revoked": count})
        return Response({"revoked": count})


class MeSignInsView(SoulAPIView):
    @extend_schema(responses={200: SignInRecordSerializer(many=True), 403: SoulErrorSerializer})
    def get(self, request):
        return Response(sign_in_history(self.account))
