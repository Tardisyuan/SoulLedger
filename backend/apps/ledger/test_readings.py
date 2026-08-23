"""
Per-civilization ledger readings.

Split out of apps/ledger/tests.py and test_decay.py for the same reason those
two were split from each other: the 500-line limit.

The claim under test is that a net balance is the Chinese instrument, not a
shared primitive, and that serving it to everybody quietly applies one
cosmology's arithmetic to three. See apps/ledger/readings.py.
"""
import re
from pathlib import Path

import pytest

from apps.ledger.readings import (
    MAAT_FEATHER_WEIGHT,
    POENA_MISSING_INPUTS,
    REASON_TENANT_NOT_MAPPED,
    SENTENCE_MISSING_INPUTS,
    UNAVAILABLE_REASON_CODES,
    get_civilization_reading,
)
from apps.ledger.services import LedgerService
from apps.souls.models import Civilization, Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestCivilizationReadings:

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenants = {
            civ: Tenant.objects.get_or_create(
                code=code, defaults={"display_name": code}
            )[0]
            for civ, code in (
                (Civilization.CHINESE, "CN_DIYU"),
                (Civilization.EUROPEAN, "EU_HEAVEN_HELL"),
                (Civilization.EGYPTIAN, "EG_DUAT"),
                (Civilization.GREEK, "GR_HADES"),
            )
        }

    def _soul(self, tenant, merits=(), demerits=()):
        """Deeds dated in the year of death, so decay is exactly 1.0 and the
        only thing the reading sees is the weights themselves."""
        soul = Soul.objects.create(
            name=f"{tenant.code} soul", current_state=SoulState.JUDGING,
            death_year=2000, tenant=tenant,
        )
        for record_type, weights in (("MERIT", merits), ("DEMERIT", demerits)):
            for w in weights:
                SoulRecord.objects.create(
                    soul=soul, record_type=record_type, description=f"{record_type} {w}",
                    weight=w, event_year=2000,
                )
        return soul

    # -- CHINESE: a cumulative account ------------------------------------

    def test_chinese_reads_a_net_balance(self):
        soul = self._soul(self.tenants[Civilization.CHINESE], merits=(30,), demerits=(12,))
        reading = LedgerService.get_ledger_summary(soul)["reading"]
        assert reading["kind"] == "BALANCE"
        assert reading["civilization"] == "CHINESE"
        assert reading["balance"] == 18
        assert reading["merit"] == 30
        assert reading["demerit"] == 12

    # -- EGYPTIAN: a threshold, not a score --------------------------------

    def test_egyptian_reads_a_threshold_not_a_balance(self):
        soul = self._soul(self.tenants[Civilization.EGYPTIAN], merits=(30,), demerits=(12,))
        reading = LedgerService.get_ledger_summary(soul)["reading"]
        assert reading["kind"] == "THRESHOLD"
        assert reading["civilization"] == "EGYPTIAN"
        assert "balance" not in reading
        assert reading["heart_weight"] == 12
        assert reading["counterweight"] == MAAT_FEATHER_WEIGHT
        assert reading["heavier_than_feather"] is True

    def test_merit_does_not_lighten_an_egyptian_heart(self):
        """The bug this reading exists to stop, in one assertion.

        A heart carrying 18 points of recorded wrongdoing netted to +6 against
        24 points of merit, and +6 is on the passing side of any threshold
        anyone would pick — a pass granted by an offsetting step the Egyptian
        weighing does not have. These are the real numbers from the seeded soul
        塞內布.
        """
        soul = self._soul(self.tenants[Civilization.EGYPTIAN], merits=(24,), demerits=(18,))
        summary = LedgerService.get_ledger_summary(soul)

        assert summary["karmic_balance"] == 6  # what the shared reading said
        assert summary["reading"]["heart_weight"] == 18
        assert summary["reading"]["heavier_than_feather"] is True

    def test_a_heart_with_no_recorded_wrongdoing_passes(self):
        soul = self._soul(self.tenants[Civilization.EGYPTIAN], merits=(5,))
        reading = LedgerService.get_ledger_summary(soul)["reading"]
        assert reading["heart_weight"] == 0
        assert reading["heavier_than_feather"] is False

    def test_a_heart_level_with_the_feather_is_not_heavier(self):
        """"Not heavier than" — the formula is balance, not surplus."""
        soul = self._soul(
            self.tenants[Civilization.EGYPTIAN], demerits=(MAAT_FEATHER_WEIGHT,)
        )
        reading = LedgerService.get_ledger_summary(soul)["reading"]
        assert reading["heart_weight"] == MAAT_FEATHER_WEIGHT
        assert reading["heavier_than_feather"] is False

    # -- EUROPEAN: guilt and penalty come apart ----------------------------

    def test_european_reads_culpa_and_reports_poena_as_unavailable(self):
        soul = self._soul(self.tenants[Civilization.EUROPEAN], merits=(30,), demerits=(12, 5))
        reading = LedgerService.get_ledger_summary(soul)["reading"]
        assert reading["kind"] == "GUILT_AND_PENALTY"
        assert reading["civilization"] == "EUROPEAN"
        assert reading["culpa"] == 17
        assert reading["culpa_record_count"] == 2
        # Not 0, and not a proxy derived from culpa. Poena is what remains
        # after absolution, and nothing here records absolution, satisfaction
        # owed, or penance performed.
        assert reading["poena"] is None
        # The absence, as the three facts it is made of rather than as a
        # sentence listing them. This list is what the panel is built from —
        # one bullet per member, its copy keyed off the member name — so a
        # fourth missing input arrives on screen instead of being dropped by a
        # hard-coded list of three. See the RESOLVED(i18n) note in readings.py.
        assert reading["poena_missing"] == ["ABSOLUTION", "SATISFACTION", "PENANCE"]
        assert reading["poena_missing"] == list(POENA_MISSING_INPUTS)
        # Absence asserted as well as presence: the sentence must not come back
        # *beside* the list. Two copies of one fact is how the frontend's
        # hard-coded 20/100 got to disagree with `inheritance_note`.
        assert "poena_unavailable" not in reading

    def test_poena_never_reports_an_absence_without_saying_what_is_missing(self):
        """`poena: None` and an empty `poena_missing` is the bare null this
        replaced.

        The pair is the whole contract for a client with no message catalogue:
        the None says there is no number, the list says which facts are absent.
        Either one alone is worse than the English sentence used to be.
        """
        soul = self._soul(self.tenants[Civilization.EUROPEAN], demerits=(3,))
        reading = LedgerService.get_ledger_summary(soul)["reading"]
        assert reading["poena"] is None
        assert reading["poena_missing"], (
            "poena is unavailable and the reading did not say what is missing"
        )
        # Members, not a re-wrapped sentence handed back under a new key.
        assert all(
            isinstance(m, str) and m and " " not in m and m == m.upper()
            for m in reading["poena_missing"]
        )

    def test_merit_does_not_reduce_european_culpa(self):
        """A good deed does not retire a sin; absolution does."""
        soul = self._soul(self.tenants[Civilization.EUROPEAN], merits=(500,), demerits=(12,))
        summary = LedgerService.get_ledger_summary(soul)
        assert summary["karmic_balance"] == 488
        assert summary["reading"]["culpa"] == 12

    # -- UNKNOWN: no cosmology, no reading ---------------------------------

    def test_an_unmapped_tenant_gets_a_refusal_not_the_chinese_reading(self):
        """The fail-open just removed from Soul.civilization, not rebuilt here."""
        tenant = Tenant.objects.get_or_create(
            code="RDG_UNMAPPED", defaults={"display_name": "Unmapped"}
        )[0]
        soul = self._soul(tenant, merits=(30,), demerits=(12,))
        assert soul.civilization == "UNKNOWN"

        summary = LedgerService.get_ledger_summary(soul)
        reading = summary["reading"]
        assert reading["kind"] == "UNAVAILABLE"
        assert reading["civilization"] == "UNKNOWN"
        # A state, not a sentence — and not a second `remedy` field either.
        # "Configure the tenant" is what TENANT_NOT_MAPPED *means*; the panel
        # keys `unavailable_tenant_not_mapped_cta` off this code and owns the
        # imperative in three languages.
        assert reading["reason_code"] == REASON_TENANT_NOT_MAPPED
        assert reading["reason_code"] in UNAVAILABLE_REASON_CODES
        assert "reason" not in reading
        assert "remedy" not in reading
        assert "balance" not in reading
        # The raw sums stay — they are true of any ledger and commit to no
        # cosmology. It is the reading that would have been a claim.
        assert summary["merit_score"] == 30
        assert summary["karmic_balance"] == 18

    # -- shape ------------------------------------------------------------

    def test_karmic_balance_is_untouched_for_every_civilization(self):
        """The reading is additive. Nothing downstream loses its number."""
        for civ, tenant in self.tenants.items():
            soul = self._soul(tenant, merits=(30,), demerits=(12,))
            summary = LedgerService.get_ledger_summary(soul)
            assert summary["karmic_balance"] == 18, civ
            soul.refresh_from_db()
            assert soul.karmic_balance == 18, civ

    def test_a_fourth_cosmology_is_one_entry(self):
        """GREEK arrived as a dict entry, not a fourth branch of an if/elif.

        This is also the assertion that forces the enum and the table to land in
        the same commit: adding `Civilization.GREEK` alone turns this red, and
        the only way to make it green is to say what a Greek ledger means.
        """
        from apps.ledger.readings import CIVILIZATION_READING
        assert isinstance(CIVILIZATION_READING, dict)
        assert set(CIVILIZATION_READING) == set(Civilization)

    def test_reading_is_looked_up_not_defaulted(self):
        """Called directly with a civilization nobody has configured.

        NORSE, not GREEK. This test used to pass "GREEK" as its stand-in for an
        unconfigured cosmology, which was true right up until GREEK was
        configured — at which point the assertion would have gone on passing for
        the wrong reason if the value had been left alone, or (as here) started
        failing and revealed that the *branch under test* had lost its only
        witness. The replacement is not an arbitrary string: Norse was removed
        from this system outright because a pantheon whose destination follows
        the manner of death has no judgment step to host (see
        `consolidate_eu_pantheon`'s module docstring), so it is a cosmology this
        repository has decided will never be in `TENANT_CIVILIZATION` — the one
        thing this test needs of it.
        """
        reading = get_civilization_reading(
            "NORSE", merit=30, demerit=12, merit_count=3, demerit_count=1
        )
        assert reading["kind"] == "UNAVAILABLE"
        assert reading["civilization"] == "NORSE"
        assert reading["reason_code"] == REASON_TENANT_NOT_MAPPED
        assert "NORSE" not in Civilization.values, (
            "NORSE is this test's stand-in for a cosmology nobody configured. "
            "If it has become a real Civilization member, the UNAVAILABLE "
            "branch is no longer being exercised — pick another unconfigured "
            "name rather than leaving this green over a lookup that now hits."
        )

    # -- GREEK: a term served ---------------------------------------------

    def test_greek_reads_a_sentence_and_not_a_balance(self):
        soul = self._soul(self.tenants[Civilization.GREEK], merits=(30,), demerits=(7, 5))
        reading = LedgerService.get_ledger_summary(soul)["reading"]
        assert reading["kind"] == "SENTENCE"
        assert reading["civilization"] == "GREEK"
        # Republic X, 615a-b: tenfold for each wrong, in hundred-year periods.
        assert reading["repayment_multiple"] == 10
        assert reading["circuit_years"] == 1000
        # Two recorded wrongs, counted as deeds and not summed as weights: the
        # multiplier in Plato applies per wrong done, and 12 is this system's
        # own severity scale rather than anything the source grades by.
        assert reading["wrongs"] == 2
        assert "balance" not in reading, (
            "A net merit-minus-demerit balance is the Chinese instrument. "
            "Plato does not net a good life against a term owed — 615b requites "
            "well-doing on its own road, in its own measure."
        )
        assert "heart_weight" not in reading
        assert "culpa" not in reading

    def test_greek_refuses_to_report_elapsed_time(self):
        """The one number the reading needs and the ledger does not hold.

        Same discipline as `poena` in the European reading: an explicit refusal
        with a reason, rather than a proxy derived from data that means
        something else.
        """
        soul = self._soul(self.tenants[Civilization.GREEK], merits=(30,), demerits=(12,))
        reading = LedgerService.get_ledger_summary(soul)["reading"]
        assert reading["elapsed_years"] is None
        # The null and the reason travel together, exactly as `poena` and
        # `poena_missing` do. A bare null names nothing a client can act on and
        # gives the panel nothing to say beyond an em-dash.
        assert reading["elapsed_missing"] == list(SENTENCE_MISSING_INPUTS)
        assert "elapsed_unavailable" not in reading, (
            "The English paragraph this field carried is copy, and copy belongs "
            "in the bundles now that the panel renders SENTENCE."
        )
        # Absence asserted as well as presence: a derived stand-in would sit
        # happily beside the None and nobody would notice.
        assert "years_served" not in reading
        assert "years_remaining" not in reading

    def test_greek_reports_the_right_hand_road_as_well_as_the_left(self):
        """The reading modelled one of Republic X's two roads and not the other.

        614c sends the just to the right and upward and the unjust to the left
        and downward; 615b requites well-doing "in the same measure" — the same
        tenfold, over the same thousand-year circuit. Building the reading out
        of `demerit_count` alone said the left-hand road and left the right one
        unsayable, so a soul who had done well got a reading that mentioned
        nothing it had done well.

        `benefactions` is a *count* of merit records for exactly the reason
        `wrongs` is a count of demerit records: the multiplier in Plato applies
        per deed done, and `weight` is this system's severity scale, which no
        source reckons a term of years by. Three benefactions of weights 9, 4
        and 5 are three, not eighteen — and this soul is built so that those two
        readings are different numbers.
        """
        soul = self._soul(
            self.tenants[Civilization.GREEK], merits=(9, 4, 5), demerits=(7, 5)
        )
        reading = LedgerService.get_ledger_summary(soul)["reading"]

        assert reading["wrongs"] == 2
        assert reading["benefactions"] == 3
        # One rule and one clock, not one of each per road. 615b's "same
        # measure" is the same measure, and 614c's two roads leave the same
        # judgment and return to the same meadow, so there is one circuit
        # length and one elapsed figure the ledger does not hold.
        assert reading["repayment_multiple"] == 10
        assert reading["circuit_years"] == 1000
        assert reading["elapsed_years"] is None
        assert reading["elapsed_missing"] == list(SENTENCE_MISSING_INPUTS)

    def test_greek_reports_a_road_even_when_the_other_is_empty(self):
        """A soul with nothing on one side still gets both roads reported.

        0 here is not the absence `elapsed_years` is. "No recorded wrongs" is
        something this ledger genuinely knows, and a road reported as 0 says it;
        dropping the field instead would make an empty road indistinguishable
        from a road this reading does not model — which is the state the whole
        change is undoing.
        """
        just = self._soul(self.tenants[Civilization.GREEK], merits=(4, 6))
        reading = LedgerService.get_ledger_summary(just)["reading"]
        assert reading["benefactions"] == 2
        assert reading["wrongs"] == 0

        unjust = self._soul(self.tenants[Civilization.GREEK], demerits=(4, 6, 8))
        reading = LedgerService.get_ledger_summary(unjust)["reading"]
        assert reading["benefactions"] == 0
        assert reading["wrongs"] == 3

    def test_greek_nets_neither_road_against_the_other(self):
        """Two parallel tenfold repayments, and nothing that is their arithmetic.

        The reason merit stayed out of this reading in the first place was that
        subtracting it would rebuild the Chinese account under a Greek name.
        Passing the merit count in is what makes that failure reachable, so the
        guard is a property over the whole payload rather than a check on the
        two fields anyone would think to look at: no value in this reading may
        be the difference of the two roads, their product, or `wrongs` and
        `benefactions` multiplied out by the repayment rule.

        The last of those is the `ef7df3d` prohibition applied to the new road.
        Tenfold repayment is a rule Republic X states, not a balance it
        computes; `3 × 10 = 30` is a quantity of nothing this system has a unit
        for, and printing it beside a term would read as a debt.

        The soul is built so that every forbidden figure is distinct from every
        permitted one — 9+4+5 merit weights over three records against 7+5
        demerit weights over two — so this cannot pass by coincidence.
        """
        soul = self._soul(
            self.tenants[Civilization.GREEK], merits=(9, 4, 5), demerits=(7, 5)
        )
        summary = LedgerService.get_ledger_summary(soul)
        reading = summary["reading"]

        # The netting reading this one refuses to be, computed here so the
        # numbers below are visibly the ones the payload must not contain.
        assert summary["merit_score"] == 18
        assert summary["demerit_score"] == 12
        assert summary["karmic_balance"] == 6

        forbidden = {
            1, -1,      # benefactions - wrongs, and its negation
            6, -6,      # the karmic balance, and its negation
            5,          # the two roads added together
            18, 12,     # the weight sums: counts, not magnitudes
            30, 20,     # each road multiplied out by the repayment rule
            10 * 5,     # ...and both roads multiplied out together
        }
        numbers = {
            v for v in reading.values()
            if isinstance(v, int) and not isinstance(v, bool)
        }
        assert not (numbers & forbidden), (
            "A Greek reading value is the arithmetic of the two roads. They are "
            "parallel repayments — 615b requites well-doing on its own road, in "
            "its own measure — and a difference, a sum or a product of them is "
            "the Chinese account wearing a Greek name."
        )

        # Exhaustive, not a spot check: a netted field cannot be added under a
        # name nobody thought to forbid.
        assert set(reading) == {
            "kind", "civilization", "wrongs", "benefactions",
            "repayment_multiple", "circuit_years",
            "elapsed_years", "elapsed_missing",
        }


