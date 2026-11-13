"""「为什么我点不了?」(docs/audit/2026-11-12-portfolio-ai-ideas.md 第二部分接入点 6)。

`GET /api/v1/perm/explain/?action=<权限码>[&object=<类型>:<id>]`

**原因由代码算,不由模型判断。** `explain()` 按 `check_permission` 本身的顺序重走一遍硬规则(灵魂账号、
全局专属、管理员专属、角色禁用、设计 / 审批互斥、缺授予),再看只读代看,再用那个页面自己的视图集
`get_queryset()` 问这条记录在不在调用者的范围里(殿级隔离、暂居只读、行级数据范围全在里面,与
`soul_assist/officer_tools.py` 同一个办法)。

**只解释调用者自己。** 不收用户参数。对范围外的对象只说 `out_of_scope`:不分「别殿的」「不存在」「数据范围外」,
与 404 同一个口径 —— 否则这个接口就是一个探测别人记录是否存在的工具。附带的 `scope_kinds` 只是调用者自己
角色的范围配置,不涉及那条记录。

**模型只措辞,而且可以没有。** 殿开了助手才把算好的结论(只有码、名称、角色名、原因码,不含任何记录内容)
交给模型写成一句话;模型里出现结论之外的权限码或角色名就不用它。没有模型、模型不可用、措辞没过检查时
`explanation` 为 null,页面按 `reason` 用语言包里的句子(`perm_explain.reason.*`)—— 那句才是兜底。
"""
import json
import re

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.locale import locale_from_request
from apps.core.permissions import TenantPermission
from apps.perm import checker, data_scope

#: 解释给出的原因码。前端语言包 `perm_explain.reason.<码>` 每个都有一句,测试钉住两边一致。
REASONS = ("allowed", "soul_account", "global_admin_only", "admin_only", "role_forbidden", "design_approve_conflict",
           "missing_permission", "viewing_read_only", "out_of_scope")
READ_ONLY_CODENAME = re.compile(r"\.(read|view|list)$")  # 与前端 useImpersonation.ts 同一条
_CODENAME = re.compile(r"^[a-z_]{1,40}\.[a-z_]{1,40}$")
_OBJECT = re.compile(r"^([a-z_]{1,20}):([0-9A-Za-z-]{1,64})$")


def _viewsets():
    """对象类型 → (视图集, 数据范围的业务键)。只收这几类:解释的是「这页上的这条」,不是任意表。"""
    from apps.judgment.views import JudgmentViewSet
    from apps.souls.views import SoulViewSet
    from apps.workflow.views import ApprovalWorkflowViewSet

    return {"judgment": (JudgmentViewSet, "judgment"), "soul": (SoulViewSet, "soul"),
            "workflow": (ApprovalWorkflowViewSet, "workflow")}


OBJECT_TYPES = ("judgment", "soul", "workflow")


def known_codenames():
    from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, Permission

    known = {c for c, *_ in DEFAULT_PERMISSIONS} | {c for codes in ROLE_PERMISSIONS.values() for c in codes}
    return known | set(Permission.objects.values_list("codename", flat=True))


def permission_name(codename, lang):
    from apps.perm.english import PERMISSION_NAME_EN
    from apps.perm.models import DEFAULT_PERMISSIONS, Permission

    if lang == "en" and codename in PERMISSION_NAME_EN:
        return PERMISSION_NAME_EN[codename]
    names = {c: n for c, n, *_ in DEFAULT_PERMISSIONS}
    return names.get(codename) or Permission.objects.filter(codename=codename).values_list("name", flat=True).first() or ""


def _roles(user):
    return [r for r in (getattr(user, "role", None), *checker.live_extra_roles(user)) if r]


def roles_that_can(codename):
    """能持有这个码的角色(按硬规则与授予算,与 `check_permission` 同一套)。全局专属的只有无殿 ADMIN。"""
    from apps.perm.models import Role

    if codename in checker.GLOBAL_ONLY_CODENAMES or codename in checker.ADMIN_ONLY_CODENAMES:
        return ["ADMIN"]
    names = Role.objects.filter(is_deleted=False).order_by("name").values_list("name", flat=True)
    return ["ADMIN", *(n for n in names if n not in ("ADMIN", "SOUL") and checker._role_allows(n, codename))]


def _denial(user, codename):
    """不持有时是哪一条规则挡的。顺序与 `check_permission` 相同;多个角色时,任一角色本来有授予却被硬规则
    拿掉,就报那条硬规则(那是「为什么」的真答案),否则是缺授予。"""
    role = getattr(user, "role", None)
    if role == "SOUL":
        return "soul_account"
    if codename in checker.GLOBAL_ONLY_CODENAMES:
        return "global_admin_only"
    if codename in checker.ADMIN_ONLY_CODENAMES:
        return "admin_only"
    for r in _roles(user):
        if checker._role_has(r, codename):
            if codename in checker.ROLE_FORBIDDEN_CODENAMES.get(r, ()):
                return "role_forbidden"
            if codename in checker.WORKFLOW_APPROVE_CODENAMES:
                return "design_approve_conflict"
    return "missing_permission"


def _visible(request, object_type, object_id):
    viewset, _ = _viewsets()[object_type]
    qs = viewset(request=request, action="retrieve", kwargs={}, format_kwarg=None).get_queryset()
    try:
        return qs.filter(pk=object_id).exists()
    except (ValueError, TypeError, DjangoValidationError):  # 形状不对的 id(uuid 列收到数字串)= 看不到
        return False


