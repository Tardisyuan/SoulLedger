"""勾魂牒的接口(规则在 `apps/dispatch/capture.py`):`/api/v1/dispatch/capture-warrants/`。

* GET 列表(`?soul=<id>` 只看一个灵魂,`?status=` 按状态)、GET 详情、GET `due/`(阳寿已到、还没有牒的灵魂):`soul.read`。
* POST 发牒、`{id}/capture/` 拘到、`{id}/hand-over/` 交接(登记死亡)、`{id}/cancel/` 撤销:`soul.die` ——
  交接就是登记死亡,与 `POST /souls/{id}/die/` 同一个码名。
"""
import uuid

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.dispatch import capture as capture_service
from apps.dispatch.models import CaptureEscort, CaptureStatus, CaptureWarrant
from apps.perm.filters import DataScopeFilter
from apps.souls.models import Soul


class CaptureWarrantSerializer(serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    soul_code = serializers.CharField(source="soul.soul_code", read_only=True, allow_null=True)
    city_god_name = serializers.CharField(source="city_god.name", read_only=True, allow_null=True)

    class Meta:
        model = CaptureWarrant
        fields = ("id", "soul", "soul_name", "soul_code", "city_god", "city_god_name", "escort", "status",
                  "issued_at", "captured_at", "handed_over_at", "judgment", "cancel_reason", "create_time")
        read_only_fields = fields


class CaptureIssueSerializer(serializers.Serializer):
    soul = serializers.UUIDField()
    #: 不给就按功过建议(`capture.suggested_escort`)。
    escort = serializers.ChoiceField(choices=CaptureEscort.choices, required=False)


class CaptureHandOverSerializer(serializers.Serializer):
    location = serializers.CharField(required=False, allow_blank=True, max_length=255)


class CaptureCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)


class CaptureRefusalSerializer(serializers.Serializer):
    code = serializers.CharField()
    detail = serializers.CharField()


class CaptureDueSoulSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    soul_code = serializers.CharField(allow_null=True)
    origin_location = serializers.CharField()
    fated_death_date = serializers.DateField()
    karmic_balance = serializers.IntegerField()
    suggested_escort = serializers.ChoiceField(choices=CaptureEscort.choices)


#: `due/` 一次最多给的行数;`count` 不受它限。
DUE_LIMIT = 200


class CaptureDueListSerializer(serializers.Serializer):
    """`due/`:`results` 最多 200 行;`count` 是全部待发的数(页头写它,不写截断后的行数)。"""

    count = serializers.IntegerField()
    results = CaptureDueSoulSerializer(many=True)


def _souls(request):
    """本殿、且在请求人数据范围里的灵魂(发牒与 `due/` 同一口径)。"""
    return DataScopeFilter.filter_queryset(request, scope_to_tenant(Soul.objects.all(), request), Soul)


class CaptureWarrantViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin,
                            mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """勾魂牒(只在地府):阳寿尽的灵魂由城隍发牒,鬼差拘到,交接时登记死亡。"""

    permission_classes = [TenantPermission, CodenamePermission]
    # 勾魂一族(用户 2026-10-29 第 3 条;原 soul.read / soul.die):发牒与撤销 capture.issue,拘到与交接 capture.execute。
    permission_codename = "capture"
    extra_permissions = {
        "due": ["capture.read"],
        "create": ["capture.issue"], "cancel": ["capture.issue"],
        "capture": ["capture.execute"], "hand_over": ["capture.execute"],
    }
    queryset = CaptureWarrant.objects.select_related("soul", "city_god").all()
    serializer_class = CaptureWarrantSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action != "list":
            return qs
        params = self.request.query_params
        try:
            soul = uuid.UUID(params["soul"]) if params.get("soul") else None
        except ValueError:
            raise serializers.ValidationError({"soul": ["Not a valid UUID."]}) from None
        if soul is not None:
            qs = qs.filter(soul_id=soul)
        if params.get("status") in CaptureStatus.values:
            qs = qs.filter(status=params["status"])
        return qs

    @extend_schema(parameters=[
        OpenApiParameter("soul", str, required=False, description="Only this soul's warrants."),
        OpenApiParameter("status", enum=CaptureStatus.values, required=False),
    ])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(request=CaptureIssueSerializer,
                   responses={201: CaptureWarrantSerializer, 404: CaptureRefusalSerializer,
                              409: CaptureRefusalSerializer})
    def create(self, request):
        body = CaptureIssueSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        # 与 `due/` 同一个范围(2026-10-29 审查):此前按 `tenant=<请求的租户>` 过滤,没有租户的 ADMIN 永远 404。
        # 数据范围(B3b):范围外的灵魂与别殿一样 404。
        soul = _souls(request).filter(pk=body.validated_data["soul"]).first()
        if soul is None:
            return Response({"code": "not_found", "detail": "Soul not found."}, status=status.HTTP_404_NOT_FOUND)
        warrant = capture_service.issue(soul, body.validated_data.get("escort"))
        return Response(CaptureWarrantSerializer(warrant).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses={200: CaptureWarrantSerializer, 409: CaptureRefusalSerializer})
    @action(detail=True, methods=["post"])
    def capture(self, request, pk=None):
        warrant = capture_service.capture(self.get_object().pk)
        return Response(CaptureWarrantSerializer(warrant).data)

    @extend_schema(request=CaptureHandOverSerializer,
                   responses={200: CaptureWarrantSerializer, 409: CaptureRefusalSerializer})
    @action(detail=True, methods=["post"], url_path="hand-over")
    def hand_over(self, request, pk=None):
        body = CaptureHandOverSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        warrant = capture_service.hand_over(self.get_object().pk, body.validated_data.get("location", ""))
        return Response(CaptureWarrantSerializer(warrant).data)

    @extend_schema(request=CaptureCancelSerializer,
                   responses={200: CaptureWarrantSerializer, 400: CaptureRefusalSerializer,
                              409: CaptureRefusalSerializer})
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        body = CaptureCancelSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        warrant = capture_service.cancel(self.get_object().pk, body.validated_data["reason"])
        return Response(CaptureWarrantSerializer(warrant).data)

    @extend_schema(responses=CaptureDueListSerializer)
    @action(detail=False, methods=["get"], pagination_class=None)
    def due(self, request):
        """阳寿已到、还在世、没有未了结勾魂牒的本殿地府灵魂(`results` 最多 200 个,阳寿早的在前;`count` 是总数)。"""
        due = capture_service.due_souls(_souls(request))
        souls = due[:DUE_LIMIT]
        return Response({"count": due.count(), "results": [{
            "id": s.pk, "name": s.name, "soul_code": s.soul_code, "origin_location": s.origin_location,
            "fated_death_date": f"{s.fated_death_year:04d}-{s.fated_death_month:02d}-{s.fated_death_day:02d}",
            "karmic_balance": s.karmic_balance, "suggested_escort": capture_service.suggested_escort(s),
        } for s in souls]})
