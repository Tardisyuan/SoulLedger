"""Write the first path station for souls that died before death wrote one.

    manage.py backfill_soul_entry_path --dry-run   # counts per civilization, writes nothing
    manage.py backfill_soul_entry_path

For every live (not soft-deleted), not-ALIVE soul with a recorded death date
and **no** `SoulPathEntry` at all: one entry at its civilization's entry realm
(`apps.realms.path.ENTRY_REALM_CODES`) in the soul's own tenant, `entered_at` =
the death date at 00:00 UTC, `left_at` NULL. A later judgment or disposition
does not close it: when the soul left is not known, so it is not invented.

Idempotent: a soul that has any entry is skipped, so a second run writes 0.

Skipped and counted, per civilization:
* has_path          — already has at least one entry (includes the second run);
* alive             — ALIVE: not dead in this life (rebirth clears the death date);
* no_death_date     — `death_year` is NULL;
* undatable         — BCE or missing month/day: `DateTimeField` cannot hold it
                      and a day is not invented;
* no_entry_realm    — the soul's tenant has no live entry realm for its civilization.
"""
import datetime
from collections import Counter, defaultdict

from django.core.management.base import BaseCommand

from apps.realms.models import SoulPathEntry
from apps.realms.path import entry_realm_for
from apps.souls.dates import to_legacy_date
from apps.souls.models import Soul, SoulState

OUTCOMES = ("created", "has_path", "alive", "no_death_date", "undatable", "no_entry_realm")


def backfill(*, dry_run=False):
    """Returns {civilization: Counter(outcome -> n)}."""
    counts = defaultdict(Counter)
    souls = Soul.all_objects.filter(is_deleted=False).select_related("tenant").order_by("pk")
    realms = {}
    for soul in souls.iterator():
        civ = soul.civilization
        # The idempotency guard. A death recorded between this check and the
        # insert below writes its own sequence-1 row, and the insert then hits
        # `soulpath_unique_sequence` instead of writing a second first station.
        if SoulPathEntry.all_objects.filter(soul_id=soul.pk).exists():
            counts[civ]["has_path"] += 1
            continue
        if soul.current_state == SoulState.ALIVE:
            counts[civ]["alive"] += 1
            continue
        if soul.death_year is None:
            counts[civ]["no_death_date"] += 1
            continue
        died = to_legacy_date(soul.death_year, soul.death_month, soul.death_day)
        if died is None:
            counts[civ]["undatable"] += 1
            continue
        key = (soul.tenant_id, civ)
        if key not in realms:
            realms[key] = entry_realm_for(soul)
        realm = realms[key]
        if realm is None:
            counts[civ]["no_entry_realm"] += 1
            continue
        counts[civ]["created"] += 1
        if dry_run:
            continue
        SoulPathEntry.all_objects.create(
            soul_id=soul.pk,
            realm=realm,
            sequence=1,
            entered_at=datetime.datetime.combine(died, datetime.time.min, tzinfo=datetime.UTC),
            tenant_id=soul.tenant_id,
        )
    return counts


class Command(BaseCommand):
    help = "Write the entry-realm first path station for souls that died before death wrote one"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Count per civilization; write nothing")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        counts = backfill(dry_run=dry_run)
        total = Counter()
        for civ in sorted(counts):
            total.update(counts[civ])
            self.stdout.write(f"{civ}: " + " ".join(f"{o}={counts[civ][o]}" for o in OUTCOMES))
        self.stdout.write(("DRY RUN (nothing written) " if dry_run else "") + "total: "
                          + " ".join(f"{o}={total[o]}" for o in OUTCOMES))
