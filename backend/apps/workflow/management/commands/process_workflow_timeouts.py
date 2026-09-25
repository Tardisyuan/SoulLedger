"""Fire every per-node workflow timeout that is due.

Timeouts fire ONLY when this runs (or the celery task `workflow.process_timeouts`,
which calls the same function). Nothing schedules either: the beat scheduler is
not deployed, and the task is deliberately not in `apps/scheduler/registry.py`.
To make timeouts real, run this from cron, e.g. every 15 minutes:

    */15 * * * *  cd backend && .venv/bin/python manage.py process_workflow_timeouts

See `apps/workflow/timeouts.py` for what each action does.
"""
from django.core.management.base import BaseCommand
from django.utils.dateparse import parse_datetime

from apps.workflow.timeouts import process_due


class Command(BaseCommand):
    help = "Fire due per-node workflow timeouts (escalate / auto-reject / notify)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--now",
            help="ISO timestamp to evaluate deadlines against (default: the current time).",
        )

    def handle(self, *args, **options):
        now = parse_datetime(options["now"]) if options.get("now") else None
        counts = process_due(now=now)
        self.stdout.write(
            "workflow timeouts: "
            + ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
        )
