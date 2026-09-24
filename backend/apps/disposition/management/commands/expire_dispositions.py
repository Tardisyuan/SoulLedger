"""Run the disposition expiry check now, without celery.

    manage.py expire_dispositions                # every active tenant
    manage.py expire_dispositions --tenant CN_DIYU

Calls the same per-tenant task body beat would run (in-process, so no worker
and no broker are needed — celery beat is not deployed yet), one tenant at a
time, each under its own tenant contextvar. Idempotent: a second run marks
nothing new.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.disposition.tasks import expire_due_dispositions_for_tenant
from apps.tenants.models import Tenant


class Command(BaseCommand):
    help = "Mark dispositions whose term has ended as expired (the daily disposition.expire_due_for_tenant job, run now)"

    def add_arguments(self, parser):
        parser.add_argument("--tenant", help="Tenant code; default is every active tenant")

    def handle(self, *args, **options):
        tenants = Tenant.objects.filter(is_active=True).order_by("code")
        if options["tenant"]:
            tenants = tenants.filter(code=options["tenant"])
            if not tenants.exists():
                raise CommandError(f"no active tenant with code {options['tenant']!r}")
        total = 0
        for tenant in tenants:
            result = expire_due_dispositions_for_tenant(tenant_id=str(tenant.pk))
            total += result["expired"]
            self.stdout.write(f"{tenant.code}: expired={result['expired']}")
        self.stdout.write(f"total expired={total}")
