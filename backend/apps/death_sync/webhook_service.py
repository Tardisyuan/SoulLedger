"""
Webhook delivery service — handles webhook sending, signing, and retry logic.
"""
import json
import time
import logging
import ipaddress
import socket
from urllib.parse import urlparse
import requests
from django.conf import settings
from django.utils import timezone
from apps.death_sync.models import (
    WebhookConfig, WebhookDeliveryLog, WebhookDeliveryStatus,
    DeathRegistrationRequest,
)
from apps.death_sync.signing import sign_payload

logger = logging.getLogger(__name__)

# Retry delays in seconds (exponential backoff)
RETRY_DELAYS = [30, 120, 600, 3600, 21600]  # 30s, 2m, 10m, 1h, 6h

# SSRF: private/loopback IP ranges to block
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),      # loopback IPv4
    ipaddress.ip_network("::1/128"),           # loopback IPv6
    ipaddress.ip_network("10.0.0.0/8"),        # private class A
    ipaddress.ip_network("172.16.0.0/12"),     # private class B
    ipaddress.ip_network("192.168.0.0/16"),    # private class C
    ipaddress.ip_network("169.254.0.0/16"),    # link-local
    ipaddress.ip_network("::ffff:0:0/96"),     # IPv4-mapped IPv6
]


def _validate_webhook_url(url):
    """
    Validate a webhook URL to prevent SSRF attacks.

    Raises ValueError if the URL is unsafe.
    """
    parsed = urlparse(url)

    # Enforce HTTPS in production
    if not settings.DEBUG and parsed.scheme != "https":
        raise ValueError(
            f"Webhook URL must use HTTPS in production, got: {parsed.scheme}"
        )

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Webhook URL must have a valid hostname")

    # Resolve the hostname and check for private/loopback IPs
    try:
        resolved = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise ValueError(f"Could not resolve webhook hostname: {hostname}")

    for family, _, _, _, sockaddr in resolved:
        ip = ipaddress.ip_address(sockaddr[0])
        for network in _BLOCKED_NETWORKS:
            if ip in network:
                raise ValueError(
                    f"Webhook URL resolves to a private/loopback IP: {ip}"
                )


class WebhookService:
    """
    Handles webhook delivery with HMAC signing and retry logic.
    """

    @staticmethod
    def deliver_webhook(webhook, registration):
        """
        Deliver a webhook payload to a registered endpoint.

        Args:
            webhook: WebhookConfig instance
            registration: DeathRegistrationRequest instance

        Returns:
            WebhookDeliveryLog instance
        """
        # Check event filter
        if webhook.events and registration.status not in webhook.events:
            return None

        # Build payload
        payload = {
            "event": "DEATH_REGISTERED",
            "timestamp": timezone.now().isoformat(),
            "tenant": str(registration.tenant_id),
            "data": {
                "registration_id": str(registration.id),
                "soul_id": str(registration.soul_id) if registration.soul_id else None,
                "status": registration.status,
                "source_system": registration.source_system,
            },
        }

        payload_bytes = json.dumps(payload).encode()
        timestamp = str(int(time.time()))

        # SSRF protection: validate URL before sending
        try:
            _validate_webhook_url(webhook.url)
        except ValueError as e:
            logger.warning(f"SSRF validation failed for webhook {webhook.id}: {e}")
            delivery_log = WebhookDeliveryLog.objects.create(
                webhook=webhook,
                registration=registration,
                status=WebhookDeliveryStatus.FAILED,
                request_body=payload,
                error_message=str(e),
            )
            return delivery_log

        # Create delivery log
        delivery_log = WebhookDeliveryLog.objects.create(
            webhook=webhook,
            registration=registration,
            status=WebhookDeliveryStatus.PENDING,
            request_body=payload,
        )

        try:
            # Sign payload
            signature = sign_payload(payload_bytes, webhook.signing_secret, timestamp)

            # Send request
            headers = {
                "Content-Type": "application/json",
                "X-SoulLedger-Signature": f"sha256={signature}",
                "X-SoulLedger-Timestamp": timestamp,
                "X-SoulLedger-Event": "DEATH_REGISTERED",
                "X-SoulLedger-Delivery": str(delivery_log.id),
            }

            start_time = time.time()
            response = requests.post(
                webhook.url,
                data=payload_bytes,
                headers=headers,
                timeout=webhook.timeout_seconds,
            )
            duration_ms = int((time.time() - start_time) * 1000)

            # Update delivery log
            delivery_log.http_status_code = response.status_code
            delivery_log.response_body = response.text[:1000]
            delivery_log.duration_ms = duration_ms

            if 200 <= response.status_code < 300:
                delivery_log.status = WebhookDeliveryStatus.SUCCESS
            else:
                delivery_log.status = WebhookDeliveryStatus.FAILED
                delivery_log.error_message = f"HTTP {response.status_code}"

            delivery_log.save()
            return delivery_log

        except requests.Timeout:
            delivery_log.status = WebhookDeliveryStatus.FAILED
            delivery_log.error_message = "Request timed out"
            delivery_log.save()
            return delivery_log

        except requests.RequestException as e:
            delivery_log.status = WebhookDeliveryStatus.FAILED
            delivery_log.error_message = str(e)
            delivery_log.save()
            return delivery_log

    @staticmethod
    def schedule_retry(delivery_log):
        """
        Schedule a retry for a failed delivery with exponential backoff.

        Args:
            delivery_log: WebhookDeliveryLog instance

        Returns:
            Updated WebhookDeliveryLog instance
        """
        if delivery_log.attempt >= delivery_log.webhook.max_retries:
            delivery_log.status = WebhookDeliveryStatus.FAILED
            delivery_log.save()
            return delivery_log

        delay_index = min(delivery_log.attempt, len(RETRY_DELAYS) - 1)
        delay = RETRY_DELAYS[delay_index]

        delivery_log.attempt += 1
        delivery_log.status = WebhookDeliveryStatus.RETRYING
        delivery_log.next_retry_at = timezone.now() + timezone.timedelta(seconds=delay)
        delivery_log.save()

        return delivery_log
