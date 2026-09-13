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

# SSRF: private/loopback IP ranges to block
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),      # loopback IPv4
    ipaddress.ip_network("::1/128"),           # loopback IPv6
    ipaddress.ip_network("10.0.0.0/8"),        # private class A
    ipaddress.ip_network("172.16.0.0/12"),     # private class B
    ipaddress.ip_network("192.168.0.0/16"),    # private class C
    ipaddress.ip_network("169.254.0.0/16"),    # link-local
    ipaddress.ip_network("::ffff:0:0/96"),     # IPv4-mapped IPv6
    # The four below were missing. Verified 2026-08-29 by running the list
    # above against probe addresses: each of these was ALLOWED.
    ipaddress.ip_network("0.0.0.0/8"),         # "this network" -- 0.0.0.0 routes
                                               # to localhost on Linux, so this
                                               # was a loopback bypass
    ipaddress.ip_network("fc00::/7"),          # IPv6 unique local (fd00::/8 etc.)
    ipaddress.ip_network("100.64.0.0/10"),     # CGNAT / carrier-grade NAT
    ipaddress.ip_network("192.0.0.0/24"),      # IETF protocol assignments
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
        raise ValueError(f"Could not resolve webhook hostname: {hostname}") from None

    for _family, _, _, _, sockaddr in resolved:
        ip = ipaddress.ip_address(sockaddr[0])
        for network in _BLOCKED_NETWORKS:
            if ip in network:
                raise ValueError(
                    f"Webhook URL resolves to a private/loopback IP: {ip}"
                )
