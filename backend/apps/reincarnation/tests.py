"""
Tests for ReincarnationService — ledger carryover and the rebirth gate.

These cover the service, not the API surface; /api/v1/reincarnation/ view
tests live in tests/test_reincarnation_api.py.
"""
import pytest

from apps.ledger.services import LedgerService, RebirthNotApplicable
from apps.reincarnation.models import (
    SIX_PATHS,
    THREE_EVIL_PATHS,
    THREE_GOOD_PATHS,
    RebirthForm,
)
from apps.reincarnation.services import ReincarnationService
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant


def _tenant(code):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]


def _soul_ready_for_rebirth(tenant, merit, demerit):
    return Soul.objects.create(
        name="Carryover Soul",
        current_state=SoulState.REINCARNATING,
        merit_score=merit,
        demerit_score=demerit,
        tenant=tenant,
    )


def _soul_with_ledger_records(tenant, merit_weight, demerit_weight, death_year=2000):
    """A dead soul whose effective ledger comes from real SoulRecords dated
    at death (decay_factor exactly 1.0), not from a merit_score/demerit_score
    set by hand — complete_rebirth now carries over what the records say,
    not the denormalised fields, so tests that want an exact carryover
    number have to earn it the same way. Mirrors
    apps.ledger.tests.TestInheritanceMeritDemeritSplit's setup.
    """
    soul = Soul.objects.create(
        name="Carryover Soul",
        current_state=SoulState.REINCARNATING,
        death_year=death_year,
        tenant=tenant,
    )
    if merit_weight:
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="CHINESE",
            description="Merit deed", weight=merit_weight, event_year=death_year,
        )
    if demerit_weight:
        SoulRecord.objects.create(
            soul=soul, record_type="DEMERIT", civilization="CHINESE",
            description="Demerit deed", weight=demerit_weight, event_year=death_year,
        )
    return soul


class TestSixPaths:
    """六道轮回 — docs/07_六道轮回详解.md §一 lists six paths; the enum used to
    offer four, so the product shipped a UI advertising 六道轮回 over a model
    that could not record half of them.
    """

    def test_all_six_paths_exist(self):
        assert set(SIX_PATHS) == {
            RebirthForm.DIVINE,
            RebirthForm.HUMAN,
            RebirthForm.ASURA,
            RebirthForm.ANIMAL,
            RebirthForm.HUNGRY_GHOST,
            RebirthForm.HELL_BEING,
        }

    def test_choices_are_in_doctrinal_order_with_other_last(self):
        """三善道 best-to-worst, then 三恶道 worst-to-worst, then the legacy
        escape hatch. Order is what the admin dropdown and any generated
        client enum render in, so it is worth pinning."""
        assert [value for value, _label in RebirthForm.choices] == [
            "DIVINE", "HUMAN", "ASURA", "ANIMAL", "HUNGRY_GHOST", "HELL_BEING", "OTHER",
        ]

    def test_labels(self):
        assert dict(RebirthForm.choices) == {
            "DIVINE": "Deva (Heaven Path)",
            "HUMAN": "Human (Human Path)",
            "ASURA": "Asura (Demigod Path)",
            "ANIMAL": "Animal (Beast Path)",
            "HUNGRY_GHOST": "Hungry Ghost",
            "HELL_BEING": "Hell Being",
            "OTHER": "Other (Unclassified)",
        }

    def test_good_and_evil_paths_partition_the_six(self):
        assert len(THREE_GOOD_PATHS) == len(THREE_EVIL_PATHS) == 3
        assert not set(THREE_GOOD_PATHS) & set(THREE_EVIL_PATHS)

    def test_other_is_not_one_of_the_six(self):
        """OTHER survives only so pre-existing rows stay readable. If it ever
        drifts back into SIX_PATHS the六道 count silently becomes seven."""
        assert RebirthForm.OTHER not in SIX_PATHS
        assert len(RebirthForm.choices) == len(SIX_PATHS) + 1

    def test_longest_value_fits_the_column(self):
        from apps.reincarnation.models import Reincarnation

        max_length = Reincarnation._meta.get_field("rebirth_form").max_length
        assert max(len(v) for v in RebirthForm.values) <= max_length