# --------------------------------------------------------------------------
# The prose rule
# --------------------------------------------------------------------------

#: Reading fields that are still English sentences, and the survey behind the
#: exemption.
#:
#: The rule this qualifies is the blunt one
#: `apps/ledger/tests.py::test_the_rates_are_the_constants_and_no_prose_ships_with_them`
#: applies to the inheritance response: a returned string with a space in it is
#: prose that has crept into the service layer. Blunt on purpose — it does not
#: need to guess which key the next sentence would arrive under.
#:
#: Empty. It has one member's worth of history and the history is the point.
#:
#: `elapsed_unavailable` was exempt because the survey that removed
#: `poena_unavailable` and `reason` reached the opposite conclusion about it.
#: Those two were read by nothing and duplicated catalogue copy the panel had
#: already written, more completely, in three languages. `SoulReadingPanel.tsx`
#: had no SENTENCE branch at all and no bundle carried a Greek-sentence string,
#: so converting that one would have deleted an explanation and put nothing in
#: its place — the reason `fungibility.GRANULARITY_UNAVAILABLE` and
#: `services.TERMINAL_COSMOLOGY_REASON` still stay. It was listed rather than
#: skipped so that giving the Greek reading a panel had to come back past here.
#:
#: It did. The panel exists, the three bundles carry
#: `souls.detail.reading.elapsed_missing_*`, the field is
#: `SENTENCE_MISSING_INPUTS`, and the exemption is spent. Kept as an empty set
#: rather than deleted with it: an empty allow-list says the answer today is
#: *none*, which is a different claim from there being no rule.
PROSE_STILL_ALLOWED: set[tuple[str, str]] = set()


