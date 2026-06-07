"""
Management command to seed the three tenant records.
Idempotent — uses get_or_create so it's safe to run multiple times.
"""
from django.core.management.base import BaseCommand

from apps.tenants.models import Tenant


class Command(BaseCommand):
    help = "Seed the three multi-tenant records: CN_DIYU, EU_HEAVEN_HELL, EG_DUAT"

    def handle(self, *args, **options):
        tenants = [
            {
                "code": "CN_DIYU",
                "display_name": "Chinese Afterlife",
                "description": "中国地府 — 十殿阎王、十八层地狱、第一层天界",
                "dispatch_enabled": True,
            },
            {
                "code": "EU_HEAVEN_HELL",
                "display_name": "European Afterlife",
                "description": "European Heaven, Purgatory, and Hell — 9 circles of Hell, 7 terraces of Purgatory, 9 spheres of Heaven",
                "dispatch_enabled": True,
            },
            {
                "code": "EG_DUAT",
                "display_name": "Egyptian Afterlife",
                "description": "Egyptian Duat — Field of Reeds (Aaru), Hall of Two Truths, Lake of Fire",
                "dispatch_enabled": True,
            },
        ]

        created = 0
        for t in tenants:
            obj, was_created = Tenant.objects.get_or_create(
                code=t["code"],
                defaults={
                    "display_name": t["display_name"],
                    "description": t["description"],
                    "dispatch_enabled": t["dispatch_enabled"],
                },
            )
            if was_created:
                created += 1
                self.stdout.write(self.style.SUCCESS(f"✓ Created tenant: {obj.code}"))
            else:
                self.stdout.write(f"  Tenant already exists: {obj.code}")

        self.stdout.write(self.style.SUCCESS(f"\n{created} new tenant(s) created."))
