"""`/api/v1/assist-admin/`:助手管理页的后端(docs/ARCHITECTURE-assist-admin.md)。

**只许 ADMIN,按角色判断**(`role == "ADMIN"`),不走可授予的权限码 —— 否则「权限」页能把它
误授给别人。MODERATOR 与其余一律 403。官员令牌(`OfficerJWTAuthentication`)。
每次保存(配置、每殿开关)写一条 `resource="assistant_config"` 的审计;API key 只记「已更换 / 已清除」。
"""
from dataclasses import replace

from django.db import transaction
from django.db.models import Count
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.tenant import ADMIN_ROLE
from apps.soul_accounts.authentication import OfficerJWTAuthentication
from apps.soul_assist import config, corpus, eval_identities, evals, service, usage
from apps.soul_assist.admin_serializers import (
    CandidateSerializer,
    ConfigSerializer,
    ConfigUpdateSerializer,
    ConnectivityResultSerializer,
    CorpusSerializer,
    EvalCaseSerializer,
    EvalIdentitiesSerializer,
    EvalPreviewRequestSerializer,
    EvalPreviewSerializer,
    EvalRunDetailSerializer,
    EvalRunSerializer,
    EvalStartSerializer,
    HallSerializer,
    HallUpdateSerializer,
    UsageSerializer,
)
from apps.soul_assist.models import AssistConfig, AssistEvalCase, AssistEvalRun
from apps.soul_assist.serializers import AssistErrorSerializer


class IsAdminRole(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated
                    and getattr(request.user, "role", None) == ADMIN_ROLE)


class AdminView(APIView):
    authentication_classes = [OfficerJWTAuthentication]
    permission_classes = [IsAdminRole]


