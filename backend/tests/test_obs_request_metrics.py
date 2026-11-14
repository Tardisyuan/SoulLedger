"""Request / task / handler counters (`apps/core/obs.py`), their `/metrics/` rendering, `/health/ready/`,
the JSON log fields, and the Celery global time limits (be-obs items 2–5, 8; 2026-11-14).

None of these needs a live Redis: the counters accumulate in memory, the flush is exercised against a fake
pipeline, and `/metrics/` is rendered from a fake `read_totals`. "Redis down must not fail a request" is
tested with REDIS_URL pointing at a closed port.
"""
import json
import logging
import re
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest
from celery.signals import task_postrun
from django.test import override_settings

from apps.core import health, obs
from config.json_logging import JsonFormatter

REPO = Path(__file__).resolve().parents[2]
DEAD_REDIS = "redis://127.0.0.1:1/0"
TOKEN = "obs-test-token-0123456789"


@pytest.fixture(autouse=True)
def _fresh():
    obs._reset_for_tests()
    health._ready_last[:] = [float("-inf"), True]
    yield
    obs._reset_for_tests()
    health._ready_last[:] = [float("-inf"), True]


def _http(fields, prefix):
    return {k: v for k, v in fields.items() if k.startswith(prefix + obs.SEP)}


# ── accumulation ────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_requests_are_counted_in_memory_and_a_dead_redis_fails_nothing(client):
    with override_settings(REDIS_URL=DEAD_REDIS):
        assert client.get("/health/").status_code == 200
        assert client.get("/no-such-route-obs/").status_code == 404
        counts = obs.pending()
        assert counts["http|GET|health/|2xx"] == 1
        # Unmatched paths are one bounded label, never the raw path.
        assert counts["http|GET|-|4xx"] == 1
        assert not any("no-such-route-obs" in k for k in counts)
        assert sum(_http(counts, "http_le").values()) == 2

        assert obs.flush() is False  # Redis is down: the batch is dropped, nothing raises
        assert obs.pending() == {}
        assert client.get("/health/").status_code == 200  # and requests keep being served


def test_5xx_is_counted_but_kept_out_of_the_latency_histogram():
    obs.record_request("POST", "api/v1/x/", 503, 12.0)
    obs.record_request("POST", "api/v1/x/", 201, 450.0)
    counts = obs.pending()
    assert counts["http|POST|api/v1/x/|5xx"] == 1
    assert counts["http|POST|api/v1/x/|2xx"] == 1
    assert _http(counts, "http_le") == {"http_le|POST|api/v1/x/|500": 1}
    assert counts["http_ms|POST|api/v1/x/"] == 450


def test_bucket_edges_are_inclusive_and_open_ended():
    assert obs.bucket_for(400) == "400"
    assert obs.bucket_for(400.1) == "500"
    assert obs.bucket_for(10_000) == "inf"


def test_every_slo_latency_threshold_is_a_bucket_edge():
    """`≤ N ms` in docs/SLO.md must be readable off the histogram exactly, not interpolated."""
    text = (REPO / "docs" / "SLO.md").read_text(encoding="utf-8")
    thresholds = {int(n) for n in re.findall(r"≤\s*(\d+)\s*ms", text)}
    assert thresholds, "found no latency SLO in docs/SLO.md; the pattern stopped matching"
    assert thresholds <= set(obs.BUCKETS_MS), thresholds - set(obs.BUCKETS_MS)


def test_labels_cannot_forge_a_field():
    obs.incr("handler_failure", "a|b")
    assert obs.pending() == {"handler_failure|a/b": 1}


# ── flushing ────────────────────────────────────────────────────────────


class _FakePipe:
    def __init__(self, calls):
        self.calls = calls

    def hincrby(self, key, field, n):
        self.calls.append(("hincrby", key, field, n))

    def expire(self, key, ttl):
        self.calls.append(("expire", key, ttl))

    def execute(self):
        self.calls.append(("execute",))


def test_a_flush_is_one_pipeline_into_the_total_and_the_hour_bucket(monkeypatch):
    calls = []
    monkeypatch.setattr(obs, "_redis", lambda: SimpleNamespace(pipeline=lambda transaction: _FakePipe(calls)))
    obs.record_request("GET", "health/", 200, 5)
    assert obs.flush() is True
    keys = {c[1] for c in calls if c[0] == "hincrby"}
    assert obs.TOTAL_KEY in keys and any(k.startswith("obs:h:") for k in keys)
    assert ("hincrby", obs.TOTAL_KEY, "http|GET|health/|2xx", 1) in calls
    assert calls[-1] == ("execute",) and sum(c[0] == "execute" for c in calls) == 1
    assert obs.pending() == {}


