"""受刑计划的只读 API。`GET /api/v1/sentence-plans/`、`/{id}/`。"""
from django.db.models import Prefetch
from rest_framework import viewsets

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import is_tenant_exempt, scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin
from apps.sentence_plan.models import SentenceNode, SentencePlan, SentencePlanRequest
from apps.sentence_plan.serializers import SentencePlanSerializer


class SentencePlanPartyPermission(TenantPermission):
    """原属租户,或在计划上有节点的执行地租户。

    与 `apps/dispatch/permissions.py` 的两个 party permission 同一个理由:`TenantPermission`
    比的是 `obj.tenant`,而这张表的 `tenant` 记的是归属(原属),执行地也有权看到自己那一站。
    只给**可达性**;阶段 2 / 3 的写动作各自再判谁能写。
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


class SentencePlanViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    # 读计划是读案子的一部分:`judgment.read`(ADMIN / JUDGE / MODERATOR)。不另设码名族 ——
    # 与 `StatuteViewSet` 用 `judgment` 同一个理由;`sentence_plan.cancel` 在阶段 3 随撤销一起加。
    permission_classes = [SentencePlanPartyPermission, CodenamePermission]
    permission_codename = "judgment"
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
