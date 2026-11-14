"""GET /metrics/ — Prometheus text format (exposition 0.0.4), hand-written: no client library is installed.

Two kinds of value:
* Gauges read at scrape time (database / broker up, queue depths, backlog counts and ages).
* Counters and the request-latency histogram, accumulated in each process and flushed to Redis every
  10 s / 100 events (`apps/core/obs.py`), read back here from `obs:total`. HTTP is a single daphne process
  today (backend/Dockerfile), but Celery is prefork and HTTP may become several workers, so a scrape that
  read only its own process's memory would see one process's share. (This docstring used to say "gunicorn
  runs several worker processes" as the reason for having no counters at all; nothing here runs gunicorn.)
  Up to ~10 s of counts can be unflushed in other processes; this process flushes before reading.

Access (config/settings.py): `Authorization: Bearer <METRICS_TOKEN>`, or a client address inside
METRICS_ALLOWED_IPS. Neither configured, or neither matching: 404, the same answer as a path that does not exist.
nginx does not route /metrics/; the scraper talks to backend:8000 on the compose network.

Each probe is independent: a dead Redis turns `soulledger_redis_up` to 0 and drops the queue gauges, it does not
fail the scrape — the scrape failing is what Prometheus already reports as `up == 0`.
"""
import hmac
import ipaddress
import logging

from django.conf import settings
from django.http import Http404, HttpResponse

from apps.core.client_ip import get_client_ip

logger = logging.getLogger(__name__)

CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"


def allowed(request) -> bool:
    token = settings.METRICS_TOKEN
    if token:
        header = request.META.get("HTTP_AUTHORIZATION", "")
        if header.startswith("Bearer ") and hmac.compare_digest(header[7:].encode(), token.encode()):
            return True
    if settings.METRICS_ALLOWED_IPS:
        ip = get_client_ip(request)
        if ip:
            addr = ipaddress.ip_address(ip)
            return any(addr in ipaddress.ip_network(n, strict=False) for n in settings.METRICS_ALLOWED_IPS)
    return False


def _label(value) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _sample(name, labels, value) -> str:
    inner = ",".join(f'{k}="{_label(v)}"' for k, v in sorted(labels.items()))
    return f"{name}{{{inner}}} {value}" if inner else f"{name} {value}"


class _Out:
    def __init__(self):
        self.lines = []

    def metric(self, kind, name, help_text, samples):
        """samples: [(labels_dict, value)]"""
        self.lines += [f"# HELP {name} {help_text}", f"# TYPE {name} {kind}"]
        self.lines += [_sample(name, labels, value) for labels, value in samples]

    def gauge(self, name, help_text, samples):
        self.metric("gauge", name, help_text, samples)

    def counter(self, name, help_text, samples):
        self.metric("counter", name, help_text, samples)


def _database(out):
    from django.db import connection

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        logger.warning("metrics: database probe failed", exc_info=True)
        out.gauge("soulledger_database_up", "1 if this process can query the database.", [({}, 0)])
        return False
    out.gauge("soulledger_database_up", "1 if this process can query the database.", [({}, 1)])
    return True


def _celery(out):
    import redis

    from config.celery import app

    try:
        client = redis.Redis.from_url(settings.CELERY_BROKER_URL, socket_timeout=2, socket_connect_timeout=2)
        queue = app.conf.task_default_queue or "celery"
        depth = client.llen(queue)
        # kombu's redis transport keeps delivered-but-unacked messages in this hash until the worker acks.
        unacked = client.hlen("unacked")
    except Exception:
        logger.warning("metrics: broker probe failed", exc_info=True)
        out.gauge("soulledger_redis_up", "1 if the celery broker answered.", [({}, 0)])
        return
    out.gauge("soulledger_redis_up", "1 if the celery broker answered.", [({}, 1)])
    out.gauge("soulledger_celery_queue_length", "Messages waiting in the celery broker queue.",
              [({"queue": queue}, depth)])
    out.gauge("soulledger_celery_unacked", "Messages a worker has taken but not acknowledged.", [({}, unacked)])