class TestNoProseInReadings:
    """No database: every builder is a pure function of its arguments."""

    CLASS_TOTALS = {"MONEY": {"merit": 10, "demerit": 4}}

    def _all_readings(self):
        for civ in Civilization:
            yield get_civilization_reading(
                civ.value, merit=30, demerit=12, merit_count=3, demerit_count=2,
                class_totals=self.CLASS_TOTALS,
            )
        # And the refusal, which is the fifth shape this module can return.
        yield get_civilization_reading(
            "NORSE", merit=30, demerit=12, merit_count=3, demerit_count=2
        )

    def test_a_reading_returns_identifiers_and_numbers_not_sentences(self):
        found = set()

        for reading in self._all_readings():
            for key, value in reading.items():
                if key == "non_fungible":
                    # fungibility.py's payload, not this module's. Its prose is
                    # argued and kept there, beside the machine-readable half
                    # (`granularity_applied`, GRANULARITY_MISSING_INPUTS) that
                    # answers the same question. Asserting it is still a dict is
                    # what stops this exemption becoming a hole a sentence fits
                    # through under a nested key.
                    assert isinstance(value, dict)
                    continue
                if isinstance(value, str):
                    candidates = [value]
                elif isinstance(value, list):
                    candidates = [v for v in value if isinstance(v, str)]
                else:
                    candidates = []
                for candidate in candidates:
                    if " " in candidate:
                        found.add((reading["kind"], key))

        assert found == PROSE_STILL_ALLOWED, (
            "A reading value with a space in it is English copy shipping out of "
            "the service layer. `poena_unavailable` and `reason` were removed "
            "for exactly that. An exact-set comparison rather than a subset one: "
            "a new sentence reddens this, and so does dropping an exempt field "
            "without saying so in PROSE_STILL_ALLOWED."
        )

    def test_the_members_are_identifiers_a_catalogue_key_can_be_built_from(self):
        """The frontend does `poena_missing_${member.toLowerCase()}`.

        A member with a space, a dash, or mixed case would produce a key no
        bundle has, and `t()` answers a missing key by returning the key — so
        the failure would be visible but ugly. Keeping the members to
        SCREAMING_SNAKE is what makes the derivation total.
        """
        for members in (
            POENA_MISSING_INPUTS, SENTENCE_MISSING_INPUTS, UNAVAILABLE_REASON_CODES,
        ):
            assert members, "an empty enumeration guards nothing"
            for member in members:
                assert re.fullmatch(r"[A-Z][A-Z_]*", member), member


