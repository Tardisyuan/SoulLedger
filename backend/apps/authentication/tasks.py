"""Celery tasks for authentication."""
from celery import shared_task
from django.core.management import call_command


@shared_task(name="authentication.flush_expired_tokens")
def flush_expired_tokens():
    """Delete expired refresh-token rows (IS-18).

    Every refresh rotates and blacklists, so the simplejwt outstanding and
    blacklisted tables gain a row pair per refresh and nothing removed them.
    Blacklisted rows cascade from their outstanding row. Scheduled by
    `manage.py setup_scheduled_tasks` (apps/scheduler/registry.py).
    """
    call_command("flushexpiredtokens")