@pytest.mark.django_db
class TestRebirthIntoEachPath:
    """Every path must survive a real rebirth, not just exist in the enum.

    complete_rebirth writes rebirth_form straight through — there is no
    if/elif over the form anywhere in the backend (routing is done on realm
    codes in DispositionService), so nothing can quietly drop a new value
    into a fallback branch. This pins that.
    """

    @pytest.mark.parametrize("form", list(SIX_PATHS))
    def test_soul_can_be_reborn_into_any_of_the_six(self, form):
        soul = _soul_ready_for_rebirth(_tenant("CN_DIYU"), merit=10, demerit=0)
        reincarnation = ReincarnationService.complete_rebirth(
            soul=soul, new_identity="Again", rebirth_form=form.value,
        )
        reincarnation.refresh_from_db()
        assert reincarnation.rebirth_form == form.value
        assert reincarnation.get_rebirth_form_display() == form.label
        soul.refresh_from_db()
        assert soul.current_state == SoulState.ALIVE

    def test_full_clean_accepts_the_new_paths(self):
        """Model-level validation (and therefore DRF's ModelSerializer, which
        derives its ChoiceField from the same choices) must take them."""
        from apps.reincarnation.models import Reincarnation

        soul = _soul_ready_for_rebirth(_tenant("CN_DIYU"), merit=0, demerit=0)
        for form in (RebirthForm.ASURA, RebirthForm.HUNGRY_GHOST, RebirthForm.HELL_BEING):
            record = Reincarnation(
                soul=soul, target_realm="DY_COURT_05_YANLUO", rebirth_form=form.value,
                cycle_count=1, tenant=soul.tenant,
            )
            record.full_clean(exclude=["disposition"])


@pytest.mark.django_db
class TestLedgerCarryover:
    """The rebirth math and the reporting endpoint must share one basis."""

    def test_merit_thins_and_demerit_carries_in_full(self):
        soul = _soul_with_ledger_records(_tenant("CN_DIYU"), merit_weight=100, demerit_weight=100)
        ReincarnationService.complete_rebirth(soul=soul, new_identity="Reborn")
        soul.refresh_from_db()
        assert soul.merit_score == 20
        # Was 20 under the old symmetric factor — dying is not an amnesty.
        assert soul.demerit_score == 100

    def test_demerit_does_not_erode_across_cycles(self):
        """0.2 → 0.04 → 0.008 used to let three lives erase anything."""
        tenant = _tenant("CN_DIYU")
        soul = _soul_with_ledger_records(tenant, merit_weight=0, demerit_weight=1000)
        for cycle in range(3):
            soul.current_state = SoulState.REINCARNATING
            # complete_rebirth clears death_year on the way out (rebirth
            # resets the soul to ALIVE); put it back before each cycle so
            # the demerit record's decay_factor stays 1.0 and this loop is
            # only ever exercising INHERITANCE_DEMERIT, not the unrelated
            # (and, for a soul with no death date, calendar-drifting) decay
            # measured against today.
            soul.death_year = 2000
            soul.save()
            ReincarnationService.complete_rebirth(soul=soul, new_identity=f"Life {cycle}")
            soul.refresh_from_db()
        assert soul.demerit_score == 1000

    def test_rebirth_applies_exactly_what_the_inheritance_endpoint_reports(self):
        """The invariant the two used to violate: same soul, same moment,
        same number — whether you ask for it or whether it gets applied.

        Denormalised merit_score/demerit_score are forced out of sync with
        the records here (bypassing Soul.save(), the same way a soft-deleted
        or edited record — which doesn't re-trigger SoulRecord's own
        recalculation hook — or a stale nightly ledger.recalculate_all run
        would leave them) specifically because that drift is what the old
        complete_rebirth read from. Against the pre-fix code this test fails:
        it multiplied the stale 9999/9999 by INHERITANCE_MERIT/DEMERIT
        instead of going through get_reincarnation_inheritance, landing on
        2000/9999 instead of 20/50.
        """
        tenant = _tenant("CN_DIYU")
        soul = Soul.objects.create(
            name="Drifted Soul",
            current_state=SoulState.REINCARNATING,
            death_year=2000,
            tenant=tenant,
        )
        SoulRecord.objects.create(
            soul=soul, record_type="MERIT", civilization="CHINESE",
            description="Repaired the bridge", weight=100, event_year=2000,
        )
        SoulRecord.objects.create(
            soul=soul, record_type="DEMERIT", civilization="CHINESE",
            description="Burned the granary", weight=50, event_year=2000,
        )
        Soul.objects.filter(pk=soul.pk).update(merit_score=9999, demerit_score=9999)
        soul.refresh_from_db()
        assert soul.merit_score == 9999
        assert soul.demerit_score == 9999

        reported = LedgerService.get_reincarnation_inheritance(soul)
        assert reported["inherited_merit"] == 20
        assert reported["inherited_demerit"] == 50

        ReincarnationService.complete_rebirth(soul=soul, new_identity="Reborn Again")
        soul.refresh_from_db()

        assert soul.merit_score == reported["inherited_merit"] == 20
        assert soul.demerit_score == reported["inherited_demerit"] == 50


