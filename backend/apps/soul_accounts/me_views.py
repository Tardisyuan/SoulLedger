"""灵魂端接口:`/api/v1/soul-auth/`(登录、刷新、登出)与 `/api/v1/me/`(本人)。

**本人范围不是逐个视图补的。** 每个 `/me/` 视图都继承 `SoulAPIView`:认证只认灵魂令牌
(官员令牌 403),权限只认当前(未停用)灵魂账号,并在 `must_change_password` 期间拒绝
一切,除了显式声明 `allowed_before_password_change = True` 的改密视图。所有查询都从
`request.user.soul_account.soul` 出发,URL 里不接受任何灵魂 id。
`tests/test_soul_auth_boundary.py::test_every_me_route_is_a_soul_api_view` 走真实 URLconf 钉住这一点。
"""
from django.core.cache import cache
from drf_spectacular.utils import OpenApiResponse, PolymorphicProxySerializer, extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError

from apps.core.idempotency import idempotent
from apps.soul_accounts import mfa as soul_mfa
from apps.soul_accounts import rebirth
from apps.soul_accounts import services as svc
from apps.soul_accounts.authentication import (
    SOUL_RECYCLED,
    SoulJWTAuthentication,
    SoulRefreshToken,
    soul_is_recycled,
)
from apps.soul_accounts.models import RebirthApplication, SoulAccount
from apps.soul_accounts.serializers import (
    ChangePasswordRequestSerializer,
    CooldownShorteningCreateSerializer,
    MeCooldownShorteningSerializer,
    MeLifeSerializer,
    MeProfileSerializer,
    MeRebirthApplicationListSerializer,
    MeRebirthApplicationSerializer,
    MeSentencePlanSerializer,
    MeTenantSerializer,
    MeWelcomedRequestSerializer,
    MeWelcomedSerializer,
    RebirthAppealSerializer,
    RebirthApplicationCreateSerializer,
    SoulErrorSerializer,
    SoulLoginRequestSerializer,
    SoulLoginResponseSerializer,
    SoulMfaRequiredSerializer,
    SoulRefreshRequestSerializer,
    SoulTokenPairSerializer,
)

#: 三层,各 15 分钟一个窗口(2026-09-17 用户决定两层;2026-11-01 改成三层,review P2 #16):
#: 同一灵魂编号、同一 IP 5 次失败 —— 挡一台机器对单个账号猜密码(强度与此前相同);
#: 同一灵魂编号、所有 IP 合计 20 次 —— 挡换着 IP 对单个账号猜。此前编号这一层不看 IP、5 次就锁,
#: 知道编号的任何人都能把那个灵魂锁在门外;现在要动用 4 个以上 IP 才锁得住它,而真本人在自己那个 IP 上不受
#: 别的 IP 上那 5 次的影响;
#: 同一 IP 50 次失败 —— 挡一台机器扫很多编号,又不至于把运营商 NAT 后面的一群人一起锁死。
#: 编号的两层按「用途」分开计(`scope`):密码登录 `login`、面容登录 `face`、登录后的确认是本人 `confirm`,
#: 一处的失败不再消耗另一处的预算;IP 那一层三处共用。成功只清本用途、本编号的两层,不清 IP 层。
LOGIN_WINDOW_SECONDS = 900
CODE_ATTEMPTS = 5
CODE_ALL_IPS_ATTEMPTS = 20
IP_ATTEMPTS = 50


def _rate_keys(ip, soul_code, scope="login"):
    """→ (IP 键, 编号+IP 键, 编号键)。编号不以原文进缓存键:键名会出现在 Redis 的 MONITOR / 慢日志 / 备份里。
    哈希后的键仍按编号区分,但从键反推不出编号。"""
    import hashlib

    digest = hashlib.sha256(svc.normalize_soul_code(soul_code).encode()).hexdigest()[:32]
    return (f"soul_login_rate:ip:{ip}", f"soul_login_rate:{scope}:code:{digest}:ip:{ip}",
            f"soul_login_rate:{scope}:code:{digest}")


_LIMITS = (IP_ATTEMPTS, CODE_ATTEMPTS, CODE_ALL_IPS_ATTEMPTS)


def rate_limited(keys) -> bool:
    return any(cache.get(key, 0) >= limit for key, limit in zip(keys, _LIMITS, strict=True))


def count_failure(keys) -> int:
    """三层各记一次;→ 这个编号在这台机器上还能再错几次(两层编号预算里小的那个)。"""
    counts = []
    for key in keys:
        counts.append(cache.get(key, 0) + 1)
        cache.set(key, counts[-1], timeout=LOGIN_WINDOW_SECONDS)
    return max(0, min(CODE_ATTEMPTS - counts[1], CODE_ALL_IPS_ATTEMPTS - counts[2]))


def clear_after_success(keys) -> None:
    """成功只清这个编号(本用途)的计数。IP 计数不清:否则攻击者用自己的一个真账号登录一次,
    就能把整台机器的扫描预算重置。"""
    cache.delete_many(list(keys[1:]))


