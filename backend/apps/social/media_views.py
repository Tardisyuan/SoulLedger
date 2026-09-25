"""帖子图片的文件出口:`GET /api/v1/social-media/<id>/?t=<签名>`。

不挂任何 JWT 认证类:`<img src>` 与 App 的图片组件都带不上 `Authorization` 头。
凭据是地址里的签名(apps/social/media.py::signed_url),它只说明「这个地址是发给谁的」;
**能不能拿到文件每一次都用那个人重算 `may_view`**。签名坏了、过期了、换了图片 id、
那个人此刻看不见这条帖子 —— 全是同一个 404,不区分,不给探测口。
"""
from django.http import FileResponse, Http404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from apps.core.throttling import ClientIPRateThrottle
from apps.social import media as post_media
from apps.social.models import PostMedia


class PostMediaThrottle(ClientIPRateThrottle):
    """按签名里的查看者计数:一屏动态流就有几十张图,全局匿名限额(60/分钟)会把它掐断。
    签名无效时退回按 IP。"""

    scope = "post_media"

    def get_cache_key(self, request, view):
        viewer = post_media.viewer_from_token(request.query_params.get("t"), view.kwargs.get("media_id"))
        ident = f"u{viewer}" if viewer is not None else self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class PostMediaFileView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PostMediaThrottle]

    @extend_schema(
        operation_id="v1_social_media_file",
        parameters=[OpenApiParameter("t", str, required=True, description="序列化器给出的签名。")],
        responses={
            (200, "image/*"): OpenApiResponse(description="图片文件(PNG / JPEG / WebP)。"),
            404: OpenApiResponse(description="签名无效或过期,或查看者此刻看不见这张图。"),
        },
    )
    def get(self, request, media_id):
        from apps.authentication.models import User

        viewer_id = post_media.viewer_from_token(request.query_params.get("t"), media_id)
        media = PostMedia.all_objects.filter(pk=media_id).first() if viewer_id is not None else None
        viewer = User.objects.filter(pk=viewer_id).first() if media is not None else None
        if viewer is None or not post_media.may_view(viewer, media):
            raise Http404
        response = FileResponse(media.file.open("rb"), content_type=media.content_type)
        # 私有缓存,且不超过签名的有效期:帖子被隐藏后,共享缓存里不能还留着一份。
        response["Cache-Control"] = f"private, max-age={post_media.URL_TTL}"
        response["X-Content-Type-Options"] = "nosniff"
        return response
