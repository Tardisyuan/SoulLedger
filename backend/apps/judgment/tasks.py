"""
Celery tasks for Judgment app.
"""
from datetime import timedelta

from celery import shared_task
from django.utils import timezone


@shared_task(name="judgment.auto_conclude_stale")
def auto_conclude_stale_judgments(days_threshold: int = 30):
    """
    Auto-conclude judgments that have been pending for too long.
    Runs weekly. Pending judgments older than days_threshold without a judge
    or verdict are flagged (not auto-concluded, just logged).
    """
    from apps.judgment.models import Judgment

    threshold = timezone.now() - timedelta(days=days_threshold)
    stale_judgments = Judgment.objects.filter(
        is_final=False,
        verdict__isnull=True,
        created_at__lt=threshold,
    ).select_related("soul", "tenant")

    flagged = 0
    for judgment in stale_judgments:
        # Log the stale judgment for admin review
        judgment.notes = (judgment.notes or "") + f"\n[SYSTEM] Flagged as stale on {timezone.now().isoformat()}"
        judgment.save(update_fields=["notes"])
        flagged += 1

    return {
        "flagged": flagged,
        "threshold_days": days_threshold,
        "timestamp": timezone.now().isoformat(),
    }
