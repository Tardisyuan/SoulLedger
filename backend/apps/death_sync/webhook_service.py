"""
Webhook delivery service — handles webhook sending, signing, and retry logic.
"""
import json
import time
import logging
import requests
from django.utils import timezone
from apps.death_sync.models import (
    WebhookConfig, WebhookDeliveryLog, WebhookDeliveryStatus,
    DeathRegistrationRequest,
)
from apps.death_sync.signing import sign_payload

logger = logging.getLogger(__name__)

# Retry delays in seconds (exponential backoff)
RETRY_DELAYS = [30, 120, 600, 3600, 21600]  # 30s, 2m, 10m, 1h, 6h


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
