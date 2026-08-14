"""
Time-decay tests for LedgerService.

Split out of apps/ledger/tests.py (which covers the REST endpoints) to keep
both files under the 500-line limit.
"""
import pytest
from django.utils import timezone

from apps.ledger.services import CIVILIZATION_DECAY_RATE, DECAY_RATE, LedgerService
from apps.souls.models import Civilization, Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestLedgerDecayWithBCEDates:
    """Time-decay calculation for records with a BCE event_year.

    See apps.souls.dates.year_span and LedgerService._get_record_age_years:
    there is no year 0, so a deed in 612 BCE (-612) and a death in 580 BCE
    are 32 years apart, and 612 BCE to 2 CE is 613 years, not 614.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KBC_T1", defaults={"display_name": "Ledger BCE Tenant"}
        )[0]
        self.soul = Soul.objects.create(
            name="Ancient Egyptian Soul",
            current_state=SoulState.JUDGING,
            death_year=-580,
            tenant=self.tenant,
        )

    def test_bce_event_date_decays_correctly(self):
        SoulRecord.objects.create(
            soul=self.soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Built a temple", weight=100, event_year=-612,
        )
        summary = LedgerService.get_ledger_summary(self.soul)
        assert len(summary["records"]) == 1
        record = summary["records"][0]
        assert record["event_date"] == {"year": -612, "month": None, "day": None}
        # Deed-to-death, not deed-to-today. Fixed by the data, so unlike the
        # assertion this replaces it does not go stale on 1 January.
        assert record["years_elapsed"] == 32.0

    def test_bce_ce_boundary_still_drops_the_missing_year_zero(self):
        """A soul who lived across the boundary: 612 BCE to 2 CE is 613 years."""
        soul = Soul.objects.create(
            name="Boundary Soul", current_state=SoulState.JUDGING,
            death_year=2, tenant=self.tenant,
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Long-lived deed", weight=100, event_year=-612,
        )
        summary = LedgerService.get_ledger_summary(soul)
        assert summary["records"][0]["years_elapsed"] == 613.0

    def test_bce_and_ce_records_both_decay(self):
        SoulRecord.objects.create(
            soul=self.soul, record_type="MERIT", civilization="EGYPTIAN",
            description="Ancient deed", weight=50, event_year=-100,
        )
        SoulRecord.objects.create(
            soul=self.soul, record_type="DEMERIT", civilization="EGYPTIAN",
            description="Recent deed", weight=50, event_year=2020, event_month=1, event_day=1,
        )
        result = LedgerService.recalculate_soul_ledger(self.soul)
        # Nothing should blow up crossing the BCE/CE boundary. The 2020 CE
        # record post-dates this soul's death by two and a half millennia and
        # is clamped to a span of 0, so it keeps its full weight rather than
        # being amplified.
        assert result["merit_score"] >= 0
        assert result["demerit_score"] == 50


@pytest.mark.django_db
class TestDecayAnchoredToDeath:
    """Decay measures deed-to-death, not deed-to-today.

    The point of the anchor change: the same life produces the same ledger
    whenever it happened. Measured to today, a 612 BCE deed retained
    3.5e-12 of its weight, so every ancient soul scored 0/0 and
    disposition's `karma >= 0` routed it to heaven.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KDA_T1", defaults={"display_name": "Ledger Anchor Tenant"}
        )[0]

    def _soul_who_lived_seventy_years(self, death_year):
        """Deeds at age 20 and age 65 for a soul who died at 70."""
        soul = Soul.objects.create(
            name=f"Soul dead in {death_year}",
            current_state=SoulState.JUDGING,
            death_year=death_year,
            tenant=self.tenant,
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="CHINESE",
            description="deed at 20", weight=100, event_year=death_year - 50,
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="CHINESE",
            description="deed at 65", weight=100, event_year=death_year - 5,
        )
        return soul

    @pytest.mark.parametrize("death_year", [-612, 1500, 2020])
    def test_same_life_same_ledger_in_every_era(self, death_year):
        """612 BCE, 1500 CE and 2020 CE must produce identical decay."""
        soul = self._soul_who_lived_seventy_years(death_year)
        summary = LedgerService.get_ledger_summary(soul)
        by_deed = {r["description"]: r for r in summary["records"]}

        early, late = by_deed["deed at 20"], by_deed["deed at 65"]
        assert early["years_elapsed"] == 50.0
        assert late["years_elapsed"] == 5.0
        # e^(-0.01 × 50) and e^(-0.01 × 5), to the payload's 4dp.
        assert early["decay_factor"] == 0.6065
        assert late["decay_factor"] == 0.9512
        assert early["effective_weight"] == 60.65
        assert late["effective_weight"] == 95.12
        # The 1.57× recency gradient decay was always supposed to express,
        # and which used to collapse into float noise for ancient souls.
        assert summary["merit_score"] == 156

    def test_living_soul_still_measures_to_today(self):
        """A living soul's story is still running, so today is the anchor."""
        soul = Soul.objects.create(
            name="Still Alive", current_state=SoulState.ALIVE, tenant=self.tenant,
        )
        this_year = timezone.now().year
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="CHINESE",
            description="Ten years back", weight=100, event_year=this_year - 10,
        )
        record = LedgerService.get_ledger_summary(soul)["records"][0]
        assert 9.0 <= record["years_elapsed"] <= 11.0
        assert 0.89 <= record["decay_factor"] <= 0.92

    def test_deed_after_death_is_clamped_not_amplified(self):
        """e^(-r·y) with a negative y inflates a weight. Never allow it."""
        soul = Soul.objects.create(
            name="Posthumous Record", current_state=SoulState.JUDGING,
            death_year=1900, tenant=self.tenant,
        )
        SoulRecord.objects.create(
            soul=soul, record_type="DEMERIT", civilization="CHINESE",
            description="Recorded 50 years too late", weight=100, event_year=1950,
        )
        record = LedgerService.get_ledger_summary(soul)["records"][0]
        assert record["years_elapsed"] == 0.0
        assert record["decay_factor"] == 1.0
        # Un-clamped this would have been 100 × e^(0.5) ≈ 164.87.
        assert record["effective_weight"] == 100.0

    def test_dead_soul_without_a_death_year_falls_back_to_today(self):
        """No anchor to use, so degrade to the old behaviour explicitly."""
        soul = Soul.objects.create(
            name="Undated Death", current_state=SoulState.JUDGING, tenant=self.tenant,
        )
        assert soul.death_year is None
        this_year = timezone.now().year
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="CHINESE",
            description="Twenty years back", weight=100, event_year=this_year - 20,
        )
        record = LedgerService.get_ledger_summary(soul)["records"][0]
        assert 19.0 <= record["years_elapsed"] <= 21.0

    def test_record_without_an_event_year_respects_the_death_anchor(self):
        """The recorded_at fallback must be anchored too, not left on today."""
        soul = Soul.objects.create(
            name="No Event Date", current_state=SoulState.JUDGING,
            death_year=1850, tenant=self.tenant,
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="CHINESE",
            description="Undated deed", weight=100,
        )
        record = LedgerService.get_ledger_summary(soul)["records"][0]
        assert record["event_date"] is None
        # recorded_at is now(), long after an 1850 death, so the span clamps
        # to 0 rather than running the clock from today back to the deed.
        assert record["years_elapsed"] == 0.0
        assert record["decay_factor"] == 1.0

    def test_dead_souls_scores_do_not_drift_with_the_calendar(self):
        """Judgments must be reproducible: the same soul, the same number."""
        soul = self._soul_who_lived_seventy_years(1500)
        first = LedgerService.recalculate_soul_ledger(soul)
        second = LedgerService.recalculate_soul_ledger(soul)
        assert first["merit_score"] == second["merit_score"] == 156


