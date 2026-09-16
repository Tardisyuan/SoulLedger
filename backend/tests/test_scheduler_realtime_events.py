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
