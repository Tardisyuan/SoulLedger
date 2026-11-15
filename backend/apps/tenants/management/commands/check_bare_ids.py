"""List bare ids (stage 1B, D3) that name no row of their target in the control database.

    manage.py check_bare_ids

Run it before reversing the 1B migrations: putting a foreign-key constraint back fails on the first
orphan. Looks on every alias `apps.core.sharding.fanout()` names. Exits 1 when it finds any.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.core.bare_ids import orphans
from apps.core.sharding import fanout


class Command(BaseCommand):
    help = "List bare ids that name no row of their target (run before reversing stage 1B)."

    def handle(self, *args, **options):
        found = orphans(fanout())
        for edge, alias, n in found:
            self.stdout.write(f"{edge} on {alias}: {n} orphan id(s)")
        if found:
            raise CommandError(f"{len(found)} bare id column(s) hold orphans")
        self.stdout.write("no orphan bare ids")
