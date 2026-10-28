"""The unburied and the unpaid do not cross (2026-10-28; docs/01_希腊冥府整体架构.md §2.3).

Il. 23.71-74: Patroclus' shade, unburied, cannot cross the river. Aen. 6.298-330: Charon ferries only the buried.
Lucian, De luctu 10: an obol for the ferryman. `Soul.ferry_passage` records either; while it is set the soul waits on
the bank of Acheron (where the death put it) and its first-instance case can be neither claimed nor concluded.
"""
from datetime import date

import pytest

from apps.authentication.models import User
from apps.judgment import claims
from apps.judgment.claims import ClaimRefusedError
from apps.judgment.models import JudgmentKind
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from apps.tenants.overview import hall_row
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def gr_tenant():
    return Tenant.objects.get_or_create(code="GR_HADES", defaults={"display_name": "Hades"})[0]


@pytest.fixture
def judge(gr_tenant):
    return User.objects.create_user(username="gr_judge", role="JUDGE", tenant=gr_tenant)


def _dead(tenant, passage=""):
    soul = Soul.objects.create(name="Patroclus", tenant=tenant, current_state=SoulState.ALIVE, ferry_passage=passage)
    return soul, soul.die(death_date=date.today())


@pytest.mark.parametrize("passage", ["UNBURIED", "NO_FARE"])
def test_an_unferried_soul_waits_on_the_bank(gr_tenant, judge, admin_user, passage):
    soul, case = _dead(gr_tenant, passage)
    for act in (lambda: claims.claim(case.pk, judge), lambda: case.conclude("PASSED")):
        with pytest.raises(ClaimRefusedError) as refused:
            act()
        assert refused.value.code == "unferried"
        assert refused.value.extra == {"ferry_passage": passage}
    assert hall_row(gr_tenant)["judgments"]["held"] == 1
    # Buried at last: the officer clears it and the case can be heard. Nothing on the case moved.
    res = officer_client(admin_user).patch(f"/api/v1/souls/{soul.pk}/", {"ferry_passage": ""}, format="json")
    assert res.status_code == 200, res.data
    claims.claim(case.pk, judge)
    assert hall_row(gr_tenant)["judgments"]["held"] == 0


def test_a_buried_soul_crosses_as_before(gr_tenant, judge):
    _soul, case = _dead(gr_tenant)
    claims.claim(case.pk, judge)


def test_only_the_first_instance_waits(gr_tenant, judge):
    """An appeal or a reopen comes after the crossing: the soul is past the river already."""
    soul, case = _dead(gr_tenant, "UNBURIED")
    case.kind = JudgmentKind.REOPEN
    case.save(update_fields=["kind"])
    claims.claim(case.pk, judge)


def test_only_a_greek_soul_waits_on_that_bank(gr_tenant, admin_user):
    client = officer_client(admin_user)
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN_DIYU"})[0]
    chinese = Soul.objects.create(name="c", tenant=cn)
    res = client.patch(f"/api/v1/souls/{chinese.pk}/", {"ferry_passage": "UNBURIED"}, format="json")
    assert res.status_code == 400 and "ferry_passage" in res.data, res.data
    greek = Soul.objects.create(name="g", tenant=gr_tenant)
    res = client.patch(f"/api/v1/souls/{greek.pk}/", {"ferry_passage": "NO_FARE"}, format="json")
    assert res.status_code == 200 and res.data["ferry_passage"] == "NO_FARE", res.data
