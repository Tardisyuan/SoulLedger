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


def test_no_match_goes_to_the_default_city_god_and_without_one_no_case_is_opened(hall, cn_tenant):
    """用户 2026-10-29:没有匹配也没有兜底城隍时不许开案(409 `no_city_god`),整笔回滚 —— 此前直接进十殿。"""
    from apps.realms.models import SoulPathEntry
    from apps.soul_accounts.models import SoulAccount

    soul = Soul.objects.create(name="无城隍", tenant=cn_tenant, current_state=SoulState.ALIVE,
                               origin_location="四川成都")
    events_before = list(SoulEvent.objects.filter(soul=soul).values_list("pk", flat=True))  # SOUL_CREATED
    with pytest.raises(city_gods.NoCityGodError) as refused:
        soul.die(death_date=date.today())
    assert refused.value.code == "no_city_god" and refused.value.status_code == 409
    soul = Soul.objects.get(pk=soul.pk)
    assert soul.current_state == SoulState.ALIVE and soul.death_year is None
    assert not Judgment.all_objects.filter(soul=soul).exists()
    assert not SoulAccount.objects.filter(soul=soul).exists()
    assert not SoulPathEntry.all_objects.filter(soul=soul).exists()
    assert list(SoulEvent.objects.filter(soul=soul).values_list("pk", flat=True)) == events_before

    default = CityGod.objects.create(tenant=cn_tenant, name="酆都城隍", is_default=True)
    assert _dead(cn_tenant, "四川成都").city_god == default
    assert _dead(cn_tenant, "").city_god == default


def test_every_way_of_opening_a_diyu_case_is_refused_without_a_city_god(hall, cn_tenant):
    """死亡登记(`/souls/{id}/die/`)、手开审判(`POST /judgment/` 给在世的灵魂)、土地公登记(与外部死亡同步同一条
    `DeathSyncService._process`)、勾魂交接:一律拒绝,什么都没写。手开那条走的是 `Soul.opening_fields`,不经
    `Soul.die` 的预检。"""
    from apps.death_sync.models import TudiGod
    from apps.death_sync.services import DeathSyncService
    from apps.dispatch import capture
    from apps.dispatch.models import CaptureWarrant

    lead = officer_client(hall["lead"])

    def alive(name):
        return Soul.objects.create(name=name, tenant=cn_tenant, current_state=SoulState.ALIVE,
                                   origin_location="四川成都", fated_death_year=2000, fated_death_month=1,
                                   fated_death_day=1)

    def untouched(soul):
        soul = Soul.objects.get(pk=soul.pk)
        return soul.current_state == SoulState.ALIVE and not Judgment.all_objects.filter(soul=soul).exists()

    died = alive("登记")
    res = lead.post(f"/api/v1/souls/{died.pk}/die/", {"death_date": "2026-09-01"}, format="json")
    assert (res.status_code, res.data["code"]) == (409, "no_city_god") and untouched(died)

    opened = alive("手开")
    res = lead.post("/api/v1/judgment/", {"soul": str(opened.pk), "court": "第一殿"}, format="json")
    assert (res.status_code, res.data["code"]) == (409, "no_city_god") and untouched(opened)

    tudi_soul = alive("土地")
    tudi = TudiGod.objects.create(tenant=cn_tenant, name="石桥村土地", regions=["石桥"])
    record = DeathSyncService.register_by_tudi(tudi, {"soul_lookup": {"soul_id": str(tudi_soul.pk)},
                                                      "death_date": "2026-10-01"})
    assert (record.status, record.error_code, record.judgment_id) == ("FAILED", "NO_CITY_GOD", None)
    assert untouched(tudi_soul)

    # 勾魂:发牒时就拒(2026-10-29),同一个 409 `no_city_god`;此前发牒、拘到都照走,到交接才拒。
    captured = alive("勾魂")
    with pytest.raises(city_gods.NoCityGodError):
        capture.issue(captured)
    assert untouched(captured)
    assert not CaptureWarrant.objects.filter(soul=captured).exists()

    # 设了兜底城隍,同一条土地公登记重试就过(NO_CITY_GOD 可重试,`RETRYABLE_ERRORS`)。
    CityGod.objects.create(tenant=cn_tenant, name="酆都城隍", is_default=True)
    retried = DeathSyncService.retry_failed(record.pk, cn_tenant)
    assert (retried.status, retried.error_code) == ("PROCESSED", "")
    assert Judgment.all_objects.get(soul=tudi_soul).city_god.name == "酆都城隍"


