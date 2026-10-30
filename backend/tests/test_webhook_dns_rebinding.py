"""The webhook sender checks the address it actually connected to, not only the one it validated.

`_validate_webhook_url` resolves the hostname once and `requests` resolves it again to connect.
A name that answers public the first time and 127.0.0.1 the second (DNS rebinding) used to pass
the check and reach the private address. `public_only_session` re-checks the peer after connect.
"""
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

import pytest
from django.test import override_settings

from apps.core.outbound import public_only_session, validate_webhook_url

_real_getaddrinfo = socket.getaddrinfo


class _Ok(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


@pytest.fixture
def local_server():
    server = HTTPServer(("127.0.0.1", 0), _Ok)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server.server_address[1]
    server.shutdown()


def _rebinding(port):
    """First lookup of rebind.example answers a public address, every later one 127.0.0.1."""
    calls = []

    def fake(host, *args, **kwargs):
        if host != "rebind.example":
            return _real_getaddrinfo(host, *args, **kwargs)
        calls.append(host)
        ip = "93.184.216.34" if len(calls) == 1 else "127.0.0.1"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    return fake


@override_settings(DEBUG=True)
def test_a_name_that_rebinds_to_loopback_after_validation_is_refused(local_server):
    url = f"http://rebind.example:{local_server}/hook"
    with patch("socket.getaddrinfo", side_effect=_rebinding(local_server)):
        validate_webhook_url(url)  # the first answer is public: the old check passes
        with public_only_session() as session, pytest.raises(ValueError, match="127.0.0.1"):
            session.post(url, data=b"{}", timeout=5, allow_redirects=False)


def test_a_direct_private_address_is_refused_and_an_allowed_one_is_not(local_server):
    url = f"http://127.0.0.1:{local_server}/hook"
    with public_only_session() as session, pytest.raises(ValueError):
        session.post(url, data=b"{}", timeout=5)
    # Control: the same request through the allowlist reaches the server — so the refusal
    # above is the peer check, not a connection that could never have worked.
    with public_only_session(allowed={"127.0.0.1"}) as session:
        assert session.post(url, data=b"{}", timeout=5).status_code == 200


def test_the_old_death_sync_names_are_the_core_guard_itself():
    """`apps/events` still imports the guard from `apps.death_sync.webhook_service` (moved to
    `apps.core.outbound` 2026-10-30): the re-export must be the same functions, not copies that could drift."""
    from apps.core import outbound
    from apps.death_sync import webhook_service

    assert webhook_service._validate_webhook_url is outbound.validate_webhook_url
    assert webhook_service._require_public_ip is outbound.require_public_ip
    assert webhook_service.public_only_session is outbound.public_only_session
