"""角色数据范围的接口(数据范围设计 B4,local-gates/rbac-2026-10-29/datascope-design.md「接口(B4)」)。

GET     /perm/data-scope/resources/     可单独设置范围的业务 [{key, label}](label 按 Accept-Language,zh 中文、其余英文)
GET|PUT /perm/roles/<id>/data-scope/    {default:{scope,orgs}, overrides:[{resource,scope,orgs}]}

读:持 system.settings(与权限页同一个码)。写:无殿且持 system.settings(`CanWriteGlobalSettings`)——
角色是各殿共用的。PUT 整份替换;ADMIN 角色拒改(它跳过范围,配了也不生效);DEFINE 机构不能空,机构可跨殿挑。
默认 ALL 不存行(没配 = 全部),所以「从没配过」与「配成全部」读回来一样。
"""
from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.client_ip import get_client_ip
from apps.core.locale import locale_from_request
from apps.core.schema import ErrorResponseSerializer
from apps.events.realtime import push_permission_refresh
from apps.perm import data_scope
from apps.perm.matrix import ADMIN_ROLE_NAME

from .models import Role, RoleDataScope
from .views import CanWriteGlobalSettings, HasSystemSettings

#: 注册表里每项业务的显示名 (zh, en)。`test_every_registered_resource_has_a_label` 守着不漏。
LABELS = {
    "soul": ("灵魂", "Souls"),
    "judgment": ("审判", "Judgments"),
    "disposition": ("处置", "Dispositions"),
    "reincarnation": ("轮回", "Reincarnations"),
    "soul_event": ("灵魂事件", "Soul events"),
    "capture": ("勾魂令", "Capture warrants"),
    "appeal": ("上诉", "Appeals"),
    "workflow": ("审批流程", "Approval workflows"),
    "user": ("用户", "Users"),
    "org": ("机构", "Organizations"),
}


def resource_keys():
    """注册表里的业务,按注册顺序去重。"""
    return list(dict.fromkeys(e.resource for e in data_scope.REGISTRY.values()))


SCOPES = [c for c, _ in RoleDataScope.SCOPE_CHOICES]


class DataScopeResourceSerializer(serializers.Serializer):
    key = serializers.CharField()
    label = serializers.CharField()


class DataScopeRuleSerializer(serializers.Serializer):
    scope = serializers.ChoiceField(choices=RoleDataScope.SCOPE_CHOICES)
    orgs = serializers.ListField(child=serializers.IntegerField(), required=False, default=list, max_length=500)

    def validate(self, attrs):
        if attrs["scope"] != data_scope.DEFINE:
            attrs["orgs"] = []  # 只有 DEFINE 用得上机构
        elif not attrs["orgs"]:
            raise serializers.ValidationError(
                {"orgs": ["DEFINE needs at least one organization."]}, code="define_without_orgs")
        attrs["orgs"] = sorted(set(attrs["orgs"]))
        return attrs


class DataScopeOverrideSerializer(DataScopeRuleSerializer):
    resource = serializers.ChoiceField(choices=resource_keys())


class RoleDataScopeConfigSerializer(serializers.Serializer):
    default = DataScopeRuleSerializer()
    overrides = DataScopeOverrideSerializer(many=True, required=False, default=list)

    def validate(self, attrs):
        from apps.org.models import Organization

        keys = [o["resource"] for o in attrs["overrides"]]
        if len(keys) != len(set(keys)):
            raise serializers.ValidationError({"overrides": ["Each resource at most once."]}, code="duplicate_resource")
        wanted = {pk for rule in (attrs["default"], *attrs["overrides"]) for pk in rule["orgs"]}
        missing = wanted - set(Organization.objects.filter(pk__in=wanted).values_list("pk", flat=True))
        if missing:
            raise serializers.ValidationError(
                {"orgs": [f"No such organization: {sorted(missing)}"]}, code="unknown_org")
        return attrs


def role_config(role):
    """角色当前的配置,GET / PUT 同形。"""
    default = {"scope": data_scope.ALL, "orgs": []}
    overrides = []
    for row in RoleDataScope.objects.filter(role=role).prefetch_related("orgs").order_by("resource"):
        rule = {"scope": row.scope, "orgs": sorted(o.pk for o in row.orgs.all())}
        if row.resource:
            overrides.append({"resource": row.resource, **rule})
        else:
            default = rule
    return {"default": default, "overrides": overrides}


def replace_role_config(role, config):
    """整份替换。默认 ALL 不存行。调用方负责事务。"""
    RoleDataScope.objects.filter(role=role).delete()
    rules = [("", config["default"])] if config["default"]["scope"] != data_scope.ALL else []
    rules += [(o["resource"], o) for o in config["overrides"]]
    for resource, rule in rules:
        row = RoleDataScope.objects.create(role=role, resource=resource, scope=rule["scope"])
        if rule["orgs"]:
            row.orgs.set(rule["orgs"])


@extend_schema(request=None, responses={200: DataScopeResourceSerializer(many=True)})
@api_view(["GET"])
@permission_classes([IsAuthenticated, HasSystemSettings])
def data_scope_resources(request):
    zh = locale_from_request(request).lower().startswith("zh")
    return Response([{"key": k, "label": LABELS[k][0 if zh else 1]} for k in resource_keys()])


@extend_schema(methods=["GET"], request=None, responses={200: RoleDataScopeConfigSerializer, 404: ErrorResponseSerializer})
@extend_schema(
    methods=["PUT"], request=RoleDataScopeConfigSerializer,
    responses={200: RoleDataScopeConfigSerializer, 400: ErrorResponseSerializer, 404: ErrorResponseSerializer},
)
@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated, HasSystemSettings])
def role_data_scope(request, pk):
    if request.method == "PUT" and not CanWriteGlobalSettings().has_permission(request, None):
        return Response({"error": "Only a hall-less administrator may change data scopes."},
                        status=status.HTTP_403_FORBIDDEN)
    role = Role.objects.filter(pk=pk).first()
    if role is None:
        return Response({"error": "Role not found"}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(role_config(role))

    if role.name == ADMIN_ROLE_NAME:
        return Response({"error": "ADMIN always sees everything; its data scope is fixed.", "code": "admin_role"},
                        status=status.HTTP_400_BAD_REQUEST)
    serializer = RoleDataScopeConfigSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    from apps.audit.models import AuditAction, AuditLog

    with transaction.atomic():
        before = role_config(role)
        replace_role_config(role, serializer.validated_data)
        after = role_config(role)
        if after != before:
            AuditLog.objects.create(
                tenant=getattr(request, "tenant", None),
                user=request.user,
                action=AuditAction.PERMISSION_CHANGE,
                resource="role",
                resource_id=str(role.pk),
                changes={"data_scope": {"old": before, "new": after}},
                description=f"Data scope of role {role.name} changed"[:500],
                ip_address=get_client_ip(request),
                user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
            )
    # 范围的求解只缓存在请求上(data_scope.request_cache),没有跨请求的缓存要失效;服务器端下一个请求即生效。
    # 已开的实时连接按新范围重算(各连接自己判断;B5 的 consumer 在刷新时重取范围)。
    push_permission_refresh()
    return Response(after)
