"""「导出我的资料」的接口(Design 第二十八批 S3;规则与包的内容在 `data_export.py`)。

    GET  /me/export/            最近一次申请的状态(从没申请过 → `{"export": null}`)
    POST /me/export/            申请:要当前密码,或面容认过后取出的凭据;已有一份在准备 → 409 `export_in_progress`
    GET  /me/export/file/?t=…   取文件:签名 + 灵魂令牌,两样都要;签名里的账号必须是调用者自己

全部继承 `SoulAPIView`:只认灵魂令牌,从 `self.account` 出发,URL 里没有任何 id。
文件出口与朋友圈图片同一个写法(`media_views.serve_private_file`:生产走 nginx 的 `X-Accel-Redirect`)。
"""
from types import SimpleNamespace

from django.core.files.storage import default_storage
from django.http import Http404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.response import Response

from apps.social.media_views import serve_private_file
from apps.soul_accounts import data_export
from apps.soul_accounts import services as svc
from apps.soul_accounts.me_views import SoulAPIView
from apps.soul_accounts.mfa_views import _error, confirm_current_password
from apps.soul_accounts.models import DataExportStatus
from apps.soul_accounts.serializers import (
    SoulDataExportRequestSerializer,
    SoulDataExportSerializer,
    SoulDataExportStateSerializer,
    SoulErrorSerializer,
    SoulMfaRefusalSerializer,
)


def _row(export):
    current = data_export.effective_status(export)
    return {
        "id": export.pk, "status": current, "requested_at": export.requested_at,
        "finished_at": export.finished_at, "expires_at": export.expires_at, "file_name": export.file_name,
        "byte_size": export.byte_size,
        "download_url": data_export.signed_path(export) if current == DataExportStatus.READY else None,
    }


class MeExportView(SoulAPIView):
    @extend_schema(responses={200: SoulDataExportStateSerializer, 403: SoulErrorSerializer})
    def get(self, request):
        export = data_export.latest(self.account)
        return Response(SoulDataExportStateSerializer({"export": _row(export) if export else None}).data)

    @extend_schema(request=SoulDataExportRequestSerializer,
                   responses={201: SoulDataExportSerializer, 400: SoulMfaRefusalSerializer,
                              409: SoulErrorSerializer, 429: SoulMfaRefusalSerializer})
    def post(self, request):
        """申请。身份没认出来 → 400 `wrong_password`(错 5 次 429 `rate_limited`,与登录同一份预算)。"""
        body = SoulDataExportRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        refusal = confirm_current_password(request, self.account, body.validated_data["password"],
                                           body.validated_data["credential"])
        if refusal is not None:
            return refusal
        try:
            export = data_export.request_export(self.account, request=request)
        except svc.SoulAccountError as exc:
            return _error(exc)
        return Response(SoulDataExportSerializer(_row(export)).data, status=status.HTTP_201_CREATED)


class MeExportFileView(SoulAPIView):
    @extend_schema(
        operation_id="v1_me_export_file",
        parameters=[OpenApiParameter("t", str, required=True, description="状态里 `download_url` 的签名。")],
        responses={(200, "application/zip"): OpenApiResponse(description="导出的 zip。"),
                   404: OpenApiResponse(description="签名无效或过期、不是调用者自己的、文件已过期。")},
    )
    def get(self, request):
        export = data_export.export_from_token(request.query_params.get("t"), self.account)
        if export is None:
            raise Http404
        name = export.file_path
        stored = SimpleNamespace(file=SimpleNamespace(name=name, open=lambda mode: default_storage.open(name, mode)),
                                 content_type="application/zip")
        response = serve_private_file(stored, int(data_export.LINK_TTL.total_seconds()))
        response["Content-Disposition"] = f'attachment; filename="{export.file_name}"'
        return response
