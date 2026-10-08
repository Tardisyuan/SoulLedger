"""`/api/v1/me/push-tokens/`、`/api/v1/me/notification-settings/` 与 `/api/v1/me/notifications/`。

都继承 `SoulAPIView`:只认灵魂令牌、只认当前(未停用)账号、首登改密前拒绝 ——
`tests/test_soul_auth_boundary.py::test_every_me_route_is_a_soul_api_view` 走真实 URLconf 钉住。
"""
import re

from django.db.models import F, Window
from django.db.models.functions import RowNumber
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import serializers, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.soul_accounts.me_views import SoulAPIView
from apps.soul_accounts.serializers import SoulErrorSerializer
from apps.soul_push import services
from apps.soul_push.models import PushDelivery, PushDevice, PushPlatform, PushPreference

#: Expo 的两种前缀都认:`ExponentPushToken[...]` 是当前 `getExpoPushTokenAsync` 给的,
#: `ExpoPushToken[...]` 是 expo-server-sdk 的 `isExpoPushToken` 同样接受的写法。
#: 括号里只放 token 实际出现的字符,拒绝空白与控制字符 —— 这个值会原样进 Expo 请求体。
EXPO_TOKEN_RE = re.compile(r"^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$")


class PushTokenRegisterSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)
    platform = serializers.ChoiceField(choices=PushPlatform.choices)

    def validate_token(self, value):
        if not EXPO_TOKEN_RE.match(value):
            raise serializers.ValidationError("不是 Expo push token(ExponentPushToken[...])。")
        return value


class PushTokenUnregisterSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)


class PushDeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushDevice
        fields = ["id", "platform", "is_active", "last_seen_at", "created_at"]
        read_only_fields = fields


class NotificationSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushPreference
        fields = ["rebirth", "judgment", "residence", "chat", "locale"]


class MePushTokensView(SoulAPIView):
    @extend_schema(request=PushTokenRegisterSerializer,
                   responses={200: PushDeviceSerializer, 201: PushDeviceSerializer,
                              400: OpenApiResponse(description="token 格式不对"), 403: SoulErrorSerializer})
    def post(self, request):
        body = PushTokenRegisterSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        device, created = services.register_device(self.account, **body.validated_data)
        return Response(PushDeviceSerializer(device).data,
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class MePushTokenUnregisterView(SoulAPIView):
    @extend_schema(request=PushTokenUnregisterSerializer, responses={204: None, 403: SoulErrorSerializer})
    def post(self, request):
        """204 与 token 是否存在、属于谁无关 —— 不能拿它探测别人的 token。"""
        body = PushTokenUnregisterSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        services.unregister_device(self.account, body.validated_data["token"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeNotificationSettingsView(SoulAPIView):
    @extend_schema(responses={200: NotificationSettingsSerializer, 403: SoulErrorSerializer})
    def get(self, request):
        return Response(NotificationSettingsSerializer(services.preference_for(self.account)).data)

    @extend_schema(request=NotificationSettingsSerializer,
                   responses={200: NotificationSettingsSerializer, 400: OpenApiResponse(description="字段校验失败"),
                              403: SoulErrorSerializer})
    def patch(self, request):
        body = NotificationSettingsSerializer(services.preference_for(self.account), data=request.data, partial=True)
        body.is_valid(raise_exception=True)
        body.save()
        return Response(body.data)


# ── 通知记录 ──────────────────────────────────────────────────────────────


class PushHistoryItemSerializer(serializers.ModelSerializer):
    """一条推送,按**内容**给:每个状态都在(被系统丢掉的、灵魂当时关掉的,内容照样可读)。
    `data` 是推送带的导航目标(`{screen, …}`,见 `services.rule_for`),App 用 `landingOf` 解。"""

    class Meta:
        model = PushDelivery
        fields = ["id", "kind", "title", "body", "status", "data", "created_at"]
        read_only_fields = fields


class PaginatedPushHistorySerializer(serializers.Serializer):
    """DRF 分页信封的显式声明 —— 理由同 `apps/social/soul_views.py::_page`:APIView 上
    drf-spectacular 推不出 `{count, next, previous, results}`。"""

    count = serializers.IntegerField()
    next = serializers.CharField(allow_null=True)
    previous = serializers.CharField(allow_null=True)
    results = PushHistoryItemSerializer(many=True)


class MeNotificationsView(SoulAPIView):
    """`GET /me/notifications/`:本灵魂收到过的推送,最新在前,分页(PAGE_SIZE 20)。

    只读。范围是**灵魂**而不是本世账号:转世换账号,记录仍是同一个灵魂的。
    `PushDelivery` 一台设备一行,两台手机登同一账号就是同一件事两行 —— 这里按
    `dedupe_key` 只给最早那一行,记录讲的是「发生过什么」,不是「发到了哪台」。
    """

    @extend_schema(responses={200: PaginatedPushHistorySerializer, 403: SoulErrorSerializer})
    def get(self, request):
        queryset = (
            PushDelivery.objects.filter(soul_id=self.account.soul_id)
            .annotate(rn=Window(RowNumber(), partition_by=[F("dedupe_key")], order_by=F("created_at").asc()))
            .filter(rn=1)
            .order_by("-created_at", "-id")
        )
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response(PushHistoryItemSerializer(page, many=True).data)
