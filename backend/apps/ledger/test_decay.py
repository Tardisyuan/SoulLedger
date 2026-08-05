"""
Time-decay tests for LedgerService.

Split out of apps/ledger/tests.py (which covers the REST endpoints) to keep
both files under the 500-line limit.
"""
import pytest
from django.utils import timezone

from apps.ledger.services import LedgerService
from apps.souls.models import Soul, SoulState
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
