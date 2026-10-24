"""城隍初审(apps/judgment/city_gods.py,用户 2026-10-24 决定):按出身地分给城隍、解送之前十殿认领不了、
只有名下官员与殿管理员能办、租户隔离、别的文明不经城隍、横死的解送后仍押在枉死城。"""
from datetime import date, timedelta

import pytest

from apps.events.models import SoulEvent
from apps.judgment import city_gods, claims
from apps.judgment.claims import ClaimRefusedError
from apps.judgment.models import CityGod, Judgment
from apps.notifications.models import UserNotification
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

GODS = "/api/v1/judgment/city-gods/"
CASES = "/api/v1/judgment/city-god-cases/"


def _dead(tenant, location="", fated=None):
    soul = Soul.objects.create(name="张三", tenant=tenant, current_state=SoulState.ALIVE, origin_location=location)
    if fated:
        soul.fated_death_year, soul.fated_death_month, soul.fated_death_day = fated.year, fated.month, fated.day
        soul.save()
    return soul.die(death_date=date.today())


@pytest.fixture
def hall(cn_tenant):
    clerk = sp.officer("clerk", "JUDGE", cn_tenant)
    return {
        "clerk": clerk,
        "judge": sp.officer("court_judge", "JUDGE", cn_tenant),
        "lead": sp.officer("lead", "MODERATOR", cn_tenant),
        "zhejiang": CityGod.objects.create(tenant=cn_tenant, name="浙江都城隍", regions=["浙江"]),
        "hangzhou": CityGod.objects.create(tenant=cn_tenant, name="杭州府城隍", regions=["杭州"]),
    }


@pytest.fixture
def assigned(hall):
    hall["hangzhou"].officers.add(hall["clerk"])
    return hall


# ── 收案:按出身地 ──────────────────────────────────────────────────────


def test_the_most_specific_region_named_last_wins(hall, cn_tenant):
    assert _dead(cn_tenant, "浙江省杭州市").city_god == hall["hangzhou"]
    assert _dead(cn_tenant, "浙江宁波").city_god == hall["zhejiang"]
    judgment = _dead(cn_tenant, "浙江省杭州市")
    assert judgment.city_god_status == "PENDING"
    event = SoulEvent.objects.get(soul=judgment.soul, event_type="CITY_GOD_RECEIVED")
    assert event.payload["city_god_name"] == "杭州府城隍"


def test_no_match_goes_to_the_default_city_god_or_straight_to_the_courts(hall, cn_tenant):
    plain = _dead(cn_tenant, "四川成都")
    assert plain.city_god is None and plain.city_god_status == ""
    assert not SoulEvent.objects.filter(soul=plain.soul, event_type="CITY_GOD_RECEIVED").exists()
    default = CityGod.objects.create(tenant=cn_tenant, name="酆都城隍", is_default=True)
    assert _dead(cn_tenant, "四川成都").city_god == default
    assert _dead(cn_tenant, "").city_god == default