def test_recording_alone_never_touches_redis_until_a_threshold(monkeypatch):
    touched = []

    def fake_redis():
        touched.append(1)
        raise ConnectionError("not reached before the threshold")

    monkeypatch.setattr(obs, "_redis", fake_redis)
    for _ in range(obs.FLUSH_EVERY - 1):
        obs.record_request("GET", "health/", 200, 1)
        obs.maybe_flush()
    assert touched == []  # below FLUSH_EVERY requests and inside FLUSH_SECONDS: memory only
    obs.record_request("GET", "health/", 200, 1)
    obs.maybe_flush()
    assert touched == [1]


# ── what else is counted ────────────────────────────────────────────────


class _Task:
    name = "apps.x.do_it"

    def __init__(self):
        self.request = SimpleNamespace()


def test_a_finished_task_is_counted_by_name_and_state():
    task = _Task()
    task_postrun.send(sender=task, task_id="obs-1", task=task, state="FAILURE")
    assert obs.pending()["task|apps.x.do_it|FAILURE"] == 1


def test_a_swallowed_handler_failure_is_counted():
    from apps.events.handlers.registry import HandlerRegistry

    class Boom:
        propagate_errors = False

        def handle(self, envelope):
            raise RuntimeError("x")

    HandlerRegistry._safe_call(Boom(), SimpleNamespace(domain="d", event_type="e"))
    assert obs.pending()["handler_failure|Boom"] == 1


# ── /metrics/ ───────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_metrics_renders_counters_and_a_cumulative_histogram(client, monkeypatch):
    totals = {
        "http|GET|api/v1/me/|2xx": 3,
        "http|GET|api/v1/me/|5xx": 1,
        "http_le|GET|api/v1/me/|100": 1,
        "http_le|GET|api/v1/me/|500": 1,
        "http_le|GET|api/v1/me/|inf": 1,
        "http_ms|GET|api/v1/me/": 5600,
        "handler_failure|WebSocketHandler": 2,
        "task|soul_push.deliver|SUCCESS": 4,
        "ws|open": 5,
        "ws|close": 2,
    }
    monkeypatch.setattr(obs, "flush", lambda: True)
    monkeypatch.setattr(obs, "read_totals", lambda: totals)
    with override_settings(METRICS_TOKEN=TOKEN, METRICS_ALLOWED_IPS=[]):
        body = client.get("/metrics/", HTTP_AUTHORIZATION=f"Bearer {TOKEN}").content.decode()
    lines = body.splitlines()
    h = "soulledger_http_request_duration_seconds"
    assert "soulledger_counters_up 1" in lines
    assert 'soulledger_http_requests_total{class="5xx",method="GET",route="api/v1/me/"} 1' in lines
    assert f"# TYPE {h} histogram" in lines
    assert f'{h}_bucket{{le="0.1",method="GET",route="api/v1/me/"}} 1' in lines
    assert f'{h}_bucket{{le="0.4",method="GET",route="api/v1/me/"}} 1' in lines
    assert f'{h}_bucket{{le="0.5",method="GET",route="api/v1/me/"}} 2' in lines
    assert f'{h}_bucket{{le="+Inf",method="GET",route="api/v1/me/"}} 3' in lines
    assert f'{h}_count{{method="GET",route="api/v1/me/"}} 3' in lines
    assert f'{h}_sum{{method="GET",route="api/v1/me/"}} 5.6' in lines
    assert 'soulledger_event_handler_failures_total{handler="WebSocketHandler"} 2' in lines
    assert 'soulledger_celery_tasks_total{state="SUCCESS",task="soul_push.deliver"} 4' in lines
    assert "soulledger_ws_connections 3" in lines
    assert "soulledger_webhook_oldest_pending_seconds 0" in lines
    assert "soulledger_push_oldest_unsent_seconds 0" in lines


@pytest.mark.django_db
def test_metrics_still_answers_when_the_counter_store_is_down(client):
    with override_settings(METRICS_TOKEN=TOKEN, METRICS_ALLOWED_IPS=[], REDIS_URL=DEAD_REDIS):
        response = client.get("/metrics/", HTTP_AUTHORIZATION=f"Bearer {TOKEN}")
    assert response.status_code == 200
    lines = response.content.decode().splitlines()
    assert "soulledger_counters_up 0" in lines
    assert not any(line.startswith("soulledger_http_requests_total{") for line in lines)


