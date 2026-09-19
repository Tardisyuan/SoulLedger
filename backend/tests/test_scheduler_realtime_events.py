"""Scheduler events on the WebSocket pipeline: what, to whom, when, and never fatal.

Two layers. The unit half swaps the channel layer for a recorder (the same
trick as tests/test_the_push_is_not_sent_before_the_row_is_readable.py) and
asserts the groups and the `_permission` gate on every envelope. The last test
drives the real ASGI application with `WebsocketCommunicator` so the gate is
seen doing its job at the consumer: a VIEWER without `scheduler.read` receives
nothing from an event that reached its own tenant's group.
"""
import uuid
from datetime import timedelta

import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.test import TestCase
from django.utils import timezone
from django_celery_beat.models import CrontabSchedule, PeriodicTask
from rest_framework_simplejwt.tokens import RefreshToken

from apps.scheduler import realtime, services
from apps.scheduler.models import RunStatus, ScheduledJob, TaskRun

JOBS = "/api/v1/scheduler/jobs/"


class _Recorder:
    def __init__(self, fail=False):
        self.sent = []
        self.fail = fail

    async def group_send(self, group, message):
        if self.fail:
            raise RuntimeError("channel layer down")
        self.sent.append((group, message))


@pytest.fixture
def layer(monkeypatch):
    rec = _Recorder()
    monkeypatch.setattr("channels.layers.get_channel_layer", lambda *a, **k: rec)
    return rec


def _job(key, tenant=None):
    schedule, _ = CrontabSchedule.objects.get_or_create(minute="0", hour="3", timezone="UTC")
    pt = PeriodicTask.objects.create(name=key if tenant is None else f"{key}@{tenant.code}", task=key, crontab=schedule)
    return ScheduledJob.objects.create(periodic_task=pt, job_key=key, tenant=tenant)


def _events(layer, event):
    return [(g, m["data"]) for g, m in layer.sent if m["data"]["event"] == event]


# ---------------------------------------------------------------------------
# What and to whom
# ---------------------------------------------------------------------------

@pytest.mark.django_db(transaction=True)
def test_every_status_change_of_a_tenant_run_reaches_the_tenant_group_gated(layer, cn_tenant, eu_tenant):
    job = _job("tests.rt_tenant_job", tenant=cn_tenant)
    run = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id=str(uuid.uuid4()), tenant=cn_tenant)
    run.status = RunStatus.RUNNING
    run.started_at = timezone.now()
    run.save(update_fields=["status", "started_at"])
    run.error = "detail only"
    run.save(update_fields=["error"])  # not a status change → no event
    run.finish(RunStatus.FAILURE, error="boom")

    events = _events(layer, realtime.RUN_UPDATED)
    assert [d["status"] for _, d in events] == ["PENDING", "RUNNING", "FAILURE"]
    for group, data in events:
        assert group == f"rt_tenant_{cn_tenant.code}"
        assert data["_permission"] == "scheduler.read" and data["domain"] == "scheduler"
        assert data["job_id"] == job.pk and data["run_id"] == run.pk and data["timestamp"]
        assert data["task_name"] == job.job_key and data["tenant_id"] == cn_tenant.pk
    assert not any(g == f"rt_tenant_{eu_tenant.code}" for g, _ in layer.sent)
    assert not any(g.startswith("rt_user_") for g, _ in layer.sent)


@pytest.mark.django_db(transaction=True)
def test_reaper_and_worker_ready_lost_transitions_are_pushed_too(layer, cn_tenant):
    job = _job("tests.rt_tenant_job", tenant=cn_tenant)
    old = timezone.now() - timedelta(hours=2)
    TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="a", tenant=cn_tenant, status=RunStatus.RUNNING, started_at=old, worker_hostname="w1")
    TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="b", tenant=cn_tenant, status=RunStatus.PENDING, queued_at=old)
    layer.sent.clear()

    services.reap_stale_runs()
    assert sorted(d["status"] for _, d in _events(layer, realtime.RUN_UPDATED)) == ["LOST", "LOST"]

    layer.sent.clear()
    TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="c", tenant=cn_tenant, status=RunStatus.RUNNING, started_at=old, worker_hostname="w1")
    layer.sent.clear()
    services.mark_lost_for_worker("w1")
    assert [d["status"] for _, d in _events(layer, realtime.RUN_UPDATED)] == ["LOST"]


