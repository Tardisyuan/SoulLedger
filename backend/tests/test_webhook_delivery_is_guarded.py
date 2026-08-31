"""Webhook deliveries are signed with a real key, filtered, and not aimed inward.

Four defects on the outbound-HTTP path, measured 2026-08-29.

**Signed with an empty key.** `apps/events/handlers/webhook_handler.py` read
`getattr(webhook, "secret", "")`. The field is `signing_secret`; there is no
`secret`. The `getattr` default turned a typo into an empty HMAC key, so the
signature on every EventBus delivery was reproducible by anyone who could see
the body::

    sent:                      sha256=550aa2ad...
    recomputed with empty key: sha256=550aa2ad...   -> match
    recomputed with the real signing_secret:         -> no match

`apps/death_sync/webhook_service.py` signs the *same header name* with the
real secret. So a receiver verifying properly rejected 100% of EventBus
deliveries and accepted every death-sync one -- the failure looked like a
transport problem, not a signing one.

**The subscription list was never read.** A `WebhookConfig` registered for
`events=["DEATH_SYNC_RECEIVED"]` received a `WORKFLOW_APPROVED` envelope
carrying `{"soul_id": ..., "verdict": "GUILTY"}`.

**The SSRF blocklist had four holes.** Running the list against probes:
`0.0.0.0` (routes to localhost on Linux), `fd00::1` (IPv6 ULA), `100.64.1.1`
(CGNAT) and `192.0.0.1` were all ALLOWED.

**Redirects were followed.** `requests.post` defaults to following them and
`_validate_webhook_url` only ever saw the URL we were handed, so a public host
answering `302 -> http://169.254.169.254/...` reached the metadata service
carrying the tenant's signature.
"""
import hashlib
import hmac
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from django.db import transaction

from apps.death_sync.webhook_service import _BLOCKED_NETWORKS, _validate_webhook_url


class _Envelope:
    def __init__(self, event_type, domain="workflow", tenant_code="WD_T"):
        self.event_type = event_type
        self.domain = domain
        self.tenant_code = tenant_code

    def to_dict(self):
        return {"event_type": self.event_type, "payload": {"soul_id": "abc"}}


@pytest.fixture
def wired(db):
    from apps.death_sync.models import ExternalApiKey, WebhookConfig
    from apps.tenants.models import Tenant

    tenant = Tenant.objects.get_or_create(
        code="WD_T", defaults={"display_name": "Webhook Delivery"}
    )[0]
    _, key_hash, key_prefix = ExternalApiKey.generate_key()
    key = ExternalApiKey.objects.create(
        tenant=tenant, name="WD", system_type="HOSPITAL",
        key_hash=key_hash, key_prefix=key_prefix,
    )
    hook = WebhookConfig.objects.create(
        tenant=tenant, api_key=key,
        url="https://example.invalid/hook",
        signing_secret="the-real-secret",
        events=["DEATH_SYNC_RECEIVED"],
    )
    return tenant, hook



@contextmanager
def _run_on_commit_callbacks():
    """Run whatever `transaction.on_commit` collects inside this block.

    `django_capture_on_commit_callbacks` is the pytest-django fixture for
    this; a context manager keeps `_deliver` usable from a plain helper
    function rather than threading a fixture through every caller.
    """
    connection = transaction.get_connection()
    start = len(connection.run_on_commit)
    try:
        yield
    finally:
        callbacks = [fn for _sids, fn, *_ in connection.run_on_commit[start:]]
        del connection.run_on_commit[start:]
        for fn in callbacks:
            fn()


def _record(envelope):
    """跑 handler,返回它**记下**的投递行。不发 HTTP。

    2026-09-01 之后 handler 只写 `EventWebhookDelivery` 行,真正的 HTTP 在
    `events.deliver_webhook` 任务里(M26 的后半:把投递从请求线程上挪走,
    并让失败有人重试)。所以订阅过滤在这里断,签名在任务上断。

    `_run_on_commit_callbacks` 仍然需要:`django_db` 把测试裹在一个**永不提交**
    的 atomic 里,而入队挂在 `on_commit` 上。入队本身会失败(测试环境没有
    broker),`_enqueue` 吞掉它 —— 那正是「入队失败不算数据丢失」的设计:行还在。
    """
    from apps.events.handlers.webhook_handler import WebhookHandler
    from apps.events.models import EventWebhookDelivery

    before = set(EventWebhookDelivery.objects.values_list("id", flat=True))
    with _run_on_commit_callbacks():
        WebhookHandler().handle(envelope)
    return list(EventWebhookDelivery.objects.exclude(id__in=before))