@pytest.mark.django_db
class TestRebirthGate:
    """A terminal cosmology has no next life, so nothing may be reborn into it."""

    def test_chinese_soul_can_be_reborn(self):
        soul = _soul_ready_for_rebirth(_tenant("CN_DIYU"), merit=10, demerit=0)
        reincarnation = ReincarnationService.complete_rebirth(soul=soul, new_identity="Again")
        assert reincarnation.cycle_count == 1
        soul.refresh_from_db()
        assert soul.current_state == SoulState.ALIVE

    @pytest.mark.parametrize("code", ["EG_DUAT", "EU_HEAVEN_HELL"])
    def test_terminal_cosmology_cannot_be_reborn(self, code):
        soul = _soul_ready_for_rebirth(_tenant(code), merit=10, demerit=50)
        with pytest.raises(RebirthNotApplicable) as excinfo:
            ReincarnationService.complete_rebirth(soul=soul, new_identity="Should not happen")
        assert excinfo.value.status_code == 409
        assert excinfo.value.detail["code"] == "REBIRTH_NOT_APPLICABLE"

    def test_gate_fires_before_anything_is_written(self):
        """No Reincarnation row, no ledger change, no state change."""
        from apps.reincarnation.models import Reincarnation

        soul = _soul_ready_for_rebirth(_tenant("EG_DUAT"), merit=10, demerit=50)
        with pytest.raises(RebirthNotApplicable):
            ReincarnationService.complete_rebirth(soul=soul, new_identity="Should not happen")
        soul.refresh_from_db()
        assert Reincarnation.objects.filter(soul=soul).count() == 0
        assert soul.merit_score == 10
        assert soul.demerit_score == 50
        assert soul.current_state == SoulState.REINCARNATING


@pytest.mark.django_db
class TestReincarnationTenant:
    """
    M15/A4 regression coverage: `complete_rebirth` used to call
    `Reincarnation.objects.create(...)` without a `tenant=` kwarg, leaving
    the row with `tenant=NULL` even though `Reincarnation` already ships an
    `all_objects = models.Manager()` alongside the tenant-aware `objects`
    manager — infrastructure for tenant scoping that this call site never
    actually used.
    """

    def test_reincarnation_record_inherits_soul_tenant(self):
        tenant = _tenant("CN_DIYU")
        soul = _soul_ready_for_rebirth(tenant, merit=10, demerit=0)
        reincarnation = ReincarnationService.complete_rebirth(soul=soul, new_identity="Again")
        assert reincarnation.tenant_id == tenant.id

    def test_reincarnation_record_is_visible_under_a_tenant_scoped_query(self):
        """Regression guard: with tenant=NULL this row would not show up
        under a tenant-scoped filter, and would leak into every other
        tenant's unfiltered-by-mistake query instead."""
        from apps.reincarnation.models import Reincarnation

        tenant = _tenant("CN_DIYU")
        other_tenant = _tenant("EU_HEAVEN_HELL")
        soul = _soul_ready_for_rebirth(tenant, merit=10, demerit=0)
        reincarnation = ReincarnationService.complete_rebirth(soul=soul, new_identity="Again")
        assert Reincarnation.objects.filter(pk=reincarnation.pk, tenant=tenant).exists()
        assert not Reincarnation.objects.filter(pk=reincarnation.pk, tenant=other_tenant).exists()
