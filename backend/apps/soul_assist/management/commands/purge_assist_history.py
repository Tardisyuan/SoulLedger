"""Run the assistant history purge now, without celery.

    manage.py purge_assist_history

Same body as the daily `soul_assist.purge_history` job (in-process, so no worker
and no broker are needed — celery beat is not deployed yet; until it is, run this
from cron, or messages outlive the 30-day retention). Idempotent.
"""
from django.core.management.base import BaseCommand

from apps.soul_assist.service import purge_history


class Command(BaseCommand):
    help = "Delete assistant messages past retention, and deleted / retired-account conversations"

    def handle(self, *args, **options):
        result = purge_history()
        self.stdout.write(f"messages={result['messages']} conversations={result['conversations']}")
