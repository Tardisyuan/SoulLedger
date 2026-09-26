"""Fire every per-node workflow timeout that is due, now, without celery.

    manage.py process_workflow_timeouts                        # every active tenant
    manage.py process_workflow_timeouts --now 2026-09-27T10:00:00+00:00

The scheduled job `workflow.process_timeouts_for_tenant` does the same every
5 minutes per active tenant; this is its manual entry point, one tenant at a
time through the same `process_due_for_tenant`. See `apps/workflow/timeouts.py`
for what each action does.
"""
from collections import Counter

from django.core.management.base import BaseCommand
from django.utils.dateparse import parse_datetime

from apps.tenants.models import Tenant
from apps.workflow.timeouts import process_due_for_tenant


class Command(BaseCommand):
    help = "Fire due per-node workflow timeouts (escalate / auto-reject / notify)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--now",
            help="ISO timestamp to evaluate deadlines against (default: the current time).",
        )

    def handle(self, *args, **options):
        now = parse_datetime(options["now"]) if options.get("now") else None
        counts: Counter = Counter()
        for tenant in Tenant.objects.filter(is_active=True).order_by("code"):
            counts.update(process_due_for_tenant(tenant, now=now))
        self.stdout.write(
            "workflow timeouts: "
            + ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
        )
