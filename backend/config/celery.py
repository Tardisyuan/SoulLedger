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
