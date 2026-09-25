from celery import shared_task


@shared_task(name="workflow.process_timeouts")
def process_timeouts():
    """Fire due per-node timeouts. NOT scheduled: see `apps/workflow/timeouts.py`
    for why this is not in `apps/scheduler/registry.py`, and
    `manage.py process_workflow_timeouts` for the command that does the same."""
    from apps.workflow.timeouts import process_due

    return process_due()
