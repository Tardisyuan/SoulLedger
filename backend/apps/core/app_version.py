from django.conf import settings
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

APPS = ("soul", "officer")
PLATFORMS = ("ios", "android")


class AppVersionQuerySerializer(serializers.Serializer):
    app = serializers.ChoiceField(choices=APPS)
    platform = serializers.ChoiceField(choices=PLATFORMS)


class AppVersionSerializer(serializers.Serializer):
    """空串 = 没配置 = 不限制。版本比较在 App 里做,这里只给数字。"""

    min_supported = serializers.CharField(allow_blank=True)
    latest = serializers.CharField(allow_blank=True)
    store_url = serializers.CharField(allow_blank=True)


class AppVersionView(APIView):
    """GET /api/v1/app-version/?app=soul|officer&platform=ios|android (public, read-only).

    Anonymous on purpose: the check runs before sign-in. The default anon
    throttle applies (DEFAULT_THROTTLE_CLASSES)."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[
            OpenApiParameter("app", str, enum=list(APPS)),
            OpenApiParameter("platform", str, enum=list(PLATFORMS)),
        ],
        responses=AppVersionSerializer,
    )
    def get(self, request):
        query = AppVersionQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        policy = settings.APP_VERSION_POLICY[query.validated_data["app"]][query.validated_data["platform"]]
        return Response(AppVersionSerializer(policy).data)
