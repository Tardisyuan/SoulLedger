"""`X-Forwarded-For` is client-supplied. Two controls trusted it anyway.

**It deleted the audit trail (PostgreSQL only).** `AuditLog.ip_address` is a
`GenericIPAddressField` and `objects.create()` runs no `full_clean`, so an
unparseable value raised DataError *inside* the audit write while the mutation
itself committed. Measured end to end on a PostgreSQL clone, 2026-08-29: a
PATCH with `X-Forwarded-For: not-an-ip` returned 200, the change was stored,
and no audit row exists. On SQLite that column is TEXT and nothing fails --
which is why 2694 passing tests could not see it.

**It defeated an IP allowlist and a brute-force limiter.** A key restricted to
203.0.113.9 accepted a request from 198.51.100.7 carrying
`X-Forwarded-For: 203.0.113.9` (200 with the header, 401 without). The same
helper keys the login limiter, so rotating the header reset the counter.

There were three copies of the helper. These tests go at the one that replaced
them, because that is the layer the rule lives on -- and because the
PostgreSQL half cannot be reproduced on the engine this suite runs on.
"""
import pytest
from django.test import RequestFactory, override_settings

from apps.core.client_ip import get_client_ip


def _request(remote_addr=None, forwarded=None):
    rf = RequestFactory()
    req = rf.get("/")
    if remote_addr is None:
        req.META.pop("REMOTE_ADDR", None)
    else:
        req.META["REMOTE_ADDR"] = remote_addr
    if forwarded is not None:
        req.META["HTTP_X_FORWARDED_FOR"] = forwarded
    return req


@override_settings(TRUSTED_PROXY_COUNT=0)
def test_a_forged_header_is_ignored_when_no_proxy_is_configured():
    ip = get_client_ip(_request("198.51.100.7", "203.0.113.9"))
    assert ip == "198.51.100.7", (
        f"got {ip!r}. With no trusted proxy there is nothing in the header "
        f"worth believing; returning it is how an allowlist was satisfied by "
        f"the address it was asking for."
    )


@override_settings(TRUSTED_PROXY_COUNT=0)
def test_garbage_never_reaches_a_caller():
    """The audit column is `inet` on PostgreSQL. A non-address must not arrive."""
    for junk in ("not-an-ip", "'; DROP TABLE", "999.999.999.999", "", "   "):
        ip = get_client_ip(_request("198.51.100.7", junk))
        assert ip == "198.51.100.7", f"{junk!r} produced {ip!r}"


@override_settings(TRUSTED_PROXY_COUNT=0)
def test_an_unparseable_remote_addr_yields_none_rather_than_itself():
    """None is a real answer; inventing one is how this started.

    Callers must handle it: `AuditLog.ip_address` is nullable, and an
    allowlist must read None as 'not on the list'.
    """
    assert get_client_ip(_request("garbage")) is None


@override_settings(TRUSTED_PROXY_COUNT=1)
def test_with_one_trusted_proxy_the_client_entry_is_counted_from_the_right():
    """Proxies append. The last entry is ours; the one before it is what we saw.

    Taking entry [0] -- what all three copies did -- takes whatever the client
    typed at the far end of the chain.
    """
    ip = get_client_ip(_request("10.0.0.1", "203.0.113.9, 198.51.100.7"))
    assert ip == "203.0.113.9", (
        f"got {ip!r}; with one trusted proxy the client address is the entry "
        f"immediately left of the proxy's own"
    )


@override_settings(TRUSTED_PROXY_COUNT=1)
def test_a_forged_prefix_cannot_reach_past_the_trusted_hop():
    """The attacker controls everything left of the real proxy's entry."""
    ip = get_client_ip(
        _request("10.0.0.1", "1.2.3.4, 5.6.7.8, 203.0.113.9, 198.51.100.7")
    )
    assert ip == "203.0.113.9", f"got {ip!r} -- a forged prefix was believed"


@override_settings(TRUSTED_PROXY_COUNT=2)
def test_a_chain_shorter_than_configured_falls_back_to_remote_addr():
    """Fewer hops than proxies means the chain is not the one we were promised."""
    ip = get_client_ip(_request("10.0.0.1", "203.0.113.9"))
    assert ip == "10.0.0.1", f"got {ip!r}"


@pytest.mark.django_db
@override_settings(TRUSTED_PROXY_COUNT=0)
def test_the_audit_helper_and_the_api_key_helper_both_route_here():
    """Three copies existed. A fix applied to one of them is not a fix.

    Asserting the delegation rather than re-testing the behaviour: the rule is
    tested above, and what regresses is someone re-inlining a copy.
    """
    from apps.audit.signals import _get_client_ip as audit_helper
    from apps.authentication.views import _get_client_ip as auth_helper
    from apps.death_sync.authentication import APIKeyAuthentication

    req = _request("198.51.100.7", "203.0.113.9")
    assert audit_helper(req) == "198.51.100.7"
    assert auth_helper(req) == "198.51.100.7"
    assert APIKeyAuthentication._get_client_ip(req) == "198.51.100.7"
