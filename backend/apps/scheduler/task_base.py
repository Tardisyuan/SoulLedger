"""The celery Task base every task in this project gets (config/celery.py).

Only `__call__` is overridden, and only for tasks in the registry: it takes the
single-flight lock for the (job, tenant) before running the body, and records
SKIPPED without running when another execution holds it.

Why a base class and not a signal: `task_prerun` cannot stop a task — celery
catches and logs whatever a receiver raises (celery.utils.dispatch.Signal.send)
— and the tasks themselves live in five other apps, so the one place a
"do not run" decision can be made without editing each of them is here.

The module must stay importable before Django is set up (config/celery.py
names it in `Celery(task_cls=...)`), hence the lazy imports.
"""
import logging

from celery import Task

logger = logging.getLogger(__name__)


class SchedulerTask(Task):
    def __call__(self, *args, **kwargs):
        req = self.request
        # A direct Python call (`some_task()` in a test or a service) is not a
        # scheduled execution; keep plain-function semantics for it.
        if req.called_directly:
            return super().__call__(*args, **kwargs)

        gate = None
        try:
            gate = _gate(self.name, req, args, kwargs)
        except Exception:  # noqa: BLE001 — bookkeeping must never fail the task
            logger.exception("scheduler: lock gate failed for %s; running unlocked", self.name)

        if gate is None:
            return super().__call__(*args, **kwargs)

        key, owner, acquired = gate
        if not acquired:
            try:
                _mark_skipped(req.id, key)
            except Exception:  # noqa: BLE001
                logger.exception("scheduler: could not record SKIPPED for %s", req.id)
            return {"skipped": "locked", "lock": key}

        try:
            return super().__call__(*args, **kwargs)
        finally:
            from apps.scheduler.services import release_lock

            release_lock(key, owner)


def _gate(task_name, req, args, kwargs):
    from apps.scheduler import registry
    from apps.scheduler.services import acquire_lock, lock_key, tenant_id_from_call

    spec = registry.get(task_name)
    if spec is None:
        return None
    key = lock_key(spec.key, tenant_id_from_call(spec, args, kwargs))
    owner = str(req.id)
    return key, owner, acquire_lock(key, owner, spec.max_runtime)


def _mark_skipped(task_id, key):
    from apps.scheduler.models import RunStatus, TaskRun

    run = TaskRun.objects.filter(celery_task_id=str(task_id)).first()
    if run is not None:
        run.finish(RunStatus.SKIPPED, error=f"another run holds {key}")
