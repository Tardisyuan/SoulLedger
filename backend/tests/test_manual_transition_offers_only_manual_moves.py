"""`POST /souls/{id}/transition/` offers only the moves people make by hand (2026-10-27 user decision, review #2):
death (ALIVE → JUDGING, needs soul.die) and missing / recalled (DISPOSED ⇄ LOST, with a reason). Every other legal
edge of the state machine belongs to a business action and is refused here, for every role that holds the codename."""
import pytest

from apps.authentication.models import User
from apps.souls.models import Soul, SoulState
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

BUSINESS_EDGES = [
    (SoulState.JUDGING, SoulState.DISPOSED),
    (SoulState.DISPOSED, SoulState.REINCARNATING),
    (SoulState.DISPOSED, SoulState.SETTLED),
    (SoulState.REINCARNATING, SoulState.ALIVE),
]


@pytest.mark.parametrize("role", ["ADMIN", "JUDGE"])  # MODERATOR 2026-11-07 起不持 soul.transition(403 在前)
@pytest.mark.parametrize(("start", "target"), BUSINESS_EDGES)
def test_business_edges_are_refused_by_hand(cn_tenant, role, start, target):
    user = User.objects.create_user(username=f"t_{role}", password="x", role=role, tenant=cn_tenant)
    soul = Soul.objects.create(name="手动", tenant=cn_tenant, current_state=start)
    assert soul.can_transition_to(target)  # a legal edge of the state machine, just not a manual one
    res = officer_client(user).post(f"/api/v1/souls/{soul.pk}/transition/",
                                    {"new_state": target, "reason": "by hand"}, format="json")
    assert (res.status_code, res.data.get("code")) == (409, "transition_not_manual"), res.data
    assert Soul.objects.get(pk=soul.pk).current_state == start


def test_the_lost_moves_are_still_offered(cn_tenant, admin_user):
    soul = Soul.objects.create(name="走失", tenant=cn_tenant, current_state=SoulState.DISPOSED)
    client = officer_client(admin_user)
    url = f"/api/v1/souls/{soul.pk}/transition/"
    assert client.post(url, {"new_state": SoulState.LOST, "reason": "途中走失"}, format="json").status_code == 200
    assert client.post(url, {"new_state": SoulState.DISPOSED, "reason": "寻回"}, format="json").status_code == 200
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.DISPOSED


def test_disposed_back_to_judging_is_a_system_only_edge(cn_tenant, admin_user):
    """DISPOSED → JUDGING exists for one system action (a refused Egyptian weighing, user 2026-10-27):
    the state machine allows it only when that action names itself, and never by hand."""
    soul = Soul.objects.create(name="重称", tenant=cn_tenant, current_state=SoulState.DISPOSED)
    assert not soul.can_transition_to(SoulState.JUDGING)
    assert not soul.can_transition_to(SoulState.JUDGING, system="something_else")
    assert soul.can_transition_to(SoulState.JUDGING, system="weighing_rejected")
    res = officer_client(admin_user).post(f"/api/v1/souls/{soul.pk}/transition/",
                                          {"new_state": SoulState.JUDGING, "reason": "by hand"}, format="json")
    assert res.status_code == 400, res.data
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.DISPOSED
    assert soul.transition_to(SoulState.JUDGING, "test", system="weighing_rejected")
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.JUDGING


def test_death_by_hand_opens_the_case_die_opens(cn_tenant, admin_user):
    """Review 2026-11-01 #4: ALIVE → JUDGING through /transition/ used to move the state only — a JUDGING soul with
    no case and no city god. It is now recorded as /die/ records it."""
    from apps.judgment.models import CityGodStatus, Judgment
    from tests.city_god_support import default_city_god

    city_god = default_city_god(cn_tenant)
    soul = Soul.objects.create(name="手报死亡", tenant=cn_tenant)
    res = officer_client(admin_user).post(f"/api/v1/souls/{soul.pk}/transition/",
                                          {"new_state": SoulState.JUDGING, "reason": "by hand"}, format="json")
    assert res.status_code == 200, res.data
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.JUDGING
    cases = list(Judgment.objects.filter(soul=soul))
    assert len(cases) == 1
    assert cases[0].city_god_id == city_god.pk and cases[0].city_god_status == CityGodStatus.PENDING


def test_death_by_hand_without_a_city_god_is_refused_and_leaves_nothing(cn_tenant, admin_user):
    from apps.judgment.models import Judgment

    soul = Soul.objects.create(name="无城隍", tenant=cn_tenant)
    res = officer_client(admin_user).post(f"/api/v1/souls/{soul.pk}/transition/",
                                          {"new_state": SoulState.JUDGING, "reason": "by hand"}, format="json")
    assert (res.status_code, res.data.get("code")) == (409, "no_city_god"), res.data
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.ALIVE
    assert not Judgment.objects.filter(soul=soul).exists()
