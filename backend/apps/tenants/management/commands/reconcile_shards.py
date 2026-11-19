"""Compare the control database with the civilization shards; with --fix, make them equal (stage 2 of
docs/audit/2026-11-15-sharding/PLAN.md). Sync is this command with --fix.

    manage.py reconcile_shards --all [--retry-window 30]
    manage.py reconcile_shards --civ GREEK --fix [--direction control-to-shard | shard-to-control]

Which rows a shard holds and how they are compared: apps/core/shard_sync.py. Prints one line per row that
differs (model, pk, which side lacks or disagrees), exits 1 when any is left -- with --fix, rows
still differing when it re-checks after the fix -- and on an integer-id range problem (apps/core/shard_ids.py: an
id of another civilization's range on a shard, a write-cut shard's sequence outside its range, control's
PostgreSQL sequences at or above 1e15). No shard alias configured: says so and exits 0.
`--direction shard-to-control --fix` is refused for a civilization not in SHARD_WRITE_CIVS. A civilization in
SHARD_PURGED_CIVS (stage 5) compares no SHARD row shard-to-control (`shard_sync._sides`).
`--assert-control-empty` (stage 5, after the purge) also exits 1 while control holds any row of the civilization's
purge plan (`shard_sync.purge_plan`: its halls' SHARD rows, not D2, not the control-mastered models).
"""
from django.core.management.base import BaseCommand, CommandError

from apps.core.shard_sync import CONTROL_TO_SHARD, SHARD_TO_CONTROL, reconcile, shard_aliases


class Command(BaseCommand):
    help = "Compare control with the civilization shards (full-row digests); --fix makes the target side equal."

    def add_arguments(self, parser):
        which = parser.add_mutually_exclusive_group(required=True)
        which.add_argument("--civ", help="One civilization, e.g. GREEK")
        which.add_argument("--all", action="store_true", help="Every configured shard")
        parser.add_argument("--retry-window", type=float, default=0,
                            help="Seconds to keep re-checking differing rows before reporting them (in-flight writes)")
        parser.add_argument("--fix", action="store_true", help="Repair the differences found")
        parser.add_argument("--direction", choices=[CONTROL_TO_SHARD, SHARD_TO_CONTROL], default=CONTROL_TO_SHARD,
                            help="Which side is the source of truth (default control-to-shard)")
        parser.add_argument("--assert-control-empty", action="store_true",
                            help="Stage 5: also fail while control holds any row of the civilization's purge plan "
                                 "(its halls' SHARD rows; not D2, not the control-mastered models)")

    def handle(self, *args, civ, retry_window, fix, direction, assert_control_empty=False, **options):
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
        if fix and direction == SHARD_TO_CONTROL:
            # Until a civilization's writes are cut over (stage 4) control is its master: copying the shard
            # back would revert control's newer writes and raw-delete its new rows (VERIFY-stage2 item 2).
            from django.conf import settings

            from apps.core.shard_sync import civilization_of

            early = sorted(civilization_of(a) for a in shards if civilization_of(a) not in settings.SHARD_WRITE_CIVS)
            if early:
                raise CommandError(f"--direction {SHARD_TO_CONTROL} --fix refused for {early}: not in SHARD_WRITE_CIVS "
                                   f"{list(settings.SHARD_WRITE_CIVS)}, so control is still the master of their rows")
        report = reconcile(shards, fix=fix, direction=direction, retry_window=retry_window)
        for alias, diffs in report.items():
            src, dst = ("control", alias) if direction == CONTROL_TO_SHARD else (alias, "default")
            for d in diffs:
                self.stdout.write(d.line(src, dst))
            self.stdout.write(f"{alias}: {len(diffs)} row(s) differ" + (", fixed" if fix and diffs else ""))
        if fix:
            report = reconcile(shards, direction=direction, retry_window=retry_window)
            for d in (d for diffs in report.values() for d in diffs):
                self.stdout.write("still " + d.line(*(("control", d.alias) if direction == CONTROL_TO_SHARD
                                                      else (d.alias, "default"))).strip())
        left = sum(map(len, report.values()))
        # Stage 4 (gap 4a): integer ids of the compared shards in their civilization's range, control's below it.
        from apps.core.shard_ids import problems

        ranges = [p for alias in ["default", *shards] for p in problems(alias)]
        for p in ranges:
            self.stdout.write(f"  id range: {p}")
        left_on_control = 0
        if assert_control_empty:  # G2, PREP-stage5 §4 step 9: what a purge deletes is gone from control
            from apps.core.shard_sync import civilization_of, purge_plan

            for alias in shards:
                for model, qs in sorted(purge_plan(civilization_of(alias)).items(), key=lambda kv: kv[0]._meta.label):
                    n = qs.count()
                    left_on_control += n
                    if n:
                        self.stdout.write(f"  control still holds {model._meta.label} {n} row(s) of {alias}")
            self.stdout.write(f"control holds {left_on_control} purgeable row(s) of {', '.join(shards)}")
        if left_on_control:
            raise CommandError(f"control still holds {left_on_control} row(s) a purge deletes")
        if left:
            raise CommandError(f"{left} row(s) differ" + (" after the fix" if fix else ""))
        if ranges:
            raise CommandError(f"{len(ranges)} id range problem(s)")
