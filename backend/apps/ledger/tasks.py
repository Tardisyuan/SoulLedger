"""
Celery tasks for Ledger app.

The `name=` strings are explicit and decoupled from this module's path, so
renaming the app would not have renamed them — but a stored schedule points at
a task *name*, and django_celery_beat happily keeps dispatching to a name
nothing answers to, silently. Renaming these is therefore a data change, not
just a code change; ledger/migrations/0001 rewrites the PeriodicTask rows that
setup_ledger_tasks wrote.
"""
from celery import shared_task
from django.utils import timezone


@shared_task(name="ledger.recalculate_all")
def recalculate_all_ledgers():
    """
    Recalculate the ledger for all souls.
    Run daily to apply time decay to all records.
    """
    from apps.ledger.services import LedgerService
    from apps.souls.models import Soul

    updated = 0
    for soul in Soul.objects.iterator(chunk_size=500):
        LedgerService.recalculate_soul_ledger(soul)
        updated += 1

    return {"updated": updated, "timestamp": timezone.now().isoformat()}


@shared_task(name="ledger.recalculate_single")
def recalculate_soul_ledger_task(soul_id: str):
    """
    Recalculate the ledger for a single soul by ID.
    """
    from apps.ledger.services import LedgerService
    from apps.souls.models import Soul

    try:
        soul = Soul.objects.get(id=soul_id)
        result = LedgerService.recalculate_soul_ledger(soul)
        return result
    except Soul.DoesNotExist:
        return {"error": "Soul not found", "soul_id": soul_id}
