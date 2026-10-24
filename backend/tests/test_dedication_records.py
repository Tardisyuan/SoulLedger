"""超度回向(2026-10-24 用户决定):官员代登的功德，只对审判中、受刑中的灵魂有效。"""
import pytest
from rest_framework.test import APIClient

from apps.souls.models import Soul, SoulState

pytestmark = pytest.mark.django_db


def _post(user, soul, **body):
    client = APIClient()
    client.force_authenticate(user)
    data = {"record_type": "MERIT", "category": "DEDICATION", "description": "家人为其诵经七日", "weight": 5, **body}
    return client.post(f"/api/v1/souls/{soul.pk}/add_record/", data, format="json")


@pytest.mark.parametrize("state, ok", [(SoulState.JUDGING, True), (SoulState.DISPOSED, True),
                                       (SoulState.ALIVE, False), (SoulState.REINCARNATING, False)])
def test_a_dedication_reaches_only_a_soul_under_judgment_or_sentence(cn_tenant, admin_user, state, ok):
    soul = Soul.objects.create(name="亡者", tenant=cn_tenant, current_state=state)
    assert (_post(admin_user, soul).status_code == 201) is ok


def test_a_dedication_is_merit(cn_tenant, admin_user):
    soul = Soul.objects.create(name="亡者", tenant=cn_tenant, current_state=SoulState.JUDGING)
    assert _post(admin_user, soul, record_type="DEMERIT").status_code == 400
