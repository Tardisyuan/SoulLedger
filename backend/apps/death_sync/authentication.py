"""
API Key authentication for external death sync systems.
"""
import hashlib

from django.db import models
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed


class APIKeyAuthentication(BaseAuthentication):
    """
    Authenticates external systems via API key.
    Header format: Authorization: ApiKey <raw_key>

    Sets request.api_key to the validated ExternalApiKey instance.
    Sets request.tenant from the key's tenant.
    """
    keyword = "ApiKey"

    def authenticate(self, request):
        from apps.death_sync.models import ExternalApiKey

        auth = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth.startswith(f"{self.keyword} "):
            return None

        raw_key = auth[len(self.keyword) + 1:].strip()
        if not raw_key:
            return None

        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

        try:
            api_key = ExternalApiKey.objects.select_related("tenant").get(
                key_hash=key_hash,
                is_active=True,
            )
        except ExternalApiKey.DoesNotExist:
            raise AuthenticationFailed("Invalid or inactive API key") from None

        if api_key.is_expired:
            raise AuthenticationFailed("API key has expired")

        # Check IP whitelist
        if api_key.allowed_ips:
            client_ip = self._get_client_ip(request)
            if client_ip not in api_key.allowed_ips:
                raise AuthenticationFailed(f"IP {client_ip} not whitelisted")

        # Update usage stats
        ExternalApiKey.objects.filter(pk=api_key.pk).update(
            last_used_at=timezone.now(),
            usage_count=models.F("usage_count") + 1,
        )

        # Set tenant context
        request.tenant = api_key.tenant
        request.api_key = api_key

        from django.contrib.auth.models import AnonymousUser
        return (AnonymousUser(), api_key)

    def authenticate_header(self, request):
        return self.keyword

    @staticmethod
    def _get_client_ip(request):
        """Delegates to the one validated implementation.

        `allowed_ips` was bypassable by sending the address it wanted:
        measured, a key restricted to 203.0.113.9 accepted a request from
        198.51.100.7 carrying `X-Forwarded-For: 203.0.113.9`. See
        apps/core/client_ip.py.
        """
        from apps.core.client_ip import get_client_ip

        return get_client_ip(request)
