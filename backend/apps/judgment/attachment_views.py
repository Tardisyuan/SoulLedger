"""案卷附件的接口(2026-10-15,Design 第二十八批 W4)。规则与存储见 `attachments.py`。

    GET    /api/v1/judgment/<id>/attachments/                列表 + 用量(judgment.read)
    POST   /api/v1/judgment/<id>/attachments/                上传一个文件(judgment.execute),multipart `file`
    DELETE /api/v1/judgment/<id>/attachments/<aid>/          上传人、结案前(judgment.execute);审计一条「删除附件」
    GET    /api/v1/judgment/<id>/attachments/<aid>/link/     10 分钟的签名地址(judgment.read)
    GET    /api/v1/case-attachments/<aid>/?t=<签名>[&dl=1]    文件本身(不挂 JWT:`<iframe>` / `<img>` 带不上头)

前四个是 `JudgmentViewSet` 的动作(`CaseAttachmentActionsMixin`):案子经 `get_object()`,所以租户划界、
数据范围与评议同一条路 —— 别的租户的案子是 404。审批页的附件区读写的是同一个案子(`workflow.judgment`),
所以没有第二套接口。灵魂端没有任何入口:文件出口也拒绝灵魂角色。
"""
from django.http import Http404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.client_ip import get_client_ip
from apps.core.throttling import ClientIPRateThrottle
from apps.judgment import attachments as svc
from apps.judgment import claims
from apps.judgment.models import CaseAttachment
from apps.social.media_views import serve_private_file


class CaseAttachmentSerializer(serializers.ModelSerializer):
    uploader_name = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = CaseAttachment
        fields = ["id", "name", "byte_size", "content_type", "uploader", "uploader_name", "created_at", "can_delete"]
        read_only_fields = fields

    def get_uploader_name(self, obj) -> str:
        user = obj.uploader
        return (user.display_name or user.username) if user else ""

    def get_can_delete(self, obj) -> bool:
        """给界面决定要不要画「删除」;服务端在 DELETE 时仍然重判。"""
        request = self.context.get("request")
        return bool(request and obj.uploader_id == request.user.pk and not svc.is_concluded(obj.judgment))


class CaseAttachmentListSerializer(serializers.Serializer):
    items = CaseAttachmentSerializer(many=True)
    count = serializers.IntegerField()
    total_bytes = serializers.IntegerField()
    max_count = serializers.IntegerField()
    max_total_bytes = serializers.IntegerField()
    max_file_bytes = serializers.IntegerField()
    concluded = serializers.BooleanField()


class CaseAttachmentErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.CharField(help_text="bad_type / too_large / case_full / too_many / concluded / not_uploader")


class CaseAttachmentLinkSerializer(serializers.Serializer):
    url = serializers.CharField(help_text="站点根相对路径 `/api/v1/case-attachments/<id>/?t=…`,10 分钟有效。")
    name = serializers.CharField()
    content_type = serializers.CharField()


_UPLOAD_BODY = inline_serializer("CaseAttachmentUpload", {"file": serializers.FileField()})


def _refused(exc):
    return Response({"detail": str(exc), "code": exc.code}, status=exc.status)