# ── /health/ready/ ──────────────────────────────────────────────────────


@pytest.mark.django_db
def test_ready_is_503_when_the_database_check_fails(client):
    broken = mock.MagicMock()
    broken.cursor.side_effect = Exception("db down")
    with mock.patch.object(health, "connection", broken), mock.patch.object(health, "redis_ok", return_value=True):
        response = client.get("/health/ready/")
    assert response.status_code == 503
    assert response.json() == {"status": "degraded"}  # which dependency failed is not public


@pytest.mark.django_db
def test_ready_is_503_when_redis_is_unreachable(client):
    with mock.patch.object(health, "database_ok", return_value=True), override_settings(REDIS_URL=DEAD_REDIS):
        response = client.get("/health/ready/")
    assert response.status_code == 503


@pytest.mark.django_db
def test_ready_is_200_when_both_answer_and_is_cached(client):
    with mock.patch.object(health, "database_ok", return_value=True) as db, \
            mock.patch.object(health, "redis_ok", return_value=True):
        assert client.get("/health/ready/").json() == {"status": "ok"}
        assert client.get("/health/ready/").status_code == 200
    assert db.call_count == 1  # second hit inside READY_CACHE_SECONDS reused the answer


@pytest.mark.django_db
def test_liveness_stays_constant_while_readiness_is_down(client):
    with mock.patch.object(health, "database_ok", return_value=False):
        assert client.get("/health/ready/").status_code == 503
        assert client.get("/health/").status_code == 200


# ── JSON log fields ─────────────────────────────────────────────────────


def _record(**extra):
    record = logging.LogRecord("apps.access", logging.INFO, __file__, 1, "http_request", None, None)
    record.__dict__.update(extra)
    return record


def test_the_formatter_writes_the_request_fields_and_only_whitelisted_extras():
    out = json.loads(JsonFormatter().format(_record(
        method="GET", route="api/v1/me/", status=200, duration_ms=12.5,
        tenant="CN_DIYU", user_id=7, password="hunter2",
    )))
    assert out["method"] == "GET" and out["route"] == "api/v1/me/" and out["status"] == 200
    assert out["duration_ms"] == 12.5 and out["tenant"] == "CN_DIYU" and out["user_id"] == 7
    assert "password" not in out and "hunter2" not in json.dumps(out)


def test_outside_a_request_the_context_fields_are_empty():
    out = json.loads(JsonFormatter().format(_record()))
    assert out["tenant"] == "-" and out["user_id"] is None
    assert "route" not in out and "duration_ms" not in out


def test_inside_a_request_tenant_and_user_come_from_the_context():
    from apps.core.request_local import clear_current_user, set_current_user
    from apps.tenants.managers import clear_current_tenant, set_current_tenant

    set_current_tenant(SimpleNamespace(code="EU_INFERNO"))
    set_current_user(SimpleNamespace(pk=42))
    try:
        out = json.loads(JsonFormatter().format(_record()))
    finally:
        clear_current_tenant()
        clear_current_user()
    assert out["tenant"] == "EU_INFERNO" and out["user_id"] == 42


@pytest.mark.django_db
def test_each_request_writes_one_access_line(client, caplog):
    with caplog.at_level(logging.INFO, logger="apps.access"), override_settings(REDIS_URL=DEAD_REDIS):
        client.get("/health/")
    lines = [r for r in caplog.records if r.name == "apps.access"]
    assert len(lines) == 1
    r = lines[0]
    assert (r.method, r.route, r.status, r.tenant, r.user_id) == ("GET", "health/", 200, "-", None)
    assert r.duration_ms >= 0


# ── Celery ──────────────────────────────────────────────────────────────


def test_celery_has_global_time_limits_and_soft_comes_first():
    from django.conf import settings

    from config.celery import app

    assert 0 < settings.CELERY_TASK_SOFT_TIME_LIMIT < settings.CELERY_TASK_TIME_LIMIT
    assert app.conf.task_soft_time_limit == settings.CELERY_TASK_SOFT_TIME_LIMIT
    assert app.conf.task_time_limit == settings.CELERY_TASK_TIME_LIMIT