def _backlogs(out):
    from datetime import timedelta

    from django.db.models import Count, Min
    from django.utils import timezone

    from apps.events.models import EventWebhookDelivery, EventWebhookStatus
    from apps.scheduler.models import TaskRun
    from apps.scheduler.services import overdue_jobs
    from apps.soul_push.models import PushDelivery, PushStatus

    out.gauge("soulledger_scheduler_overdue_jobs", "Scheduled jobs whose cron fired with no run recorded.",
              [({}, len(list(overdue_jobs())))])
    since = timezone.now() - timedelta(hours=24)
    rows = TaskRun.objects.filter(queued_at__gte=since).values("status").annotate(n=Count("id"))
    out.gauge("soulledger_scheduler_runs_24h", "Scheduled-task runs queued in the last 24 hours, by status.",
              [({"status": r["status"]}, r["n"]) for r in rows])
    out.gauge("soulledger_webhook_deliveries_pending", "Event webhook deliveries still waiting to succeed.",
              [({}, EventWebhookDelivery.objects.filter(status=EventWebhookStatus.PENDING).count())])
    out.gauge("soulledger_push_deliveries_unsent", "Soul push deliveries queued or being sent.",
              [({}, PushDelivery.objects.filter(status__in=(PushStatus.QUEUED, PushStatus.SENDING)).count())])

    # Age of the oldest item, not just the count: 3 pending can be three that just arrived or three stuck for
    # two days. 0 when nothing is waiting.
    now = timezone.now()

    def age(qs, field):
        oldest = qs.aggregate(m=Min(field))["m"]
        return round((now - oldest).total_seconds(), 1) if oldest else 0

    out.gauge("soulledger_webhook_oldest_pending_seconds", "Age of the oldest event webhook delivery still pending.",
              [({}, age(EventWebhookDelivery.objects.filter(status=EventWebhookStatus.PENDING), "create_time"))])
    out.gauge("soulledger_push_oldest_unsent_seconds", "Age of the oldest soul push delivery queued or being sent.",
              [({}, age(PushDelivery.objects.filter(status__in=(PushStatus.QUEUED, PushStatus.SENDING)),
                        "created_at"))])


def _seconds(ms) -> str:
    return format(ms / 1000, "g")


def _counters(out):
    """Everything `apps/core/obs.py` accumulates, summed over every process that flushed to Redis."""
    from apps.core import obs

    obs.flush()
    try:
        totals = obs.read_totals()
    except Exception:
        logger.warning("metrics: counter store (Redis) unreachable", exc_info=True)
        out.gauge("soulledger_counters_up", "1 if the counter store (Redis, REDIS_URL) answered.", [({}, 0)])
        return
    out.gauge("soulledger_counters_up", "1 if the counter store (Redis, REDIS_URL) answered.", [({}, 1)])

    requests, buckets, sums, failures, tasks, ws = [], {}, {}, [], [], {"open": 0, "close": 0}
    for field, n in sorted(totals.items()):
        kind, *labels = field.split(obs.SEP)
        if kind == "http" and len(labels) == 3:
            requests.append(({"method": labels[0], "route": labels[1], "class": labels[2]}, n))
        elif kind == "http_le" and len(labels) == 3:
            buckets.setdefault((labels[0], labels[1]), {})[labels[2]] = n
        elif kind == "http_ms" and len(labels) == 2:
            sums[(labels[0], labels[1])] = n
        elif kind == "handler_failure" and len(labels) == 1:
            failures.append(({"handler": labels[0]}, n))
        elif kind == "task" and len(labels) == 2:
            tasks.append(({"task": labels[0], "state": labels[1]}, n))
        elif kind == "ws" and len(labels) == 1 and labels[0] in ws:
            ws[labels[0]] = n

    out.counter("soulledger_http_requests_total", "HTTP requests by method, route template and status class.",
                requests)
    name = "soulledger_http_request_duration_seconds"
    out.lines += [f"# HELP {name} Latency of non-5xx HTTP requests (the SLO latency denominator, docs/SLO.md).",
                  f"# TYPE {name} histogram"]
    for (method, route), counts in sorted(buckets.items()):
        labels = {"method": method, "route": route}
        running = 0
        for edge in obs.BUCKETS_MS:
            running += counts.get(str(edge), 0)
            out.lines.append(_sample(f"{name}_bucket", {**labels, "le": _seconds(edge)}, running))
        running += counts.get("inf", 0)
        out.lines.append(_sample(f"{name}_bucket", {**labels, "le": "+Inf"}, running))
        out.lines.append(_sample(f"{name}_sum", labels, _seconds(sums.get((method, route), 0))))
        out.lines.append(_sample(f"{name}_count", labels, running))
    out.counter("soulledger_event_handler_failures_total",
                "Best-effort event handler calls that raised (logged and swallowed by the registry).", failures)
    out.counter("soulledger_celery_tasks_total", "Celery task runs finished, by task name and final state.", tasks)
    out.gauge("soulledger_ws_connections", "WebSocket connections open (opened minus closed, all processes).",
              [({}, max(ws["open"] - ws["close"], 0))])


def metrics_view(request):
    if request.method != "GET" or not allowed(request):
        raise Http404
    out = _Out()
    out.gauge("soulledger_up", "1 while the backend answers.", [({}, 1)])
    if _database(out):
        try:
            _backlogs(out)
        except Exception:
            logger.warning("metrics: backlog probe failed", exc_info=True)
    _celery(out)
    _counters(out)
    return HttpResponse("\n".join(out.lines) + "\n", content_type=CONTENT_TYPE)