def _run_delivery_task(delivery):
    """把一条已记录的投递交给真正的任务跑,返回它发出的请求。"""
    from apps.events.tasks import deliver_event_webhook

    sent = []

    def fake_urlopen(req, timeout=None):
        sent.append(req)

        class _R:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        return _R()

    with patch("urllib.request.urlopen", side_effect=fake_urlopen), patch(
        "apps.events.handlers.webhook_handler._reject_if_not_publicly_routable",
        lambda url: None,
    ):
        deliver_event_webhook.apply(args=[str(delivery.id)])
    return sent


@pytest.mark.django_db
def test_a_delivery_is_signed_with_the_configured_secret(wired):
    _, hook = wired
    recorded = _record(_Envelope("DEATH_SYNC_RECEIVED", domain="death_sync"))
    assert len(recorded) == 1, "handler 没有记下投递;下面的探针什么都证明不了"

    sent = _run_delivery_task(recorded[0])
    assert len(sent) == 1, "任务没有发出请求"

    body = sent[0].data
    header = sent[0].headers["X-soulledger-signature"]
    with_real = "sha256=" + hmac.new(
        b"the-real-secret", body, hashlib.sha256
    ).hexdigest()
    with_empty = "sha256=" + hmac.new(b"", body, hashlib.sha256).hexdigest()

    assert header == with_real, (
        f"签名与 `signing_secret` 对不上。得到 {header},应为 {with_real}。"
    )
    assert header != with_empty, (
        "签名用空密钥就能复现 —— 任何看得见 body 的人都能伪造它。"
    )


@pytest.mark.django_db
def test_a_webhook_only_receives_the_events_it_subscribed_to(wired):
    _, hook = wired
    assert hook.events == ["DEATH_SYNC_RECEIVED"]

    assert _record(_Envelope("WORKFLOW_APPROVED")) == [], (
        "一个只订阅了死亡通知的 webhook 被记下了一条 workflow 投递。"
        "载荷里带着 soul id 与裁决,而目标 URL 是租户自己给的。"
    )
    assert len(_record(_Envelope("DEATH_SYNC_RECEIVED", domain="death_sync"))) == 1, (
        "订阅了的事件没被记下 —— 过滤器把什么都拒了"
    )


@pytest.mark.django_db
def test_an_empty_subscription_list_still_means_everything(wired):
    _, hook = wired
    hook.events = []
    hook.save(update_fields=["events"])
    assert len(_record(_Envelope("WORKFLOW_APPROVED"))) == 1


@pytest.mark.django_db
def test_a_webhook_without_a_secret_records_nothing(wired):
    """没有签名密钥就不记 —— 否则会攒下一堆永远发不出去的行。

    任务侧也有同一道检查(它把行标成 ABANDONED),两处都要:handler 这道防止
    行堆积,任务那道防止有人直接入队一条没密钥的投递。
    """
    _, hook = wired
    hook.signing_secret = ""
    hook.save(update_fields=["signing_secret"])
    assert _record(_Envelope("DEATH_SYNC_RECEIVED", domain="death_sync")) == []


@pytest.mark.parametrize(
    "address",
    [
        "0.0.0.0",       # routes to localhost on Linux
        "127.0.0.1",
        "10.0.0.1",
        "169.254.169.254",  # cloud metadata
        "192.168.1.1",
        "172.16.0.1",
        "fd00::1",       # IPv6 unique local
        "::1",
        "100.64.1.1",    # CGNAT
        "192.0.0.1",     # IETF protocol assignments
    ],
)
def test_the_blocklist_covers_every_address_that_should_never_be_reached(address):
    """Four of these were ALLOWED before: 0.0.0.0, fd00::1, 100.64.1.1, 192.0.0.1.

    Asserted against the network list directly rather than through
    `_validate_webhook_url`, which would need DNS.
    """
    import ipaddress

    ip = ipaddress.ip_address(address)
    assert any(ip in net for net in _BLOCKED_NETWORKS), (
        f"{address} is not covered by any blocked network"
    )


