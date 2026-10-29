"""`/metrics/` (apps/core/metrics.py) and the LOG_FORMAT switch (config/settings.py)."""
import json
import subprocess
import sys

import pytest
from cryptography.fernet import Fernet
from django.test import override_settings

from tests.test_encryption_key_is_required import BACKEND, _env
from tests.test_health_answers_plain_http_probes import _production_setting

TOKEN = "metrics-test-token-0123456789"


@pytest.fixture
def pending_delivery(db):
    from apps.death_sync.models import ExternalApiKey, WebhookConfig
    from apps.events.models import EventWebhookDelivery, EventWebhookStatus
    from apps.tenants.models import Tenant

    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    key = ExternalApiKey.objects.create(tenant=tenant, name="k", system_type="CUSTOM", key_hash="met", key_prefix="slk_met")
    hook = WebhookConfig.objects.create(tenant=tenant, api_key=key, url="https://example.invalid/x", signing_secret="s")
    for status in (EventWebhookStatus.PENDING, EventWebhookStatus.SUCCESS):
        EventWebhookDelivery.objects.create(webhook=hook, tenant=tenant, domain="soul", event_type="x",
                                            payload_json={}, status=status)


@pytest.mark.django_db
def test_closed_when_nothing_is_configured(client):
    with override_settings(METRICS_TOKEN="", METRICS_ALLOWED_IPS=[]):
        assert client.get("/metrics/").status_code == 404
        assert client.get("/metrics/", HTTP_AUTHORIZATION="Bearer ").status_code == 404


@pytest.mark.django_db
def test_the_token_admits_and_nothing_else_does(client, pending_delivery):
    with override_settings(METRICS_TOKEN=TOKEN, METRICS_ALLOWED_IPS=[]):
        assert client.get("/metrics/").status_code == 404
        assert client.get("/metrics/", HTTP_AUTHORIZATION="Bearer wrong").status_code == 404
        assert client.get("/metrics/", HTTP_AUTHORIZATION=f"Token {TOKEN}").status_code == 404
        assert client.post("/metrics/", HTTP_AUTHORIZATION=f"Bearer {TOKEN}").status_code == 404
        response = client.get("/metrics/", HTTP_AUTHORIZATION=f"Bearer {TOKEN}")

    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/plain; version=0.0.4")
    body = response.content.decode()
    lines = body.splitlines()
    assert "soulledger_up 1" in lines
    assert "soulledger_database_up 1" in lines
    assert "soulledger_webhook_deliveries_pending 1" in lines  # the SUCCESS row is not counted
    assert "# TYPE soulledger_scheduler_overdue_jobs gauge" in lines
    assert any(line.startswith("soulledger_redis_up ") for line in lines)
    assert TOKEN not in body
    # Every sample line is `name{labels} value` or `name value` with a numeric value.
    for line in lines:
        if not line.startswith("#"):
            float(line.rsplit(" ", 1)[1])


@pytest.mark.django_db
def test_the_address_list_uses_the_validated_client_ip(client):
    with override_settings(METRICS_TOKEN="", METRICS_ALLOWED_IPS=["10.0.0.0/8", "192.0.2.7"], TRUSTED_PROXY_COUNT=0):
        assert client.get("/metrics/", REMOTE_ADDR="10.1.2.3").status_code == 200
        assert client.get("/metrics/", REMOTE_ADDR="192.0.2.7").status_code == 200
        assert client.get("/metrics/", REMOTE_ADDR="192.0.2.8").status_code == 404
        # A typed X-Forwarded-For is ignored without a trusted proxy in front.
        assert client.get("/metrics/", REMOTE_ADDR="192.0.2.8", HTTP_X_FORWARDED_FOR="10.1.2.3").status_code == 404


@pytest.mark.django_db
def test_a_dead_broker_drops_the_queue_gauges_not_the_scrape(client):
    with override_settings(METRICS_TOKEN=TOKEN, CELERY_BROKER_URL="redis://127.0.0.1:1/0"):
        response = client.get("/metrics/", HTTP_AUTHORIZATION=f"Bearer {TOKEN}")
    assert response.status_code == 200
    lines = response.content.decode().splitlines()
    assert "soulledger_redis_up 0" in lines
    assert not any(line.startswith("soulledger_celery_queue_length") for line in lines)
    assert "soulledger_database_up 1" in lines


def test_production_does_not_redirect_the_scrape_to_https():
    assert r"^metrics/$" in _production_setting("SECURE_REDIRECT_EXEMPT")


# ── LOG_FORMAT ─────────────────────────────────────────────────────────────

LOG_ONE = "import django, logging; django.setup(); logging.getLogger('apps.probe').warning('PROBE \"q\"')"


def _log(debug, **env):
    proc = subprocess.run([sys.executable, "-W", "ignore", "-c", LOG_ONE], cwd=BACKEND,
                          env=_env(debug, Fernet.generate_key().decode(), **env),
                          capture_output=True, text=True, timeout=120)
    return proc, [line for line in proc.stderr.splitlines() if "PROBE" in line]


def _is_json(line):
    try:
        json.loads(line)
    except json.JSONDecodeError:
        return False
    return True


def test_log_format_switches_both_ways():
    proc, lines = _log("false", LOG_FORMAT="text")
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert len(lines) == 1 and not _is_json(lines[0]) and lines[0].startswith("WARNING ")

    proc, lines = _log("true", LOG_FORMAT="json")
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert len(lines) == 1 and json.loads(lines[0])["message"] == 'PROBE "q"'

    proc, lines = _log("true")  # DEBUG default: text
    assert len(lines) == 1 and not _is_json(lines[0])


def test_an_unknown_log_format_is_refused():
    proc, _ = _log("true", LOG_FORMAT="xml")
    assert proc.returncode != 0 and "LOG_FORMAT must be" in proc.stderr


def test_an_unparseable_metrics_address_is_refused():
    proc, _ = _log("true", METRICS_ALLOWED_IPS="10.0.0.0/8,not-an-ip")
    assert proc.returncode != 0 and "METRICS_ALLOWED_IPS" in proc.stderr
