"""ADMIN may open a case the state rules refuse for everyone else.

BD-08 added two rules to `JudgmentSerializer.validate_soul`: a SETTLED soul is
final, and a soul with an open case cannot be given a second one. They shipped
on 2026-09-12 applying to ADMIN too, because the only exemption in that method
came from `same_tenant_or_404_message`, which exempts ADMIN from *tenant
ownership* and nothing else.

The user's decision the same day: ADMIN is exempt from these two as well. ADMIN
is the role that repairs data, and the states these rules refuse — a settled
soul that was settled in error, a case stuck open — are exactly the states that
need repairing. A JUDGE still gets 400; that half is what BD-08 was for, and it
is pinned here so the exemption cannot quietly widen into "nobody is checked".
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.judgment.models import Judgment
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()
URL = "/api/v1/judgment/"


def _jwt_client(user, tenant):
    from rest_framework_simplejwt.tokens import RefreshToken

    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def bench(db):
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "Chinese Diyu"})[0]
    judge = User.objects.create_user(username="ex_judge", password="x", role="JUDGE", tenant=cn)
    admin = User.objects.create_user(username="ex_admin", password="x", role="ADMIN", tenant=cn)
    settled = Soul.objects.create(name="Settled Soul", current_state=SoulState.SETTLED, tenant=cn)
    busy = Soul.objects.create(name="Busy Soul", current_state=SoulState.JUDGING, tenant=cn)
    Judgment.objects.create(soul=busy, civilization="CHINESE", tenant=cn)
    return {
        "cn": cn,
        "settled": settled,
        "busy": busy,
        "judge": _jwt_client(judge, cn),
        "admin": _jwt_client(admin, cn),
    }


@pytest.mark.django_db
def test_admin_may_open_a_case_on_a_settled_soul(bench):
    resp = bench["admin"].post(
        URL, {"soul": str(bench["settled"].id), "court": "第一殿"}, format="json"
    )

    assert resp.status_code == 201, resp.data
    assert Judgment.all_objects.filter(soul=bench["settled"]).count() == 1


@pytest.mark.django_db
def test_admin_may_open_a_second_case_on_a_soul_that_already_has_one(bench):
    resp = bench["admin"].post(URL, {"soul": str(bench["busy"].id), "court": "第一殿"}, format="json")

    assert resp.status_code == 201, resp.data
    assert Judgment.all_objects.filter(soul=bench["busy"]).count() == 2


@pytest.mark.django_db
def test_a_judge_is_still_refused_on_both(bench):
    """The exemption is ADMIN's alone — without this, "exempt" could mean "removed"."""
    settled = bench["judge"].post(
        URL, {"soul": str(bench["settled"].id), "court": "第一殿"}, format="json"
    )
    busy = bench["judge"].post(URL, {"soul": str(bench["busy"].id), "court": "第一殿"}, format="json")

    assert settled.status_code == 400, settled.data
    assert busy.status_code == 400, busy.data
    assert "soul" in settled.data and "soul" in busy.data
    # And nothing was written by either refusal.
    assert Judgment.all_objects.filter(soul=bench["settled"]).count() == 0
    assert Judgment.all_objects.filter(soul=bench["busy"]).count() == 1
