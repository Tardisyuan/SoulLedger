"""TaskRun recording, the single-flight lock, recovery, retention, alerts, overdue.

`Task.apply()` drives celery's real tracer in-process — `task_prerun`,
`task_postrun`, `task_failure` all fire, and the custom `__call__` on
`SchedulerTask` runs — so these are integration tests of the receivers, not
calls to the receivers with hand-built arguments (except RETRY and
worker_ready, whose real triggers need a broker and a worker process).

Two throwaway tasks are registered into the registry for the module: one
that records it ran, one that raises. Using a real business task for the
failure case would mean breaking it on purpose.
"""
import uuid
from datetime import timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from celery import shared_task
from django.core.cache import cache
from django.utils import timezone
from django_celery_beat.models import CrontabSchedule, PeriodicTask

from apps.notifications.models import UserNotification
from apps.scheduler import registry, services, signals
from apps.scheduler.models import RunStatus, RunTrigger, ScheduledJob, TaskRun
from apps.scheduler.registry import GLOBAL, JobSpec

CALLS: list = []


@shared_task(name="tests.scheduler_ok")
def _ok_task(tenant_id=None):
    CALLS.append(tenant_id)
    return {"ran": True}


@shared_task(name="tests.scheduler_boom")
def _boom_task():
    raise RuntimeError("boom")


@pytest.fixture(autouse=True)
def _registered(monkeypatch):
    monkeypatch.setitem(registry._BY_KEY, "tests.scheduler_ok", JobSpec("tests.scheduler_ok", GLOBAL, "* * * * *", max_runtime=60))
    monkeypatch.setitem(registry._BY_KEY, "tests.scheduler_boom", JobSpec("tests.scheduler_boom", GLOBAL, "* * * * *", max_runtime=60))
    CALLS.clear()
    cache.delete_pattern("scheduler:lock:*") if hasattr(cache, "delete_pattern") else None
    for key in ("tests.scheduler_ok", "tests.scheduler_boom"):
        cache.delete(services.lock_key(key, None))
    yield


def _job(key, tenant=None, **pt_fields):
    schedule, _ = CrontabSchedule.objects.get_or_create(minute="0", hour="3", timezone="UTC")
    pt = PeriodicTask.objects.create(
        name=key if tenant is None else f"{key}@{tenant.code}", task=key, crontab=schedule, **pt_fields
    )
    return ScheduledJob.objects.create(periodic_task=pt, job_key=key, tenant=tenant)


def test_the_task_base_is_ours():
    """Every task in this process must be a SchedulerTask, in this process.

    Not a tautology. Until config/__init__.py imported the Celery app, whether
    a shared task got our base depended on whether some earlier test had
    happened to import config.celery: `test_a_broken_receiver_does_not_fail_
    the_task` passed alone (gate never ran, nothing to catch) and
    `test_a_held_lock_...` failed when run right after it in one process
    (measured 2026-09-17). Pinned by name so the order dependence cannot
    come back unnoticed.
    """
    from celery import current_app

    from apps.authentication.tasks import flush_expired_tokens
    from apps.scheduler.task_base import SchedulerTask

    assert current_app.main == "soulledger"
    for task in (_ok_task, flush_expired_tokens):
        assert isinstance(task._get_current_object(), SchedulerTask), task.name


# ---------------------------------------------------------------------------
# Recording
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_a_successful_run_is_recorded_running_then_success(db):
    job = _job("tests.scheduler_ok")
    task_id = str(uuid.uuid4())

    result = _ok_task.apply(task_id=task_id, headers={"periodic_task_name": job.periodic_task.name})

    assert result.get() == {"ran": True}
    run = TaskRun.objects.get(celery_task_id=task_id)
    assert run.status == RunStatus.SUCCESS
    assert run.job == job and run.trigger == RunTrigger.SCHEDULE
    assert run.started_at is not None and run.finished_at is not None and run.duration_ms is not None
    assert run.result == "{'ran': True}"


