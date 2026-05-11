"""
Management command to set up Celery beat periodic tasks for karma.
Run once after deployment: python manage.py setup_karma_tasks
"""
from django.core.management.base import BaseCommand
from django_celery_beat.models import PeriodicTask, CrontabSchedule, IntervalSchedule


class Command(BaseCommand):
    help = "Set up Celery beat periodic tasks for karma recalculation"

    def handle(self, *args, **options):
        # Create crontab schedule: run every day at 00:00 UTC
        schedule, _ = CrontabSchedule.objects.get_or_create(
            minute="0",
            hour="0",
            day_of_week="*",
            day_of_month="*",
            month_of_year="*",
        )

        # Create the periodic task
        task, created = PeriodicTask.objects.get_or_create(
            name="karma.recalculate_all",
            defaults={
                "task": "karma.recalculate_all",
                "crontab": schedule,
                "interval": None,
                "enabled": True,
                "description": "Recalculate karma for all souls daily (applies time decay)",
            },
        )

        if created:
            self.stdout.write(self.style.SUCCESS("Created periodic task: karma.recalculate_all"))
        else:
            self.stdout.write(self.style.WARNING("Periodic task already exists: karma.recalculate_all"))

        self.stdout.write(self.style.SUCCESS("Done. Start celery beat with: celery -A config beat -l INFO"))
