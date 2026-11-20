"""Move each civilization shard's integer-id sequences into its range (stage 4 gap 4a; apps/core/shard_ids.py).
Run once on every new shard before the process runs sharded (the first write to a shard refuses otherwise).

    manage.py assign_shard_id_ranges --civ GREEK
    manage.py assign_shard_id_ranges --all [--check]

Idempotent: a sequence already in its range stays. Refuses (exit 1, nothing changed on that shard) when the shard
holds an id of another civilization's range. `--check` changes nothing and exits 1 on any problem, control included.
"""
from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError

from apps.core import shard_ids
from apps.core.shard_sync import civilization_of, shard_aliases


class Command(BaseCommand):
    help = "Assign each civilization shard its own integer-id range (CHINESE 1e15, EUROPEAN 2e15, EGYPTIAN 3e15, GREEK 4e15)."

    def add_arguments(self, parser):
        which = parser.add_mutually_exclusive_group(required=True)
        which.add_argument("--civ", help="One civilization, e.g. GREEK")
        which.add_argument("--all", action="store_true", help="Every configured shard")
        parser.add_argument("--check", action="store_true", help="Report problems only; change nothing")

    def handle(self, *args, civ, check, **options):
        shards = shard_aliases()
        if civ:
            shards = [a for a in shards if civilization_of(a) == civ.upper()]
            if not shards:
                raise CommandError(f"no shard database is configured for {civ!r}; configured: {shard_aliases()}")
        if check:
            found = [p for alias in ["default", *shards] for p in shard_ids.problems(alias, written=[
                civilization_of(a) for a in shards])]
            for p in found:
                self.stdout.write(p)
            if found:
                raise CommandError(f"{len(found)} id range problem(s)")
            self.stdout.write("id ranges: ok")
            return
        for alias in shards:
            try:
                assigned = shard_ids.assign(alias)
            except ImproperlyConfigured as e:
                raise CommandError(str(e)) from None
            low, high = shard_ids.id_range(civilization_of(alias))
            self.stdout.write(f"{alias}: {len(assigned)} sequence(s) in [{low}, {high})")
