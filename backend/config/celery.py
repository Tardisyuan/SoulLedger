"""
Celery config for SoulLedger.
"""
import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# task_cls: every task (incl. the @shared_task ones in other apps) gets the
# single-flight lock gate for registry-listed names. See apps/scheduler/task_base.py.
app = Celery("soulledger", task_cls="apps.scheduler.task_base:SchedulerTask")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# 任务消息头带上发起请求的 X-Request-ID(apps/core/trace.py 里的三个 signal 接收器)。
import apps.core.trace  # noqa: E402,F401
