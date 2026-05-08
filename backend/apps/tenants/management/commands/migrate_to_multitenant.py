"""
Data migration command to backfill tenant FK on all business model rows.

Maps civilization → tenant:
  CHINESE  → CN_DIYU
  EUROPEAN → EU_HEAVEN_HELL
  EGYPTIAN → EG_DUAT

Also backfills all null-tenant rows to CN_DIYU for all models.

Usage:
  python manage.py migrate_to_multitenant           # execute
  python manage.py migrate_to_multitenant --dry-run  # preview only
"""
import sys
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.tenants.models import Tenant
from apps.souls.models import Soul, Civilization, SoulState
from apps.realms.models import Realm
from apps.actors.models import Actor
from apps.judgment.models import Judgment
from apps.disposition.models import Disposition
from apps.reincarnation.models import Reincarnation
from apps.events.models import SoulEvent
from apps.authentication.models import User

# Mapping from civilization code → tenant code
CIV_TO_TENANT = {
    Civilization.CHINESE: "CN_DIYU",
    Civilization.EUROPEAN: "EU_HEAVEN_HELL",
    Civilization.EGYPTIAN: "EG_DUAT",
}


class Command(BaseCommand):
    help = "Backfill tenant FK on all business models (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview changes without committing.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        if dry_run:
            self.stdout.write(self.style.WARNING("=== DRY RUN — no changes will be committed ===\n"))

        # Ensure tenants exist
        tenants = {
            "CN_DIYU": Tenant.objects.get_or_create(
                code="CN_DIYU", defaults={"display_name": "Chinese Afterlife"}
            )[0],
            "EU_HEAVEN_HELL": Tenant.objects.get_or_create(
                code="EU_HEAVEN_HELL", defaults={"display_name": "European Afterlife"}
            )[0],
            "EG_DUAT": Tenant.objects.get_or_create(
                code="EG_DUAT", defaults={"display_name": "Egyptian Afterlife"}
            )[0],
        }
        cn_tenant = tenants["CN_DIYU"]

        models_with_civ = [
            (Soul, "Soul", "civilization"),
            (Realm, "Realm", "civilization"),
            (Actor, "Actor", "civilization"),
            (Judgment, "Judgment", "civilization"),
        ]
        # Models without civilization field — backfill null rows to CN_DIYU
        models_no_civ = [
            (Disposition, "Disposition"),
            (Reincarnation, "Reincarnation"),
            (SoulEvent, "SoulEvent"),
            (User, "User"),
        ]

        total_updates = {}
        total_null_backfill = {}

        # ---- Phase 1: Models WITH civilization ----
        for model_cls, label, civ_field in models_with_civ:
            before = model_cls.objects.count()
            null_before = model_cls.objects.filter(tenant__isnull=True).count()
            updates_planned = 0

            for civ_val, tenant_code in CIV_TO_TENANT.items():
                t = tenants[tenant_code]
                qs = model_cls.objects.filter(**{civ_field: civ_val}, tenant__isnull=True)
                updates_planned += qs.count()
                if not dry_run:
                    qs.update(tenant=t)

            total_updates[label] = updates_planned
            after = model_cls.objects.count() if dry_run else model_cls.objects.count()
            null_after = 0 if not dry_run else model_cls.objects.filter(tenant__isnull=True).count()

            self.stdout.write(
                f"  {label:20s} | before={before:4d}  null={null_before:3d}  "
                f"updates={updates_planned:3d}  | after={after:4d}  null={null_after:3d}"
            )

        # ---- Phase 2: Models WITHOUT civilization — backfill null to CN_DIYU ----
        for model_cls, label in models_no_civ:
            before = model_cls.objects.count()
            null_before = model_cls.objects.filter(tenant__isnull=True).count()

            if not dry_run:
                model_cls.objects.filter(tenant__isnull=True).update(tenant=cn_tenant)

            total_null_backfill[label] = null_before
            after = model_cls.objects.count() if dry_run else model_cls.objects.count()
            null_after = 0 if not dry_run else null_before

            self.stdout.write(
                f"  {label:20s} | before={before:4d}  null={null_before:3d}  "
                f"backfill={null_before:3d}  | after={after:4d}  null={null_after:3d}"
            )

        # ---- Summary ----
        total_by_civ = sum(total_updates.values())
        total_null = sum(total_null_backfill.values())
        self.stdout.write(
            self.style.SUCCESS(
                f"\n{'[DRY RUN] ' if dry_run else ''}"
                f"Total by-civilization updates: {total_by_civ}  "
                f"Total null-backfill: {total_null}  "
                f"Grand total: {total_by_civ + total_null}"
            )
        )

        if dry_run:
            self.stdout.write(self.style.WARNING("Run without --dry-run to apply changes."))