def _error(detail, code, http=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": detail, "code": code}, status=http)


def _key_required():
    return _error("换了供应商或地址,要同时填 API key:已存的 key 不会发往新的地址。", "api_key_required")


def _config_body(eff: config.Effective):
    from django.conf import settings

    key = eff.connection.api_key
    return ConfigSerializer({
        **{k: config.current_value(eff, k) for k in config.EDITABLE if k != "enabled"},
        # 地址里的 `user:pass@` 是凭证,与 key 一样只写不读;回传去敏形式时按「没改」处理(config.unredact)。
        "base_url": config.redact_url(eff.connection.base_url),
        "enabled": eff.enabled, "switch": eff.switch, "env_enabled": eff.env_enabled,
        # 末 4 位只在 key 足够长时给:短 key 的末 4 位就是它的一大半。
        "api_key": {"set": bool(key), "last4": key[-4:] if len(key) >= 12 else None,
                    "set_at": eff.api_key_set_at, "source": "page" if eff.api_key_set_at else "env"},
        "eval_soul_account": eff.eval_soul_account_id, "eval_officer": eff.eval_officer_id,
        "month_rolls_over_at": usage.ROLLOVER_TEXT,
        "overridden": list(eff.overridden),
        "read_only": {"max_concurrent": settings.ASSISTANT_MAX_CONCURRENT,
                      "timeout_seconds": settings.ASSISTANT_TIMEOUT_SECONDS,
                      "history_turns": settings.ASSISTANT_HISTORY_TURNS,
                      "retention_days": service.RETENTION_DAYS},
    }).data


class ConfigView(AdminView):
    @extend_schema(operation_id="assist_admin_config_retrieve", responses={200: ConfigSerializer})
    def get(self, request):
        from apps.soul_assist import usage

        usage.maybe_reopen()  # 管理员打开页面时就看到「新月份已自动重开」,不必等第一次提问
        return Response(_config_body(config.effective()))

    @extend_schema(operation_id="assist_admin_config_update", request=ConfigUpdateSerializer,
                   responses={200: ConfigSerializer, 400: AssistErrorSerializer})
    def patch(self, request):
        body = ConfigUpdateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = dict(body.validated_data)
        with transaction.atomic():
            AssistConfig.objects.get_or_create(pk=1)
            row = AssistConfig.objects.select_for_update().get(pk=1)
            # 「之前」与「之后」都按锁住的这一行算:两次并发的 PATCH 不能各自测过一半、合起来存下没测过的组合。
            eff = config.effective(row)
            data = config.unredact(data, eff.connection)
            try:
                after = config.candidate(data, eff.connection)
            except config.KeyRequiredError:
                return _key_required()
            # 连接的任何一项(供应商、地址、key、模型、effort、fallbacks)变了,都要先测通**同一套**候选,
            # 15 分钟内(§3.1)。唯一例外是只清除 key:key 泄露时要能立刻清掉,而没有 key 的配置测不通。
            only_clears_key = after == replace(eff.connection, api_key="")
            if after != eff.connection and not only_clears_key and not config.was_tested(after):
                return _error("连接配置变了:先用这套配置通过连通测试再保存。", "untested_connection")
            prices = data.get("prices", eff.prices)
            cap = data.get("monthly_cap", eff.monthly_cap)
            if cap is not None and after.model not in prices:
                return _error("设了月度上限,就要给当前模型填价格:否则花费算不出来,上限永远不会触发。",
                              "unpriced_model")
            api_key = data.pop("api_key", config._UNSET)
            config.save_changes(row, data, user=request.user, request=request, api_key=api_key)
        return Response(_config_body(config.effective()))


class ConfigTestView(AdminView):
    @extend_schema(operation_id="assist_admin_config_test", request=CandidateSerializer,
                   responses={200: ConnectivityResultSerializer, 400: AssistErrorSerializer})
    def post(self, request):
        body = CandidateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            conn = config.candidate(body.validated_data, config.effective().connection)
        except config.KeyRequiredError:
            return _key_required()
        result = evals.probe(conn)
        return Response(ConnectivityResultSerializer({
            **result, "provider": config.provider_name(conn.provider), "model": conn.model}).data)


def _halls():
    from apps.souls.models import Soul
    from apps.tenants.models import Tenant

    homed = dict(Soul.objects.order_by().values_list("home_tenant").annotate(n=Count("id")))
    return [{"id": t.pk, "code": t.code, "display_name": t.display_name, "souls_homed": homed.get(t.pk, 0),
             "assistant_enabled": (t.settings or {}).get("assistant_enabled") is True}
            for t in Tenant.objects.order_by("code")]


class HallListView(AdminView):
    @extend_schema(operation_id="assist_admin_halls_list", responses={200: HallSerializer(many=True)})
    def get(self, request):
        return Response(HallSerializer(_halls(), many=True).data)


class HallDetailView(AdminView):
    @extend_schema(operation_id="assist_admin_hall_update", request=HallUpdateSerializer,
                   responses={200: HallSerializer, 404: AssistErrorSerializer})
    def patch(self, request, tenant_id):
        from apps.tenants.models import Tenant

        body = HallUpdateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        on = body.validated_data["assistant_enabled"]
        with transaction.atomic():
            tenant = Tenant.objects.select_for_update().filter(pk=tenant_id).first()
            if tenant is None:
                return _error("没有这个殿。", "not_found", status.HTTP_404_NOT_FOUND)
            old = (tenant.settings or {}).get("assistant_enabled") is True
            tenant.settings = {**(tenant.settings or {}), "assistant_enabled": on}
            tenant.save(update_fields=["settings"])
            config.audit(request.user, f"hall assistant switch {tenant.code}",
                         {"assistant_enabled": [old, on]}, request, resource_id=f"tenant:{tenant.code}")
        return Response(HallSerializer(next(h for h in _halls() if h["id"] == tenant.pk)).data)


class EvalIdentitiesView(AdminView):
    @extend_schema(operation_id="assist_admin_eval_identities_ensure", request=None,
                   responses={200: EvalIdentitiesSerializer})
    def post(self, request):
        account, officer, note = eval_identities.ensure(request.user, request)
        desc = (f"评测灵魂「{account.soul.name}」与评测官员 {officer.username}(角色 {officer.role},均不可登录)"
                f"在 {account.soul.tenant.code} 殿。{note}").strip()
        return Response(EvalIdentitiesSerializer({
            "eval_soul_account": account.pk, "eval_officer": officer.pk, "officer_username": officer.username,
            "officer_role": officer.role, "description": desc}).data)


class EvalCaseListView(AdminView, generics.ListCreateAPIView):
    serializer_class = EvalCaseSerializer
    queryset = AssistEvalCase.objects.all()
    pagination_class = None


class EvalCaseDetailView(AdminView, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = EvalCaseSerializer
    queryset = AssistEvalCase.objects.all()


def _cases(side):
    qs = AssistEvalCase.objects.filter(active=True)
    return list(qs if side == "both" else qs.filter(side=side))


class EvalPreviewView(AdminView):
    @extend_schema(operation_id="assist_admin_eval_preview", request=EvalPreviewRequestSerializer,
                   responses={200: EvalPreviewSerializer, 400: AssistErrorSerializer})
    def post(self, request):
        body = EvalPreviewRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        try:
            preview = evals.preview(data["candidates"], _cases(data["side"]), request.user)
        except config.KeyRequiredError:
            return _key_required()
        return Response(EvalPreviewSerializer(preview).data)


class EvalRunListView(AdminView):
    @extend_schema(operation_id="assist_admin_eval_runs_list", responses={200: EvalRunSerializer(many=True)})
    def get(self, request):
        evals.fail_stale()
        return Response(EvalRunSerializer(AssistEvalRun.objects.all()[:50], many=True).data)

    @extend_schema(operation_id="assist_admin_eval_run_start", request=EvalStartSerializer,
                   responses={202: EvalRunSerializer, 400: AssistErrorSerializer})
    def post(self, request):
        from apps.soul_assist.tasks import run_eval

        body = EvalStartSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        run = evals.start(body.validated_data["confirm_token"], request.user)
        if run is None:
            return _error("确认已过期或已用过,请重新预估。", "invalid_confirm_token")
        transaction.on_commit(lambda: run_eval.delay(run.pk))
        return Response(EvalRunSerializer(run).data, status=status.HTTP_202_ACCEPTED)


class EvalRunDetailView(AdminView, generics.RetrieveAPIView):
    serializer_class = EvalRunDetailSerializer
    queryset = AssistEvalRun.objects.prefetch_related("results")


class UsageView(AdminView):
    @extend_schema(operation_id="assist_admin_usage", responses={200: UsageSerializer, 400: AssistErrorSerializer},
                   parameters=[OpenApiParameter("month", str, description="YYYY-MM,缺省本月")])
    def get(self, request):
        month = request.query_params.get("month")
        try:
            at = usage.month_of(month) if month else None
        except ValueError:
            return _error("month 要写成 YYYY-MM。", "invalid_month")
        eff = config.effective()
        return Response(UsageSerializer({**usage.report(eff.prices, at), "cap": eff.monthly_cap}).data)


class CorpusView(AdminView):
    @extend_schema(operation_id="assist_admin_corpus", responses={200: CorpusSerializer})
    def get(self, request):
        entries = [{"id": e["id"], "locale": locale, "audience": audience, "screens": e["screens"],
                    "civilizations": e["civilizations"], "tokens": usage.estimate_tokens(e["body"])}
                   for locale in corpus.LOCALES for audience in corpus.AUDIENCES
                   for e in corpus.entries(locale, audience)]
        prompts = usage.corpus_prompts(corpus)
        return Response(CorpusSerializer({"entries": entries, "prompts": prompts,
                                          "total_tokens": max(p["tokens"] for p in prompts),
                                          "threshold": usage.CORPUS_TOKEN_THRESHOLD}).data)

