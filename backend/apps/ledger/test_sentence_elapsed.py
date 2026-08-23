"""Elapsed time on Plato's circuit, once the ledger has somewhere to record it.

`_greek_reading` reported `elapsed_years: None` unconditionally, and the reason
was never that the arithmetic was hard — it was that the ledger held no origin
to measure from, and deriving one from `death_year` would have invented a start
for a term this system had never begun counting.

`Disposition.term_start` is that origin, recorded explicitly and deliberately
*not* re-read off `executed_at`. So the tests here come in two halves, and the
second half matters as much as the first:

  * given a term start, the reading reports the years served; and
  * given none, the reading is byte-for-byte what it was before the column
    existed — still None, still naming both SENTENCE_MISSING_INPUTS.

The second half is the one that goes quietly wrong. A change that makes the
happy path work and lets the absent path start reporting 0, or an empty
`elapsed_missing`, has replaced an honest absence with a claim — which is the
single thing apps/ledger/readings.py exists to stop.
"""
import datetime

import pytest

from apps.disposition.models import Disposition
from apps.ledger.readings import (
    GREEK_CIRCUIT_YEARS,
    SENTENCE_MISSING_INPUTS,
    get_civilization_reading,
    sentence_elapsed_years,
)
from apps.ledger.services import LedgerService
from apps.souls.models import Civilization, Soul, SoulState
from apps.tenants.models import Tenant


class TestSentenceElapsedArithmetic:
    """No database. `today` is passed in, so these are fixed answers rather
    than answers that depend on the day the suite runs."""

    def test_no_term_start_is_no_answer(self):
        assert sentence_elapsed_years(None) is None
        assert sentence_elapsed_years((None, None, None)) is None

    def test_a_term_that_began_in_antiquity_counts_across_the_era_boundary(self):
        """399 BCE to 2026 CE is 2424 years, not 2425. There is no year 0, and
        getting this wrong by one is the whole reason the arithmetic lives in
        `apps.souls.dates` rather than being a subtraction written here."""
        assert sentence_elapsed_years(
            (-399, 2, 15), datetime.date(2026, 8, 23)
        ) == 2424

    def test_an_anniversary_that_has_not_come_round_is_not_counted(self):
        assert sentence_elapsed_years((1900, 9, 1), datetime.date(2026, 8, 23)) == 125
        assert sentence_elapsed_years((1900, 8, 23), datetime.date(2026, 8, 23)) == 126

    def test_an_unknown_month_does_not_lose_a_year(self):
        """Year-only precision is the ordinary case for an ancient record, and
        `compare_historical_dates` returns 0 rather than guessing, so no
        subtraction happens. The answer is an upper bound accurate to a year,
        which is the same accuracy `lifespan_years` settles for."""
        assert sentence_elapsed_years((1900, None, None), datetime.date(2026, 8, 23)) == 126

    def test_a_term_starting_today_has_served_nothing(self):
        assert sentence_elapsed_years((2026, 8, 23), datetime.date(2026, 8, 23)) == 0

    def test_a_future_term_start_floors_at_zero_rather_than_going_negative(self):
        """A negative quantity of time served is not a fact about any soul.

        `whole_years_between` would answer -4 here; 0 is the true statement
        ("the term has not begun to run") and the falsehood is left to the
        validator that can actually say it — `check_term_start` refuses the
        contradictions it knows, and a future start is not one of the two.
        """
        assert sentence_elapsed_years((2030, 1, 1), datetime.date(2026, 8, 23)) == 0

    def test_a_term_longer_than_the_circuit_is_reported_as_it_is(self):
        """Not clamped to GREEK_CIRCUIT_YEARS.

        Clamping would assert that the circuit ended and the soul came back,
        which is a fact about the disposition's execution and the soul's state.
        This reading looks at neither, so it must not imply either.
        """
        elapsed = sentence_elapsed_years((-399, 2, 15), datetime.date(2026, 8, 23))
        assert elapsed > GREEK_CIRCUIT_YEARS
        assert elapsed == 2424