def _scope_kinds(user, resource):
    """调用者自己的角色对这项业务配的范围(去重);ADMIN / 没配 = ["ALL"]。只说「你」,不说那条记录。"""
    if data_scope.org_ids(user, resource) is None:
        return ["ALL"]
    rows = data_scope._rows(user, {})
    return sorted({(r.get(resource) or r.get("")).scope for r in rows.values() if (r.get(resource) or r.get(""))})


def explain(request, codename, obj=None):
    """→ 结构化结论(不含措辞)。`obj` 是 (类型, id) 或 None。"""
    from apps.authentication.impersonation import impersonating

    user = request.user
    out = {"action": codename, "role": user.role, "extra_roles": checker.live_extra_roles(user),
           "roles_that_can": roles_that_can(codename), "object_type": obj[0] if obj else None, "scope_kinds": []}
    if not checker.check_permission(user, codename):
        return {**out, "allowed": False, "reason": _denial(user, codename)}
    if impersonating(request) and not READ_ONLY_CODENAME.search(codename):
        return {**out, "allowed": False, "reason": "viewing_read_only"}
    if obj is not None and not _visible(request, *obj):
        resource = _viewsets()[obj[0]][1]
        return {**out, "allowed": False, "reason": "out_of_scope", "scope_kinds": _scope_kinds(user, resource)}
    return {**out, "allowed": True, "reason": "allowed"}


# ── 措辞(可选) ────────────────────────────────────────────────────────────

SYSTEM = (
    "You explain to an officer of SoulLedger, in one or two plain sentences, why the system allows or refuses one "
    "action. The conclusion was computed by the permission checker and is final: restate it, do not argue with it, "
    "do not add rules, roles or permissions that are not in the data, and do not guess whether any record exists. "
    "If the reason is out_of_scope, say only that the record is outside what this officer can see. "
    "Reason codes: allowed; soul_account (soul accounts hold no officer permissions); global_admin_only (shared "
    "configuration, only the administrator with no hall); admin_only (only the administrator role may hold it); "
    "role_forbidden (forbidden for that role whatever the grant table says); design_approve_conflict (a role that "
    "designs workflows may not approve them); missing_permission (no role of this officer is granted it); "
    "viewing_read_only (the officer is viewing as someone else, read-only); out_of_scope. "
    "Answer in the language named in the data, with no preamble."
)
_TOKEN_CODENAME = re.compile(r"\b[a-z_]+\.[a-z_]+\b")
_TOKEN_ROLE = re.compile(r"\b[A-Z][A-Z_]{2,}\b")


def grounded(text, facts):
    """模型的话里出现的权限码与大写角色名,都必须在结论里。否则不用这句(落回语言包)。"""
    roles = {facts["role"], *facts["extra_roles"], *facts["roles_that_can"]} | {"ALL", "ORG", "ORG_CHILD", "SELF",
                                                                                 "DEFINE"}
    return (bool(text.strip()) and set(_TOKEN_CODENAME.findall(text)) <= {facts["action"]}
            and set(_TOKEN_ROLE.findall(text)) <= roles)


def phrase(request, facts, lang):
    """模型的一句话,或 None。"""
    from apps.soul_assist import features

    if not features.enabled(request):
        return None
    data = {**facts, "permission_name": permission_name(facts["action"], lang), "language": lang}
    try:
        done = features.complete("perm_explain", request, system=SYSTEM, facts=json.dumps(data, ensure_ascii=False),
                                 prompt="Explain this conclusion to the officer.")
    except features.FeatureUnavailableError:
        return None
    return done.text if grounded(done.text, facts) else None


# ── 接口 ─────────────────────────────────────────────────────────────────


class ExplanationSerializer(serializers.Serializer):
    action = serializers.CharField()
    permission_name = serializers.CharField(allow_blank=True)
    allowed = serializers.BooleanField()
    reason = serializers.ChoiceField(choices=REASONS)
    role = serializers.CharField()
    extra_roles = serializers.ListField(child=serializers.CharField())
    roles_that_can = serializers.ListField(child=serializers.CharField())
    object_type = serializers.CharField(allow_null=True)
    scope_kinds = serializers.ListField(child=serializers.CharField(), help_text="只在 out_of_scope 时有:调用者自己的范围")
    explanation = serializers.CharField(allow_null=True, help_text="模型的措辞;null = 用语言包按 reason 的句子")


def parse(params):
    codename = (params.get("action") or "").strip()
    if not _CODENAME.match(codename) or codename not in known_codenames():
        raise ValidationError({"action": "Not a permission codename."})
    raw = (params.get("object") or "").strip()
    if not raw:
        return codename, None
    m = _OBJECT.match(raw)
    if not m or m.group(1) not in OBJECT_TYPES:
        raise ValidationError({"object": f"Expected <type>:<id>, type one of {', '.join(OBJECT_TYPES)}."})
    return codename, (m.group(1), m.group(2))


@extend_schema(
    operation_id="perm_explain",
    parameters=[OpenApiParameter("action", OpenApiTypes.STR, required=True, description="权限码,如 judgment.assign"),
                OpenApiParameter("object", OpenApiTypes.STR, description="可选,<类型>:<id>,类型为 judgment / soul / workflow")],
    responses={200: ExplanationSerializer},
)
@api_view(["GET"])
@permission_classes([IsAuthenticated, TenantPermission])
def explain_view(request):
    codename, obj = parse(request.query_params)
    facts = explain(request, codename, obj)
    lang = "zh-Hans" if locale_from_request(request).lower().startswith("zh") else "en"
    body = {**facts, "permission_name": permission_name(codename, lang), "explanation": phrase(request, facts, lang)}
    return Response(ExplanationSerializer(body).data)
