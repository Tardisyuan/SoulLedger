from celery import shared_task


@shared_task(name="core.prune_retained_data")
def prune_retained_data():
    """Operational tables past their retention window (apps/core/retention.py). Registered in apps/scheduler/registry.py."""
    from apps.core.retention import prune_retained_data as run

    return run()
