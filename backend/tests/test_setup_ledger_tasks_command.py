"""Smoke test for `manage.py setup_ledger_tasks` (DB-07).

Registers a django-celery-beat PeriodicTask for the daily ledger
recalculation. Nothing in the suite exercised this command before this
file. Asserts the actual effect (one enabled PeriodicTask row on a
midnight-UTC crontab) and that running it again does not create a second
row — `get_or_create` on the task name is the only thing preventing that.
"""
import pytest
from django.core.management import call_command
from django_celery_beat.models import PeriodicTask

TASK_NAME = "ledger.recalculate_all"


@pytest.mark.django_db
def test_setup_ledger_tasks_registers_one_task_however_often_it_runs():
    call_command("setup_ledger_tasks")

    tasks = PeriodicTask.objects.filter(task=TASK_NAME)
    assert tasks.count() == 1
    task = tasks.get()
    assert task.enabled
    assert task.interval is None
    assert task.crontab is not None
    assert task.crontab.minute == "0"
    assert task.crontab.hour == "0"

    call_command("setup_ledger_tasks")

    # Absence check: a second run must not register a duplicate task.
    assert PeriodicTask.objects.filter(task=TASK_NAME).count() == 1
