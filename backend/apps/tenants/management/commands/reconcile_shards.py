"""Compare the control database with the civilization shards; with --fix, make them equal (control-to-shard; the
`sharding.sync_shards` task is this command with --fix).

    manage.py reconcile_shards --all [--retry-window 30] [--assert-control-empty]
    manage.py reconcile_shards --civ GREEK --fix

Which rows a shard holds and how they are compared: apps/core/shard_sync.py. Prints one line per row that
differs (model, pk, which side lacks or disagrees), exits 1 when any is left -- with --fix, rows
still differing when it re-checks after the fix -- and on an integer-id range problem (apps/core/shard_ids.py: an
id of another civilization's range on a shard, a shard's sequence outside its range, control's
PostgreSQL sequences at or above 1e15). No shard alias configured: says so and exits 0.
`--assert-control-empty` also exits 1 while control holds any SHARD row of a civilization's halls
(`shard_sync.purge_plan`: not D2, not the control-mastered models) -- sharded, control holds none.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.core.shard_sync import reconcile, shard_aliases


class Command(BaseCommand):
    help = "Compare control with the civilization shards (full-row digests); --fix makes the target side equal."

    def add_arguments(self, parser):
        which = parser.add_mutually_exclusive_group(required=True)
        which.add_argument("--civ", help="One civilization, e.g. GREEK")
        which.add_argument("--all", action="store_true", help="Every configured shard")
        parser.add_argument("--retry-window", type=float, default=0,
                            help="Seconds to keep re-checking differing rows before reporting them (in-flight writes)")
        parser.add_argument("--fix", action="store_true", help="Repair the differences found")
        parser.add_argument("--assert-control-empty", action="store_true",
                            help="Also fail while control holds any SHARD row of the civilization's halls "
                                 "(not D2, not the control-mastered models): sharded, it holds none")

    def handle(self, *args, civ, retry_window, fix, assert_control_empty=False, **options):
        shards = shard_aliases()
        if not shards:
            self.stdout.write("no shard database is configured (no civ_* alias in DATABASES): nothing to compare")
            return
        if civ:
            from apps.core.sharding import alias_for_civilization

            try:
                alias = alias_for_civilization(civ.upper())
            except ValueError:
                raise CommandError(f"unknown civilization {civ!r}") from None
            if alias not in shards:
                raise CommandError(f"no shard database {alias!r} is configured; configured: {shards}")
            shards = [alias]
        report = reconcile(shards, fix=fix, retry_window=retry_window)
        for alias, diffs in report.items():
            for d in diffs:
                self.stdout.write(d.line("control", alias))
            self.stdout.write(f"{alias}: {len(diffs)} row(s) differ" + (", fixed" if fix and diffs else ""))
        if fix:
            report = reconcile(shards, retry_window=retry_window)
            for d in (d for diffs in report.values() for d in diffs):
                self.stdout.write("still " + d.line("control", d.alias).strip())
        left = sum(map(len, report.values()))
        # Stage 4 (gap 4a): integer ids of the compared shards in their civilization's range, control's below it.
        from apps.core.shard_ids import problems

        ranges = [p for alias in ["default", *shards] for p in problems(alias)]
        for p in ranges:
            self.stdout.write(f"  id range: {p}")
        left_on_control = 0
        if assert_control_empty:  # G2: sharded, control holds none of these rows
            from apps.core.shard_sync import civilization_of, purge_plan

            for alias in shards:
                for model, qs in sorted(purge_plan(civilization_of(alias)).items(), key=lambda kv: kv[0]._meta.label):
                    n = qs.count()
                    left_on_control += n
                    if n:
                        self.stdout.write(f"  control still holds {model._meta.label} {n} row(s) of {alias}")
            self.stdout.write(f"control holds {left_on_control} purgeable row(s) of {', '.join(shards)}")
        if left_on_control:
            raise CommandError(f"control still holds {left_on_control} row(s) only a shard may hold")
        if left:
            raise CommandError(f"{left} row(s) differ" + (" after the fix" if fix else ""))
        if ranges:
            raise CommandError(f"{len(ranges)} id range problem(s)")