#: 两种 200:令牌,或开着两步验证时的 `mfa_required` + 短时效的待验证凭据(去 /soul-auth/mfa/verify/)。
#: 密码登录与面容/指纹登录同一个形状。
LOGIN_OUTCOME = PolymorphicProxySerializer(
    component_name="SoulLoginOutcome",
    serializers=[SoulLoginResponseSerializer, SoulMfaRequiredSerializer],
    resource_type_field_name=None,
)


def _error(exc: svc.SoulAccountError):
    return Response({"detail": str(exc), "code": exc.code}, status=exc.status)


class IsCurrentSoulAccount(BasePermission):
    def has_permission(self, request, view):
        account = getattr(request.user, "soul_account", None)
        if account is None or account.retired_at is not None:
            return False
        if account.must_change_password and not getattr(view, "allowed_before_password_change", False):
            if svc.initial_password_expired(account):
                raise PermissionDenied({"detail": "初始密码已过期。绑定了联系邮箱的,可以在登录页点「忘记密码」用邮箱自己重置;否则请联系官员重置。", "code": "initial_password_expired"})
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
        responses={
            200: LOGIN_OUTCOME,
            400: OpenApiResponse(description="字段校验失败"),
            401: SoulErrorSerializer, 429: SoulErrorSerializer,
        },
    )
    def post(self, request):
        from apps.authentication.models import LoginLog
        from apps.core.client_ip import get_client_ip

        ip = get_client_ip(request)
        body = SoulLoginRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        soul_code = body.validated_data["soul_code"]
        keys = _rate_keys(ip, soul_code)
        if rate_limited(keys):
            return Response({"detail": "登录尝试过于频繁,请 15 分钟后再试。", "code": "rate_limited"},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        user_agent = request.META.get("HTTP_USER_AGENT", "")[:500]
        try:
            account = svc.authenticate(soul_code, body.validated_data["password"])
        except svc.SoulAccountError as exc:
            count_failure(keys)
            LoginLog.objects.create(username=sign_in_username(soul_code), status="FAILED", ip_address=ip,
                                    user_agent=user_agent, failure_reason=exc.code)
            return _error(exc)
        return finish_first_step(account, soul_code, rate_keys=keys, ip=ip,
                                 user_agent=user_agent, device_token=body.validated_data.get("device_token"),
                                 request=request)


def sign_in_username(soul_code) -> str:
    """登录记录里的 `username`:`soul:` + 规范化后的编号(去空白、大写)。「登录记录」页按它找这个灵魂的失败行;
    原样记下用户手输的 ` abc ` 时,那几次失败在页上查不到(review-2026-11-01 P3)。"""
    return f"soul:{svc.normalize_soul_code(soul_code)}"[:150]


def finish_first_step(account, soul_code, *, rate_keys, ip, user_agent, device_token, request=None,
                      method="password", device_login=None):
    """第一步(密码或面容凭据)过了之后的共同尾巴:清编号计数;开着两步验证且手机不在免询问期内 →
    `mfa_required`,否则发令牌。**面容只代替密码,两步验证照常。**
    `device_login`:面容登录用的那一行凭据 —— 这次登录建出的会话记到它上面(经待验证凭据带到第二步也一样),
    退出这台设备时它跟着失效。"""
    from apps.authentication.models import LoginLog

    clear_after_success(rate_keys)
    if soul_mfa.is_enabled(account) and not soul_mfa.device_remembered(account, device_token):
        # 第二步:第一步对了,令牌还不发。待验证凭据只开 /soul-auth/mfa/verify/ 这一扇门。
        # 殿名随之返回(此时已过第一步这一关),供「手机和恢复码都没有了」一屏使用。
        return Response({
            "mfa_required": True,
            "pending_token": soul_mfa.issue_pending(account, method, device_login=device_login),
            "soul_code": account.soul.soul_code,
            "home_tenant": MeTenantSerializer(account.soul.home_tenant).data,
        })
    # 这次登录靠「这部手机不再询问」跳过了第二步:会话记着那枚设备令牌,退出这台时一并作废。
    tokens = svc.complete_login(account, request=request, method=method,
                                trust_hash=soul_mfa.core._hash_device(device_token) if device_token else "",
                                device_login=device_login)
    LoginLog.objects.create(user=account.user, username=sign_in_username(soul_code), status="SUCCESS",
                            ip_address=ip, user_agent=user_agent, method=method)
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
        from rest_framework_simplejwt.settings import api_settings

        from apps.authentication.signin_sessions import SessionAwareRefreshMixin

        class _Serializer(SessionAwareRefreshMixin, TokenRefreshSerializer):
            token_class = SoulRefreshToken

        # 灵魂在回收站里不续期(审计 2026-11-11 A2-01);恢复后旧的刷新令牌照常可用。
        # 在视图里答 401:这个视图没有认证类,序列化器里抛 AuthenticationFailed 会被 DRF 改成 403。
        try:
            user_id = SoulRefreshToken(request.data.get("refresh", "")).payload.get(api_settings.USER_ID_CLAIM)
        except TokenError:
            user_id = None  # 无效令牌交给下面的序列化器,答同一句 token_not_valid
        if user_id is not None and soul_is_recycled(SoulAccount.objects.filter(user_id=user_id).first()):
            return Response(SOUL_RECYCLED, status=status.HTTP_401_UNAUTHORIZED)

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
            from apps.authentication import signin_sessions

            token = SoulRefreshToken(request.data.get("refresh", ""))
            token.blacklist()
            signin_sessions.sign_out(token)
        except TokenError:
            pass  # 已失效的令牌不需要再作废;不把「令牌有效与否」当作一个可探测的回答
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── 本人 ─────────────────────────────────────────────────────────────────


class MeView(SoulAPIView):
    @extend_schema(responses={200: MeProfileSerializer, 403: SoulErrorSerializer})
    def get(self, request):
        account = self.account
        return Response(MeProfileSerializer(account.soul, context={"account": account}).data)


class MeWelcomedView(SoulAPIView):
    """记下「欢迎过场已为这个文明播过」(App 设计「文明气质」1b)。幂等:末项已是它就不写。

    已记过的文明被移到末尾而不是重复追加 —— 末项是「上一次欢迎进入的文明」,App 据此
    判断「回归原籍」要不要照播一次;列表本身仍是集合。只写本人这一行(`self.account`),
    行锁挡两台设备同时写时的丢更新。"""

    @extend_schema(request=MeWelcomedRequestSerializer,
                   responses={200: MeWelcomedSerializer, 400: OpenApiResponse(description="字段校验失败"),
                              403: SoulErrorSerializer})
    def post(self, request):
        from django.db import transaction

        body = MeWelcomedRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        civilization = body.validated_data["civilization"]
        with transaction.atomic():
            account = SoulAccount.objects.select_for_update().get(pk=self.account.pk)
            welcomed = list(account.welcomed_civilizations)
            if welcomed[-1:] != [civilization]:
                account.welcomed_civilizations = [c for c in welcomed if c != civilization] + [civilization]
                account.save(update_fields=["welcomed_civilizations"])
        return Response({"welcomed_civilizations": account.welcomed_civilizations})


class MePasswordView(SoulAPIView):
    allowed_before_password_change = True

    @extend_schema(request=ChangePasswordRequestSerializer,
                   responses={200: SoulTokenPairSerializer, 400: SoulErrorSerializer, 403: SoulErrorSerializer})
    def post(self, request):
        from django.core.exceptions import ValidationError

        body = ChangePasswordRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        from apps.authentication import signin_sessions

        # 这台设备留着(其余退出):它的会话从 access 的 `sid` 认;老令牌没有 `sid`,就给它补一条。
        keep = signin_sessions.session_of(request.auth) or signin_sessions.start(request.user, request)
        try:
            tokens = svc.change_password(self.account, body.validated_data["old_password"],
                                         body.validated_data["new_password"],
                                         push_token=body.validated_data["push_token"],
                                         device_credential=body.validated_data["device_credential"],
                                         keep_session=keep)
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


class MeSentencePlanView(SoulAPIView):
    """本人本世的受刑计划(App「我的受刑」)。只读;从 `self.account` 出发,不接受任何 id。"""

    @extend_schema(responses={200: MeSentencePlanSerializer, 403: SoulErrorSerializer})
    def get(self, request):
        from apps.sentence_plan.soul_view import soul_plan

        return Response(MeSentencePlanSerializer(soul_plan(self.account)).data)


class MeRebirthApplicationsView(SoulAPIView):
    @extend_schema(responses={200: MeRebirthApplicationListSerializer, 403: SoulErrorSerializer})
    def get(self, request):
        account = self.account
        can, reason, until = rebirth.eligibility(account)
        rows = (RebirthApplication.objects.filter(soul=account.soul, cycle=account.cycle)
                .select_related("workflow__current_node", "appeal_workflow__current_node"))
        can_shorten, _, _ = rebirth.cooldown_shortening_eligibility(account)
        shortening = rebirth.current_cooldown_shortening(account)
        return Response({
            "can_apply": can, "reason": reason, "cooldown_until": until,
            "results": MeRebirthApplicationSerializer(rows, many=True, context={"account": account}).data,
            "can_shorten_cooldown": can_shorten,
            "cooldown_shortening": MeCooldownShorteningSerializer(shortening).data if shortening else None,
        })

    @extend_schema(request=RebirthApplicationCreateSerializer,
                   responses={201: MeRebirthApplicationSerializer, 400: SoulErrorSerializer, 409: SoulErrorSerializer})
    @idempotent
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


class MeCooldownShorteningView(SoulAPIView):
    """冷却期内申请缩短本次冷却。状态在 `GET rebirth-applications/` 的 `cooldown_shortening` 里。"""

    @extend_schema(request=CooldownShorteningCreateSerializer,
                   responses={201: MeCooldownShorteningSerializer, 400: SoulErrorSerializer, 409: SoulErrorSerializer})
    def post(self, request):
        body = CooldownShorteningCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            row = rebirth.request_cooldown_shortening(self.account, **body.validated_data)
        except svc.SoulAccountError as exc:
            return _error(exc)
        return Response(MeCooldownShorteningSerializer(row).data, status=status.HTTP_201_CREATED)


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
