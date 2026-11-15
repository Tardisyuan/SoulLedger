"""Compare the control database with the civilization shards; with --fix, make them equal (stage 2 of
docs/audit/2026-11-15-sharding/PLAN.md). Sync is this command with --fix.

    manage.py reconcile_shards --all [--retry-window 30]
    manage.py reconcile_shards --civ GREEK --fix [--direction control-to-shard | shard-to-control]

Which rows a shard holds and how they are compared: apps/core/shard_sync.py. Prints one line per row that
differs (model, pk, which side lacks or disagrees), exits 1 when any is left -- with --fix, rows
still differing when it re-checks after the fix. No shard alias configured: says so and exits 0.
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

    def handle(self, *args, civ, retry_window, fix, direction, **options):
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
        if left:
            raise CommandError(f"{left} row(s) differ" + (" after the fix" if fix else ""))