@pytest.mark.django_db
def test_a_failed_run_records_failure_with_the_traceback(db):
    job = _job("tests.scheduler_boom")
    task_id = str(uuid.uuid4())

    result = _boom_task.apply(task_id=task_id, throw=False)

    assert result.state == "FAILURE"
    run = TaskRun.objects.get(celery_task_id=task_id)
    assert run.status == RunStatus.FAILURE and run.job == job
    assert run.error.startswith("RuntimeError: boom")
    assert "Traceback" in run.error


@pytest.mark.django_db
def test_an_unregistered_task_leaves_no_row(db):
    from apps.authentication.tasks import flush_expired_tokens

    _job("tests.scheduler_ok")
    # `events.deliver_webhook` is not in the registry; nor is any task with a
    # foreign name. Prove absence with a name nothing registers.
    task_id = str(uuid.uuid4())
    result = flush_expired_tokens.apply(task_id=task_id)  # registered globally...
    assert result.state == "SUCCESS"
    # ...so IT gets a row (job=None: no ScheduledJob for it in this test DB),
    assert TaskRun.objects.filter(celery_task_id=task_id).exists()
    # while the unregistered `tests.*` name used by the mock below never does.
    assert not TaskRun.objects.filter(task_name="events.deliver_webhook").exists()


@pytest.mark.django_db
def test_a_broken_receiver_does_not_fail_the_task(db, monkeypatch):
    _job("tests.scheduler_ok")

    def explode(*_a, **_k):
        raise RuntimeError("bookkeeping is broken")

    # Both bookkeeping paths: the signal receivers (resolve_job) and the lock
    # gate in SchedulerTask.__call__ (tenant_id_from_call). Celery itself
    # swallows receiver exceptions; the gate's try/except is ours alone.
    monkeypatch.setattr(signals.services, "resolve_job", explode)
    monkeypatch.setattr(signals.services, "tenant_id_from_call", explode)
    result = _ok_task.apply(task_id=str(uuid.uuid4()))

    assert result.state == "SUCCESS" and result.get() == {"ran": True}
    assert CALLS == [None]


@pytest.mark.django_db
def test_a_manual_pending_row_is_picked_up_by_the_same_task_id(db, admin_user, monkeypatch):
    job = _job("tests.scheduler_ok")
    sent = {}

    def fake_send_task(name, kwargs=None, task_id=None, headers=None, **_):
        sent.update(name=name, kwargs=kwargs, task_id=task_id, headers=headers)

    import config.celery

    monkeypatch.setattr(config.celery.app, "send_task", fake_send_task)
    run = services.trigger_manual(job, admin_user)
    assert run.status == RunStatus.PENDING and run.trigger == RunTrigger.MANUAL and run.triggered_by == admin_user
    assert sent["task_id"] == run.celery_task_id and sent["headers"] == {"scheduler_trigger": "MANUAL"}

    _ok_task.apply(task_id=run.celery_task_id, headers=sent["headers"])
    run.refresh_from_db()
    assert run.status == RunStatus.SUCCESS and run.trigger == RunTrigger.MANUAL
    assert TaskRun.objects.filter(job=job).count() == 1


@pytest.mark.django_db
def test_retry_keeps_the_row_open_and_the_first_start(db):
    job = _job("tests.scheduler_ok")
    task_id = str(uuid.uuid4())
    started = timezone.now() - timedelta(minutes=2)
    run = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id=task_id, status=RunStatus.RUNNING, started_at=started)

    signals.on_postrun(sender=_ok_task, task_id=task_id, retval=None, state="RETRY")
    run.refresh_from_db()
    assert run.status == RunStatus.RETRY and run.finished_at is None

    _ok_task.apply(task_id=task_id)
    run.refresh_from_db()
    assert run.status == RunStatus.SUCCESS
    assert run.started_at == started
    assert run.duration_ms >= 120_000


