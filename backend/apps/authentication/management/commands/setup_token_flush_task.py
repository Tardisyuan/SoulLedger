"""Register the daily expired-JWT flush as a django-celery-beat PeriodicTask.

Idempotent — the compose boot command runs it on every start. The schedule
lives in the database (DatabaseScheduler), not in a `beat_schedule` dict.
"""
from django.core.management.base import BaseCommand
from django_celery_beat.models import CrontabSchedule, PeriodicTask

TASK = "authentication.flush_expired_tokens"


class Command(BaseCommand):
    help = "Schedule the daily flush of expired simplejwt outstanding/blacklisted tokens"

    def handle(self, *args, **options):
        schedule, _ = CrontabSchedule.objects.get_or_create(
            minute="30", hour="3", day_of_week="*", day_of_month="*", month_of_year="*",
        )
        # `enabled` is left out of the update so an operator who switched the
        # task off does not have it switched back on by the next boot.
        _, created = PeriodicTask.objects.update_or_create(
            name=TASK,
            defaults={"task": TASK, "crontab": schedule, "interval": None},
        )
        self.stdout.write(f"{'Created' if created else 'Updated'} periodic task: {TASK}")
