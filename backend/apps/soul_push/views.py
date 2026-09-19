"""`/api/v1/me/push-tokens/` 与 `/api/v1/me/notification-settings/`。

都继承 `SoulAPIView`:只认灵魂令牌、只认当前(未停用)账号、首登改密前拒绝 ——
`tests/test_soul_auth_boundary.py::test_every_me_route_is_a_soul_api_view` 走真实 URLconf 钉住。
"""
import re

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import serializers, status
from rest_framework.response import Response

from apps.soul_accounts.me_views import SoulAPIView
from apps.soul_accounts.serializers import SoulErrorSerializer
from apps.soul_push import services
from apps.soul_push.models import PushDevice, PushPlatform, PushPreference

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
