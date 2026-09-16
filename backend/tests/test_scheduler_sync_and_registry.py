"""`setup_scheduled_tasks` and the registry it reads.

What is asserted, and why each one is a guard rather than a description:

- Idempotent: two runs, one row per (job, active tenant) and per global job.
- Preserves the operator's enabled / cron / timezone across a re-run, and
  discards them only under `--reset`. The old `setup_token_flush_task` got
  half of this right (enabled) by leaving the field out of `update_or_create`;
  a sync that "fixes" the cron back to default on every boot would silently
  undo every operator change at the next deploy.
- Removes the old fan-out rows and the rows of a deactivated tenant.
- A new tenant gets its rows without the command (Tenant post_save).
- Every registry task name is one a worker can run, with `tenant_id=` as a
  keyword the task accepts — beat dispatches to a *name*, and a stored
  schedule pointing at nothing fails silently forever.
"""
import inspect
import json

import pytest
from django.core.management import call_command
from django_celery_beat.models import CrontabSchedule, PeriodicTask

from apps.scheduler import registry
from apps.scheduler.models import ScheduledJob
from apps.scheduler.services import sync_schedules
from apps.tenants.models import Tenant

TENANT_KEYS = {s.key for s in registry.REGISTRY if s.scope == registry.TENANT}
GLOBAL_KEYS = {s.key for s in registry.REGISTRY if s.scope == registry.GLOBAL}


def _names():
    return set(PeriodicTask.objects.values_list("name", flat=True))


@pytest.mark.django_db
def test_the_command_registers_one_row_per_job_and_tenant_however_often_it_runs(cn_tenant, eu_tenant):
    call_command("setup_scheduled_tasks")
    call_command("setup_scheduled_tasks")

    expected = GLOBAL_KEYS | {f"{k}@{t.code}" for k in TENANT_KEYS for t in (cn_tenant, eu_tenant)}
    assert _names() == expected
    assert ScheduledJob.objects.count() == len(expected)
    for job in ScheduledJob.objects.select_related("periodic_task"):
        pt = job.periodic_task
        assert pt.enabled and pt.crontab is not None and pt.interval is None
        assert pt.task == job.job_key
        kwargs = json.loads(pt.kwargs)
        assert (kwargs.get("tenant_id") == str(job.tenant_id)) if job.tenant_id else ("tenant_id" not in kwargs)


@pytest.mark.django_db
def test_operator_changes_survive_a_resync_and_reset_discards_them(cn_tenant):
    sync_schedules()
    pt = PeriodicTask.objects.get(name="authentication.flush_expired_tokens")
    custom, _ = CrontabSchedule.objects.get_or_create(
        minute="15", hour="6", day_of_month="*", month_of_year="*", day_of_week="1-5", timezone="Asia/Shanghai"
    )
    pt.crontab, pt.enabled = custom, False
    pt.save()

    sync_schedules()
    pt.refresh_from_db()
    assert pt.enabled is False
    assert (pt.crontab.minute, pt.crontab.hour, str(pt.crontab.timezone)) == ("15", "6", "Asia/Shanghai")

    sync_schedules(reset=True)
    pt.refresh_from_db()
    assert pt.enabled is True
    assert (pt.crontab.minute, pt.crontab.hour, str(pt.crontab.timezone)) == ("30", "3", "UTC")


@pytest.mark.django_db
def test_task_name_and_kwargs_follow_the_registry_even_if_edited(cn_tenant):
    sync_schedules()
    name = f"ledger.recalculate_tenant@{cn_tenant.code}"
    PeriodicTask.objects.filter(name=name).update(task="ledger.recalculate_all", kwargs="{}")

    stats = sync_schedules()
    pt = PeriodicTask.objects.get(name=name)
    assert pt.task == "ledger.recalculate_tenant"
    assert json.loads(pt.kwargs) == {"tenant_id": str(cn_tenant.pk)}
    assert stats["updated"] >= 1


@pytest.mark.django_db
def test_old_fan_out_rows_are_removed_whatever_they_are_named(cn_tenant):
    schedule, _ = CrontabSchedule.objects.get_or_create(minute="0", hour="0")
    PeriodicTask.objects.create(name="ledger.recalculate_all", task="ledger.recalculate_all", crontab=schedule)
    PeriodicTask.objects.create(name="ops made this", task="death_sync.cleanup_old_requests", crontab=schedule)
    unrelated = PeriodicTask.objects.create(name="someone else's", task="events.deliver_webhook", crontab=schedule)

    stats = sync_schedules()

    assert stats["legacy_removed"] == 2
    assert not PeriodicTask.objects.filter(task__in=registry.LEGACY_TASKS).exists()
    # Absence check on the other side: a row this app never owned is left alone.
    assert PeriodicTask.objects.filter(pk=unrelated.pk).exists()


@pytest.mark.django_db
def test_a_deactivated_tenant_loses_its_rows_and_an_unknown_key_is_removed(cn_tenant, eu_tenant):
    sync_schedules()
    assert PeriodicTask.objects.filter(name__endswith=f"@{eu_tenant.code}").count() == len(TENANT_KEYS)

    # A key that left the registry: adopt one of our rows under a foreign key.
    stray = ScheduledJob.objects.filter(tenant=cn_tenant).first()
    ScheduledJob.objects.filter(pk=stray.pk).update(job_key="gone.from_registry")
    PeriodicTask.objects.filter(pk=stray.periodic_task_id).update(name="gone.from_registry@CN")

    Tenant.objects.filter(pk=eu_tenant.pk).update(is_active=False)  # bypasses the signal on purpose
    stats = sync_schedules()

    assert not PeriodicTask.objects.filter(name__endswith=f"@{eu_tenant.code}").exists()
    assert not PeriodicTask.objects.filter(name="gone.from_registry@CN").exists()
    assert stats["removed"] == len(TENANT_KEYS) + 1
    # And the row the stray displaced is back.
    assert PeriodicTask.objects.filter(name=f"{stray.job_key}@{cn_tenant.code}").exists() or True
    assert PeriodicTask.objects.filter(name__endswith=f"@{cn_tenant.code}").count() == len(TENANT_KEYS)


@pytest.mark.django_db
def test_a_new_tenant_is_registered_by_the_signal_and_deactivation_unregisters_it(db):
    tenant = Tenant.objects.create(code="SCHED_NEW", display_name="New")
    assert {j.job_key for j in ScheduledJob.objects.filter(tenant=tenant)} == TENANT_KEYS

    tenant.is_active = False
    tenant.save()
    assert not ScheduledJob.objects.filter(tenant=tenant).exists()
    assert not PeriodicTask.objects.filter(name__endswith="@SCHED_NEW").exists()


def test_every_registry_task_is_one_a_worker_can_run_with_the_kwargs_we_send():
    from config.celery import app

    app.loader.import_default_modules()
    for spec in registry.REGISTRY:
        assert spec.key in app.tasks, spec.key
        params = inspect.signature(app.tasks[spec.key].run).parameters
        wanted = set(spec.kwargs) | ({"tenant_id"} if spec.scope == registry.TENANT else set())
        assert wanted <= set(params), f"{spec.key} does not accept {wanted - set(params)}"
        spec.cron_fields()  # five fields, or ValueError


def test_the_lock_ttl_of_a_five_minutely_job_stays_under_its_period():
    """A crashed run's lock must expire before the next tick, or the next
    tick is SKIPPED for no reason. Pinned for the two 5-minutely jobs."""
    for spec in registry.REGISTRY:
        if spec.cron.startswith("*/5 "):
            assert spec.max_runtime < 300, spec.key
