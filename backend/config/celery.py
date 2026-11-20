"""
Celery config for SoulLedger.
"""
import os

from celery import Celery, signals

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# task_cls: every task (incl. the @shared_task ones in other apps) gets the
# single-flight lock gate for registry-listed names. See apps/scheduler/task_base.py.
app = Celery("soulledger", task_cls="apps.scheduler.task_base:SchedulerTask")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# 任务消息头带上发起请求的 X-Request-ID(apps/core/trace.py 里的三个 signal 接收器)。
import apps.core.trace  # noqa: E402,F401


@signals.worker_init.connect
@signals.beat_init.connect
def refuse_purged_control_without_shards(**_kwargs):
    """Celery runs no Django system checks: the one that refuses a non-sharded process over a purged control database
    (apps/core/shard_sync.py `purged_control_needs_shards`) is asked here. SystemExit, not an exception: Celery logs a
    receiver's exception and starts anyway."""
    from apps.core.shard_sync import purged_control_needs_shards

    errors = purged_control_needs_shards()
    if errors:
        raise SystemExit("; ".join(f"{e.id}: {e.msg}" for e in errors))
