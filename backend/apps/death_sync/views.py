"""
REST views for death_sync app.
"""
import hashlib
import json
from django.db import IntegrityError
from rest_framework import viewsets, status
from rest_framework.permissions import IsAdminUser
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


class ExternalApiKeyViewSet(viewsets.ModelViewSet):
    """
    CRUD for external API keys (admin only).
    """
    permission_classes = [IsAdminUser]
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

    def create(self, request, *args, **kwargs):
        """Register a death (single or batch)."""
        from apps.death_sync.services import DeathSyncService
        from django.db import IntegrityError

        api_key = request.api_key
        tenant = request.tenant
        data = request.data

        # Check permission
        if not api_key.can_register_death:
            return Response(
                {"error": {"code": "KEY_NO_DEATH_PERMISSION", "message": "API key lacks death registration permission"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Batch registration
        if data.get("batch") and "registrations" in data:
            registrations = data["registrations"]
            if len(registrations) > 50:
                return Response(
                    {"error": {"code": "BATCH_TOO_LARGE", "message": "Batch size limit is 50"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            results = DeathSyncService.process_batch(
                tenant=tenant,
                api_key=api_key,
                registrations=registrations,
                source_ip=self._get_client_ip(request),
            )
            succeeded = sum(1 for r in results if r.status == DeathRegistrationStatus.PROCESSED)
            return Response({
                "status": "partial" if succeeded < len(results) else "accepted",
                "total": len(results),
                "succeeded": succeeded,
                "failed": len(results) - succeeded,
                "results": [
                    {
                        "index": idx,
                        "status": r.status,
                        "registration_id": str(r.id),
                        **({"error_code": r.error_code, "error_message": r.error_message} if r.status == DeathRegistrationStatus.FAILED else {}),
                        **({"soul_id": str(r.soul_id), "judgment_id": str(r.judgment_id)} if r.status == DeathRegistrationStatus.PROCESSED else {}),
                    }
                    for idx, r in enumerate(results)
                ],
            }, status=status.HTTP_207_MULTI_STATUS if succeeded < len(results) else status.HTTP_201_CREATED)

        # Single registration
        serializer = DeathRegistrationCreateSerializer(data=data)
        serializer.is_valid(raise_exception=True)

        idempotency_key = request.headers.get(
            "X-Idempotency-Key",
            f"{api_key.id}_{hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()}",
        )
        # Use API key's system_type, not client-provided header (prevents impersonation)
        source_system = api_key.system_type

        try:
            result = DeathSyncService.register_death(
                tenant=tenant,
                api_key=api_key,
                payload=serializer.validated_data,
                idempotency_key=idempotency_key,
                source_ip=self._get_client_ip(request),
            )
        except IntegrityError:
            # Idempotency conflict
            existing = DeathRegistrationRequest.objects.filter(
                source_system=source_system,
                idempotency_key=idempotency_key,
            ).first()
            if existing:
                return Response({
                    "status": "duplicate",
                    "registration_id": str(existing.id),
                    "existing_status": existing.status,
                }, status=status.HTTP_409_CONFLICT)
            raise

        if result.status == DeathRegistrationStatus.FAILED:
            return Response({
                "error": {
                    "code": result.error_code,
                    "message": result.error_message,
                    "request_id": str(result.id),
                },
            }, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            "status": "accepted",
            "registration_id": str(result.id),
            "idempotency_key": idempotency_key,
            "result": {
                "soul_id": str(result.soul_id),
                "previous_state": "ALIVE",
                "new_state": "JUDGING",
                "judgment_id": str(result.judgment_id),
            },
        }, status=status.HTTP_201_CREATED)

    def _get_client_ip(self, request):
        """Extract client IP from request."""
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            return x_forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")


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
    Health check for death sync API with monitoring metrics.
    """
    authentication_classes = [APIKeyAuthentication]

    def get(self, request):
        from django.utils import timezone
        from datetime import timedelta

        api_key = getattr(request, 'api_key', None)
        tenant = getattr(request, 'tenant', None)

        # Count pending/failed registrations in last 24h
        cutoff_24h = timezone.now() - timedelta(hours=24)
        pending_count = DeathRegistrationRequest.objects.filter(
            status=DeathRegistrationStatus.PENDING,
            request_timestamp__gte=cutoff_24h,
        ).count()
        failed_count = DeathRegistrationRequest.objects.filter(
            status=DeathRegistrationStatus.FAILED,
            request_timestamp__gte=cutoff_24h,
        ).count()

        # Count failed webhooks in last 24h
        from apps.death_sync.models import WebhookDeliveryLog, WebhookDeliveryStatus
        failed_webhooks = WebhookDeliveryLog.objects.filter(
            status=WebhookDeliveryStatus.FAILED,
            created_at__gte=cutoff_24h,
        ).count()

        return Response({
            "api_key": {
                "name": api_key.name if api_key else None,
                "system_type": api_key.system_type if api_key else None,
                "is_active": api_key.is_active if api_key else False,
                "rate_limit_remaining": {
                    "per_minute": api_key.rate_limit_per_minute if api_key else 0,
                    "per_hour": api_key.rate_limit_per_hour if api_key else 0,
                },
            },
            "system": {
                "status": "healthy",
                "pending_registrations_24h": pending_count,
                "failed_registrations_24h": failed_count,
                "failed_webhooks_24h": failed_webhooks,
            },
        })