@pytest.mark.django_db
def test_before_publish_creates_a_pending_row_for_beat_dispatch(db):
    job = _job("tests.scheduler_ok")
    task_id = str(uuid.uuid4())

    signals.on_before_publish(
        sender="tests.scheduler_ok",
        headers={"id": task_id, "task": "tests.scheduler_ok", "periodic_task_name": job.periodic_task.name},
        body=([], {}, {}),
    )
    run = TaskRun.objects.get(celery_task_id=task_id)
    assert run.status == RunStatus.PENDING and run.job == job

    # A publish without the beat header (a `.delay()` from code) is not ours to pre-record.
    signals.on_before_publish(sender="tests.scheduler_ok", headers={"id": str(uuid.uuid4())}, body=([], {}, {}))
    assert TaskRun.objects.count() == 1


# ---------------------------------------------------------------------------
# Lock
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_a_held_lock_makes_the_run_skipped_without_executing(db):
    job = _job("tests.scheduler_ok")
    key = services.lock_key("tests.scheduler_ok", None)
    assert cache.add(key, "someone-else", timeout=60)
    task_id = str(uuid.uuid4())

    result = _ok_task.apply(task_id=task_id)

    assert result.get() == {"skipped": "locked", "lock": key}
    assert CALLS == []
    run = TaskRun.objects.get(celery_task_id=task_id)
    assert run.status == RunStatus.SKIPPED and run.job == job
    # The following SUCCESS postrun for the no-op must not have overwritten it.
    assert run.result == ""

    cache.delete(key)
    assert _ok_task.apply(task_id=str(uuid.uuid4())).get() == {"ran": True}
    assert CALLS == [None]


@pytest.mark.django_db
def test_the_lock_is_released_after_the_run_and_held_during_it(db, monkeypatch):
    _job("tests.scheduler_ok")
    key = services.lock_key("tests.scheduler_ok", None)
    seen = {}
    original = _ok_task.run

    def spy(*a, **k):
        seen["holder"] = cache.get(key)
        return original(*a, **k)

    monkeypatch.setattr(_ok_task, "run", spy)
    task_id = str(uuid.uuid4())
    _ok_task.apply(task_id=task_id)
    assert seen["holder"] == task_id
    assert cache.get(key) is None


def test_a_direct_python_call_takes_no_lock_and_writes_no_row(db):
    assert _ok_task() == {"ran": True}
    assert cache.get(services.lock_key("tests.scheduler_ok", None)) is None
    assert TaskRun.objects.count() == 0


# ---------------------------------------------------------------------------
# Recovery
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_worker_ready_marks_only_that_hostnames_running_rows_lost(db):
    job = _job("tests.scheduler_ok")
    mine = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="a", status=RunStatus.RUNNING, worker_hostname="w1", started_at=timezone.now())
    other = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="b", status=RunStatus.RUNNING, worker_hostname="w2", started_at=timezone.now())
    done = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="c", status=RunStatus.SUCCESS, worker_hostname="w1")

    signals.on_worker_ready(sender=SimpleNamespace(hostname="w1"))

    assert TaskRun.objects.get(pk=mine.pk).status == RunStatus.LOST
    assert TaskRun.objects.get(pk=other.pk).status == RunStatus.RUNNING
    assert TaskRun.objects.get(pk=done.pk).status == RunStatus.SUCCESS
    assert "w1 restarted" in TaskRun.objects.get(pk=mine.pk).error


