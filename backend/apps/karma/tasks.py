"""
Celery tasks for Karma app.
"""
from celery import shared_task
from django.utils import timezone


@shared_task(name="karma.recalculate_all")
def recalculate_all_karma():
    """
    Recalculate karma for all souls.
    Run daily to apply time decay to all records.
    """
    from apps.karma.services import KarmaService
    from apps.souls.models import Soul

    updated = 0
    for soul in Soul.objects.iterator(chunk_size=500):
        KarmaService.recalculate_soul_karma(soul)
        updated += 1

    return {"updated": updated, "timestamp": timezone.now().isoformat()}


@shared_task(name="karma.recalculate_single")
def recalculate_soul_karma_task(soul_id: str):
    """
    Recalculate karma for a single soul by ID.
    """
    from apps.karma.services import KarmaService
    from apps.souls.models import Soul

    try:
        soul = Soul.objects.get(id=soul_id)
        result = KarmaService.recalculate_soul_karma(soul)
        return result
    except Soul.DoesNotExist:
        return {"error": "Soul not found", "soul_id": soul_id}
