"""Register every scheduled job for every active tenant. Idempotent.

Replaces `setup_ledger_tasks` and `setup_token_flush_task`; the compose boot
command runs this on every start. Task names and kwargs follow
apps/scheduler/registry.py; an operator's enabled / cron / timezone changes
survive unless `--reset` is given. Rows for the old fan-out parents and for
deactivated tenants are removed.
"""
from django.core.management.base import BaseCommand

from apps.scheduler.services import sync_schedules


class Command(BaseCommand):
    help = "Register scheduled jobs (registry × active tenants) as django-celery-beat PeriodicTasks"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Also restore each job's default cron, timezone and enabled=True, discarding operator changes",
        )

    def handle(self, *args, **options):
        stats = sync_schedules(reset=options["reset"])
        self.stdout.write(
            "scheduled tasks: "
            + ", ".join(f"{k}={stats.get(k, 0)}" for k in ("created", "updated", "removed", "legacy_removed"))
        )
