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
    ALIVE_STATE,
    ERROR,
    MAX_PLAUSIBLE_LIFESPAN_YEARS,
    WARNING,
    check_record_date,
    check_soul_dates,
    check_term_start,
    compare_historical_dates,
    format_historical_date,
    lifespan_years,
    whole_years_between,
)
from apps.souls.models import SoulState


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



class TestWholeYearsBetween:
    """The arithmetic `lifespan_years` used to own alone.

    Renamed rather than copied when a second caller appeared that is not about
    a life (`apps.ledger.readings.sentence_elapsed_years`, measuring a term).
    `lifespan_years` delegates, so these cases are the same cases — the point
    of asserting them under both names is that the delegation is real and the
    year-0 correction did not get re-implemented on the way out.
    """

    def test_it_is_the_same_answer_lifespan_years_gives(self):
        for start, end in [
            ((-612, None, None), (-580, None, None)),
            ((-50, None, None), (10, None, None)),
            ((1900, 6, 1), (1950, 5, 31)),
            ((1900, 6, 1), (1950, 6, 1)),
        ]:
            assert whole_years_between(start, end) == lifespan_years(start, end)

    def test_a_term_that_crosses_the_era_boundary_loses_the_missing_year_zero(self):
        """The case the rename exists for: not a life, same missing year 0."""
        assert whole_years_between((-399, None, None), (1, None, None)) == 399

    def test_an_unfinished_anniversary_is_not_counted(self):
        assert whole_years_between((-399, 6, 1), (-300, 5, 31)) == 98
        assert whole_years_between((-399, 6, 1), (-300, 6, 1)) == 99

    def test_either_end_unknown_is_no_answer(self):
        assert whole_years_between((None, None, None), (1950, 1, 1)) is None
        assert whole_years_between((1900, 1, 1), (None, None, None)) is None


class TestTermStartRules:
    """check_term_start — a disposition's term start against its soul.

    The third date in this module and the first that is not about a life, so
    the tests are the two contradictions it can see and, just as importantly,
    the legitimate case it must stay silent on.
    """

    DEATH = (-399, 2, 15)

    def test_the_state_literal_still_names_the_state_it_thinks_it_does(self):
        """The one thing that would switch this rule off in silence.

        `apps.souls.dates` cannot import SoulState — `apps.souls.models`
        imports *it*, for the birth_date/death_date properties — so ALIVE's
        stored value is spelled out there as a literal. Two copies of one value
        that nothing compares are free to drift, and the drift would not raise:
        the ALIVE branch would simply stop matching and the rule would report
        nothing, forever, with every test that asserts a *clean* result still
        green.
        """
        assert SoulState.ALIVE.value == ALIVE_STATE

    def test_no_term_start_is_the_ordinary_case(self):
        assert check_term_start(
            (None, None, None), self.DEATH, SoulState.DISPOSED
        ) == []

    def test_a_term_starting_after_death_is_fine(self):
        assert check_term_start(
            (-399, 3, 1), self.DEATH, SoulState.DISPOSED
        ) == []

    def test_a_term_starting_on_the_day_of_death_is_fine(self):
        """Judgment follows death; it does not have to follow it by a day."""
        assert check_term_start(
            self.DEATH, self.DEATH, SoulState.DISPOSED
        ) == []

    def test_a_term_starting_before_death_is_an_error(self):
        problems = check_term_start(
            (-450, None, None), self.DEATH, SoulState.DISPOSED
        )
        assert _codes(problems) == ["term_start_before_death"]
        assert problems[0].severity == ERROR
        # Both dates are named, because either may be the wrong one.
        assert "450 BCE" in problems[0].message
        assert "399" in problems[0].message

    def test_the_comparison_is_conservative_at_low_precision(self):
        """Same year, month unknown on one side: not evidence of anything.

        Inherited from `compare_historical_dates` on purpose. This rule
        refuses writes, and "died some time in 399 BCE, term began some time
        in 399 BCE" is the ordinary shape of an ancient record.
        """
        assert check_term_start(
            (-399, None, None), self.DEATH, SoulState.DISPOSED
        ) == []

    def test_a_term_start_on_a_living_soul_is_an_error(self):
        problems = check_term_start(
            (-399, 3, 1), (None, None, None), SoulState.ALIVE
        )
        assert _codes(problems) == ["term_start_on_a_living_soul"]
        assert problems[0].severity == ERROR

    def test_a_reborn_souls_served_term_keeps_its_start_and_says_nothing(self):
        """The case that makes the naive form of the rule wrong.

        `ReincarnationService.complete_rebirth` sets `death_date = None` and
        transitions the soul back to ALIVE, and the disposition it served
        under keeps its rows. That soul is ALIVE, has no death date, and
        legitimately owns a term start — the single most ordinary outcome in
        the system. A rule that fired here would be wrong far more often than
        it was right, which is how a rule gets switched off.
        """
        assert check_term_start(
            (-399, 3, 1), (None, None, None), SoulState.ALIVE, term_executed=True
        ) == []

    def test_an_unexecuted_term_on_a_living_soul_is_still_an_error(self):
        """The other side of the same gate: `term_executed` narrows the rule,
        it does not delete it."""
        problems = check_term_start(
            (-399, 3, 1), (None, None, None), SoulState.ALIVE, term_executed=False
        )
        assert _codes(problems) == ["term_start_on_a_living_soul"]

    def test_the_two_rules_are_reported_independently(self):
        """A row can be wrong in both ways at once and must say so twice.

        Not one message with two clauses: the codes are what a caller switches
        on, and collapsing them would make "which of the two is this" a
        question about English.
        """
        problems = check_term_start(
            (-450, 1, 1), self.DEATH, SoulState.ALIVE, term_executed=False
        )
        assert _codes(problems) == [
            "term_start_before_death", "term_start_on_a_living_soul"
        ]

    def test_a_dead_souls_state_is_not_second_guessed(self):
        """Every state that is not ALIVE gets the date rule and nothing else."""
        for state in (
            SoulState.JUDGING, SoulState.DISPOSED,
            SoulState.REINCARNATING, SoulState.SETTLED, SoulState.LOST,
        ):
            assert check_term_start((-399, 3, 1), self.DEATH, state) == []

    def test_a_future_term_start_is_not_one_of_these_rules(self):
        """Absence asserted, so that adding a third rule stays deliberate.

        Nothing in this module compares any date to the clock, and this one
        does not either. `sentence_elapsed_years` floors its answer at zero so
        a future start reports as nothing served rather than as a negative;
        that is the reading's decision and it is asserted where it lives.
        """
        assert check_term_start(
            (9999, 1, 1), self.DEATH, SoulState.DISPOSED
        ) == []
