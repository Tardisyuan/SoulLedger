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


@pytest.mark.parametrize("role", ["ADMIN", "MODERATOR", "JUDGE"])
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
