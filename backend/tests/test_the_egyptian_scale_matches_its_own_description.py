"""A heart carrying recorded wrongs is heavier than the feather.

`MAAT_FEATHER_WEIGHT` (apps/ledger/readings.py) is justified in prose: "1 is
the smallest weight a SoulRecord can carry ... Choosing it says: a heart with
any recorded wrongdoing beyond a single minimal deed is heavier than the
feather. That is a harsh instrument, and it is meant to be."

`heart_weight` is the *decayed and rounded* demerit total, and EGYPTIAN was
sharing the generic `DECAY_RATE`. Measured 2026-08-29: three recorded wrongs of
weight 1 decayed to a heart_weight of 1 and passed the weighing, and so did a
single wrong of weight 3 committed 150 years before death.

The same file had already made this exact argument for EUROPEAN -- "a label
that contradicts the arithmetic under it is worse than either alone" -- and
given it a rate of 0.0. Nobody carried it across. The Duat does not forget
with time; the 42 negative confessions are not a decaying score.

`apps/ledger/test_readings.py` could not see this. Its `_soul` helper dates
every deed in the year of death -- its own docstring says so: "so decay is
exactly 1.0 and the only thing the reading sees is the weights themselves".
That is a reasonable way to test the reading and it makes the decay rate
invisible by construction. Every case here deliberately crosses years.
"""
import pytest

from apps.ledger.services import CIVILIZATION_DECAY_RATE, LedgerService
from apps.souls.models import Civilization, Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant


@pytest.fixture
def egyptian_soul(db):
    tenant = Tenant.objects.get_or_create(
        code="EG_DUAT", defaults={"display_name": "Duat"}
    )[0]
    soul = Soul.objects.create(
        name="Weighed", current_state=SoulState.JUDGING, tenant=tenant,
        death_year=2000, death_month=1, death_day=1,
    )
    assert soul.civilization == Civilization.EGYPTIAN
    return soul


def test_the_duat_does_not_forget_with_time():
    assert CIVILIZATION_DECAY_RATE[Civilization.EGYPTIAN] == 0.0, (
        "EGYPTIAN carries a decay rate. `heart_weight` is the decayed demerit "
        "total, so any rate at all means a wrong committed long enough before "
        "death weighs nothing -- while MAAT_FEATHER_WEIGHT's own comment "
        "promises the opposite."
    )


@pytest.mark.django_db
@pytest.mark.parametrize("years_before_death", [0, 10, 150])
def test_a_single_recorded_wrong_outweighs_the_feather_however_old(
    egyptian_soul, years_before_death
):
    """The age of the deed must not be what decides the weighing."""
    SoulRecord.objects.create(
        soul=egyptian_soul,
        record_type="DEMERIT",
        description="a recorded wrong",
        weight=3,
        event_year=2000 - years_before_death,
        event_month=1,
        event_day=1,
        tenant=egyptian_soul.tenant,
    )
    egyptian_soul.refresh_from_db()
    reading = LedgerService.get_ledger_summary(egyptian_soul)["reading"]
    assert reading["heavier_than_feather"] is True, (
        f"a wrong committed {years_before_death} years before death left the "
        f"heart at {reading['heart_weight']}, lighter than the feather "
        f"({reading['counterweight']})"
    )


@pytest.mark.django_db
def test_a_heart_with_nothing_recorded_still_passes(egyptian_soul):
    """Negative control. A scale that always says 'heavy' weighs nothing."""
    reading = LedgerService.get_ledger_summary(egyptian_soul)["reading"]
    assert reading["heavier_than_feather"] is False, (
        "a soul with no recorded wrongdoing failed the weighing"
    )