class CaseAttachmentActionsMixin:
    """混进 `JudgmentViewSet`。码名在它的 `extra_permissions` 里。"""

    def _attachment(self, judgment, attachment_id):
        row = (CaseAttachment.all_objects.select_related("judgment", "uploader")
               .filter(pk=attachment_id, judgment=judgment, deleted_at__isnull=True).first())
        if row is None:
            raise Http404
        return row

    @extend_schema(responses=CaseAttachmentListSerializer)
    @action(detail=True, methods=["get"], url_path="attachments", pagination_class=None, parser_classes=[MultiPartParser])
    def attachments(self, request, pk=None):
        judgment = self.get_object()
        rows = list(svc.live(judgment).select_related("uploader", "judgment"))
        return Response(CaseAttachmentListSerializer({
            "items": rows,
            "count": len(rows), "total_bytes": sum(r.byte_size for r in rows),
            "max_count": svc.MAX_COUNT, "max_total_bytes": svc.MAX_TOTAL_BYTES,
            "max_file_bytes": svc.MAX_FILE_BYTES, "concluded": svc.is_concluded(judgment),
        }, context={"request": request}).data)

    @extend_schema(
        request={"multipart/form-data": _UPLOAD_BODY},
        responses={201: CaseAttachmentSerializer, 400: CaseAttachmentErrorSerializer,
                   409: CaseAttachmentErrorSerializer},
    )
    @attachments.mapping.post
    def add_attachment(self, request, pk=None):
        from apps.audit.models import AuditAction, AuditLog

        judgment = self.get_object()
        claims.assert_may_edit(judgment, request, "attachment")
        uploaded = request.FILES.get("file")
        if uploaded is None:
            return Response({"detail": "file is required.", "code": "bad_type"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            row = svc.upload(request.user, judgment, uploaded)
        except svc.AttachmentError as exc:
            return _refused(exc)
        AuditLog.objects.create(
            tenant=judgment.tenant, user=request.user, action=AuditAction.CREATE,
            resource="judgment.attachment", resource_id=str(judgment.id),
            description=f"上传附件:{judgment.case_number} {row.name}"[:500],
            changes={"attachment": str(row.id), "name": row.name, "byte_size": row.byte_size},
            ip_address=get_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
        )
        return Response(CaseAttachmentSerializer(row, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        responses={204: OpenApiResponse(description="已删除。"), 403: CaseAttachmentErrorSerializer},
    )
    @action(detail=True, methods=["delete"], url_path=r"attachments/(?P<attachment_id>[0-9a-fA-F-]{36})",
            pagination_class=None)
    def delete_attachment(self, request, pk=None, attachment_id=None):
        from apps.audit.models import AuditAction, AuditLog

        judgment = self.get_object()
        row = self._attachment(judgment, attachment_id)
        try:
            svc.delete(request.user, row)
        except svc.AttachmentError as exc:
            return _refused(exc)
        AuditLog.objects.create(
            tenant=judgment.tenant, user=request.user, action=AuditAction.DELETE,
            resource="judgment.attachment", resource_id=str(judgment.id),
            description=f"删除附件:{judgment.case_number} {row.name}"[:500],
            changes={"attachment": str(row.id), "name": row.name, "byte_size": row.byte_size},
            ip_address=get_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses=CaseAttachmentLinkSerializer)
    @action(detail=True, methods=["get"], url_path=r"attachments/(?P<attachment_id>[0-9a-fA-F-]{36})/link",
            pagination_class=None)
    def attachment_link(self, request, pk=None, attachment_id=None):
        judgment = self.get_object()
        row = self._attachment(judgment, attachment_id)
        tenant = getattr(request, "tenant", None)
        return Response(CaseAttachmentLinkSerializer({
            "url": svc.signed_url(row, request.user, tenant), "name": row.name, "content_type": row.content_type,
        }).data)


class CaseAttachmentThrottle(ClientIPRateThrottle):
    """按签名里的查看者计数;签名无效时退回按 IP。"""

    scope = "case_attachment"

    def get_cache_key(self, request, view):
        grant = svc.viewer_from_token(request.query_params.get("t"), view.kwargs.get("attachment_id"))
        ident = f"u{grant[0]}" if grant is not None else self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class CaseAttachmentFileView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CaseAttachmentThrottle]

    @extend_schema(
        operation_id="v1_case_attachment_file",
        parameters=[
            OpenApiParameter("t", str, required=True, description="`…/attachments/<aid>/link/` 给出的签名。"),
            OpenApiParameter("dl", int, required=False, description="1 = 作为下载(Content-Disposition: attachment)。"),
        ],
        responses={
            (200, "application/octet-stream"): OpenApiResponse(description="图片(PNG / JPEG)或 PDF 文件。"),
            404: OpenApiResponse(description="签名无效或过期,或查看者此刻看不见这份附件。"),
        },
    )
    def get(self, request, attachment_id):
        from urllib.parse import quote

        from apps.authentication.models import User

        grant = svc.viewer_from_token(request.query_params.get("t"), attachment_id)
        viewer_id, tenant_id = grant if grant is not None else (None, None)
        row = CaseAttachment.all_objects.filter(pk=attachment_id).first() if viewer_id is not None else None
        viewer = User.objects.filter(pk=viewer_id).first() if row is not None else None
        if viewer is None or not svc.may_view(viewer, row, tenant_id):
            raise Http404
        response = serve_private_file(row, svc.URL_TTL)
        disposition = "attachment" if request.query_params.get("dl") == "1" else "inline"
        response["Content-Disposition"] = f"{disposition}; filename*=UTF-8''{quote(row.name)}"
        # 抽屉里的 PDF 用 iframe 内嵌;生产里前端与 API 同源(nginx),默认的 DENY 会让它空白。
        response["X-Frame-Options"] = "SAMEORIGIN"
        return response
