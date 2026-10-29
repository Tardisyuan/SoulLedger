"""官员交接的接口。规则在 `handover.py`。

    POST /api/v1/judgment/handover/preview/   {from, to} → 每类几件 + problems,不写
    POST /api/v1/judgment/handover/           {from, to} → 每类实际移了几件
    GET  /api/v1/judgment/handover/officers/  → 一殿在职官员(交接对话框的人选)

要 `judgment.assign`(殿管理员、殿主;与改派同一码名)。书信另要操作人持 `soul_inbox.reply`,没有就只移交其余几类
(`letters_kept`,用户 2026-10-29 第 22 条)。非 ADMIN 只能交接本殿的官员:别的殿的人与不存在的人
答同一个 404。接手人必须是交出人所在殿的在职官员(400 `invalid_target`)。
"""
from django.contrib.auth import get_user_model
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import is_tenant_exempt
from apps.judgment import handover

User = get_user_model()


class HandoverRequestSerializer(serializers.Serializer):
    # 预览可不填 `to`:只数件数(停用官员前问一句「他手上还有没有事」,那时还没选接手人)。提交必须填。
    to = serializers.IntegerField(required=False, allow_null=True)


# `from` is a Python keyword, so the body key is declared outside the class body.
HandoverRequestSerializer._declared_fields["from"] = serializers.IntegerField()


class HandoverPreviewSerializer(serializers.Serializer):
    judgments = serializers.IntegerField()
    appeals = serializers.IntegerField()
    appeals_returned_to_pool = serializers.IntegerField(help_text="接手人是原判官员的申诉:退回待复核")
    city_gods = serializers.ListField(child=serializers.CharField())
    letters = serializers.IntegerField()
    letters_kept = serializers.IntegerField(help_text="操作人不持 soul_inbox.reply:这些书信不移交,留在交出人名下")
    problems = serializers.ListField(child=serializers.ChoiceField(["target_cannot_judge", "target_cannot_reply"]))


class HandoverResultSerializer(serializers.Serializer):
    judgments = serializers.IntegerField()
    appeals = serializers.IntegerField()
    appeals_returned_to_pool = serializers.IntegerField()
    city_gods = serializers.IntegerField()
    letters = serializers.IntegerField()
    letters_kept = serializers.IntegerField(help_text="操作人不持 soul_inbox.reply:这些书信没有移交,留在交出人名下")


class _HandoverBase(APIView):
    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        return ["judgment.assign"]

    def _people(self, request):
        body = HandoverRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        officers = User.objects.exclude(role="SOUL")
        if not is_tenant_exempt(request.user):
            tenant = getattr(request, "tenant", None)
            officers = officers.filter(tenant=tenant) if tenant else officers.none()
        source = officers.filter(pk=body.validated_data["from"], tenant__isnull=False).first()
        if source is None:
            raise NotFound()
        to = body.validated_data.get("to")
        target = User.objects.filter(pk=to).first() if to is not None else None
        return source, target

    def _refused(self, exc):
        return Response(exc.as_payload(), status=exc.status)


class HandoverOfficerSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    display_name = serializers.CharField()
    role_display = serializers.CharField()


class HandoverOfficersView(APIView):
    """`GET /judgment/handover/officers/`:交接对话框的人选 —— 一殿的在职官员(非灵魂),只回 id、显示名、角色显示名。

    与交接本身同一个码 `judgment.assign`(rbac-web M-7 / 待拍板 23):对话框此前用 `users/`(ADMIN + user.manage),
    持 judgment.assign 的殿主打开就是 403。非 ADMIN 只看本殿(殿取自令牌);全局 ADMIN 用 `?tenant=<id>` 说是哪一殿。
    """

    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        return ["judgment.assign"]

    @extend_schema(operation_id="judgment_handover_officers",
                   parameters=[OpenApiParameter("tenant", int, required=False,
                                                description="全局 ADMIN 指定殿;其他人忽略,一律本殿")],
                   responses={200: HandoverOfficerSerializer(many=True)})
    def get(self, request):
        from apps.perm.models import Role

        if is_tenant_exempt(request.user):
            raw = request.query_params.get("tenant", "")
            if not raw.isdigit():
                return Response({"tenant": ["Give the hall id."]}, status=400)
            tenant_id = int(raw)
        else:
            tenant = getattr(request, "tenant", None)
            if tenant is None:
                return Response([])
            tenant_id = tenant.pk
        officers = list(User.objects.filter(tenant_id=tenant_id, is_active=True).exclude(role="SOUL")
                        .order_by("display_name", "username"))
        labels = dict(Role.objects.filter(name__in={u.role for u in officers}).values_list("name", "display_name"))
        return Response([{"id": u.pk, "display_name": u.display_name or u.username,
                          "role_display": labels.get(u.role) or u.role} for u in officers])


class HandoverPreviewView(_HandoverBase):
    @extend_schema(operation_id="judgment_handover_preview", request=HandoverRequestSerializer,
                   responses={200: HandoverPreviewSerializer})
    def post(self, request):
        source, target = self._people(request)
        try:
            return Response(handover.preview(source, target, source.tenant_id, actor=request.user))
        except handover.HandoverRefusedError as exc:
            return self._refused(exc)


class HandoverCommitView(_HandoverBase):
    @extend_schema(operation_id="judgment_handover_commit", request=HandoverRequestSerializer,
                   responses={200: HandoverResultSerializer})
    def post(self, request):
        source, target = self._people(request)
        try:
            return Response(handover.commit(source, target, source.tenant_id, actor=request.user, request=request))
        except handover.HandoverRefusedError as exc:
            return self._refused(exc)
