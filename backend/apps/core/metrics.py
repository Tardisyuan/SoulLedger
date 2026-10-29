"""GET /metrics/ — Prometheus text format (exposition 0.0.4), hand-written: no client library is installed
and every value here is a gauge read at scrape time, so a library would buy nothing.

Gauges, not counters: gunicorn runs several worker processes, and an in-process request counter would be one
worker's share, different on every scrape. Request rates and latencies belong to nginx / the load balancer.

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


class _Out:
    def __init__(self):
        self.lines = []

    def gauge(self, name, help_text, samples):
        """samples: [(labels_dict, value)]"""
        self.lines += [f"# HELP {name} {help_text}", f"# TYPE {name} gauge"]
        for labels, value in samples:
            inner = ",".join(f'{k}="{_label(v)}"' for k, v in sorted(labels.items()))
            self.lines.append(f"{name}{{{inner}}} {value}" if inner else f"{name} {value}")


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

    from django.db.models import Count
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
    return HttpResponse("\n".join(out.lines) + "\n", content_type=CONTENT_TYPE)