def test_a_publicly_routable_address_is_still_allowed():
    """Negative control -- a blocklist that blocks everything is an outage."""
    import ipaddress

    for public in ("8.8.8.8", "203.0.113.9", "2001:4860:4860::8888"):
        ip = ipaddress.ip_address(public)
        assert not any(ip in net for net in _BLOCKED_NETWORKS), (
            f"{public} is blocked; the list has stopped distinguishing"
        )


def test_outbound_delivery_does_not_follow_redirects():
    """The validator only ever sees the URL it is given.

    Asserted on the call rather than by standing up a redirecting server: what
    regresses is someone dropping the keyword, and that is what this reads.
    """
    import inspect

    from apps.death_sync import webhook_service

    source = inspect.getsource(webhook_service)
    post_call = source[source.index("requests.post(") :]
    post_call = post_call[: post_call.index("\n            )")]
    assert "allow_redirects=False" in post_call, (
        "requests.post follows redirects by default. A webhook on a public "
        "host answering 302 -> http://169.254.169.254/ reaches the metadata "
        "service carrying this tenant's HMAC signature, and the validator "
        "never sees the second URL."
    )


def test_the_url_validator_rejects_a_loopback_target():
    """End-to-end on the validator, for an address that needs no DNS."""
    with pytest.raises(ValueError):
        _validate_webhook_url("https://127.0.0.1/hook")


# ---------------------------------------------------------------------------
# The API-key capability flags.
#
# `can_manage_webhooks` and `can_query_status` were declared on the model,
# migrated, serialized, and read by nothing -- grep found 3 and 2 hits
# respectively, all of them declarations. A key with `can_manage_webhooks=False`
# POSTed to /webhooks/ and got 201, i.e. any valid key could aim this
# application's outbound HTTP.
#
# These are here because the first mutation run of this file left the
# enforcement untested: swapping CanManageWebhooks back to HasValidApiKey
# produced 35 green. A guard nothing can make fail has not been shown to guard.
# ---------------------------------------------------------------------------

@pytest.fixture
def keys(db):
    from apps.death_sync.models import ExternalApiKey
    from apps.tenants.models import Tenant

    tenant = Tenant.objects.get_or_create(
        code="WC_T", defaults={"display_name": "Webhook Caps"}
    )[0]

    def _make(**flags):
        raw, key_hash, prefix = ExternalApiKey.generate_key()
        ExternalApiKey.objects.create(
            tenant=tenant, name=f"k{len(raw)}", system_type="HOSPITAL",
            key_hash=key_hash, key_prefix=prefix, **flags,
        )
        return raw

    return _make


def _api_client(raw_key):
    from rest_framework.test import APIClient

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"ApiKey {raw_key}")
    return client


@pytest.mark.django_db
def test_a_key_without_can_manage_webhooks_is_refused(keys):
    without = _api_client(keys(can_manage_webhooks=False))
    for method, url in (
        ("get", "/api/v1/death-sync/webhooks/"),
        ("post", "/api/v1/death-sync/webhooks/"),
    ):
        resp = getattr(without, method)(
            url,
            {"url": "https://example.invalid/h", "signing_secret": "s"},
            format="json",
        )
        assert resp.status_code == 403, (
            f"{method.upper()} {url} returned {resp.status_code} for a key with "
            f"can_manage_webhooks=False. A WebhookConfig decides where this "
            f"system sends outbound HTTP."
        )


@pytest.mark.django_db
def test_a_key_with_can_manage_webhooks_still_works(keys):
    """Positive control -- the flag must gate, not close the endpoint."""
    with_cap = _api_client(keys(can_manage_webhooks=True))
    resp = with_cap.get("/api/v1/death-sync/webhooks/")
    assert resp.status_code == 200, resp.status_code


@pytest.mark.django_db
def test_a_key_without_can_query_status_is_refused_the_health_view(keys):
    without = _api_client(keys(can_query_status=False))
    resp = without.get("/api/v1/death-sync/health/")
    assert resp.status_code == 403, (
        f"health returned {resp.status_code} for a key with "
        f"can_query_status=False -- the other declared-and-never-read flag"
    )
    with_cap = _api_client(keys(can_query_status=True))
    assert with_cap.get("/api/v1/death-sync/health/").status_code == 200
