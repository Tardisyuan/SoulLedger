"""
Outbound webhook URL validation (SSRF guard).

The death_sync delivery pipeline that used to live here (`WebhookService`,
its retry tasks and `WebhookDeliveryLog`) was removed on 2026-09-13: death
registrations announce themselves through the EventBus since BD-11, and
nothing called the old path. Deliveries are `apps/events/tasks.py`, which
calls `_validate_webhook_url` below through `_reject_if_not_publicly_routable`.
"""
import ipaddress
import socket
from urllib.parse import urlparse

from django.conf import settings


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
        raise ValueError(f"Could not resolve webhook hostname: {hostname}") from None

    for _family, _, _, _, sockaddr in resolved:
        ip = ipaddress.ip_address(sockaddr[0])
        # An allowlist of "publicly routable" rather than a hand-kept blocklist:
        # the old table missed 0.0.0.0/8, fc00::/7, CGNAT and 192.0.0.0/24 until
        # 2026-08-29, and IPv6 link-local and multicast after that. `is_global`
        # is False for all of those; multicast is the one global range left.
        if not ip.is_global or ip.is_multicast or getattr(ip, "ipv4_mapped", None):
            raise ValueError(
                f"Webhook URL resolves to a private/loopback IP: {ip}"
            )
