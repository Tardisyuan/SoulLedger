# Load the Celery app whenever Django loads, so `@shared_task` binds to *our*
# app (config/celery.py) and not to celery's implicit default app.
#
# This file was empty until 2026-09-17, and nothing else in a Django process
# imported config.celery. Measured in a plain `django.setup()` process: before
# the import, `current_app.main == "default"` and a shared task's MRO is
# `[..., Task, Task]`; after it, `"soulledger"` and `[..., Task, SchedulerTask]`.
# Two consequences of the old state:
#   * the web process published `.delay()` messages through the default app,
#     whose only configuration was the CELERY_BROKER_URL environment variable
#     (celery reads that one directly) — the CELERY_* settings in
#     config/settings.py did not apply to publishing at all;
#   * the single-flight lock gate on SchedulerTask.__call__ ran or did not run
#     depending on whether some earlier import had happened to pull in
#     config.celery. A test proved it: the same test passed alone and failed
#     after another test in the same process (see
#     tests/test_scheduler_runs_and_recovery.py::test_the_task_base_is_ours).
# The pattern is the one the Celery docs give for Django projects.
from .celery import app as celery_app

__all__ = ("celery_app",)
