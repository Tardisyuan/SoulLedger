"""Tests for `manage.py check_soul_dates` — the report over existing rows.

The serializers stop new bad dates; this command finds the ones that were
already there, and says what population it looked at while doing it. The
rules themselves are in test_dates.py, their enforcement on write in
test_date_enforcement.py.

Split out when the three together passed the 500-line limit. The seam is
real: everything here is about reporting, and none of it is about refusing
a write.
"""
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.souls.models import Soul
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestCheckSoulDatesCommand:
    """`manage.py check_soul_dates` — finds what the serializers cannot,
    because it was already there before they existed."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="CMD_DATES", defaults={"display_name": "Command Dates Tenant"}
        )[0]

    def _run(self, *args):
        out = StringIO()
        call_command("check_soul_dates", "--tenant", self.tenant.code, *args, stdout=out)
        return out.getvalue()

    def test_clean_data_reports_nothing_flagged(self):
        Soul.objects.create(
            name="Fine", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        output = self._run()
        assert "0 soul(s) flagged" in output

    def test_a_soul_written_around_the_serializer_is_found(self):
        Soul.objects.create(
            name="Backwards", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        output = self._run()
        assert "death_before_birth" in output
        assert "Backwards" in output
        assert "1 soul(s) flagged: 1 error(s)" in output

    def test_an_implausible_lifespan_is_found(self):
        Soul.objects.create(
            name="Ancient Mariner", tenant=self.tenant, birth_year=1487, death_year=1998
        )
        assert "implausible_lifespan" in self._run()

    def test_a_record_outside_the_life_is_found(self):
        soul = Soul.objects.create(
            name="Ancient", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Impossibly early", weight=1, event_year=-700,
        )
        output = self._run()
        assert "event_before_birth" in output
        assert str(soul.id) in output

    def test_posthumous_records_are_reported_as_warnings_and_can_be_hidden(self):
        soul = Soul.objects.create(
            name="Ancient", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Remembered later", weight=1, event_year=-500,
        )
        assert "event_after_death" in self._run()
        assert "event_after_death" not in self._run("--errors-only")

    def test_the_command_changes_nothing(self):
        """It reports. What to do about a soul born after it died is a
        judgement, not something a script gets to make."""
        soul = Soul.objects.create(
            name="Backwards", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        self._run()
        soul.refresh_from_db()
        assert (soul.birth_year, soul.death_year) == (2019, 1943)

    def test_strict_exits_non_zero_when_errors_are_found(self):
        Soul.objects.create(
            name="Backwards", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        with pytest.raises(CommandError):
            self._run("--strict")

    def test_strict_is_quiet_when_only_warnings_are_found(self):
        soul = Soul.objects.create(
            name="Ancient", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Remembered later", weight=1, event_year=-500,
        )
        assert "0 error(s)" in self._run("--strict")

    def test_the_report_says_which_population_it_examined(self):
        """A report that silently omits soft-deleted rows gets read as a
        report on everything."""
        soul = Soul.objects.create(
            name="Gone", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        soul.is_deleted = True
        soul.save()
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="CHINESE",
            description="Attached to a deleted soul", weight=1, event_year=1900,
        )
        output = self._run()
        assert "Checking live rows only" in output
        # The record is live; it is skipped because its soul is not, and
        # counting only is_deleted records would report 0 and be wrong.
        assert "1 soul(s) and 1 record(s) were not examined" in output
        assert "Gone" not in output

    def test_include_deleted_examines_the_soft_deleted_originals(self):
        """A soft-deleted row is not necessarily junk — it may be the
        original a live row was rewritten from, and restoring it makes its
        dates live again."""
        soul = Soul.objects.create(
            name="Gone", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        soul.is_deleted = True
        soul.save()
        output = self._run("--include-deleted")
        assert "Checking live and soft-deleted rows." in output
        assert "Gone" in output
        assert "[soft-deleted]" in output
        assert "death_before_birth" in output

    def test_a_deleted_record_on_a_live_soul_is_marked_too(self):
        soul = Soul.objects.create(
            name="Ancient", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        record = SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Impossibly early", weight=1, event_year=-700,
        )
        record.is_deleted = True
        record.save()
        assert "event_before_birth" not in self._run()
        output = self._run("--include-deleted")
        assert f"record {record.id} [soft-deleted]" in output

    def _record(self, soul, year, **kwargs):
        return SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="EUROPEAN",
            description="Deed", weight=1, event_year=year, **kwargs
        )

    def test_the_record_range_says_which_end_of_the_life_the_deeds_sit_at(self):
        """The one tie-breaker in the data. A soul dated 1487-1998 whose
        deeds all fall in 1516-1541 has a death in the wrong century, not a
        birth — and no rule can say that, because both dates are valid."""
        soul = Soul.objects.create(
            name="Wrong End", tenant=self.tenant, birth_year=1487, death_year=1998
        )
        for year in (1516, 1529, 1541):
            self._record(soul, year)
        output = self._run()
        assert "birth 1487 CE · death 1998 CE · 3 record(s) dated 1516 CE..1541 CE" in output

    def test_the_range_is_shown_for_a_soul_flagged_on_a_record_rule_too(self):
        """Not only for lifespan problems — the context is what the operator
        needs whatever the finding was."""
        soul = Soul.objects.create(
            name="Ancient", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        self._record(soul, -700)
        output = self._run()
        assert "birth 612 BCE · death 580 BCE · 1 record(s) dated 700 BCE..700 BCE" in output

    def test_no_records_at_all_says_so(self):
        """Informative in its own right: the tie cannot be broken here, so
        nobody should hunt for a signal that is not there."""
        Soul.objects.create(
            name="Bare", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        assert "· no dated records" in self._run()

    def test_undated_records_are_counted_not_dropped(self):
        """A range over 3 of 11 records looks like a range over all 11."""
        soul = Soul.objects.create(
            name="Partly Dated", tenant=self.tenant, birth_year=1487, death_year=1998
        )
        self._record(soul, 1516)
        self._record(soul, 1541)
        self._record(soul, None)
        assert "2 record(s) dated 1516 CE..1541 CE, 1 undated" in self._run()

    def test_records_that_are_all_undated_say_how_many(self):
        soul = Soul.objects.create(
            name="All Undated", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        self._record(soul, None)
        self._record(soul, None)
        assert "· no dated records (2 undated)" in self._run()

    def test_the_range_respects_the_population_being_checked(self):
        """A range that counted rows the run did not examine would describe a
        different report than the one it is printed in."""
        soul = Soul.objects.create(
            name="Mixed", tenant=self.tenant, birth_year=2019, death_year=1943
        )
        self._record(soul, 1516)
        gone = self._record(soul, 1900)
        gone.is_deleted = True
        gone.save()
        assert "1 record(s) dated 1516 CE..1516 CE" in self._run()
        assert "2 record(s) dated 1516 CE..1900 CE" in self._run("--include-deleted")

    def test_the_range_does_not_draw_the_conclusion(self):
        """The rule cannot know which end is wrong. A report that starts
        guessing is a report people stop checking."""
        soul = Soul.objects.create(
            name="Wrong End", tenant=self.tenant, birth_year=1487, death_year=1998
        )
        self._record(soul, 1516)
        output = self._run().lower()
        for verdict in ("death is wrong", "birth is wrong", "probably", "likely the"):
            assert verdict not in output

    def test_an_unset_date_is_named_as_unset_in_the_context_line(self):
        soul = Soul.objects.create(
            name="Ancient", tenant=self.tenant, birth_year=-612, death_year=-580
        )
        self._record(soul, -700)
        soul2 = Soul.objects.create(name="Living", tenant=self.tenant, birth_year=1990)
        self._record(soul2, 1980)
        output = self._run()
        assert "birth 1990 CE · death unset" in output

    def test_the_tenant_filter_scopes_the_report(self):
        other = Tenant.objects.get_or_create(
            code="CMD_DATES_OTHER", defaults={"display_name": "Other"}
        )[0]
        Soul.objects.create(
            name="Elsewhere", tenant=other, birth_year=2019, death_year=1943
        )
        assert "Elsewhere" not in self._run()
