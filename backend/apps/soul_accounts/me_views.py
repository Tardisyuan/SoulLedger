"""灵魂端接口:`/api/v1/soul-auth/`(登录、刷新、登出)与 `/api/v1/me/`(本人)。

**本人范围不是逐个视图补的。** 每个 `/me/` 视图都继承 `SoulAPIView`:认证只认灵魂令牌
(官员令牌 403),权限只认当前(未停用)灵魂账号,并在 `must_change_password` 期间拒绝
一切,除了显式声明 `allowed_before_password_change = True` 的改密视图。所有查询都从
`request.user.soul_account.soul` 出发,URL 里不接受任何灵魂 id。
`tests/test_soul_auth_boundary.py::test_every_me_route_is_a_soul_api_view` 走真实 URLconf 钉住这一点。
"""
from django.core.cache import cache
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError

from apps.soul_accounts import rebirth
from apps.soul_accounts import services as svc
from apps.soul_accounts.authentication import SoulJWTAuthentication, SoulRefreshToken
from apps.soul_accounts.models import RebirthApplication
from apps.soul_accounts.serializers import (
    ChangePasswordRequestSerializer,
    MeLifeSerializer,
    MeProfileSerializer,
    MeRebirthApplicationListSerializer,
    MeRebirthApplicationSerializer,
    RebirthAppealSerializer,
    RebirthApplicationCreateSerializer,
    SoulErrorSerializer,
    SoulLoginRequestSerializer,
    SoulLoginResponseSerializer,
    SoulRefreshRequestSerializer,
    SoulTokenPairSerializer,
)

LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 900


def _error(exc: svc.SoulAccountError):
    return Response({"detail": str(exc), "code": exc.code}, status=exc.status)


class IsCurrentSoulAccount(BasePermission):
    def has_permission(self, request, view):
        account = getattr(request.user, "soul_account", None)
        if account is None or account.retired_at is not None:
            return False
        if account.must_change_password and not getattr(view, "allowed_before_password_change", False):
            if svc.initial_password_expired(account):
                raise PermissionDenied({"detail": "初始密码已过期,请联系官员重置。", "code": "initial_password_expired"})
            raise PermissionDenied({"detail": "首次登录须先修改密码。", "code": "password_change_required"})
        return True


class SoulAPIView(APIView):
    authentication_classes = [SoulJWTAuthentication]
    permission_classes = [IsCurrentSoulAccount]
    allowed_before_password_change = False

    @property
    def account(self):
        return self.request.user.soul_account


# ── 登录 / 刷新 / 登出 ────────────────────────────────────────────────────


class SoulLoginView(APIView):
    """同一个后端、另一个端点,而不是官员登录按客户端区分:两者签发的令牌**类型**不同,
    一个端点按请求头分支签两种令牌,等于把分界交给了客户端自报的一个字段。"""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        request=SoulLoginRequestSerializer,
        responses={200: SoulLoginResponseSerializer, 400: OpenApiResponse(description="字段校验失败"),
                   401: SoulErrorSerializer, 429: SoulErrorSerializer},
    )
    def post(self, request):
        from apps.authentication.models import LoginLog
        from apps.core.client_ip import get_client_ip

        ip = get_client_ip(request)
        rate_key = f"soul_login_rate:{ip}"
        attempts = cache.get(rate_key, 0)
        if attempts >= LOGIN_ATTEMPTS:
            return Response({"detail": "登录尝试过于频繁,请 15 分钟后再试。", "code": "rate_limited"},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        body = SoulLoginRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        soul_code = body.validated_data["soul_code"]
        user_agent = request.META.get("HTTP_USER_AGENT", "")[:500]
        try:
            account, tokens = svc.login(soul_code, body.validated_data["password"])
        except svc.SoulAccountError as exc:
            cache.set(rate_key, attempts + 1, timeout=LOGIN_WINDOW_SECONDS)
            LoginLog.objects.create(username=f"soul:{soul_code}"[:150], status="FAILED", ip_address=ip,
                                    user_agent=user_agent, failure_reason=exc.code)
            return _error(exc)
        cache.delete(rate_key)
        LoginLog.objects.create(user=account.user, username=f"soul:{soul_code}"[:150], status="SUCCESS",
                                ip_address=ip, user_agent=user_agent)
        return Response({
            **tokens,
            "soul_code": account.soul.soul_code,
            "account": {
                "cycle": account.cycle, "must_change_password": account.must_change_password,
                "initial_password_expires_at": account.initial_password_expires_at,
                "created_at": account.created_at,
            },
        })


class SoulRefreshView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=SoulRefreshRequestSerializer,
                   responses={200: SoulTokenPairSerializer, 401: SoulErrorSerializer})
    def post(self, request):
        from rest_framework_simplejwt.serializers import TokenRefreshSerializer

        class _Serializer(TokenRefreshSerializer):
            token_class = SoulRefreshToken

        body = _Serializer(data=request.data)
        try:
            body.is_valid(raise_exception=True)
        except TokenError:
            return Response({"detail": "刷新令牌无效或已过期。", "code": "token_not_valid"},
                            status=status.HTTP_401_UNAUTHORIZED)
        return Response(body.validated_data)


class SoulLogoutView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=SoulRefreshRequestSerializer, responses={204: None})
    def post(self, request):
        try:
            SoulRefreshToken(request.data.get("refresh", "")).blacklist()
        except TokenError:
            pass  # 已失效的令牌不需要再作废;不把「令牌有效与否」当作一个可探测的回答
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── 本人 ─────────────────────────────────────────────────────────────────


