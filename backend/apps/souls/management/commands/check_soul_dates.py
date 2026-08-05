"""Report souls and records whose dates do not make sense together.

Reports only. It fixes nothing, and that is deliberate: what to do about a
soul born after it died is a judgement — is the birth year wrong, is the
death year wrong, is it two people merged into one row — and a script has
no way to make it. The rules are in apps.souls.dates; the serializers
enforce them on new writes, and this command finds what was already there.

What it does *not* find is a soul whose dates are uniformly wrong — birth,
death and every record shifted into the same wrong era together. Nothing in
the data contradicts anything else in that case, and no rule here can see
it. See the note on the same subject in apps.souls.dates.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Prefetch, Q

from apps.souls.dates import ERROR, WARNING, check_record_date, check_soul_dates
from apps.souls.models import Soul
from apps.souls.record_models import SoulRecord


class Command(BaseCommand):
    help = (
        "Report souls and soul records with dates that contradict each other "
        "(death before birth, implausible lifespan, event outside the life). "
        "Read-only — nothing is modified."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--tenant",
            metavar="CODE",
            help="Only check souls in this tenant, e.g. EU_HEAVEN_HELL.",
        )
        parser.add_argument(
            "--errors-only",
            action="store_true",
            help="Hide warnings. Warnings cover cases that are unusual but "
                 "possible — a posthumous record above all — so they are noise "
                 "when you are hunting for rows that cannot be right.",
        )
        parser.add_argument(
            "--strict",
            action="store_true",
            help="Exit non-zero if any error was found, for use in CI. Off by "
                 "default so an operator running this to look around does not "
                 "get a failure for their trouble.",
        )
        parser.add_argument(
            "--include-deleted",
            action="store_true",
            help="Also check soft-deleted souls and records. Worth doing before "
                 "restoring any of them: a soft-deleted row here is not "
                 "necessarily junk, it may be the original a live row was "
                 "rewritten from.",
        )

    def handle(self, *args, **options):
        # Which population is being examined, and — just as important — which
        # is not. Soul.objects and the records related manager both exclude
        # soft-deleted rows, and a report that silently omits them will be
        # read as a report on everything. Deleted rows are excluded by default
        # because nothing reads them and no one can edit them through the API,
        # so their dates are not an operational problem *while they stay
        # deleted*. That last clause is why --include-deleted exists: a
        # soft-deleted row can be the original that a live row was rewritten
        # from, and restoring one makes its dates live again.
        include_deleted = options["include_deleted"]
        soul_manager = Soul.all_objects if include_deleted else Soul.objects
        # _base_manager is the unfiltered one; SoulRecord.objects is a
        # TenantManager and drops is_deleted rows like the related manager does.
        record_queryset = (
            SoulRecord._base_manager if include_deleted else SoulRecord.objects
        ).all()

        souls = (
            soul_manager.select_related("tenant")
            .prefetch_related(
                Prefetch("records", queryset=record_queryset, to_attr="checked_records")
            )
            .order_by("name")
        )
        if options["tenant"]:
            souls = souls.filter(tenant__code=options["tenant"])

        if include_deleted:
            self.stdout.write("Checking live and soft-deleted rows.")
        else:
            skipped_souls = Soul.all_objects.filter(is_deleted=True)
            # A live record on a deleted soul is skipped too — the loop below
            # never reaches it, because it iterates souls. Counting only
            # is_deleted records would report 0 skipped while quietly passing
            # over every record the deleted souls carry.
            skipped_records = SoulRecord._base_manager.filter(
                Q(is_deleted=True) | Q(soul__is_deleted=True)
            )
            if options["tenant"]:
                skipped_souls = skipped_souls.filter(tenant__code=options["tenant"])
                skipped_records = skipped_records.filter(tenant__code=options["tenant"])
            self.stdout.write(
                f"Checking live rows only — {skipped_souls.count()} soul(s) and "
                f"{skipped_records.count()} record(s) were not examined (soft-deleted, "
                f"or attached to a soft-deleted soul). Use --include-deleted to "
                f"include them."
            )
        self.stdout.write("")

        soul_count = 0
        record_count = 0
        flagged_souls = 0
        errors = 0
        warnings = 0

        for soul in souls:
            soul_count += 1
            birth = (soul.birth_year, soul.birth_month, soul.birth_day)
            death = (soul.death_year, soul.death_month, soul.death_day)

            problems = [(None, p) for p in check_soul_dates(birth, death)]
            for record in soul.checked_records:
                record_count += 1
                event = (record.event_year, record.event_month, record.event_day)
                problems += [
                    (record, p) for p in check_record_date(event, birth, death)
                ]

            errors += sum(1 for _, p in problems if p.severity == ERROR)
            warnings += sum(1 for _, p in problems if p.severity == WARNING)
            if options["errors_only"]:
                problems = [(r, p) for r, p in problems if p.severity == ERROR]
            if not problems:
                continue

            flagged_souls += 1
            tenant_code = soul.tenant.code if soul.tenant else "NO TENANT"
            # Marked per row rather than only in the header: with
            # --include-deleted a live soul can carry deleted records and the
            # other way round, and what to do about a problem depends on which.
            deleted = "  [soft-deleted]" if soul.is_deleted else ""
            self.stdout.write(f"{tenant_code}  {soul.name}  {soul.id}{deleted}")
            for record, problem in problems:
                style = self.style.ERROR if problem.severity == ERROR else self.style.WARNING
                where = ""
                if record is not None:
                    mark = " [soft-deleted]" if record.is_deleted else ""
                    where = f"record {record.id}{mark}: "
                self.stdout.write(style(
                    f"  {problem.severity.upper():<8} {problem.code:<21} {where}{problem.message}"
                ))
            self.stdout.write("")

        summary = (
            f"{soul_count} soul(s) and {record_count} record(s) checked — "
            f"{flagged_souls} soul(s) flagged: {errors} error(s), {warnings} warning(s)"
        )
        if options["strict"] and errors:
            raise CommandError(summary)
        style = self.style.WARNING if errors else self.style.SUCCESS
        self.stdout.write(style(summary))
