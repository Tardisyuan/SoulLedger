"""Compare the control registry of global codes with the rows on every database (sharding stage 4,
apps/tenants/global_codes.py).

    manage.py check_global_codes

Prints one line per problem -- a row whose code was never claimed, or one code held by two different rows
across the databases -- and exits 1 when there is any. Claims no row holds (gaps a failed shard write left)
are listed and do not fail the check. With no shard configured it checks the control database alone.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.core.shard_reads import CONTROL_ALIAS
from apps.core.shard_sync import shard_aliases
from apps.tenants.global_codes import check


class Command(BaseCommand):
    help = "Registry of global codes (soul_code, organization code) against the rows on every database."

    def handle(self, *args, **options):
        aliases = [CONTROL_ALIAS, *shard_aliases()]
        report = check(aliases)
        failed = 0
        for kind, (problems, unused) in report.items():
            for line in problems:
                self.stdout.write(line)
            for value in unused:
                self.stdout.write(f"{kind} {value!r}: claimed, no row holds it (a gap; allowed)")
            self.stdout.write(f"{kind}: {len(problems)} problem(s), {len(unused)} unused claim(s) on {aliases}")
            failed += len(problems)
        if failed:
            raise CommandError(f"{failed} global code problem(s)")