def test_the_city_gods_officers_are_told_after_commit(assigned, cn_tenant, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        _dead(cn_tenant, "杭州")
    note = UserNotification.objects.get(user=assigned["clerk"])
    assert note.notification_type == "CITY_GOD_CASE_RECEIVED" and "杭州府城隍" in note.message
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
    assert UserNotification.objects.get(user=assigned["lead"]).notification_type == "CITY_GOD_CASE_RETURNED"
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
    assert taken.status_code == 400 and taken.data["regions"]["code"] == "region_taken"
    assert (taken.data["regions"]["region"], taken.data["regions"]["city_god"]) == ("杭州", "杭州府城隍")
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


# ── 第五十三批:Design 要的几处 ────────────────────────────────────────


def test_a_case_names_the_region_that_decided_it_and_how_it_was_registered(assigned, cn_tenant):
    clerk = officer_client(assigned["clerk"])
    judgment = _dead(cn_tenant, "浙江省杭州市")
    row = clerk.get(f"{CASES}{judgment.pk}/").data
    assert (row["matched_region"], row["registered_via"]) == ("杭州", "OFFICER")
    CityGod.objects.create(tenant=cn_tenant, name="酆都城隍", is_default=True)
    assert clerk.get(f"{CASES}{_dead(cn_tenant, '四川').pk}/").data["matched_region"] is None


def test_the_editor_offers_the_halls_case_officers_to_admins_only(hall, cn_tenant, eu_tenant):
    sp.officer("eu_judge", "JUDGE", eu_tenant)
    choices = officer_client(hall["lead"]).get(f"{GODS}officer-choices/")
    assert choices.status_code == 200
    ids = {o["id"] for o in choices.data}
    assert {hall["clerk"].pk, hall["judge"].pk} <= ids and all(claims.is_assignable(sp_user, cn_tenant.pk)
                                                               for sp_user in _users(ids))
    assert officer_client(hall["judge"]).get(f"{GODS}officer-choices/").status_code == 403


def _users(ids):
    from apps.authentication.models import User

    return User.objects.filter(pk__in=ids)


def test_a_returned_case_is_listed_first_and_cannot_be_returned_again(assigned, cn_tenant):
    first, second = _dead(cn_tenant, "杭州"), _dead(cn_tenant, "杭州")
    city_gods.return_case(second.pk, assigned["clerk"], "生辰不详")
    ids = [r["id"] for r in officer_client(assigned["clerk"]).get(CASES).data["results"]]
    assert ids == [str(second.pk), str(first.pk)]
    detail = officer_client(assigned["clerk"]).get(f"{CASES}{second.pk}/").data
    assert detail["returned_at"] and detail["city_god_note"] == "生辰不详"
    assert officer_client(assigned["clerk"]).get(f"{CASES}{first.pk}/").data["returned_at"] is None
    with pytest.raises(city_gods.CityGodRefusedError):
        city_gods.return_case(second.pk, assigned["clerk"], "再退")


def test_a_city_god_without_officers_tells_the_hall_admins(hall, cn_tenant, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        _dead(cn_tenant, "杭州")
    note = UserNotification.objects.get(user=hall["lead"])
    assert note.notification_type == "CITY_GOD_CASE_RECEIVED"
    assert not UserNotification.objects.filter(user=hall["clerk"]).exists()


def test_city_god_notices_can_be_switched_off(assigned, cn_tenant, django_capture_on_commit_callbacks):
    assigned["clerk"].preferences = {"notifications": {"city_god": {"site": False}}}
    assigned["clerk"].save(update_fields=["preferences"])
    with django_capture_on_commit_callbacks(execute=True):
        _dead(cn_tenant, "杭州")
    assert not UserNotification.objects.filter(user=assigned["clerk"]).exists()


def test_the_officer_todo_has_a_city_god_group_for_its_officers_only(assigned, cn_tenant):
    from apps.officer_app import todo

    first, second = _dead(cn_tenant, "杭州"), _dead(cn_tenant, "杭州")
    city_gods.return_case(second.pk, assigned["clerk"], "生辰不详")
    group = todo.build(assigned["clerk"])["city_god"]
    assert group["count"] == 2 and [i["id"] for i in group["items"]] == [str(second.pk), str(first.pk)]
    assert group["items"][0]["city_god_status"] == "RETURNED"
    assert todo.build(assigned["lead"])["city_god"]["count"] == 0
    city_gods.send_on(first.pk, assigned["clerk"])
    assert todo.build(assigned["clerk"])["city_god"]["count"] == 1
