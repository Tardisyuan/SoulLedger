"""
Management command to seed the four tenant records.
Idempotent — uses get_or_create so it's safe to run multiple times.
"""
from django.core.management.base import BaseCommand

from apps.tenants.models import Tenant


class Command(BaseCommand):
    help = (
        "Seed the four multi-tenant records: CN_DIYU, EU_HEAVEN_HELL, EG_DUAT, "
        "GR_HADES"
    )

    def handle(self, *args, **options):
        tenants = [
            {
                "code": "CN_DIYU",
                "display_name": "Chinese Afterlife",
                "hall_name": "第五殿", "hall_name_en": "The Fifth Court", "hall_name_egy": "Yanluo Qedi",
                "description": "中国地府 — 十殿阎王、十八层地狱、第一层天界",
                "dispatch_enabled": True,
            },
            {
                "code": "EU_HEAVEN_HELL",
                "display_name": "European Afterlife",
                "hall_name": "炼狱", "hall_name_en": "Purgatory", "hall_name_egy": "Ta Hesmen",
                "description": "European Heaven, Purgatory, and Hell — 9 circles of Hell, 7 terraces of Purgatory, 9 spheres of Heaven",
                "dispatch_enabled": True,
            },
            {
                "code": "EG_DUAT",
                "display_name": "Egyptian Afterlife",
                "hall_name": "真理殿堂", "hall_name_en": "Hall of Two Truths", "hall_name_egy": "Weret Maaty",
                "description": "Egyptian Duat — Field of Reeds (Aaru), Hall of Two Truths, Lake of Fire",
                "dispatch_enabled": True,
            },
            {
                "code": "GR_HADES",
                "display_name": "Greek Afterlife",
                # 殿司展示名的取法见 tenants/0012(同一组值)。
                "hall_name": "岔路草原", "hall_name_en": "The Meadow at the Parting of the Ways",
                "hall_name_egy": "Wat Wedja",
                "description": (
                    "Greek underworld — the meadow at the parting of the ways, "
                    "the Isles of the Blessed and Tartarus (Plato, Gorgias 524a)"
                ),
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
                    **{k: t[k] for k in ("hall_name", "hall_name_en", "hall_name_egy")},
                },
            )
            if was_created:
                created += 1
                self.stdout.write(self.style.SUCCESS(f"✓ Created tenant: {obj.code}"))
            else:
                self.stdout.write(f"  Tenant already exists: {obj.code}")

        self.stdout.write(self.style.SUCCESS(f"\n{created} new tenant(s) created."))
