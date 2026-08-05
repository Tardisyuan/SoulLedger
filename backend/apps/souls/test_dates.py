"""Tests for cross-date sanity rules — see apps.souls.dates.

The rules as arithmetic, with no database in the way. Where they are
enforced, and how existing bad rows are found, is test_date_enforcement.py.

Ledger decay used to make date errors loud by accident. A soul mis-dated to
antiquity scored 3.5e-12 and its ledger visibly collapsed to zero. Decay is
now anchored to the soul's own death, which is right and which cost us that
accident: the ledger looks perfect no matter how wrong the dates are. These
rules are the replacement signal, so the tests that matter most are the ones
where a wrong answer would be worse than no rule — the BCE spans, where
naive subtraction is off by one because there is no year 0.
"""
from apps.souls.dates import (
    ERROR,
    MAX_PLAUSIBLE_LIFESPAN_YEARS,
    WARNING,
    check_record_date,
    check_soul_dates,
    compare_historical_dates,
    format_historical_date,
    lifespan_years,
)


def _codes(problems):
    return [p.code for p in problems]


class TestLifespanArithmetic:
    """Spans, not orderings. Every one of these is a case where subtracting
    the two years directly gives a different answer."""

    def test_bce_life_does_not_gain_a_year(self):
        """A soul born 612 BCE and dying 580 BCE lived 32 years, not 33."""
        assert lifespan_years((-612, None, None), (-580, None, None)) == 32

    def test_life_crossing_the_era_boundary_loses_the_missing_year_zero(self):
        """50 BCE to 10 CE is 59 years — there is no year 0 in between."""
        assert lifespan_years((-50, None, None), (10, None, None)) == 59

    def test_birthday_not_yet_come_round_in_the_year_of_death(self):
        assert lifespan_years((1943, 6, 1), (2019, 5, 1)) == 75
        assert lifespan_years((1943, 6, 1), (2019, 7, 1)) == 76

    def test_unknown_months_give_the_plain_year_difference(self):
        """An upper bound accurate to within a year, which is ample for a
        rule whose threshold is 150."""
        assert lifespan_years((1943, None, None), (2019, None, None)) == 76

    def test_unknown_dates_have_no_lifespan(self):
        assert lifespan_years((None, None, None), (2019, 1, 1)) is None
        assert lifespan_years((1943, 1, 1), (None, None, None)) is None

    def test_lifespan_is_negative_when_the_dates_are_the_wrong_way_round(self):
        assert lifespan_years((2019, None, None), (1943, None, None)) == -76


class TestDateOrdering:
    def test_bce_years_order_the_way_history_reads_them(self):
        assert compare_historical_dates((-612, None, None), (-580, None, None)) == -1
        assert compare_historical_dates((-580, None, None), (-612, None, None)) == 1

    def test_bce_is_before_ce(self):
        assert compare_historical_dates((-1, None, None), (1, None, None)) == -1

    def test_same_year_with_an_unknown_month_is_not_evidence_of_disorder(self):
        """"Born some time in 1943, died some time in 1943" must not be
        reported as a soul dying before it was born."""
        assert compare_historical_dates((1943, None, None), (1943, 6, 1)) == 0
        assert compare_historical_dates((1943, 6, 1), (1943, None, None)) == 0

    def test_same_month_with_an_unknown_day_is_not_evidence_either(self):
        assert compare_historical_dates((1943, 6, None), (1943, 6, 12)) == 0

    def test_months_and_days_separate_dates_within_a_year(self):
        assert compare_historical_dates((1943, 5, 1), (1943, 6, 1)) == -1
        assert compare_historical_dates((1943, 6, 2), (1943, 6, 1)) == 1

    def test_formatting_names_the_era(self):
        assert format_historical_date(-612, None, None) == "612 BCE"
        assert format_historical_date(1943, 5, 2) == "1943-05-02 CE"
        assert format_historical_date(None, None, None) == "unset"


