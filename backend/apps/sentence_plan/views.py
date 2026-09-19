"""受刑计划 API。

读:`GET /api/v1/sentence-plans/`、`/{id}/`(原属租户 + 有节点的执行地租户)。
写(阶段 3,docs/ARCHITECTURE-sentence-plan.md §4、§3.1):
* `POST /{id}/requests/`                     情况 2.1 / 2.2:提出方判官提 AMEND / REOPEN 请求
* `POST /{id}/requests/{request_id}/decide/`   原审判官(原属租户)ACCEPT / REJECT
* `POST /{id}/requests/{request_id}/withdraw/` 提出方撤回
* `POST /{id}/cancel/`                       撤销整份计划(`sentence_plan.cancel`,原属租户)
"""
from django.db.models import Prefetch
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import is_tenant_exempt, scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin
from apps.sentence_plan import requests as plan_requests
from apps.sentence_plan.models import SentenceNode, SentencePlan, SentencePlanRequest
from apps.sentence_plan.serializers import (
    SentencePlanCancelSerializer,
    SentencePlanRequestCreateSerializer,
    SentencePlanRequestDecideSerializer,
    SentencePlanRequestSerializer,
    SentencePlanSerializer,
)


class SentencePlanPartyPermission(TenantPermission):
    """原属租户,或在计划上有节点的执行地租户。

    与 `apps/dispatch/permissions.py` 的两个 party permission 同一个理由:`TenantPermission`
    比的是 `obj.tenant`,而这张表的 `tenant` 记的是归属(原属),执行地也有权看到自己那一站。
    只给**可达性**;写动作各自再判谁能写(决定、撤销只原属;撤回只提出方)。
    """

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False
        if is_tenant_exempt(request.user):
            return True
        tenant = getattr(request, "tenant", None)
        if tenant is None:
            return False
        if obj.tenant_id == tenant.pk:
            return True
        return obj.nodes.filter(is_deleted=False, tenant_code=tenant.code).exists()


def _ordered_children():
    return (
        Prefetch("nodes", queryset=SentenceNode.objects.order_by("order")),
        Prefetch("requests", queryset=SentencePlanRequest.objects.order_by("-create_time")),
    )


def _refused(exc):
    return Response({"error": str(exc), "code": exc.code, **exc.extra}, status=exc.status)


REQUEST_ID = OpenApiParameter("request_id", OpenApiTypes.UUID, OpenApiParameter.PATH,
                              description="The SentencePlanRequest on this plan.")


class SentencePlanViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    # 读计划是读案子的一部分:`judgment.read`(ADMIN / JUDGE / MODERATOR)。提 / 决定 / 撤回请求是
    # 对案子的动作:`judgment.execute`,与 `conclude` 同一个码(§2.5)。撤销整份计划另有
    # `sentence_plan.cancel`(ADMIN / MODERATOR,同 `dispatch.return` 的持有者)。
    permission_classes = [SentencePlanPartyPermission, CodenamePermission]
    permission_codename = "judgment"
    extra_permissions = {
        "file_request": ["judgment.execute"],
        "decide": ["judgment.execute"],
        "withdraw": ["judgment.execute"],
        "cancel": ["sentence_plan.cancel"],
    }
    #: 暂居写例外(apps/core/tenant.py::residence_writable)的唯一声明处:批准 REOPEN 请求时,
    #: 原属地为暂居在外的灵魂开重开审判。清单钉在 tests/test_tenant_scoping_contract.py::RESIDENCE_WRITABLE。
    residence_write_actions = ("decide",)
    queryset = SentencePlan.objects.all()
    serializer_class = SentencePlanSerializer
    filterset_fields = ["soul", "status", "cycle"]
    ordering_fields = ["create_time", "completed_at"]

    def get_queryset(self):
        """原属租户的计划(经 `scope_to_tenant`),加上本租户有节点的计划。

        右半边是「节点方可读」(设计稿 §2.5),形状同 `DispatchRecordViewSet` 的「源或目标」;
        `.distinct()`:它连了 nodes,一个计划有几个本租户节点就回来几次。
        """
        qs = SentencePlan.objects.select_related("soul", "tenant").prefetch_related(*_ordered_children())
        home = scope_to_tenant(qs, self.request)
        tenant = getattr(self.request, "tenant", None)
        if tenant is None or is_tenant_exempt(self.request.user):
            return home
        return (home | qs.filter(nodes__tenant_code=tenant.code, nodes__is_deleted=False)).distinct()

    def _home_or_403(self, plan):
        if is_tenant_exempt(self.request.user):
            return None
        tenant = getattr(self.request, "tenant", None)
        if tenant is None or tenant.pk != plan.tenant_id:
            return Response({"error": "Only the soul's home tenant may do this", "code": "not_home"},
                            status=status.HTTP_403_FORBIDDEN)
        return None

    def _plan_response(self, plan):
        fresh = self.get_queryset().get(pk=plan.pk)
        return Response(SentencePlanSerializer(fresh, context=self.get_serializer_context()).data)

    @extend_schema(request=SentencePlanRequestCreateSerializer, responses={201: SentencePlanRequestSerializer})
    @action(detail=True, methods=["post"], url_path="requests")
    def file_request(self, request, pk=None):
        """情况 2.1 / 2.2(§4.1):提出方租户的判官提请求。灵魂在本地 → 400,开加减项审判。"""
        plan = self.get_object()
        body = SentencePlanRequestCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        tenant = getattr(request, "tenant", None) or getattr(request.user, "tenant", None)
        if tenant is None:
            return Response({"error": "No tenant context", "code": "no_tenant"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            req = plan_requests.file_request(
                plan, tenant, kind=body.validated_data["kind"], changes=body.validated_data.get("changes"),
                reason=body.validated_data.get("reason", ""), user=request.user,
            )
        except plan_requests.PlanChangeRefusedError as exc:
            return _refused(exc)
        return Response(SentencePlanRequestSerializer(req).data, status=status.HTTP_201_CREATED)

    @extend_schema(parameters=[REQUEST_ID], request=SentencePlanRequestDecideSerializer,
                   responses=SentencePlanSerializer)
    @action(detail=True, methods=["post"], url_path=r"requests/(?P<request_id>[^/.]+)/decide")
    def decide(self, request, pk=None, request_id=None):
        """原审判官决定(Q2):只有原属租户(或 ADMIN)。ACCEPT 立刻应用;REOPEN 立刻在原属地开审(Q7)。"""
        plan = self.get_object()
        refused = self._home_or_403(plan)
        if refused is not None:
            return refused
        body = SentencePlanRequestDecideSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            plan_requests.decide(plan, request_id, accept=body.validated_data["decision"] == "ACCEPT",
                                 reason=body.validated_data.get("reason", ""), user=request.user)
        except plan_requests.PlanChangeRefusedError as exc:
            return _refused(exc)
        return self._plan_response(plan)

    @extend_schema(parameters=[REQUEST_ID], request=None, responses=SentencePlanSerializer)
    @action(detail=True, methods=["post"], url_path=r"requests/(?P<request_id>[^/.]+)/withdraw")
    def withdraw(self, request, pk=None, request_id=None):
        """提出方撤回(§4.2)。"""
        plan = self.get_object()
        try:
            plan_requests.withdraw(plan, request_id, tenant=getattr(request, "tenant", None),
                                   exempt=is_tenant_exempt(request.user), user=request.user)
        except plan_requests.PlanChangeRefusedError as exc:
            return _refused(exc)
        return self._plan_response(plan)

    @extend_schema(request=SentencePlanCancelSerializer, responses=SentencePlanSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """撤销整份计划(Q11,§3.1)。理由必填、写审计;灵魂在外不自动回归。"""
        plan = self.get_object()
        refused = self._home_or_403(plan)
        if refused is not None:
            return refused
        body = SentencePlanCancelSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            plan_requests.cancel(plan, reason=body.validated_data["reason"], user=request.user)
        except plan_requests.PlanChangeRefusedError as exc:
            return _refused(exc)
        return self._plan_response(plan)