@pytest.mark.django_db
class TestSummaryAndRecalculateAgree:
    """One soul, one score, whichever function you ask.

    recalculate_soul_ledger writes soul.merit_score by accumulating the
    unrounded decayed weight and rounding the total once. get_ledger_summary
    used to round each record to 2dp *before* accumulating, so for the same
    records it could report an integer one point away from the denormalised
    field the rest of the system reads — and the summary is what /ledger/
    serves and what the rebirth carryover applies, via
    get_reincarnation_inheritance.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="LSA_T1", defaults={"display_name": "Ledger Agreement Tenant"}
        )[0]

    def _soul_with_n_identical_deeds(self, count, weight, years):
        # Full month/day precision on both ends so the span is exactly
        # `years` — a year-only anchor is estimated at day 183 (see
        # _day_of_year) and would smear the decay factors these cases turn on.
        soul = Soul.objects.create(
            name=f"{count}×{weight} at {years}y", current_state=SoulState.JUDGING,
            death_year=1900, death_month=1, death_day=1, tenant=self.tenant,
        )
        for i in range(count):
            SoulRecord.objects.create(
                soul=soul, record_type="MERIT", civilization="CHINESE",
                description=f"deed {i}", weight=weight,
                event_year=1900 - years, event_month=1, event_day=1,
            )
        return soul

    def test_one_record_is_already_enough_to_split_the_two(self):
        """It is not an accumulation problem — one rounded part is enough.

        A single deed of weight 25, two years before death: 25·e^(-0.02) is
        24.50496…, which rounds to 25. Displayed at 2dp it is 24.5, which
        rounds to 24 (ties-to-even). Same records, same instant, two scores.
        """
        soul = self._soul_with_n_identical_deeds(count=1, weight=25, years=2)

        summary = LedgerService.get_ledger_summary(soul)
        recalculated = LedgerService.recalculate_soul_ledger(soul)

        # The record still *displays* at two decimal places, unchanged.
        assert summary["records"][0]["effective_weight"] == 24.5
        # ...but the total is the exact one, not the displayed one rounded.
        assert summary["merit_score"] == 25
        assert recalculated["merit_score"] == 25

    def test_display_rounding_does_not_accumulate_across_records(self):
        """Five deeds of weight 1, ten years back: 5·e^(-0.1) is 4.5242 → 5,
        five displayed 0.9s sum to exactly 4.5 → 4."""
        soul = self._soul_with_n_identical_deeds(count=5, weight=1, years=10)

        summary = LedgerService.get_ledger_summary(soul)
        recalculated = LedgerService.recalculate_soul_ledger(soul)

        assert summary["records"][0]["effective_weight"] == 0.9
        assert summary["merit_score"] == 5
        assert recalculated["merit_score"] == 5

    def test_summary_matches_the_denormalised_field_it_is_compared_against(self):
        soul = self._soul_with_n_identical_deeds(count=1, weight=25, years=2)
        LedgerService.recalculate_soul_ledger(soul)
        soul.refresh_from_db()

        summary = LedgerService.get_ledger_summary(soul)
        assert summary["merit_score"] == soul.merit_score
        assert summary["demerit_score"] == soul.demerit_score
        assert summary["karmic_balance"] == soul.karmic_balance


@pytest.mark.django_db
class TestDecayIsPerCivilization:
    """European deeds do not fade; everyone else's still do.

    The published European heading is 审判与补赎 — judgment and satisfaction,
    where reduction comes from contrition and the act performed, never from
    elapsed time. It shipped on top of a global DECAY_RATE with no civilization
    branch, so the label and the arithmetic under it said opposite things.
    """

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
            )
        }

    def _soul_with_an_old_deed(self, tenant, record_type="MERIT"):
        """One deed of weight 100, fifty years before a 1900 death."""
        soul = Soul.objects.create(
            name=f"{tenant.code} soul", current_state=SoulState.JUDGING,
            death_year=1900, death_month=1, death_day=1, tenant=tenant,
        )
        SoulRecord.objects.create(
            soul=soul, record_type=record_type, description="deed at 20",
            weight=100, event_year=1850, event_month=1, event_day=1,
        )
        return soul

    def test_european_deed_keeps_its_original_weight_forever(self):
        soul = self._soul_with_an_old_deed(self.tenants[Civilization.EUROPEAN])
        record = LedgerService.get_ledger_summary(soul)["records"][0]
        # The span is still reported — fifty years did pass, and that is a fact
        # about the deed. It just no longer costs the deed anything.
        assert record["years_elapsed"] == 50.0
        assert record["decay_factor"] == 1.0
        assert record["effective_weight"] == 100.0

    @pytest.mark.parametrize("civ", [Civilization.CHINESE, Civilization.EGYPTIAN])
    def test_every_other_cosmology_still_decays_at_one_percent(self, civ):
        soul = self._soul_with_an_old_deed(self.tenants[civ])
        record = LedgerService.get_ledger_summary(soul)["records"][0]
        # e^(-0.01 × 50), unchanged.
        assert record["decay_factor"] == 0.6065
        assert record["effective_weight"] == 60.65

    def test_the_same_life_scores_differently_under_the_two_rules(self):
        """The behaviour change, stated as a number: 61 becomes 100."""
        european = self._soul_with_an_old_deed(self.tenants[Civilization.EUROPEAN])
        chinese = self._soul_with_an_old_deed(self.tenants[Civilization.CHINESE])
        assert LedgerService.recalculate_soul_ledger(european)["merit_score"] == 100
        assert LedgerService.recalculate_soul_ledger(chinese)["merit_score"] == 61

    def test_a_european_demerit_does_not_fade_either(self):
        """Not an amnesty in one direction only — guilt keeps its weight too."""
        soul = self._soul_with_an_old_deed(
            self.tenants[Civilization.EUROPEAN], record_type="DEMERIT"
        )
        result = LedgerService.recalculate_soul_ledger(soul)
        assert result["demerit_score"] == 100
        assert result["karmic_balance"] == -100

    def test_an_unmapped_tenant_keeps_the_default_rate(self):
        """Decay is a house rule about recency, not a claim about a doctrine.

        Unlike the *reading* of a ledger, which refuses to guess, an unmapped
        cosmology can safely keep DECAY_RATE — leaving it there attributes
        nothing to anyone.
        """
        tenant = Tenant.objects.get_or_create(
            code="DPC_UNMAPPED", defaults={"display_name": "Unmapped"}
        )[0]
        soul = self._soul_with_an_old_deed(tenant)
        assert soul.civilization == "UNKNOWN"
        assert LedgerService._decay_rate_for(soul) == DECAY_RATE
        assert LedgerService.get_ledger_summary(soul)["records"][0]["decay_factor"] == 0.6065

    def test_rate_is_configuration_not_a_hardcoded_civilization(self):
        """GREEK arrives soon with its own answer; it must be one entry."""
        assert isinstance(CIVILIZATION_DECAY_RATE, dict)
        assert CIVILIZATION_DECAY_RATE[Civilization.EUROPEAN] == 0.0
        assert CIVILIZATION_DECAY_RATE[Civilization.CHINESE] == DECAY_RATE
        assert CIVILIZATION_DECAY_RATE[Civilization.EGYPTIAN] == DECAY_RATE


@pytest.mark.django_db
class TestMilestoneIsAMarkerNotAMultiplier:
    """`is_milestone` stars a deed in the timeline. It does not weigh it.

    The field's help_text promised "weight is doubled" from the day it landed,
    and nothing ever doubled anything — LedgerService applies _decay_weight and
    stops. These tests pin the decision that the text was the bug, so that a
    later reading of the old promise cannot quietly turn a display flag into a
    balance multiplier.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
        )[0]

    def _soul_with(self, *, is_milestone: bool) -> Soul:
        """One deed of weight 100, fifty years before a 1900 death."""
        soul = Soul.objects.create(
            name=f"milestone={is_milestone}", current_state=SoulState.JUDGING,
            death_year=1900, death_month=1, death_day=1, tenant=self.tenant,
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", description="deed at 20",
            weight=100, event_year=1850, event_month=1, event_day=1,
            is_milestone=is_milestone,
        )
        return soul

    def test_a_milestone_deed_weighs_exactly_what_an_ordinary_one_weighs(self):
        plain = LedgerService.get_ledger_summary(self._soul_with(is_milestone=False))
        starred = LedgerService.get_ledger_summary(self._soul_with(is_milestone=True))

        assert starred["records"][0]["effective_weight"] == 60.65
        assert (
            starred["records"][0]["effective_weight"]
            == plain["records"][0]["effective_weight"]
        ), "is_milestone changed the arithmetic — it is a marker, not a multiplier"

    def test_the_recalculated_score_does_not_move_either(self):
        plain = LedgerService.recalculate_soul_ledger(self._soul_with(is_milestone=False))
        starred = LedgerService.recalculate_soul_ledger(self._soul_with(is_milestone=True))
        assert starred["merit_score"] == plain["merit_score"] == 61

    def test_the_flag_still_reaches_the_client(self):
        """Inert in the arithmetic is not the same as dropped on the floor.

        The lifecycle timeline stars and tints on this value, so the summary
        has to keep carrying it.
        """
        summary = LedgerService.get_ledger_summary(self._soul_with(is_milestone=True))
        assert summary["records"][0]["is_milestone"] is True

    def test_the_help_text_does_not_promise_a_multiplier(self):
        """The original defect was a sentence, so a test has to read it."""
        help_text = SoulRecord._meta.get_field("is_milestone").help_text
        assert "doubl" not in help_text.lower(), (
            f"help_text promises weighting the ledger does not do: {help_text!r}"
        )