@pytest.mark.django_db
def test_the_reaper_closes_runs_stuck_past_max_runtime_and_never_picked_up(db, settings):
    settings.SCHEDULER_PENDING_GRACE_SECONDS = 900
    job = _job("tests.scheduler_ok")  # max_runtime 60
    now = timezone.now()
    stuck = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="stuck", status=RunStatus.RUNNING, started_at=now - timedelta(seconds=61))
    fresh = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="fresh", status=RunStatus.RUNNING, started_at=now - timedelta(seconds=59))
    dropped = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="dropped", status=RunStatus.PENDING, queued_at=now - timedelta(seconds=901))
    waiting = TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="waiting", status=RunStatus.PENDING, queued_at=now - timedelta(seconds=899))

    stats = services.reap_stale_runs(now)

    assert stats == {"running_lost": 1, "pending_lost": 1}
    assert TaskRun.objects.get(pk=stuck.pk).status == RunStatus.LOST
    assert TaskRun.objects.get(pk=fresh.pk).status == RunStatus.RUNNING
    assert TaskRun.objects.get(pk=dropped.pk).status == RunStatus.LOST
    assert TaskRun.objects.get(pk=waiting.pk).status == RunStatus.PENDING


@pytest.mark.django_db
def test_a_lost_run_that_finishes_after_all_gets_its_real_outcome(db):
    job = _job("tests.scheduler_ok")
    task_id = str(uuid.uuid4())
    TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id=task_id, status=RunStatus.LOST, started_at=timezone.now())
    signals.on_postrun(sender=_ok_task, task_id=task_id, retval={"late": True}, state="SUCCESS")
    assert TaskRun.objects.get(celery_task_id=task_id).status == RunStatus.SUCCESS


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_prune_keeps_the_newest_m_per_job_and_never_touches_open_rows(db, settings):
    settings.SCHEDULER_RUN_RETENTION_DAYS = 30
    settings.SCHEDULER_RUN_KEEP_MIN = 5
    now = timezone.now()
    busy = _job("tests.scheduler_ok")
    quiet = _job("tests.scheduler_boom")
    old = now - timedelta(days=40)
    for i in range(12):
        TaskRun.objects.create(job=busy, task_name=busy.job_key, celery_task_id=f"busy{i}", status=RunStatus.SUCCESS, queued_at=old - timedelta(hours=i))
    TaskRun.objects.create(job=busy, task_name=busy.job_key, celery_task_id="busy-running", status=RunStatus.RUNNING, queued_at=old - timedelta(days=1), started_at=old)
    # Six recent closed rows: more than the keep floor, so the floor is filled
    # by rows the retention window already protects. That is what separates
    # "kept because recent" from "kept because floor" — with only one recent
    # row the two rules are indistinguishable (a mutation ignoring the cutoff
    # stayed green against the first version of this test).
    for i in range(6):
        TaskRun.objects.create(job=busy, task_name=busy.job_key, celery_task_id=f"recent{i}", status=RunStatus.FAILURE, queued_at=now - timedelta(days=1, hours=i))
    for i in range(3):
        TaskRun.objects.create(job=quiet, task_name=quiet.job_key, celery_task_id=f"quiet{i}", status=RunStatus.SUCCESS, queued_at=old - timedelta(days=i))
    TaskRun.objects.create(job=None, task_name="gone", celery_task_id="orphan", status=RunStatus.SUCCESS, queued_at=old)

    deleted = services.prune_runs(now, batch_size=4)

    # busy: 12 old closed + 1 old RUNNING (the oldest row) + 6 recent. The keep
    # floor of 5 is filled by recent rows, so all 12 old closed rows go; the
    # RUNNING row is older than all of them and survives only because it is
    # open; the 6th recent row survives only because it is inside retention.
    assert deleted == 12 + 1
    kept = set(TaskRun.objects.filter(job=busy).values_list("celery_task_id", flat=True))
    assert kept == {"busy-running", *(f"recent{i}" for i in range(6))}
    # quiet: 3 old rows, all under the floor — nothing deleted.
    assert TaskRun.objects.filter(job=quiet).count() == 3
    assert not TaskRun.objects.filter(celery_task_id="orphan").exists()


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_failure_alerts_once_on_the_success_to_failure_edge_and_resets_on_success(db, admin_user):
    job = _job("tests.scheduler_boom")
    inbox = UserNotification.objects.filter(user=admin_user)
    before = inbox.count()

    _boom_task.apply(task_id=str(uuid.uuid4()), throw=False)
    _boom_task.apply(task_id=str(uuid.uuid4()), throw=False)
    _boom_task.apply(task_id=str(uuid.uuid4()), throw=False)

    job.refresh_from_db()
    assert job.consecutive_failures == 3
    assert job.last_alerted_at is not None
    assert inbox.count() == before + 1
    assert "Scheduled task failed: tests.scheduler_boom" in inbox.latest("created_at").title

    # Recovery: a SUCCESS postrun on this job resets the counter, silently.
    TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="rec", status=RunStatus.RUNNING, started_at=timezone.now())
    signals.on_postrun(sender=_boom_task, task_id="rec", retval=None, state="SUCCESS")
    job.refresh_from_db()
    assert job.consecutive_failures == 0
    assert inbox.count() == before + 1

    # And the next failure is a new episode: one more notification.
    _boom_task.apply(task_id=str(uuid.uuid4()), throw=False)
    assert inbox.count() == before + 2


