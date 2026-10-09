"""One command for what must happen after every deploy. Idempotent.

1. refuse if a migration is unapplied (run `migrate` first);
2. `setup_scheduled_tasks` (registry x active tenants -> beat rows);
3. `snapshot_balances`, unless every active tenant already has a balance
   snapshot computed today;
4. print a summary, with WARN lines for the env-dependent features that are off.

`--dry-run` changes nothing: step 2 runs inside a transaction that is rolled
back (so the counts are the real ones) and step 3 is only announced.
"""
import io

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.models import Count
from django.utils import timezone


class _RollbackError(Exception):
    pass


class Command(BaseCommand):
    help = "Post-deploy: check migrations, register scheduled tasks, first balance snapshot, summary"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Change nothing; print what would be done")

    def handle(self, *args, **options):
        from apps.ledger.models import BalanceSnapshot
        from apps.scheduler import beat_guard
        from apps.scheduler.models import ScheduledJob
        from apps.scheduler.services import _active_tenants

        dry = options["dry_run"]
        say = self.stdout.write
        warn = lambda msg: say(self.style.WARNING(f"WARN {msg}"))  # noqa: E731

        executor = MigrationExecutor(connection)
        pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
        if pending:
            names = ", ".join(f"{m.app_label}.{m.name}" for m, _ in pending[:10])
            raise CommandError(
                f"{len(pending)} unapplied migration(s) ({names}{', ...' if len(pending) > 10 else ''}). "
                "Run `manage.py migrate` first; nothing was changed."
            )
        say("migrations: all applied")

        # -- (b) schedules. Dry run: do the real work, count, roll back.
        counts: dict = {}

        def sync_and_count():
            call_command("setup_scheduled_tasks", stdout=self.stdout)
            counts["per_tenant"] = dict(
                ScheduledJob.objects.filter(tenant_id__isnull=False)
                .values_list("tenant__code").annotate(n=Count("id")).order_by("tenant__code")
            )
            counts["global"] = ScheduledJob.objects.filter(tenant_id__isnull=True).count()

        if dry:
            try:
                with transaction.atomic():
                    sync_and_count()
                    raise _RollbackError
            except _RollbackError:
                say("dry-run: scheduled task changes above were rolled back")
        else:
            sync_and_count()

        # -- (c) snapshot only if some active tenant has none computed today
        today = timezone.now().date()
        tenants = _active_tenants()
        done = set(
            BalanceSnapshot.objects.filter(computed_at__date=today).values_list("tenant_id", flat=True)
        )
        missing = [t.code for t in tenants if t.pk not in done]
        if not missing:
            say("snapshot_balances: already written today, skipped")
        elif dry:
            say(f"dry-run: would run snapshot_balances ({len(missing)} tenant(s) without a snapshot today)")
        else:
            call_command("snapshot_balances", stdout=io.StringIO())
            say(f"snapshot_balances: written for {len(tenants)} tenant(s)")

        # -- (d) summary
        say("scheduled tasks per tenant" + (" (as they would be)" if dry else "") + ":")
        for code, n in counts["per_tenant"].items():
            say(f"  {code}: {n}")
        say(f"  (global): {counts['global']}")
        if getattr(settings, "CELERY_BEAT_SCHEDULER", "").endswith("DatabaseScheduler"):
            holder = beat_guard.holder()
            say(f"beat: DatabaseScheduler configured; {'running as ' + str(holder) if holder else 'no running beat seen yet'}")
            if not holder:
                warn("no celery beat is holding the beat lock; scheduled tasks will not fire until it starts")
        else:
            warn("CELERY_BEAT_SCHEDULER is not DatabaseScheduler; the rows above will never fire")
        if not getattr(settings, "SENTRY_DSN", ""):
            warn("SENTRY_DSN is empty: no error tracking, no cron monitors")
        if not getattr(settings, "MATRIX_ENABLED", False):
            warn("MATRIX_ENABLED is off: /me/chat/ answers 503")
        backend = getattr(settings, "EMAIL_BACKEND", "")
        if any(k in backend for k in ("console", "dummy", "locmem", "filebased")):
            warn(f"EMAIL_BACKEND is {backend}: mail is not delivered")
        elif not getattr(settings, "EMAIL_HOST", "") or settings.EMAIL_HOST == "localhost":
            warn("EMAIL_HOST is unset/localhost: SMTP mail will not leave the box")
