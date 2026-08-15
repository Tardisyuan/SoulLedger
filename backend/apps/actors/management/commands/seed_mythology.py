"""
Idempotent seeder for the three civilizations' mythology reference data.

Why this exists
---------------
Every Realm and Actor in this system — the Ten Courts of Diyu, Dante's nine
circles, the Hall of Two Truths — used to live only in
``backend/scripts/seed_chinese_data.py``, a standalone script somebody had to
remember to run by hand. No fixtures directory, no data migration carries any
of it: the per-app data migrations are all RBAC and menu rows. A fresh clone
therefore came up with an empty cosmology, and so did CI. Anything that
depends on this data existing (judgment routing, realm pickers, cross-tenant
dispatch) had nothing to stand on.

This command is that script turned into a re-runnable entry point, plus the
tenant assignment the script declared helpers for but never actually called.

Design notes
------------
* **Match keys.** Realms match on ``realm_code`` (unique, stable). Actors have
  no code column, so they match on ``(civilization, name)`` — the same pair the
  ``unique_actor_tenant_civ_name`` constraint uses, minus the tenant (which
  this command is the thing that fills in). Names are never used to *infer* a
  civilization here: each table in ``apps.actors.mythology`` states its
  civilization explicitly.
  Keyword-sniffing an actor's name is what mis-tagged Ma'at, Pluto and Lethe as
  CHINESE and spawned the duplicate rows ``fix_actor_civilization`` exists to
  clean up.

* **Create-only by default.** Two sibling commands deliberately edit these
  same rows after seeding — ``fix_actor_civilization`` (civilization repairs +
  dedupe, Ma'at/Maat spelling merge) and ``consolidate_eu_pantheon``
  (Pluto/Hades merge, opt-in Norse purge). If seeding overwrote existing rows
  every run, the seeder and those commands would take turns undoing each
  other. So the default is get_or_create semantics; pass ``--update`` when you
  explicitly want the seed values to win.

* **Soft-deleted rows are left alone.** A row that was soft-deleted (e.g. Pluto,
  merged into Hades) is reported and skipped, never resurrected and never
  duplicated — re-creating it would collide with the unique constraint anyway,
  since that constraint does not exclude deleted rows.

Where the tables live
---------------------
This module is the entry point Django discovers and the argument parsing; the
write path is ``apps.actors.mythology.seeding.MythologySeeder``, mixed into
``Command`` below, and every row either of them writes is a literal in
``apps.actors.mythology``. That package's ``__init__`` carries the provenance
contract for the three statute corpora — which one is transcribed, which is a
pointer at rows seeded here, and why a fourth is empty. Read it before adding
to any of them.

Usage::

    python manage.py seed_mythology                        # all three, create missing
    python manage.py seed_mythology --civilization=chinese  # one civilization
    python manage.py seed_mythology --dry-run               # print the plan, write nothing
    python manage.py seed_mythology --update                # also refresh existing rows
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.actors.mythology import (
    CIVILIZATION_ACTOR_ALIASES,
    CIVILIZATION_ASSESSORS,
    CIVILIZATION_DATA,
    CIVILIZATION_STATUTES,
)
from apps.actors.mythology.seeding import MythologySeeder, Stats

# Re-exported: `Stats` and `CIVILIZATION_STATUTES` are imported from this
# module by tests/test_judgment_statutes.py, and this module stays the name
# the rest of the repo refers to.
__all__ = [
    "CIVILIZATION_ACTOR_ALIASES",
    "CIVILIZATION_ASSESSORS",
    "CIVILIZATION_DATA",
    "CIVILIZATION_STATUTES",
    "Command",
    "Stats",
]


class Command(MythologySeeder, BaseCommand):
    help = (
        "Seed the three civilizations' mythology reference data (tenants, realms, "
        "actors). Idempotent: re-running creates nothing new."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--civilization",
            choices=[*CIVILIZATION_DATA, "all"],
            default="all",
            help="Seed only one civilization. Default: all three.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be created/updated and write nothing.",
        )
        parser.add_argument(
            "--update",
            action="store_true",
            help=(
                "Also refresh existing rows to the seed values. Off by default so "
                "this command does not undo fix_actor_civilization / "
                "consolidate_eu_pantheon."
            ),
        )

    def handle(self, *args, **options):
        selection = options["civilization"]
        dry_run = options["dry_run"]
        do_update = options["update"]

        labels = list(CIVILIZATION_DATA) if selection == "all" else [selection]
        mode = "DRY-RUN" if dry_run else "WRITE"
        self.stdout.write(self.style.WARNING(
            f"=== seed_mythology ({mode}, civilizations={','.join(labels)}, "
            f"update={'on' if do_update else 'off'}) ===\n"
        ))

        tenant_stats = Stats("tenants")
        realm_stats = Stats("realms")
        actor_stats = Stats("actors")
        statute_stats = Stats("statutes")

        with transaction.atomic():
            for label in labels:
                civilization, realms, actors = CIVILIZATION_DATA[label]
                self.stdout.write(self.style.MIGRATE_HEADING(f"[{label}] {civilization}"))

                tenant = self._seed_tenant(civilization, tenant_stats)
                self._seed_realms(civilization, tenant, realms, do_update, realm_stats)
                self._seed_actors(
                    civilization, tenant, actors, do_update, actor_stats,
                    aliases=CIVILIZATION_ACTOR_ALIASES.get(label),
                )
                assessors = CIVILIZATION_ASSESSORS.get(label)
                if assessors:
                    self._seed_assessors(
                        civilization, tenant, assessors, do_update, actor_stats
                    )
                # Statutes come last within a civilization: the Egyptian corpus
                # is derived from the assessor rows written immediately above,
                # and reads them back out of this same transaction.
                corpus = CIVILIZATION_STATUTES.get(label)
                if corpus is not None:
                    self._seed_statutes(
                        civilization, tenant, *corpus, do_update, statute_stats
                    )
                if assessors:
                    self._seed_derived_statutes(
                        civilization, tenant, do_update, statute_stats
                    )
                self.stdout.write("")

            if dry_run:
                transaction.set_rollback(True)

        self.stdout.write(self.style.MIGRATE_HEADING("Summary"))
        for stats in (tenant_stats, realm_stats, actor_stats, statute_stats):
            self.stdout.write(f"  {stats.line()}")

        if dry_run:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                "Dry-run only — nothing was written. Re-run without --dry-run to apply."
            ))
        else:
            self.stdout.write(self.style.SUCCESS("\nSeed complete."))
