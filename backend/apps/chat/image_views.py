"""书信图片的四个口(设计与访问规则见 `apps/chat/images.py`):

    POST /me/chat/conversations/<id>/images/   传一张(multipart `file`),答 {id, width, height}
    POST /me/chat/images/<id>/send/            把它作为一条消息发出,答 {event_id}(重发回同一个)
    GET  /me/chat/images/<id>/                 这一世账号能看的图 → 签名地址 {id, url, width, height}
    GET  /api/v1/chat-images/<id>/?t=<签名>    文件本身(不挂 JWT:`<img src>` 与原生图片组件带不上头)

前三个继承 `ChatView`(灵魂令牌、当前账号、首登改密前拒绝;Synapse 没配 503)。**没有官员上传口**:
官员回信暂不支持发图。取不到的一律 404,不区分「没有」与「不是你的」。
"""
import math
from datetime import timedelta

from django.http import Http404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import throttling
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.chat import images
from apps.chat import services as svc
from apps.chat.models import ChatImage, Conversation
from apps.chat.serializers import (
    ChatErrorSerializer,
    ChatImageSerializer,
    ChatImageUploadedSerializer,
    MessageSentSerializer,
)
from apps.chat.views import ChatView
from apps.core.throttling import ClientIPRateThrottle
from apps.social.media_views import serve_private_file

NOT_FOUND = svc.ChatError("找不到这张图片。", "not_found", status=404)


class ChatImageUploadThrottle(throttling.UserRateThrottle):
    """按灵魂账号计;速率在 `DEFAULT_THROTTLE_RATES["chat_image_upload"]`。"""

    scope = "chat_image_upload"


class MeChatImageUploadView(ChatView):
    """先传后发的第一步:一张图一个请求(App 逐张显示进度、失败的单独重试)。校验与朋友圈图片同一个函数:
    按魔数认 PNG / JPEG / WebP,5 MB / 4000 万像素上限,重编码去掉 EXIF。400 `not_an_image` / `too_large` /
    `too_many_pixels`;一个会话里未发出的图最多 4 张,409 `too_many_pending`;会话此刻不能说话时与发送同一个拒绝。"""

    parser_classes = [MultiPartParser]
    throttle_classes = [ChatImageUploadThrottle]

    def throttled(self, request, wait):
        # 与聊天其余拒绝同一形状:App 按 `code` 分支。
        error = svc.ChatError("上传太频繁,请稍后再试。", "rate_limited", status=429)
        error.retry_at = timezone.now() + timedelta(seconds=math.ceil(wait or 0))
        raise error

    # 请求体手写而不是取自 FileField 序列化器:spectacular 会把请求里的 FileField 画成 `format: uri`
    # (朋友圈图片接口同一个理由)。
    @extend_schema(
        operation_id="v1_me_chat_image_upload",
        request={"multipart/form-data": {
            "type": "object",
            "properties": {"file": {"type": "string", "format": "binary"}},
            "required": ["file"],
        }},
        responses={201: ChatImageUploadedSerializer, 400: ChatErrorSerializer, 403: ChatErrorSerializer,
                   404: ChatErrorSerializer, 409: ChatErrorSerializer, 429: ChatErrorSerializer,
                   503: ChatErrorSerializer},
    )
    def post(self, request, conversation_id):
        upload = request.FILES.get("file")
        if upload is None:
            raise svc.ChatError("缺少图片文件。", "file_required", status=400)
        conversation = Conversation.objects.filter(pk=conversation_id).select_related("tenant").first()
        if conversation is None:
            raise NOT_FOUND
        image = images.upload(self.account, conversation, upload)
        return Response(ChatImageUploadedSerializer(image).data, status=201)


class MeChatImageSendView(ChatView):
    """把上传好的图作为一条消息发出(一条消息一张图,与文字分开)。同一张图再发回第一次的 `event_id`。"""

    @extend_schema(
        operation_id="v1_me_chat_image_send", request=None,
        responses={201: MessageSentSerializer, 403: ChatErrorSerializer, 404: ChatErrorSerializer,
                   409: ChatErrorSerializer, 503: ChatErrorSerializer},
    )
    def post(self, request, image_id):
        account = self.account
        image = ChatImage.objects.select_related("conversation__tenant").filter(
            pk=image_id, uploader=account).first()
        if image is None:
            raise NOT_FOUND
        event_id = images.send(account, image.conversation, image.pk, request=request)
        return Response({"event_id": event_id}, status=201)


class MeChatImageView(ChatView):
    """这一世账号能看的书信图的签名地址(约一小时有效)。不是会话参与方、对方还没发出:404。"""

    @extend_schema(operation_id="v1_me_chat_image_url", responses={200: ChatImageSerializer,
                                                                    404: ChatErrorSerializer})
    def get(self, request, image_id):
        view = images.soul_view(self.account, image_id)
        if view is None:
            raise NOT_FOUND
        return Response(ChatImageSerializer(view).data)


class ChatImageThrottle(ClientIPRateThrottle):
    """按签名里的查看者计:一屏书信可以有好几张图;签名无效时退回按 IP。"""

    scope = "chat_image"

    def get_cache_key(self, request, view):
        grant = images.viewer_from_token(request.query_params.get("t"), view.kwargs.get("image_id"))
        ident = f"u{grant[0]}" if grant is not None else self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class ChatImageFileView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ChatImageThrottle]

    @extend_schema(
        operation_id="v1_chat_image_file",
        parameters=[OpenApiParameter("t", str, required=True, description="`GET /me/chat/images/<id>/` 或收件箱消息给出的签名。")],
        responses={
            (200, "image/*"): OpenApiResponse(description="图片文件(PNG / JPEG / WebP)。"),
            404: OpenApiResponse(description="签名无效或过期,或查看者此刻看不见这张图。"),
        },
    )
    def get(self, request, image_id):
        from apps.authentication.models import User

        grant = images.viewer_from_token(request.query_params.get("t"), image_id)
        viewer_id, tenant_id = grant if grant is not None else (None, None)
        image = (ChatImage.objects.select_related("conversation").filter(pk=image_id).first()
                 if viewer_id is not None else None)
        viewer = User.objects.filter(pk=viewer_id).first() if image is not None else None
        if viewer is None or not images.may_view(viewer, image, tenant_id):
            raise Http404
        return serve_private_file(image, images.URL_TTL)
