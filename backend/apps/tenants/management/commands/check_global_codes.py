"""Compare the control registry of global codes with the rows on every database (sharding stage 4,
apps/tenants/global_codes.py).

    manage.py check_global_codes
    manage.py check_global_codes --clear-unknown-claims

Prints one line per problem -- a row whose code was never claimed, or one code held by two different rows
across the databases -- and exits 1 when there is any. Claims no row holds (gaps a failed shard write left)
are listed and do not fail the check. With no shard configured it checks the control database alone.

It also lists the open-case claims whose writer cannot be known (`global_codes.unknown_claims`: no transaction id
in `case_txn`), which nothing takes over on its own. `--clear-unknown-claims` deletes the ones whose case is not open
on any database (closed, or never written: its transaction rolled back); a claim whose case is open stays.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.core.shard_reads import CONTROL_ALIAS
from apps.core.shard_sync import shard_aliases
from apps.tenants.global_codes import check, unknown_claims


class Command(BaseCommand):
    help = "Registry of global codes (soul_code, organization code) against the rows on every database."

    def add_arguments(self, parser):
        parser.add_argument("--clear-unknown-claims", action="store_true",
                            help="Delete the open-case claims of unknown writer whose case is not open anywhere")

    def handle(self, *args, **options):
        aliases = [CONTROL_ALIAS, *shard_aliases()]
        for claim, state in unknown_claims(aliases):
            cleared = options["clear_unknown_claims"] and state != "open"
            if cleared:
                type(claim).objects.using(CONTROL_ALIAS).filter(pk=claim.pk, judgment_id=claim.judgment_id).delete()
            self.stdout.write(f"open-case claim soul {claim.soul_id} judgment {claim.judgment_id} "
                              f"({claim.case_txn or 'no case_txn'}): writer unknown, case {state}"
                              f"{'; cleared' if cleared else ''}")
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