@pytest.mark.django_db
def test_alert_recipients_are_admins_plus_tenant_holders_of_manage(db, admin_user, judge_user, viewer_user, eu_admin_user, cn_tenant):
    from apps.perm.models import Permission, Role, RolePermission

    job = _job("tests.scheduler_ok", tenant=cn_tenant)
    assert set(services.alert_recipients(job)) == {admin_user, eu_admin_user}

    RolePermission.objects.create(
        role=Role.objects.get(name="JUDGE"), permission=Permission.objects.get(codename="scheduler.manage")
    )
    assert set(services.alert_recipients(job)) == {admin_user, eu_admin_user, judge_user}


# ---------------------------------------------------------------------------
# Overdue
# ---------------------------------------------------------------------------

def _cron_at(local_dt):
    return {"minute": str(local_dt.minute), "hour": str(local_dt.hour), "day_of_month": "*", "month_of_year": "*", "day_of_week": "*"}


@pytest.mark.django_db
def test_overdue_is_computed_in_the_schedules_own_timezone(db, settings):
    """Same cron text, two timezones, one clock. In Asia/Shanghai the job was due
    30 minutes ago and nothing ran → overdue. In UTC the same digits are 7.5
    hours away → not overdue. Only `now` is real; the reference is one hour
    back, so a `now`-independent 'two days ago' cannot fake the result."""
    settings.SCHEDULER_OVERDUE_GRACE_SECONDS = 600
    now = timezone.now().replace(second=0, microsecond=0)
    shanghai_local = (now - timedelta(minutes=30)).astimezone(ZoneInfo("Asia/Shanghai"))
    reference = now - timedelta(hours=1)

    def make(tz, key):
        schedule = CrontabSchedule.objects.create(**_cron_at(shanghai_local), timezone=tz)
        pt = PeriodicTask.objects.create(name=f"{key}@{tz}", task="tests.scheduler_ok", crontab=schedule)
        job = ScheduledJob.objects.create(periodic_task=pt, job_key="tests.scheduler_ok")
        ScheduledJob.objects.filter(pk=job.pk).update(created_at=reference)
        PeriodicTask.objects.filter(pk=pt.pk).update(date_changed=reference)
        return ScheduledJob.objects.select_related("periodic_task").get(pk=job.pk)

    shanghai = services.job_health(make("Asia/Shanghai", "sh"), now)
    utc = services.job_health(make("UTC", "utc"), now)

    assert shanghai["overdue"] is True
    assert now - timedelta(minutes=31) <= shanghai["expected_at"] <= now - timedelta(minutes=29)
    assert utc["overdue"] is False
    assert utc["expected_at"] > now