@pytest.mark.django_db(transaction=True)
def test_a_global_run_goes_only_to_admin_user_groups(layer, admin_user, eu_admin_user, judge_user, viewer_user):
    job = _job("tests.rt_global_job")
    TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id=str(uuid.uuid4()))

    groups = {g for g, _ in layer.sent}
    assert groups == {f"rt_user_{admin_user.pk}", f"rt_user_{eu_admin_user.pk}"}
    assert not any(g.startswith("rt_tenant_") for g in groups)
    assert f"rt_user_{judge_user.pk}" not in groups and f"rt_user_{viewer_user.pk}" not in groups


@pytest.mark.django_db(transaction=True)
def test_a_deactivated_admin_is_not_a_recipient(layer, admin_user, eu_admin_user):
    eu_admin_user.is_active = False
    eu_admin_user.save(update_fields=["is_active"])
    job = _job("tests.rt_global_job")
    TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id=str(uuid.uuid4()))
    assert {g for g, _ in layer.sent} == {f"rt_user_{admin_user.pk}"}


# ---------------------------------------------------------------------------
# Schedule changes, after commit
# ---------------------------------------------------------------------------

def _bearer(user):
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}


@pytest.mark.django_db
def test_patch_emits_job_updated_only_once_the_transaction_commits(layer, api_client, admin_user, cn_tenant):
    job = _job("tests.rt_tenant_job", tenant=cn_tenant)
    layer.sent.clear()

    with TestCase.captureOnCommitCallbacks(execute=False) as callbacks:
        resp = api_client.patch(f"{JOBS}{job.pk}/", {"enabled": False}, format="json", **_bearer(admin_user))
        assert resp.status_code == 200, resp.content
        assert layer.sent == [], "the push went out before the schedule change was committed"
    for cb in callbacks:
        cb()

    events = _events(layer, realtime.JOB_UPDATED)
    assert len(events) == 1
    group, data = events[0]
    assert group == f"rt_tenant_{cn_tenant.code}" and data["_permission"] == "scheduler.read"
    assert data["job_id"] == job.pk and data["enabled"] is False and data["reason"] == "patch"
    assert data["periodic_task_name"] == job.periodic_task.name and data["timestamp"]


@pytest.mark.django_db
def test_rebuild_emits_to_every_active_tenant_and_to_admins(layer, api_client, admin_user, eu_admin_user, cn_tenant, eu_tenant):
    with TestCase.captureOnCommitCallbacks(execute=True):
        resp = api_client.post(f"{JOBS}rebuild/", **_bearer(admin_user))
        assert resp.status_code == 200, resp.content

    events = _events(layer, realtime.JOBS_REBUILT)
    groups = {g for g, _ in events}
    assert {f"rt_tenant_{cn_tenant.code}", f"rt_tenant_{eu_tenant.code}", f"rt_user_{admin_user.pk}", f"rt_user_{eu_admin_user.pk}"} <= groups
    for _, data in events:
        assert data["_permission"] == "scheduler.read"
        assert {"created", "updated", "removed", "legacy_removed", "timestamp"} <= set(data)


# ---------------------------------------------------------------------------
# Never fatal
# ---------------------------------------------------------------------------

@pytest.mark.django_db(transaction=True)
def test_a_dead_channel_layer_does_not_fail_the_write(monkeypatch, cn_tenant):
    monkeypatch.setattr("channels.layers.get_channel_layer", lambda *a, **k: _Recorder(fail=True))
    job = _job("tests.rt_tenant_job", tenant=cn_tenant)
    run = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id=str(uuid.uuid4()), tenant=cn_tenant)
    run.finish(RunStatus.SUCCESS)
    assert TaskRun.objects.get(pk=run.pk).status == RunStatus.SUCCESS


@pytest.mark.django_db(transaction=True)
def test_a_broken_event_bus_does_not_fail_the_write(monkeypatch, cn_tenant):
    def explode(*_a, **_k):
        raise RuntimeError("bus is down")

    monkeypatch.setattr("apps.events.event_bus.event_bus.publish", explode)
    job = _job("tests.rt_tenant_job", tenant=cn_tenant)
    run = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id=str(uuid.uuid4()), tenant=cn_tenant)
    run.finish(RunStatus.SUCCESS)
    assert TaskRun.objects.get(pk=run.pk).status == RunStatus.SUCCESS


