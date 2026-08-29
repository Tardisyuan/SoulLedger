"""A soul whose cosmology has no next life cannot be walked back into one.

`apps/reincarnation/views.py` states it plainly: writing REINCARNATING onto a
soul from a terminal cosmology "is the outcome SoulState.SETTLED exists to
prevent". That is why `complete()` and `reborn()` both call
`LedgerService.assert_rebirth_capable` first.

The gate was installed on those two doors. `POST /souls/{id}/transition/`
drove the same edge with no check at all. Measured 2026-08-29, an EG_DUAT soul
in DISPOSED:

    POST /transition/ {"new_state": "REINCARNATING"}  -> 200
    POST /transition/ {"new_state": "ALIVE"}          -> 200
    final: ALIVE, civilization EGYPTIAN, reincarnations=0,
           merit 900 / demerit 7 uninherited,
           the previous life's description still on the record

-- no Meng Po, no Lethe, no spell of forgetting. GUARDIAN, JUDGE and MODERATOR
all managed it; only VIEWER, which does not hold `soul.transition`, could not.

The action's own docstring argued that every other edge "is gated by its own
narrower codename that does not run through this action at all". That is a
statement about *call sites*. It is true, and it is not about which target
states this endpoint can drive.

The check now lives in `Soul.transition_to`, not on the action, because "which
doors have the gate" is the question that produced the hole.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.ledger.services import REBIRTH_CAPABLE_CIVILIZATIONS
from apps.souls.models import Civilization, Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()

# Derived from the same constant the service uses, so a cosmology that changes
# sides changes sides here too rather than leaving a stale hand-written list.
TERMINAL = sorted(set(Civilization.values) - set(REBIRTH_CAPABLE_CIVILIZATIONS))
REBIRTH_CAPABLE = sorted(REBIRTH_CAPABLE_CIVILIZATIONS)

CIV_TENANT = {
    Civilization.CHINESE: "CN_DIYU",
    Civilization.EUROPEAN: "EU_HEAVEN_HELL",
    Civilization.EGYPTIAN: "EG_DUAT",
    Civilization.GREEK: "GR_HADES",
}


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _soul_in(civilization, db):
    tenant = Tenant.objects.get_or_create(
        code=CIV_TENANT[civilization],
        defaults={"display_name": CIV_TENANT[civilization]},
    )[0]
    soul = Soul.objects.create(
        name=f"{civilization}Soul",
        current_state=SoulState.DISPOSED,
        tenant=tenant,
        death_year=1900, death_month=1, death_day=1,
    )
    assert soul.civilization == civilization, (
        f"civilization is derived from the tenant; got {soul.civilization}"
    )
    return soul, tenant


def test_the_two_lists_together_cover_every_civilization():
    """Guards against a split that silently drops one.

    If a new civilization appeared in neither list the parametrized tests
    below would simply not run for it, and nothing would say so.
    """
    assert set(TERMINAL) | set(REBIRTH_CAPABLE) == set(Civilization.values)
    assert TERMINAL and REBIRTH_CAPABLE, "one side is empty; nothing is being compared"


@pytest.mark.django_db
@pytest.mark.parametrize("civilization", TERMINAL)
def test_a_terminal_soul_cannot_be_transitioned_into_rebirth(civilization, db):
    soul, tenant = _soul_in(civilization, db)
    assert soul.transition_to(SoulState.REINCARNATING, "manual") is False
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED, (
        f"a {civilization} soul entered {soul.current_state}"
    )


@pytest.mark.django_db
@pytest.mark.parametrize("civilization", TERMINAL)
def test_the_api_refuses_it_too_and_says_so(civilization, db):
    """And the endpoint must not answer 200 to a request it declined."""
    soul, tenant = _soul_in(civilization, db)
    user = User.objects.create_user(
        username=f"tc_{civilization.lower()}", password="x",
        role="MODERATOR", tenant=tenant,
    )
    client = _jwt_client(user, tenant)

    resp = client.post(
        f"/api/v1/souls/{soul.pk}/transition/",
        {"new_state": "REINCARNATING"},
        format="json",
    )
    assert resp.status_code == 409, (
        f"got {resp.status_code}. A 200 here carries a serialized soul that "
        f"did not move -- the interface answers 'done' to a request it declined."
    )
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED


@pytest.mark.django_db
@pytest.mark.parametrize("civilization", REBIRTH_CAPABLE)
def test_a_rebirth_capable_soul_still_can(civilization, db):
    """Positive control. A gate that stops everything is an outage."""
    soul, _ = _soul_in(civilization, db)
    assert soul.transition_to(SoulState.REINCARNATING, "manual") is True
    soul.refresh_from_db()
    assert soul.current_state == SoulState.REINCARNATING


@pytest.mark.django_db
def test_the_two_doors_that_already_had_the_gate_still_have_it():
    """`assert_rebirth_capable` must keep refusing on the reincarnation routes.

    Moving the check into the model would be a poor trade if it silently
    replaced the 409 those endpoints already return.
    """
    from apps.ledger.services import LedgerService, RebirthNotApplicable

    soul, _ = _soul_in(Civilization.EGYPTIAN, None)
    with pytest.raises(RebirthNotApplicable):
        LedgerService.assert_rebirth_capable(soul)
