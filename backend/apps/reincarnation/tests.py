"""
Tests for ReincarnationService — karma carryover and the rebirth gate.

These cover the service, not the API surface; /api/v1/reincarnation/ view
tests live in tests/test_reincarnation_api.py.
"""
import pytest

from apps.karma.services import RebirthNotApplicable
from apps.reincarnation.services import ReincarnationService
from apps.souls.models import Soul, SoulState
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


@pytest.mark.django_db
class TestKarmaCarryover:
    """The rebirth math and the reporting endpoint must share one constant."""

    def test_merit_thins_and_demerit_carries_in_full(self):
        soul = _soul_ready_for_rebirth(_tenant("CN_DIYU"), merit=100, demerit=100)
        ReincarnationService.complete_rebirth(soul=soul, new_identity="Reborn")
        soul.refresh_from_db()
        assert soul.merit_score == 20
        # Was 20 under the old symmetric factor — dying is not an amnesty.
        assert soul.demerit_score == 100

    def test_demerit_does_not_erode_across_cycles(self):
        """0.2 → 0.04 → 0.008 used to let three lives erase anything."""
        tenant = _tenant("CN_DIYU")
        soul = _soul_ready_for_rebirth(tenant, merit=0, demerit=1000)
        for cycle in range(3):
            soul.current_state = SoulState.REINCARNATING
            soul.save()
            ReincarnationService.complete_rebirth(soul=soul, new_identity=f"Life {cycle}")
            soul.refresh_from_db()
        assert soul.demerit_score == 1000

    def test_uses_the_karma_service_constants_not_local_literals(self):
        from apps.karma.services import INHERITANCE_DEMERIT, INHERITANCE_MERIT
        from apps.reincarnation import services as reincarnation_services
        assert reincarnation_services.INHERITANCE_MERIT is INHERITANCE_MERIT
        assert reincarnation_services.INHERITANCE_DEMERIT is INHERITANCE_DEMERIT


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
        """No Reincarnation row, no karma change, no state change."""
        from apps.reincarnation.models import Reincarnation

        soul = _soul_ready_for_rebirth(_tenant("EG_DUAT"), merit=10, demerit=50)
        with pytest.raises(RebirthNotApplicable):
            ReincarnationService.complete_rebirth(soul=soul, new_identity="Should not happen")
        soul.refresh_from_db()
        assert Reincarnation.objects.filter(soul=soul).count() == 0
        assert soul.merit_score == 10
        assert soul.demerit_score == 50
        assert soul.current_state == SoulState.REINCARNATING
