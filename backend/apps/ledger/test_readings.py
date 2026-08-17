"""
Per-civilization ledger readings.

Split out of apps/ledger/tests.py and test_decay.py for the same reason those
two were split from each other: the 500-line limit.

The claim under test is that a net balance is the Chinese instrument, not a
shared primitive, and that serving it to everybody quietly applies one
cosmology's arithmetic to three. See apps/ledger/readings.py.
"""
import pytest

from apps.ledger.readings import MAAT_FEATHER_WEIGHT, get_civilization_reading
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
        assert reading["poena_unavailable"]

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
        assert reading["reason"]
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
        reading = get_civilization_reading("NORSE", merit=30, demerit=12, demerit_count=1)
        assert reading["kind"] == "UNAVAILABLE"
        assert reading["civilization"] == "NORSE"
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
        assert reading["elapsed_unavailable"]
        # Absence asserted as well as presence: a derived stand-in would sit
        # happily beside the None and nobody would notice.
        assert "years_served" not in reading
        assert "years_remaining" not in reading