# ---------------------------------------------------------------------------
# End to end: the consumer's gate
# ---------------------------------------------------------------------------

@database_sync_to_async
def _viewer_and_job():
    from apps.authentication.models import User
    from apps.tenants.models import Tenant

    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})
    user = User.objects.create_user(username="ws_sched_viewer", password="x", role="VIEWER", tenant=tenant)
    job = _job("tests.rt_tenant_job", tenant=tenant)
    return user, tenant, job


@database_sync_to_async
def _grant_viewer_read():
    from apps.perm.models import Permission, Role, RolePermission

    # get_or_create, not get: under `transaction=True` the database is flushed
    # after every such test, so the rows perm/0017 and perm/0021 seeded are gone
    # by the time this runs in a shared process.
    role, _ = Role.objects.get_or_create(name="VIEWER", defaults={"display_name": "Viewer"})
    perm, _ = Permission.objects.get_or_create(
        codename="scheduler.read", defaults={"name": "查看定时任务", "category": "scheduler"}
    )
    RolePermission.objects.create(role=role, permission=perm)


@database_sync_to_async
def _write_a_run(job, tenant):
    TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id=str(uuid.uuid4()), tenant=tenant)


@database_sync_to_async
def _token(user, tenant_code):
    refresh = RefreshToken.for_user(user)
    refresh["tenant_code"] = tenant_code
    return str(refresh.access_token)


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_viewer_without_the_codename_receives_nothing_and_with_it_receives_the_event():
    from config.asgi import application

    user, tenant, job = await _viewer_and_job()
    comm = WebsocketCommunicator(application, f"/ws/notifications/?token={await _token(user, tenant.code)}")
    connected, _ = await comm.connect()
    assert connected
    await comm.receive_json_from()  # "connected" frame
    try:
        await _write_a_run(job, tenant)  # PENDING event to rt_tenant_CN_DIYU
        assert await comm.receive_nothing(timeout=1.5), "a VIEWER without scheduler.read received a scheduler event"

        await _grant_viewer_read()
        await comm.send_json_to({"type": "permission.refresh"})
        refreshed = await comm.receive_json_from()
        assert "scheduler.read" in refreshed.get("permissions", [])

        await _write_a_run(job, tenant)
        frame = await comm.receive_json_from(timeout=3)
        assert frame["domain"] == "scheduler" and frame["event"] == realtime.RUN_UPDATED
        assert frame["status"] == "PENDING" and frame["job_id"] == job.pk
    finally:
        await comm.disconnect()


# ---------------------------------------------------------------------------
# SCHEDULER_RUN_FAILED: the one scheduler event that is an EventType
# ---------------------------------------------------------------------------

FAILED = "SCHEDULER_RUN_FAILED"


@pytest.fixture
def webhooks(monkeypatch, cn_tenant, eu_tenant):
    """One subscribe-to-everything webhook per tenant; enqueue stubbed out, the
    recorded `EventWebhookDelivery` rows are what is asserted."""
    from apps.death_sync.models import ExternalApiKey, WebhookConfig
    from apps.events.handlers.webhook_handler import WebhookHandler

    monkeypatch.setattr(WebhookHandler, "_enqueue", staticmethod(lambda ids: None))
    hooks = {}
    for tenant in (cn_tenant, eu_tenant):
        _, key_hash, key_prefix = ExternalApiKey.generate_key()
        key = ExternalApiKey.objects.create(
            tenant=tenant, name="oc", system_type="HOSPITAL", key_hash=key_hash, key_prefix=key_prefix,
        )
        hooks[tenant.code] = WebhookConfig.objects.create(
            tenant=tenant, api_key=key, url="https://example.invalid/hook", signing_secret="s", events=[],
        )
    return hooks


def _deliveries():
    from apps.events.models import EventWebhookDelivery

    return list(EventWebhookDelivery.objects.values_list("webhook__tenant__code", "event_type", "payload_json"))


def test_the_failure_event_is_a_member_of_the_backend_enum():
    from apps.events.models import EventType

    assert EventType.SCHEDULER_RUN_FAILED == FAILED
    assert {RunStatus.FAILURE, RunStatus.LOST} == realtime.FAILED_STATUSES