class TestSoulRules:
    """check_soul_dates — birth against death."""

    def test_a_soul_with_no_dates_has_no_problems(self):
        assert check_soul_dates((None, None, None), (None, None, None)) == []

    def test_a_living_soul_is_not_missing_anything(self):
        """Most souls in the system have no death date. That is not an error."""
        assert check_soul_dates((1943, 5, 2), (None, None, None)) == []

    def test_death_before_birth_is_an_error(self):
        problems = check_soul_dates((2019, None, None), (1943, None, None))
        assert _codes(problems) == ["death_before_birth"]
        assert problems[0].severity == ERROR

    def test_death_before_birth_within_a_single_year(self):
        problems = check_soul_dates((1943, 6, 1), (1943, 5, 1))
        assert _codes(problems) == ["death_before_birth"]

    def test_death_before_birth_in_bce(self):
        """Higher BCE number means earlier, so 580 BCE born / 612 BCE died
        is out of order even though 580 > 612 as magnitudes."""
        assert _codes(check_soul_dates((-580, None, None), (-612, None, None))) == [
            "death_before_birth"
        ]

    def test_out_of_order_dates_are_not_also_reported_as_a_long_life(self):
        """One fact, one problem. A negative lifespan restated in bigger
        numbers tells the operator nothing new."""
        assert len(check_soul_dates((2019, None, None), (1543, None, None))) == 1

    def test_an_ordinary_bce_life_is_fine(self):
        assert check_soul_dates((-612, None, None), (-580, None, None)) == []

    def test_a_medieval_life_is_fine(self):
        assert check_soul_dates((1487, None, None), (1546, None, None)) == []

    def test_the_bound_itself_is_allowed(self):
        assert check_soul_dates((1000, None, None), (1000 + MAX_PLAUSIBLE_LIFESPAN_YEARS, None, None)) == []

    def test_one_year_past_the_bound_is_an_error(self):
        problems = check_soul_dates(
            (1000, None, None), (1001 + MAX_PLAUSIBLE_LIFESPAN_YEARS, None, None)
        )
        assert _codes(problems) == ["implausible_lifespan"]
        assert problems[0].severity == ERROR

    def test_the_bound_is_measured_with_year_span_across_the_era_boundary(self):
        """100 BCE to 51 CE is exactly 150 years and must pass. Subtracting
        the years directly gives 151 and would reject it — the off-by-one
        this whole module exists to avoid, showing up in the rule meant to
        catch date errors rather than cause them."""
        assert check_soul_dates((-100, None, None), (51, None, None)) == []
        assert _codes(check_soul_dates((-100, None, None), (52, None, None))) == [
            "implausible_lifespan"
        ]

    def test_a_soul_left_in_the_wrong_era_is_caught(self):
        """The case this rule is really for: a European soul whose birth
        moved back to the 1400s while its death stayed in the 1900s."""
        problems = check_soul_dates((1487, None, None), (1998, None, None))
        assert _codes(problems) == ["implausible_lifespan"]
        assert "511 years" in problems[0].message


class TestRecordRules:
    """check_record_date — a record's event date against its soul."""

    LIFE = ((-612, None, None), (-580, None, None))

    def test_a_record_with_no_event_date_is_fine(self):
        """Common for ancient sources, and nothing requires one."""
        assert check_record_date((None, None, None), *self.LIFE) == []

    def test_a_record_within_the_life_is_fine(self):
        assert check_record_date((-600, None, None), *self.LIFE) == []

    def test_a_record_before_birth_is_an_error(self):
        problems = check_record_date((-620, None, None), *self.LIFE)
        assert _codes(problems) == ["event_before_birth"]
        assert problems[0].severity == ERROR

    def test_a_record_after_death_is_only_a_warning(self):
        """Posthumous records are real, and LedgerService._get_record_age_years
        already clamps them to a zero span rather than treating them as
        impossible. Rejecting a write the ledger deliberately tolerates would
        be a contradiction, not a tightening."""
        problems = check_record_date((-570, None, None), *self.LIFE)
        assert _codes(problems) == ["event_after_death"]
        assert problems[0].severity == WARNING

    def test_the_posthumous_gap_is_measured_across_the_era_boundary(self):
        problems = check_record_date((10, None, None), (-100, None, None), (-50, None, None))
        assert "59 year(s) after" in problems[0].message

    def test_a_record_against_a_soul_with_no_dates_is_fine(self):
        assert check_record_date(
            (-600, None, None), (None, None, None), (None, None, None)
        ) == []

    def test_a_living_souls_record_is_only_checked_against_birth(self):
        assert check_record_date((2024, None, None), (1990, None, None), (None, None, None)) == []