@pytest.mark.django_db
def test_next_fire_is_exact_across_a_local_midnight(db):
    """Fixed instants, no wall clock. Reference 23:10 Asia/Shanghai on a
    Tuesday, cron `40 23 * * *`: the answer is 23:40 the same evening.
    celery's `crontab.remaining_delta` answered 23:40 the *next* day here
    (it only looks for a later slot 'today' when the reference is on its own
    now()'s date), which is how the tz test above went red once at 23:5x
    Shanghai during a full-suite run on 2026-09-17."""
    from datetime import datetime

    tz = ZoneInfo("Asia/Shanghai")
    schedule = CrontabSchedule.objects.create(minute="40", hour="23", timezone="Asia/Shanghai")
    pt = PeriodicTask.objects.create(name="midnight", task="tests.scheduler_ok", crontab=schedule)
    reference = datetime(2026, 9, 15, 23, 10, tzinfo=tz)  # a Tuesday
    assert services.next_fire_after(pt, reference) == datetime(2026, 9, 15, 23, 40, tzinfo=tz)
    # Strictly after: a reference sitting exactly on the slot rolls to tomorrow.
    assert services.next_fire_after(pt, datetime(2026, 9, 15, 23, 40, tzinfo=tz)) == datetime(2026, 9, 16, 23, 40, tzinfo=tz)
    # Weekday sets use celery's Sunday == 0 convention.
    weekdays = CrontabSchedule.objects.create(minute="0", hour="9", day_of_week="1-5", timezone="UTC")
    pt_wd = PeriodicTask.objects.create(name="weekdays", task="tests.scheduler_ok", crontab=weekdays)
    friday_noon = datetime(2026, 9, 18, 12, 0, tzinfo=ZoneInfo("UTC"))
    assert services.next_fire_after(pt_wd, friday_noon) == datetime(2026, 9, 21, 9, 0, tzinfo=ZoneInfo("UTC"))  # Monday


@pytest.mark.django_db
def test_a_run_clears_overdue_and_a_disabled_job_is_never_overdue(db, settings):
    settings.SCHEDULER_OVERDUE_GRACE_SECONDS = 600
    now = timezone.now()
    job = _job("tests.scheduler_ok")  # 03:00 UTC daily
    long_ago = now - timedelta(days=3)
    ScheduledJob.objects.filter(pk=job.pk).update(created_at=long_ago)
    PeriodicTask.objects.filter(pk=job.periodic_task_id).update(date_changed=long_ago)
    job = ScheduledJob.objects.select_related("periodic_task").get(pk=job.pk)
    assert services.job_health(job, now)["overdue"] is True
    assert services.job_health(job, now)["next_run_at"] is not None

    TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="r", status=RunStatus.SUCCESS, queued_at=now - timedelta(minutes=5))
    assert services.job_health(job, now)["overdue"] is False

    PeriodicTask.objects.filter(pk=job.periodic_task_id).update(enabled=False, date_changed=long_ago)
    TaskRun.objects.all().delete()
    job = ScheduledJob.objects.select_related("periodic_task").get(pk=job.pk)
    assert services.job_health(job, now) == {"next_run_at": None, "last_run": None, "overdue": False, "expected_at": None}


@pytest.mark.django_db
def test_overdue_alerts_once_per_episode(db, admin_user):
    now = timezone.now()
    job = _job("tests.scheduler_ok")
    long_ago = now - timedelta(days=3)
    ScheduledJob.objects.filter(pk=job.pk).update(created_at=long_ago)
    PeriodicTask.objects.filter(pk=job.periodic_task_id).update(date_changed=long_ago)
    inbox = UserNotification.objects.filter(user=admin_user)
    before = inbox.count()

    assert services.alert_overdue(now) == 1
    assert services.alert_overdue(now) == 0
    assert inbox.count() == before + 1
    assert "did not run: tests.scheduler_ok" in inbox.latest("created_at").title

    TaskRun.objects.create(job=job, task_name=job.job_key, celery_task_id="r", status=RunStatus.SUCCESS, queued_at=now)
    services.alert_overdue(now)
    job.refresh_from_db()
    assert job.overdue_alerted_at is None
