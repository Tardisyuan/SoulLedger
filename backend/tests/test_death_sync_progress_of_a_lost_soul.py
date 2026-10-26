"""Review #13 (2026-10-27): a soul that went missing in transit was reported back to an external system as
`registered`, a step behind the `sentenced` it had already shown. LOST is only reachable from DISPOSED."""
from types import SimpleNamespace

import pytest

from apps.death_sync.models import DeathRegistrationStatus
from apps.death_sync.services import progress_of
from apps.souls.models import Soul, SoulState

pytestmark = pytest.mark.django_db


def test_a_lost_soul_stays_sentenced(cn_tenant):
    soul = Soul.objects.create(name="走失", tenant=cn_tenant, current_state=SoulState.LOST)
    registration = SimpleNamespace(pk="r", status=DeathRegistrationStatus.PROCESSED, soul=soul,
                                   judgment=SimpleNamespace(cycle=0, city_god_status=""))
    progress = progress_of(registration)
    assert (progress["stage"], progress["soul_state"]) == ("sentenced", SoulState.LOST)
