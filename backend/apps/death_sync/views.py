"""
REST views for death_sync app.
"""
from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.death_sync.models import (
    ExternalApiKey, DeathRegistrationRequest, WebhookConfig,
    WebhookDeliveryLog, DeathRegistrationStatus,
)
from apps.death_sync.serializers import (
    ExternalApiKeySerializer, DeathRegistrationRequestSerializer,
    WebhookConfigSerializer, WebhookDeliveryLogSerializer,
    DeathRegistrationCreateSerializer, HealthSerializer,
)
from apps.death_sync.authentication import APIKeyAuthentication
from apps.core.permissions import TenantPermission


class ExternalApiKeyViewSet(viewsets.ModelViewSet):
    """
    CRUD for external API keys (admin only).
    """
    permission_classes = [TenantPermission]
    queryset = ExternalApiKey.objects.all()
    serializer_class = ExternalApiKeySerializer

    def perform_create(self, serializer):
        from apps.death_sync.models import ExternalApiKey
        raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
        serializer.save(
            key_hash=key_hash,
            key_prefix=key_prefix,
            tenant=self.request.tenant,
        )
        # Return raw key in response (only time it's shown)
        serializer.validated_data['_raw_key'] = raw_key


class DeathRegistrationViewSet(viewsets.ModelViewSet):
    """
    Death registration endpoints (API key authenticated).
    """
    authentication_classes = [APIKeyAuthentication]
    queryset = DeathRegistrationRequest.objects.all()
    serializer_class = DeathRegistrationRequestSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        api_key = getattr(self.request, 'api_key', None)
        if api_key:
            qs = qs.filter(api_key=api_key)
        return qs


class WebhookViewSet(viewsets.ModelViewSet):
    """
    CRUD for webhook configurations (API key authenticated).
    """
    authentication_classes = [APIKeyAuthentication]
    queryset = WebhookConfig.objects.all()
    serializer_class = WebhookConfigSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        api_key = getattr(self.request, 'api_key', None)
        if api_key:
            qs = qs.filter(api_key=api_key)
        return qs

    def perform_create(self, serializer):
        import secrets
        signing_secret = f"whsec_{secrets.token_urlsafe(32)}"
        serializer.save(
            api_key=self.request.api_key,
            tenant=self.request.tenant,
            signing_secret=signing_secret,
        )


class DeathSyncHealthView(APIView):
    """
    Health check for death sync API.
    """
    authentication_classes = [APIKeyAuthentication]

    def get(self, request):
        api_key = getattr(request, 'api_key', None)
        return Response({
            "api_key": {
                "name": api_key.name if api_key else None,
                "system_type": api_key.system_type if api_key else None,
                "is_active": api_key.is_active if api_key else False,
            },
            "system": {
                "status": "healthy",
            },
        })
