"""Write this month's balance snapshot for every active tenant, now.

The same work `ledger.snapshot_balance_for_tenant` does on its daily schedule;
for a box where beat is not running yet, or to start the history today. There
is no backfill of earlier months — see apps.ledger.models.BalanceSnapshot.
"""
from django.core.management.base import BaseCommand

from apps.ledger.snapshots import snapshot_tenant
from apps.tenants.models import Tenant


class Command(BaseCommand):
    help = "Write this month's balance snapshot for every active tenant"

    def handle(self, *args, **options):
        tenants = Tenant.objects.filter(is_active=True).order_by("code")
        for tenant in tenants:
            row = snapshot_tenant(tenant)
            self.stdout.write(
                f"{tenant.code} {row.month:%Y-%m}: {row.soul_count} souls, total {row.balance_total}"
            )
        self.stdout.write(f"snapshots written: {len(tenants)}")