def test_the_city_gods_officers_are_told_after_commit(assigned, cn_tenant, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        _dead(cn_tenant, "杭州")
    note = UserNotification.objects.get(user=assigned["clerk"])
    assert note.params["kind"] == "city_god_case_received" and "杭州府城隍" in note.message
    assert not UserNotification.objects.filter(user=assigned["judge"]).exists()


def test_other_civilizations_never_reach_a_city_god(hall, eu_tenant, cn_tenant):
    judgment = _dead(eu_tenant, "杭州")
    assert judgment.city_god is None and judgment.city_god_status == ""
    claims.claim(judgment.pk, sp.officer("eu_judge", "JUDGE", eu_tenant))


# ── 解送之前十殿认领不了 ────────────────────────────────────────────────


def test_the_courts_cannot_claim_reassign_or_conclude_before_it_is_sent_on(assigned, cn_tenant):
    judgment = _dead(cn_tenant, "杭州")
    judge = assigned["judge"]
    for attempt in (lambda: claims.claim(judgment.pk, judge),
                    lambda: claims.reassign(judgment.pk, judge, actor=assigned["lead"]),
                    lambda: claims.lock_for_conclude(judgment.pk, judge)):
        with pytest.raises(ClaimRefusedError) as refused:
            attempt()
        assert refused.value.code == "at_city_god"
    client = officer_client(judge)
    response = client.post(f"/api/v1/judgment/{judgment.pk}/claim/")
    assert response.status_code == 409 and response.data["code"] == "at_city_god"
    assert client.get("/api/v1/judgment/queue-counts/").data["total"] == 0
    assert client.get("/api/v1/judgment/", {"group": "unclaimed"}).data["count"] == 0

    sent = officer_client(assigned["clerk"]).post(f"{CASES}{judgment.pk}/send_on/", {"note": "查无冤情"}, format="json")
    assert sent.status_code == 200, sent.data
    assert sent.data["city_god_status"] == "SENT_ON" and sent.data["can_act"] is False
    assert client.get("/api/v1/judgment/queue-counts/").data["total"] == 1
    assert client.post(f"/api/v1/judgment/{judgment.pk}/claim/").status_code == 200
    assert SoulEvent.objects.filter(soul=judgment.soul, event_type="CITY_GOD_SENT_ON").count() == 1


def test_an_untimely_death_is_still_held_after_it_is_sent_on(assigned, cn_tenant):
    judgment = _dead(cn_tenant, "杭州", fated=date.today() + timedelta(days=400))
    city_gods.send_on(judgment.pk, assigned["clerk"])
    with pytest.raises(ClaimRefusedError) as refused:
        claims.claim(judgment.pk, assigned["judge"])
    assert refused.value.code == "held_until_fated_date"


# ── 谁能办 ──────────────────────────────────────────────────────────────


def test_only_the_city_gods_officers_or_a_hall_admin_act(assigned, cn_tenant):
    judgment = _dead(cn_tenant, "杭州")
    outsider = officer_client(assigned["judge"])
    listed = outsider.get(CASES).data["results"]
    assert [row["id"] for row in listed] == [str(judgment.pk)] and listed[0]["can_act"] is False
    refused = outsider.post(f"{CASES}{judgment.pk}/send_on/", {}, format="json")
    assert refused.status_code == 403 and refused.data["code"] == "not_city_god_officer"
    # 浙江都城隍名下的官员也不能办杭州府城隍的案子
    assigned["zhejiang"].officers.add(assigned["judge"])
    assert outsider.post(f"{CASES}{judgment.pk}/send_on/", {}, format="json").status_code == 403
    assert officer_client(assigned["clerk"]).get(CASES, {"mine": "true"}).data["count"] == 1
    assert officer_client(assigned["lead"]).post(f"{CASES}{judgment.pk}/send_on/", {}, format="json").status_code == 200
    again = officer_client(assigned["lead"]).post(f"{CASES}{judgment.pk}/send_on/", {}, format="json")
    assert again.status_code == 409 and again.data["code"] == "not_at_city_god"


def test_return_needs_a_note_tells_the_admins_and_can_still_be_sent_on(assigned, cn_tenant,
                                                                      django_capture_on_commit_callbacks):
    judgment = _dead(cn_tenant, "杭州")
    clerk = officer_client(assigned["clerk"])
    assert clerk.post(f"{CASES}{judgment.pk}/return/", {}, format="json").status_code == 400
    with django_capture_on_commit_callbacks(execute=True):
        returned = clerk.post(f"{CASES}{judgment.pk}/return/", {"note": "生辰不详"}, format="json")
    assert returned.status_code == 200 and returned.data["city_god_status"] == "RETURNED"
    assert UserNotification.objects.get(user=assigned["lead"]).params["kind"] == "city_god_case_returned"
    assert SoulEvent.objects.filter(soul=judgment.soul, event_type="CITY_GOD_RETURNED").count() == 1
    assert clerk.post(f"{CASES}{judgment.pk}/return/", {"note": "再退"}, format="json").status_code == 409
    with pytest.raises(ClaimRefusedError):
        claims.claim(judgment.pk, assigned["judge"])
    assert clerk.post(f"{CASES}{judgment.pk}/send_on/", {}, format="json").status_code == 200


def test_transfer_is_for_hall_admins_and_stays_in_the_hall(assigned, cn_tenant, eu_tenant):
    judgment = _dead(cn_tenant, "杭州")
    body = {"city_god": str(assigned["zhejiang"].pk)}
    assert officer_client(assigned["clerk"]).post(f"{CASES}{judgment.pk}/transfer/", body,
                                                  format="json").status_code == 403
    moved = officer_client(assigned["lead"]).post(f"{CASES}{judgment.pk}/transfer/", body, format="json")
    assert moved.status_code == 200 and moved.data["city_god"] == assigned["zhejiang"].pk
    assert SoulEvent.objects.filter(soul=judgment.soul, event_type="CITY_GOD_RECEIVED").count() == 2
    foreign = CityGod.objects.create(tenant=eu_tenant, name="外殿")
    refused = officer_client(assigned["lead"]).post(f"{CASES}{judgment.pk}/transfer/",
                                                    {"city_god": str(foreign.pk)}, format="json")
    assert refused.status_code == 400 and refused.data["code"] == "invalid_city_god"


# ── 管理城隍 ────────────────────────────────────────────────────────────


def test_a_hall_admin_manages_city_gods_and_assigns_officers(hall, cn_tenant):
    lead = officer_client(hall["lead"])
    created = lead.post(GODS, {"name": "临安县城隍", "regions": ["临安", " ", "临安"],
                               "officer_ids": [hall["clerk"].pk]}, format="json")
    assert created.status_code == 201, created.data
    assert created.data["regions"] == ["临安"] and created.data["officers"][0]["id"] == hall["clerk"].pk
    taken = lead.post(GODS, {"name": "别的", "regions": ["杭州"]}, format="json")
    assert taken.status_code == 400 and "regions" in taken.data
    assert officer_client(hall["judge"]).post(GODS, {"name": "x"}, format="json").status_code == 403
    assert officer_client(hall["judge"]).get(GODS).data["count"] == 3
    judgment = _dead(cn_tenant, "杭州")
    busy = lead.delete(f"{GODS}{hall['hangzhou'].pk}/")
    assert busy.status_code == 409 and busy.data["code"] == "city_god_has_open_cases"
    city_gods.send_on(judgment.pk, hall["lead"])
    assert lead.delete(f"{GODS}{hall['hangzhou'].pk}/").status_code == 204


def test_city_gods_are_per_hall_and_only_in_diyu(hall, cn_tenant, eu_tenant):
    eu_lead = officer_client(sp.officer("eu_lead", "MODERATOR", eu_tenant))
    refused = eu_lead.post(GODS, {"name": "城隍"}, format="json")
    assert refused.status_code == 400 and refused.data["code"] == "city_gods_diyu_only"
    assert eu_lead.get(GODS).data["count"] == 0
    judgment = _dead(cn_tenant, "杭州")
    assert eu_lead.get(f"{CASES}{judgment.pk}/").status_code == 404
    assert eu_lead.post(f"{CASES}{judgment.pk}/send_on/", {}, format="json").status_code == 404
    outsider = sp.officer("eu_judge", "JUDGE", eu_tenant)
    bad = officer_client(hall["lead"]).patch(f"{GODS}{hall['hangzhou'].pk}/", {"officer_ids": [outsider.pk]},
                                             format="json")
    assert bad.status_code == 400 and "officer_ids" in bad.data
    assert not Judgment.objects.filter(city_god__tenant=eu_tenant).exists()
