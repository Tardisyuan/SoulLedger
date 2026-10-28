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
        _require_public_ip(sockaddr[0])


def _require_public_ip(address, allowed=()):
    """Raise ValueError unless `address` is publicly routable (or listed in `allowed`).

    An allowlist of "publicly routable" rather than a hand-kept blocklist:
    the old table missed 0.0.0.0/8, fc00::/7, CGNAT and 192.0.0.0/24 until
    2026-08-29, and IPv6 link-local and multicast after that. `is_global`
    is False for all of those; multicast is the one global range left.
    """
    ip = ipaddress.ip_address(str(address).split("%", 1)[0])
    if str(ip) in allowed:
        return
    if not ip.is_global or ip.is_multicast or getattr(ip, "ipv4_mapped", None):
        raise ValueError(f"URL resolves to a private/loopback IP: {ip}")


# ── Checking the address actually connected to ─────────────────────────────
#
# `_validate_webhook_url` resolves the name once; `requests` then resolves it
# again to connect. A DNS answer with a 0-second TTL can be public for the
# first lookup and 169.254.169.254 for the second (DNS rebinding), and the
# check above never sees the second. So the connection itself checks the peer
# it ended up on, after `connect()` and before a byte is sent. Host header,
# SNI and certificate verification still use the hostname, untouched.

def _peer_checked(conn_cls, allowed):
    class _Checked(conn_cls):
        def _new_conn(self):
            sock = super()._new_conn()
            try:
                _require_public_ip(sock.getpeername()[0], allowed)
            except ValueError:
                sock.close()
                raise
            return sock

    return _Checked


def public_only_session(allowed=()):
    """A `requests.Session` whose every connection must land on a public address
    (or one of the literal IPs in `allowed`). Proxies from the environment are
    ignored: through a proxy the peer is the proxy, and the check would pass
    for whatever the proxy then fetched."""
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.connection import HTTPConnection, HTTPSConnection
    from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool

    allowed = frozenset(allowed)

    class _HTTPPool(HTTPConnectionPool):
        ConnectionCls = _peer_checked(HTTPConnection, allowed)

    class _HTTPSPool(HTTPSConnectionPool):
        ConnectionCls = _peer_checked(HTTPSConnection, allowed)

    class _Adapter(HTTPAdapter):
        def init_poolmanager(self, *args, **kwargs):
            super().init_poolmanager(*args, **kwargs)
            self.poolmanager.pool_classes_by_scheme = {"http": _HTTPPool, "https": _HTTPSPool}

    session = requests.Session()
    session.trust_env = False
    session.mount("http://", _Adapter())
    session.mount("https://", _Adapter())
    return session