class MeView(SoulAPIView):
    @extend_schema(responses={200: MeProfileSerializer, 403: SoulErrorSerializer})
    def get(self, request):
        account = self.account
        return Response(MeProfileSerializer(account.soul, context={"account": account}).data)


class MePasswordView(SoulAPIView):
    allowed_before_password_change = True

    @extend_schema(request=ChangePasswordRequestSerializer,
                   responses={200: SoulTokenPairSerializer, 400: SoulErrorSerializer, 403: SoulErrorSerializer})
    def post(self, request):
        from django.core.exceptions import ValidationError

        body = ChangePasswordRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            tokens = svc.change_password(self.account, body.validated_data["old_password"],
                                         body.validated_data["new_password"])
        except svc.SoulAccountError as exc:
            return _error(exc)
        except ValidationError as exc:
            return Response({"detail": " ".join(exc.messages), "code": "weak_password"}, status=400)
        return Response(tokens)


def build_lives(account, *, past: bool):
    """本世(`past=False`)或全部前世(`past=True`)。每类数据按 `soul + cycle` **一次**查出
    再按 cycle 分组 —— 不沿 previous_account 走链。"""
    from apps.disposition.models import Disposition
    from apps.judgment.models import Judgment
    from apps.reincarnation.models import Reincarnation
    from apps.souls.record_models import RecordType, SoulRecord

    soul = account.soul
    cycle_filter = {"cycle__lt": account.cycle} if past else {"cycle": account.cycle}
    cycles = list(range(account.cycle)) if past else [account.cycle]
    lives = {c: {"cycle": c, "records": [], "judgments": [], "dispositions": [],
                 "rebirth_applications": [], "reincarnation": None} for c in cycles}

    def put(key, rows, cycle_of=lambda row: row.cycle):
        for row in rows:
            life = lives.get(cycle_of(row))
            if life is not None:
                life[key].append(row)

    put("records", SoulRecord.objects.filter(
        soul=soul, record_type__in=[RecordType.MERIT, RecordType.DEMERIT], **cycle_filter).order_by("recorded_at"))
    put("judgments", Judgment.objects.filter(soul=soul, **cycle_filter).select_related("judge").order_by("created_at"))
    put("dispositions", Disposition.objects.filter(soul=soul, **cycle_filter)
        .select_related("destination_realm").order_by("created_at"))
    put("rebirth_applications", RebirthApplication.objects.filter(soul=soul, **cycle_filter)
        .select_related("workflow__current_node", "appeal_workflow__current_node").order_by("created_at"))
    if past:
        # 结束第 N 世的是 cycle_count = N+1 的那次转世。
        for reincarnation in Reincarnation.objects.filter(soul=soul, cycle_count__lte=account.cycle):
            life = lives.get(reincarnation.cycle_count - 1)
            if life is not None:
                life["reincarnation"] = reincarnation
    return [lives[c] for c in cycles]


class MeLifeView(SoulAPIView):
    @extend_schema(responses={200: MeLifeSerializer, 403: SoulErrorSerializer})
    def get(self, request):
        account = self.account
        return Response(MeLifeSerializer(build_lives(account, past=False)[0], context={"account": account}).data)


class MePastLivesView(SoulAPIView):
    @extend_schema(responses={200: MeLifeSerializer(many=True), 403: SoulErrorSerializer})
    def get(self, request):
        account = self.account
        return Response(MeLifeSerializer(build_lives(account, past=True), many=True,
                                         context={"account": account}).data)


class MeRebirthApplicationsView(SoulAPIView):
    @extend_schema(responses={200: MeRebirthApplicationListSerializer, 403: SoulErrorSerializer})
    def get(self, request):
        account = self.account
        can, reason, until = rebirth.eligibility(account)
        rows = (RebirthApplication.objects.filter(soul=account.soul, cycle=account.cycle)
                .select_related("workflow__current_node", "appeal_workflow__current_node"))
        return Response({
            "can_apply": can, "reason": reason, "cooldown_until": until,
            "results": MeRebirthApplicationSerializer(rows, many=True, context={"account": account}).data,
        })

    @extend_schema(request=RebirthApplicationCreateSerializer,
                   responses={201: MeRebirthApplicationSerializer, 409: SoulErrorSerializer})
    def post(self, request):
        body = RebirthApplicationCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            application = rebirth.submit(self.account, **body.validated_data)
        except svc.SoulAccountError as exc:
            return _error(exc)
        return Response(MeRebirthApplicationSerializer(application, context={"account": self.account}).data,
                        status=status.HTTP_201_CREATED)


class MeRebirthApplicationDetailView(SoulAPIView):
    @extend_schema(operation_id="v1_me_rebirth_applications_detail",
                   responses={200: MeRebirthApplicationSerializer, 404: SoulErrorSerializer})
    def get(self, request, application_id):
        application = RebirthApplication.objects.filter(pk=application_id, soul=self.account.soul).first()
        if application is None:
            return Response({"detail": "申请不存在。", "code": "not_found"}, status=404)
        return Response(MeRebirthApplicationSerializer(application, context={"account": self.account}).data)


class MeRebirthAppealView(SoulAPIView):
    @extend_schema(request=RebirthAppealSerializer,
                   responses={200: MeRebirthApplicationSerializer, 403: SoulErrorSerializer,
                              404: SoulErrorSerializer, 409: SoulErrorSerializer})
    def post(self, request, application_id):
        body = RebirthAppealSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            application = rebirth.appeal(self.account, application_id, **body.validated_data)
        except svc.SoulAccountError as exc:
            return _error(exc)
        return Response(MeRebirthApplicationSerializer(application, context={"account": self.account}).data)