@pytest.mark.django_db
class TestGreekReadingReadsTheTermStart:

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="GR_HADES", defaults={"display_name": "GR_HADES"}
        )[0]

    def _soul(self, **kwargs):
        return Soul.objects.create(
            name="Er", current_state=SoulState.DISPOSED,
            death_year=-402, tenant=self.tenant, **kwargs
        )

    def _disposition(self, soul, term_start=(-399, 2, 15), **kwargs):
        year, month, day = term_start
        return Disposition.objects.create(
            soul=soul, tenant=soul.tenant,
            term_start_year=year, term_start_month=month, term_start_day=day,
            **kwargs
        )

    def _reading(self, soul):
        return LedgerService.get_ledger_summary(soul)["reading"]

    # -- the absent path, unchanged ---------------------------------------

    def test_a_soul_with_no_disposition_is_exactly_as_it_was(self):
        reading = self._reading(self._soul())
        assert reading["elapsed_years"] is None
        assert reading["elapsed_missing"] == list(SENTENCE_MISSING_INPUTS)

    def test_a_disposition_with_no_term_start_is_exactly_as_it_was(self):
        """The row exists; the fact does not. NULL means not recorded, which is
        every disposition written before disposition/0011."""
        soul = self._soul()
        self._disposition(soul, term_start=(None, None, None))
        reading = self._reading(soul)
        assert reading["elapsed_years"] is None
        assert reading["elapsed_missing"] == list(SENTENCE_MISSING_INPUTS)
        # And no 0 sneaking in under another name.
        assert "years_served" not in reading
        assert "time_served" not in reading

    # -- the present path --------------------------------------------------

    def test_a_recorded_term_start_is_reported_as_years_served(self):
        soul = self._soul()
        self._disposition(soul, term_start=(-399, 2, 15))
        reading = self._reading(soul)

        expected = sentence_elapsed_years((-399, 2, 15))
        assert reading["elapsed_years"] == expected
        assert expected > 2400, "the arithmetic, not merely a non-None value"

    def test_the_missing_list_empties_when_the_number_arrives(self):
        """Both members or neither — see SENTENCE_MISSING_INPUTS' own note.

        TIME_SERVED is not a second stored fact beside TERM_START, it is what
        measuring from TERM_START produces. Reporting it as still missing next
        to the number that is exactly it would be a payload contradicting
        itself.
        """
        soul = self._soul()
        self._disposition(soul)
        assert self._reading(soul)["elapsed_missing"] == []

    def test_the_number_and_the_list_are_never_both_present(self):
        """The invariant stated as an invariant, over both paths at once."""
        for term_start in ((-399, 2, 15), (None, None, None)):
            soul = self._soul()
            self._disposition(soul, term_start=term_start)
            reading = self._reading(soul)
            assert (reading["elapsed_years"] is None) == bool(reading["elapsed_missing"])

    def test_the_payload_gains_no_new_field(self):
        """Exhaustive, like test_readings.py's guard: `elapsed_years` becoming
        a number must not be the occasion for a derived companion —
        `years_remaining`, a percentage, a term length — to arrive beside it."""
        soul = self._soul()
        self._disposition(soul)
        assert set(self._reading(soul)) == {
            "kind", "civilization", "wrongs", "benefactions",
            "repayment_multiple", "circuit_years",
            "elapsed_years", "elapsed_missing",
        }

    def test_elapsed_time_is_not_turned_into_a_fraction_of_the_circuit(self):
        """A soul 2424 years into a 1000-year circuit is reported as 2424.

        The forbidden figures are the ones a progress reading would produce:
        the remainder, the ratio, and the clamp. None of them is a fact —
        this reading computes no term length, because tenfold-per-deed is a
        rule Republic X states and not a total it sums.
        """
        soul = self._soul()
        self._disposition(soul)
        reading = self._reading(soul)
        elapsed = reading["elapsed_years"]

        assert elapsed > GREEK_CIRCUIT_YEARS
        numbers = {
            v for v in reading.values()
            if isinstance(v, int) and not isinstance(v, bool)
        }
        assert GREEK_CIRCUIT_YEARS - elapsed not in numbers
        assert elapsed - GREEK_CIRCUIT_YEARS not in numbers
        assert elapsed // GREEK_CIRCUIT_YEARS not in numbers or elapsed // GREEK_CIRCUIT_YEARS == 2

    # -- which disposition ------------------------------------------------

    def test_the_most_recent_disposition_is_the_one_read(self):
        """A soul accumulates one per circuit. The term it is serving now is
        the latest, not the first one anybody wrote."""
        soul = self._soul()
        self._disposition(soul, term_start=(-399, 2, 15))
        self._disposition(soul, term_start=(1500, 6, 1))
        assert self._reading(soul)["elapsed_years"] == sentence_elapsed_years((1500, 6, 1))

    def test_an_archived_disposition_does_not_drive_the_reading(self):
        """Archiving is how an operator takes a row out of the working set.
        A withdrawn record must not go on producing a number on the screen."""
        soul = self._soul()
        archived = self._disposition(soul, term_start=(-399, 2, 15))
        archived.is_archived = True
        archived.save(update_fields=["is_archived"])

        reading = self._reading(soul)
        assert reading["elapsed_years"] is None
        assert reading["elapsed_missing"] == list(SENTENCE_MISSING_INPUTS)

    def test_a_soft_deleted_disposition_does_not_drive_the_reading(self):
        soul = self._soul()
        deleted = self._disposition(soul, term_start=(-399, 2, 15))
        deleted.is_deleted = True
        deleted.save(update_fields=["is_deleted"])

        assert self._reading(soul)["elapsed_years"] is None


class TestTheOtherThreeCosmologiesIgnoreIt:
    """`term_start` widened four builders to serve one, and the three that do
    not use it must not have quietly grown a field for it."""

    @pytest.mark.parametrize("civ", [
        Civilization.CHINESE, Civilization.EGYPTIAN, Civilization.EUROPEAN,
    ])
    def test_a_term_start_changes_nothing_for_them(self, civ):
        without = get_civilization_reading(
            civ.value, merit=30, demerit=12, merit_count=3, demerit_count=2,
        )
        with_start = get_civilization_reading(
            civ.value, merit=30, demerit=12, merit_count=3, demerit_count=2,
            term_start=(-399, 2, 15),
        )
        assert without == with_start

    def test_an_unmapped_tenant_still_gets_a_refusal(self):
        reading = get_civilization_reading(
            "NORSE", merit=0, demerit=0, merit_count=0, demerit_count=0,
            term_start=(-399, 2, 15),
        )
        assert reading["kind"] == "UNAVAILABLE"
        assert "elapsed_years" not in reading