@pytest.mark.django_db(transaction=True)
def test_only_failure_and_lost_emit_the_failure_event_to_the_tenant_group(layer, cn_tenant, eu_tenant):
    job = _job("tests.rt_tenant_job", tenant=cn_tenant)
    ok = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="ok", tenant=cn_tenant)
    for status in (RunStatus.RUNNING, RunStatus.RETRY, RunStatus.SKIPPED):
        ok.status = status
        ok.save(update_fields=["status"])
    ok.finish(RunStatus.SUCCESS)
    assert _events(layer, FAILED) == [], "a non-failure status emitted SCHEDULER_RUN_FAILED"

    bad = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="bad", tenant=cn_tenant)
    bad.finish(RunStatus.FAILURE, error="Traceback: secret internals")
    old = timezone.now() - timedelta(hours=2)
    TaskRun.objects.create(
        job=job, task_name=job.job_key, celery_task_id="stuck", tenant=cn_tenant,
        status=RunStatus.PENDING, queued_at=old,
    )
    services.reap_stale_runs()

    events = _events(layer, FAILED)
    assert [d["status"] for _, d in events] == ["FAILURE", "LOST"]
    for group, data in events:
        assert group == f"rt_tenant_{cn_tenant.code}"
        assert data["_permission"] == "scheduler.read" and data["domain"] == "scheduler"
        assert data["tenant_id"] == cn_tenant.pk and data["job_id"] == job.pk
        assert "error" not in data, "the traceback must not ride on an event a tenant webhook receives"
    assert not any(g == f"rt_tenant_{eu_tenant.code}" for g, _ in layer.sent)
    # RUN_UPDATED is unchanged: every status still gets its frame.
    assert [d["status"] for _, d in _events(layer, realtime.RUN_UPDATED) if d["run_id"] == ok.pk] == [
        "PENDING", "RUNNING", "RETRY", "SKIPPED", "SUCCESS",
    ]


@pytest.mark.django_db(transaction=True)
def test_a_global_run_failing_emits_no_failure_event_at_all(layer, admin_user):
    job = _job("tests.rt_global_job")
    run = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id=str(uuid.uuid4()))
    run.finish(RunStatus.FAILURE, error="boom")
    assert _events(layer, FAILED) == []
    # The ADMINs are still told, through the frame that was always there.
    assert [d["status"] for _, d in _events(layer, realtime.RUN_UPDATED)] == ["PENDING", "FAILURE"]


@pytest.mark.django_db(transaction=True)
def test_a_tenant_failure_is_delivered_to_that_tenants_webhooks_only(layer, webhooks, cn_tenant, eu_tenant):
    from apps.events.models import SoulEvent

    job = _job("tests.rt_tenant_job", tenant=cn_tenant)
    ok = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="ok", tenant=cn_tenant)
    ok.finish(RunStatus.SUCCESS)
    assert _deliveries() == [], "a successful run (or RUN_UPDATED at all) reached a webhook"

    bad = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="bad", tenant=cn_tenant)
    bad.finish(RunStatus.FAILURE, error="boom")

    rows = _deliveries()
    assert [(code, et) for code, et, _ in rows] == [(cn_tenant.code, FAILED)]
    envelope = rows[0][2]
    assert envelope["tenant_code"] == cn_tenant.code and envelope["domain"] == "scheduler"
    assert envelope["payload"]["run_id"] == bad.pk and envelope["payload"]["status"] == "FAILURE"
    # No soul, so no timeline row — same as NOTIFICATION_CREATED.
    assert not SoulEvent.all_objects.filter(event_type=FAILED).exists()


@pytest.mark.django_db(transaction=True)
def test_a_global_failure_reaches_no_tenants_webhook(layer, webhooks):
    job = _job("tests.rt_global_job")
    TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="g1").finish(RunStatus.FAILURE, error="x")
    TaskRun.objects.create(
        job=job, task_name=job.job_key, celery_task_id="g2", status=RunStatus.PENDING,
        queued_at=timezone.now() - timedelta(hours=2),
    )
    services.reap_stale_runs()
    assert TaskRun.objects.get(celery_task_id="g2").status == RunStatus.LOST
    assert _deliveries() == []
