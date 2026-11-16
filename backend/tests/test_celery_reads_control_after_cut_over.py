"""Celery reads where Celery writes: control, in stage 3 (apps/core/shard_reads.py, module header). Real tasks and
real Celery signals, eager, with all four civilizations cut over and the shards one sync behind control --
the state a worker (or an operator's command) sees between a commit and the next sync (VERIFY-stage3.md
section 1).

Under the earlier rule (a task with no hall read FANOUT, a per-hall task its hall's shard, a Celery signal
nothing) each of these went wrong: the export task could not find the export its request had just committed;
worker_ready raised NoShardContext, which Celery logs and swallows, so orphans were never marked LOST; the
reaper and the orphan sweep read a run's stale status from a shard and overwrote the newer one on control; a
per-hall purge re-read its lagging shard, got back the ids it had just deleted, and looped.
"""
from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from tests.test_shard_sync import CIVS, _sync, sharded


def _halls():
    from apps.tenants.models import Tenant

    return {civ: Tenant.objects.create(code=f"CEL_{civ[:2]}", display_name=civ, declared_civilization=civ)
            for civ in CIVS}


def cut_over():
    return override_settings(SHARD_READ_CIVS=list(CIVS))


@sharded
def test_a_task_finds_the_row_its_request_just_committed():
    from apps.soul_accounts import data_export
    from apps.soul_accounts.models import DataExportStatus, SoulDataExport
    from apps.soul_accounts.tasks import build_data_export
    from tests.soul_account_support import ready_soul

    account, _ = ready_soul(_halls()["GREEK"], name="exporter")
    _sync()  # the soul and its account reached the shard long ago
    export = data_export.request_export(account)  # committed on control; the next sync is up to 30 s away
    with cut_over():
        result = build_data_export.apply(args=[str(export.pk)])
    row = SoulDataExport._base_manager.using("default").get(pk=export.pk)
    assert result.successful(), f"{result.result!r}; the row was left {row.status}"
    assert row.status == DataExportStatus.READY


def _runs(hall, hostname, started):
    """Two RUNNING runs of `hostname`, synced; then the second finishes on control (after the sync)."""
    from apps.scheduler.models import RunStatus, TaskRun

    orphan, finished = (TaskRun.objects.create(task_name="t", celery_task_id=f"{hostname}-{n}", tenant=hall,
                                               status=RunStatus.RUNNING, worker_hostname=hostname, started_at=started)
                        for n in (1, 2))
    _sync()
    TaskRun._base_manager.using("default").filter(pk=finished.pk).update(status=RunStatus.SUCCESS)
    return orphan, finished


def _status(run):
    from apps.scheduler.models import TaskRun

    return TaskRun._base_manager.using("default").get(pk=run.pk).status


@sharded
def test_worker_ready_marks_what_the_worker_left_running_lost_and_nothing_else():
    from celery import signals

    from apps.scheduler.models import RunStatus

    orphan, finished = _runs(_halls()["GREEK"], "w1@host", timezone.now())
    with cut_over():
        signals.worker_ready.send(sender=type("Worker", (), {"hostname": "w1@host"})())  # Celery's own dispatch
    assert _status(orphan) == RunStatus.LOST, "worker_ready did not sweep (Celery swallows what it raises)"
    assert _status(finished) == RunStatus.SUCCESS, "a stale RUNNING read from the shard overwrote SUCCESS"


@sharded
def test_the_reaper_does_not_overwrite_a_status_newer_than_its_shard():
    from apps.scheduler.models import RunStatus
    from apps.scheduler.tasks import reap_stale_runs

    orphan, finished = _runs(_halls()["EGYPTIAN"], "w2@host", timezone.now() - timedelta(days=1))
    with cut_over():
        result = reap_stale_runs.apply()
    assert result.successful(), result.result
    assert _status(orphan) == RunStatus.LOST
    assert _status(finished) == RunStatus.SUCCESS, "a stale RUNNING read from the shard overwrote SUCCESS"


@sharded
def test_a_per_hall_purge_reads_what_it_deletes(settings):
    from apps.death_sync.models import DeathRegistrationRequest, DeathRegistrationStatus, ExternalApiKey
    from apps.death_sync.tasks import cleanup_old_requests_for_tenant

    settings.DEATH_SYNC_REQUEST_RETENTION_DAYS = 30
    hall = _halls()["CHINESE"]
    _, key_hash, prefix = ExternalApiKey.generate_key()
    key = ExternalApiKey.objects.create(tenant=hall, name="k", system_type="HOSPITAL", key_hash=key_hash,
                                        key_prefix=prefix)
    for n in range(3):
        DeathRegistrationRequest.objects.create(tenant=hall, api_key=key, idempotency_key=f"old-{n}",
                                                source_system="HOSPITAL", source_payload={},
                                                status=DeathRegistrationStatus.PENDING)
    DeathRegistrationRequest._base_manager.filter(tenant=hall).update(
        request_timestamp=timezone.now() - timedelta(days=60))
    _sync()
    batches = []

    def sleep(_seconds):
        batches.append(1)
        assert len(batches) < 5, "the purge keeps getting back the ids it already deleted"

    with cut_over(), mock.patch("time.sleep", sleep):
        result = cleanup_old_requests_for_tenant.apply(args=[str(hall.pk)], kwargs={"batch_size": 2})
    assert result.successful(), result.result
    assert result.result["deleted"] == 3
    assert not DeathRegistrationRequest._base_manager.using("default").filter(tenant=hall).exists()


@sharded
def test_a_task_that_asks_for_the_merge_gets_it():
    """The opt-in still works inside a task: read_context(FANOUT) reads every leg (here: the shard's stale copy
    of a soul renamed on control after the sync)."""
    from celery import shared_task

    from apps.core.shard_reads import FANOUT, read_context
    from apps.souls.models import Soul, SoulState

    soul = Soul.objects.create(name="before", tenant=_halls()["GREEK"], current_state=SoulState.JUDGING)
    _sync()
    Soul._base_manager.using("default").filter(pk=soul.pk).update(name="after")

    @shared_task(name="tests.read_soul_name")
    def read_name(merged):
        if not merged:
            return Soul._base_manager.get(pk=soul.pk).name
        with read_context(FANOUT):
            return Soul._base_manager.get(pk=soul.pk).name

    with cut_over():
        assert read_name.apply(args=[False]).get() == "after"
        assert read_name.apply(args=[True]).get() == "before"


@sharded
def test_a_management_command_reads_what_control_has():
    """An operator's command reads, then writes to control: it reads control too (the earlier FANOUT read the
    shard's copy, renamed on control since the sync)."""
    from django.core.management import call_command
    from django.core.management.base import BaseCommand

    from apps.souls.models import Soul, SoulState

    soul = Soul.objects.create(name="before", tenant=_halls()["EUROPEAN"], current_state=SoulState.JUDGING)
    _sync()
    Soul._base_manager.using("default").filter(pk=soul.pk).update(name="after")

    class ReadName(BaseCommand):
        def handle(self, *args, **options):
            return Soul._base_manager.get(pk=soul.pk).name

    with cut_over():
        assert call_command(ReadName()) == "after"