# --------------------------------------------------------------------------
# The frontend has to be looking at the same members
# --------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[3]
LEDGER_TS = REPO_ROOT / "frontend" / "lib" / "api" / "ledger.ts"


def _ts_const_members(source: str, name: str) -> list[str]:
    """Pull `export const NAME = ["A", "B"] as const;` out of a TS module.

    Read as text for the reason `tests/test_workflow_preset_node_types.py`
    gives for doing the same to `workflow-templates.ts`: pytest has no
    TypeScript toolchain and Jest cannot reach this module. Raises rather than
    returning an empty list if the declaration is reformatted — a cross-end
    test that silently stops finding what it compares is worse than none.
    """
    match = re.search(
        rf"export const {name} = \[(?P<body>.*?)\] as const;", source, re.DOTALL
    )
    if match is None:
        raise AssertionError(
            f"{name} is no longer declared as `export const {name} = [...] as const;` "
            f"in {LEDGER_TS}. Fix this pattern; do not delete the comparison."
        )
    members = re.findall(r'"([A-Z_]+)"', match.group("body"))
    if not members:
        raise AssertionError(f"{name} parsed to an empty list in {LEDGER_TS}")
    return members


def _backend_reading_kinds() -> set[str]:
    """Every `kind` this module can put on the wire, by asking it.

    Enumerated by calling the builders rather than by keeping a fifth list of
    kind strings: forgetting to update a list is the entire failure this file
    guards, and a set derived from the builders cannot fall behind them. The
    refusal is included because the panel has to render it too.
    """
    kinds = {
        get_civilization_reading(
            civ.value, merit=30, demerit=12, merit_count=3, demerit_count=2,
            class_totals={"MONEY": {"merit": 10, "demerit": 4}},
        )["kind"]
        for civ in Civilization
    }
    kinds.add(
        get_civilization_reading(
            "NORSE", merit=0, demerit=0, merit_count=0, demerit_count=0
        )["kind"]
    )
    return kinds


