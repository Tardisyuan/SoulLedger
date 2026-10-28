"""The 42 denials of BD 125B, heard one by one in a weighed case (2026-10-28; docs/02_奥西里斯审判详解.md §2.2, §四).

One row per assessor heard (`NegativeConfession`): true / not true / not yet decided, and a note. Read and written
on the judgment desk; frozen with the verdict; only a weighed Egyptian case hears them.
"""
import io

import pytest
from django.core.management import call_command

from apps.judgment.models import Judgment, JudgmentMethod, NegativeConfession
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded():
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())


def _case(code="EG_DUAT", method=JudgmentMethod.HEART_WEIGHING, civilization="EGYPTIAN"):
    tenant = Tenant.objects.get(code=code)
    soul = Soul.objects.create(name="Ani", tenant=tenant, current_state=SoulState.JUDGING)
    return Judgment.objects.create(soul=soul, tenant=tenant, civilization=civilization, court="—",
                                   judgment_method=method)


def test_the_listing_is_the_halls_42_in_assessor_order(seeded, admin_user):
    case = _case()
    res = officer_client(admin_user).get(f"/api/v1/judgment/{case.pk}/negative-confessions/")
    assert res.status_code == 200, res.data
    assert res.data["applies"] is True and res.data["concluded"] is False
    assert [row["ordinal"] for row in res.data["items"]] == list(range(1, 43))
    assert res.data["items"][0]["code"] == "EG-NC-01" and res.data["items"][0]["text"]
    assert {row["truthful"] for row in res.data["items"]} == {None}
    assert res.data["tally"] == {"truthful": 0, "untruthful": 0, "unheard": 42, "total": 42}


def test_recording_one_denial_and_changing_it(seeded, admin_user):
    case = _case()
    client = officer_client(admin_user)
    url = f"/api/v1/judgment/{case.pk}/negative-confessions/7/"
    res = client.put(url, {"truthful": False, "note": "the granary ledger"}, format="json")
    assert res.status_code == 200, res.data
    row = res.data["items"][6]
    assert (row["ordinal"], row["truthful"], row["note"]) == (7, False, "the granary ledger")
    assert res.data["tally"] == {"truthful": 0, "untruthful": 1, "unheard": 41, "total": 42}
    res = client.put(url, {"truthful": True}, format="json")
    assert res.data["tally"]["truthful"] == 1 and res.data["tally"]["untruthful"] == 0
    assert NegativeConfession.objects.filter(judgment=case).count() == 1  # one row per assessor, updated
    assert NegativeConfession.objects.get(judgment=case).create_user_id == admin_user.pk


def test_a_concluded_case_is_frozen(seeded, admin_user):
    case = _case()
    Judgment.objects.filter(pk=case.pk).update(verdict="PASSED", is_final=True)
    res = officer_client(admin_user).put(f"/api/v1/judgment/{case.pk}/negative-confessions/1/",
                                         {"truthful": True}, format="json")
    assert res.status_code == 409 and res.data["code"] == "concluded", res.data
    assert not NegativeConfession.objects.filter(judgment=case).exists()


def test_a_case_that_is_not_weighed_hears_no_denials(seeded, admin_user):
    client = officer_client(admin_user)
    european = _case(code="EU_HEAVEN_HELL", method=JudgmentMethod.STANDARD, civilization="EUROPEAN")
    res = client.get(f"/api/v1/judgment/{european.pk}/negative-confessions/")
    assert res.status_code == 200 and res.data["applies"] is False and res.data["items"] == []
    assert res.data["tally"] is None
    res = client.put(f"/api/v1/judgment/{european.pk}/negative-confessions/1/", {"truthful": True}, format="json")
    assert res.status_code == 400 and res.data["code"] == "not_weighed", res.data


def test_an_assessor_the_hall_has_not_seeded_is_404(seeded, admin_user):
    case = _case()
    res = officer_client(admin_user).put(f"/api/v1/judgment/{case.pk}/negative-confessions/43/",
                                         {"truthful": True}, format="json")
    assert res.status_code == 404 and res.data["code"] == "unknown_clause", res.data
