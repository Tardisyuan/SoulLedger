"""土地公(2026-10-28,只在地府):`/api/v1/death-sync/tudi-gods/`。

* 本殿的土地公:名字、管的地名、上级城隍、名下官员。看是 `judgment.read`,增改删是 `judgment.assign`
  —— 与城隍同一组码名(`apps/judgment/city_god_views.py`),土地公是城隍下面的一级。
* `{id}/register-death/`:以这位土地公的名义登记一条死亡。要 `soul.die`,且是他名下的官员或持 `judgment.assign`。
  走死亡同步的同一条处理(`DeathSyncService.register_by_tudi`):灵魂进 JUDGING、开审判、到十三站的土地庙,
  案子交他的上级城隍初审。答一条登记(与 `/death-sync/registrations/` 同一形状);失败也是一条 FAILED 的登记。
"""
from django.db import IntegrityError, transaction
from drf_spectacular.utils import extend_schema, extend_schema_field
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.authentication.models import User
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.death_sync.models import DeathRegistrationRequest, TudiGod
from apps.death_sync.serializers import DeathRegistrationCreateSerializer, DeathRegistrationRequestSerializer
from apps.death_sync.services import DeathSyncService
from apps.judgment.claims import is_assignable
from apps.judgment.models import CityGod

REGION_MAX_LENGTH = 50
REGIONS_MAX = 100


class TudiOfficerSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class TudiGodSerializer(serializers.ModelSerializer):
    regions = serializers.ListField(
        child=serializers.CharField(max_length=REGION_MAX_LENGTH, trim_whitespace=True, allow_blank=True),
        max_length=REGIONS_MAX, required=False,
    )
    city_god = serializers.PrimaryKeyRelatedField(queryset=CityGod.objects.all(), allow_null=True, required=False)
    city_god_name = serializers.CharField(source="city_god.name", read_only=True, allow_null=True)
    officer_ids = serializers.PrimaryKeyRelatedField(
        source="officers", many=True, queryset=User.objects.all(), required=False, write_only=True)
    officers = serializers.SerializerMethodField()
    registration_count = serializers.SerializerMethodField()

    class Meta:
        model = TudiGod
        fields = ("id", "tenant", "name", "regions", "city_god", "city_god_name", "officer_ids", "officers",
                  "registration_count", "create_time", "update_time")
        read_only_fields = ("id", "tenant", "create_time", "update_time")

    @extend_schema_field(TudiOfficerSerializer(many=True))
    def get_officers(self, obj) -> list:
        return [{"id": u.pk, "name": u.display_name or u.username} for u in obj.officers.order_by("username")]

    def get_registration_count(self, obj) -> int:
        return DeathRegistrationRequest.objects.filter(tudi_god=obj).count()

    def _tenant(self):
        return self.instance.tenant if self.instance else self.context["tenant"]

    def validate_name(self, value):
        others = TudiGod.objects.filter(tenant=self._tenant(), name=value)
        if self.instance is not None:
            others = others.exclude(pk=self.instance.pk)
        if others.exists():
            raise serializers.ValidationError({"code": "name_taken", "name": value})
        return value

    def validate_regions(self, value):
        return list(dict.fromkeys(r for r in value if r))

    def validate_city_god(self, value):
        """上级城隍必须是本殿的(与 `Judgment.city_god` 同一条:城隍不跨殿)。"""
        if value is not None and value.tenant_id != self._tenant().pk:
            raise serializers.ValidationError({"code": "invalid_city_god"})
        return value

    def validate_officer_ids(self, value):
        tenant = self._tenant()
        bad = sorted(u.pk for u in value if not is_assignable(u, tenant.pk, codename="soul.die"))
        if bad:
            raise serializers.ValidationError({"code": "invalid_officer", "ids": bad})
        return value


class TudiRegistrationRequestSerializer(DeathRegistrationCreateSerializer):
    """与外部登记同一组字段,外加可选的 `idempotency_key`(重复提交答同一条登记)。灵魂只认 `soul_lookup.soul_id`。"""

    idempotency_key = serializers.CharField(max_length=200, required=False)

    def validate_soul_lookup(self, value):
        if not value or "soul_id" not in value:
            raise serializers.ValidationError("Provide soul_lookup.soul_id.")
        return value


class TudiRefusalSerializer(serializers.Serializer):
    code = serializers.CharField()
    error = serializers.CharField()


class TudiGodViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """本殿的土地公(只有地府有):基层登记亡魂,报给上级城隍。删除是软删,他登记过的死亡照旧留着。"""

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "judgment"
    extra_permissions = {
        **{a: ["judgment.assign"] for a in ("create", "update", "partial_update", "destroy")},
        "register_death": ["soul.die"],
    }
    queryset = TudiGod.objects.select_related("city_god").prefetch_related("officers").all()
    serializer_class = TudiGodSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_serializer_context(self):
        return {**super().get_serializer_context(),
                "tenant": getattr(self.request, "tenant", None) or getattr(self.request.user, "tenant", None)}

    @extend_schema(responses={201: TudiGodSerializer, 400: TudiRefusalSerializer})
    def create(self, request, *args, **kwargs):
        from apps.souls.models import Civilization

        tenant = self.get_serializer_context()["tenant"]
        if tenant is None or tenant.known_civilization != Civilization.CHINESE:
            return Response({"error": "土地公 belong to 地府 only.", "code": "tudi_gods_diyu_only"},
                            status=status.HTTP_400_BAD_REQUEST)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        self._save(serializer, tenant=serializer.context["tenant"])

    def perform_update(self, serializer):
        self._save(serializer)

    @staticmethod
    def _save(serializer, **extra):
        try:
            with transaction.atomic():
                serializer.save(**extra)
        except IntegrityError:
            raise serializers.ValidationError({"name": {"code": "name_taken"}}) from None

    @extend_schema(responses={204: None})
    def destroy(self, request, *args, **kwargs):
        self.get_object().soft_delete(user=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=TudiRegistrationRequestSerializer,
                   responses={201: DeathRegistrationRequestSerializer, 403: TudiRefusalSerializer,
                              409: DeathRegistrationRequestSerializer})
    @action(detail=True, methods=["post"], url_path="register-death")
    def register_death(self, request, pk=None):
        from apps.perm.checker import check_permission

        tudi = self.get_object()
        if not (check_permission(request.user, "judgment.assign") or tudi.officers.filter(pk=request.user.pk).exists()):
            return Response({"code": "not_tudi_officer",
                             "error": "Only officers assigned to this 土地公, or a hall administrator, can register."},
                            status=status.HTTP_403_FORBIDDEN)
        body = TudiRegistrationRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        payload = dict(body.validated_data)
        key = payload.pop("idempotency_key", None)
        try:
            record = DeathSyncService.register_by_tudi(tudi, payload, key)
        except IntegrityError:
            existing = DeathRegistrationRequest.objects.filter(
                tenant=tudi.tenant, source_system="TUDI", idempotency_key=key).first()
            return Response(DeathRegistrationRequestSerializer(existing).data, status=status.HTTP_409_CONFLICT)
        return Response(DeathRegistrationRequestSerializer(record).data, status=status.HTTP_201_CREATED)