class TestFrontendMemberListsAgree:
    """The two ends must enumerate the same members, not merely both have a list.

    `frontend/src/__tests__/SoulReadingPanel.test.tsx` checks that every member
    *the frontend knows about* has copy in all three bundles. That check is
    blind in exactly one direction: a member added here and not there is absent
    from the list it iterates, so it stays green while the real payload carries
    a member no bundle has a key for. Only a test on this side can see it, and
    this is it.
    """

    def test_poena_missing_inputs_are_the_same_on_both_ends(self):
        members = _ts_const_members(LEDGER_TS.read_text(), "POENA_MISSING_INPUTS")
        assert members == list(POENA_MISSING_INPUTS), (
            "POENA_MISSING_INPUTS disagree. The panel renders one bullet per "
            "member of the payload and keys its copy off the member name, so a "
            "member the frontend has never heard of reaches the screen as a raw "
            "key. Order matters too: it is the order the bullets appear in."
        )

    def test_unavailable_reason_codes_are_the_same_on_both_ends(self):
        members = _ts_const_members(LEDGER_TS.read_text(), "UNAVAILABLE_REASON_CODES")
        assert members == list(UNAVAILABLE_REASON_CODES), (
            "UNAVAILABLE_REASON_CODES disagree. Each code names two catalogue "
            "keys — `unavailable_<code>_explanation` and `..._cta` — and a code "
            "the frontend does not know about has neither."
        )

    def test_sentence_missing_inputs_are_the_same_on_both_ends(self):
        members = _ts_const_members(LEDGER_TS.read_text(), "SENTENCE_MISSING_INPUTS")
        assert members == list(SENTENCE_MISSING_INPUTS), (
            "SENTENCE_MISSING_INPUTS disagree. Same shape as poena_missing: the "
            "panel renders one bullet per member and derives the copy key from "
            "the member name, and the order is the order they appear in."
        )

    def test_every_kind_the_backend_can_send_has_a_frontend_member(self):
        """The seam the blank Greek panel actually came through.

        The two comparisons above are about members *inside* a reading. This one
        is about the reading's own discriminator, and it is the check whose
        absence let `f92ed35` ship a `kind` no frontend branch handled.

        Nothing on the TypeScript side could have caught it: the panel switched
        exhaustively over `LedgerReading`, and `LedgerReading` is declared in
        the frontend — so the switch was exhaustive over a union that was itself
        missing SENTENCE, `tsc` passed, the component returned `undefined`, and
        React 18 renders `undefined` as nothing. No error, no warning, no red
        test, just an empty card. Only a check reading the *backend's* kinds is
        positioned to see that, and this is it.

        Sets, not lists: a switch's branch order carries no meaning.
        """
        members = _ts_const_members(LEDGER_TS.read_text(), "READING_KINDS")
        assert len(members) == len(set(members)), f"duplicate kinds in {LEDGER_TS}"
        assert set(members) == _backend_reading_kinds(), (
            "The kinds the frontend can render and the kinds the backend can "
            "return have diverged. A kind only the backend knows renders as a "
            "blank panel — SoulReadingPanel's `default` branch turns that into "
            "a visible notice, but a notice is a symptom and this is the cause. "
            "A kind only the frontend knows is dead code claiming to handle "
            "something nothing sends."
        )
