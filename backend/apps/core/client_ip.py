"""One answer to "who sent this request", validated before anyone stores it.

There were three copies of this helper -- `apps/audit/signals.py`,
`apps/death_sync/authentication.py`, `apps/authentication/views.py` -- and all
three read the first entry of ``X-Forwarded-For`` and returned it unchecked.
That header is supplied by whoever is talking to us. Two things followed.

**An unparseable value deleted the audit trail, on PostgreSQL only.**
``AuditLog.ip_address`` is a ``GenericIPAddressField`` and
``AuditLog.objects.create()`` runs no ``full_clean``. Measured end to end on a
PostgreSQL clone, 2026-08-29::

    PATCH /api/v1/workflows/{id}/                         -> 200, audit row written
    PATCH /api/v1/workflows/{id}/  + X-Forwarded-For: not-an-ip
                                                          -> 200
      notes committed as 'pwn'
      ERROR  Failed to create audit log:
             invalid input syntax for type inet: "not-an-ip"
      -> the write succeeded and the audit row does not exist

So any authenticated user could perform any mutation with no audit record by
adding one header. On SQLite that column is TEXT, the value stores fine and
nothing fails -- which is why no test in a 2694-test suite could see it. This
is the "SQLite hides a whole class of defect" case CLAUDE.md describes, in the
one place whose job is to remember what happened.

**A chosen value defeated two controls.**
``ExternalApiKey.allowed_ips``: with a key restricted to 203.0.113.9, a
request from 198.51.100.7 was refused (401) without the header and accepted
(200) with ``X-Forwarded-For: 203.0.113.9``. The same helper keys the login
brute-force limiter (5 attempts / 15 min), so rotating the header reset the
counter.

**The rule here.** ``X-Forwarded-For`` is only meaningful if the request
provably passed through proxies we control, and only the entries those proxies
appended can be trusted -- appended on the *right*, so the trustworthy one is
counted from the right. With no proxy configured there is nothing to trust and
``REMOTE_ADDR`` is the answer. Set ``TRUSTED_PROXY_COUNT`` in settings to the
number of proxies in front of the application; leaving it at 0 (the default)
means the header is ignored entirely, which is the correct behaviour for a
directly-exposed service and the safe default for one whose deployment shape
nobody has written down.
"""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_ipv46_address


def _valid(candidate):
    if not candidate:
        return None
    candidate = candidate.strip()
    try:
        validate_ipv46_address(candidate)
    except ValidationError:
        return None
    return candidate


def get_client_ip(request):
    """Return a validated client IP, or None.

    None is a real answer and callers must handle it: a request can arrive with
    no usable address, and inventing one is how an unparseable string reached a
    database column in the first place. `AuditLog.ip_address` is nullable;
    `ExternalApiKey.allowed_ips` must treat None as "not on the list".
    """
    remote_addr = _valid(request.META.get("REMOTE_ADDR"))

    trusted = getattr(settings, "TRUSTED_PROXY_COUNT", 0)
    if not trusted:
        return remote_addr

    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if not forwarded:
        return remote_addr

    # Proxies append on the right. With N trusted proxies, the last N entries
    # were written by them; the one before those is the closest address they
    # actually observed. Taking entry [0] -- what all three copies did -- takes
    # whatever the client typed.
    hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
    index = len(hops) - trusted - 1
    if index < 0:
        # Fewer hops than configured proxies: the chain is not what we were
        # told it would be, so nothing in it is trustworthy.
        return remote_addr
    return _valid(hops[index]) or remote_addr
