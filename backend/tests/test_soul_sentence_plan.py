"""灵魂端「我的受刑」(App 画布 app-civ/sentence 1a–1d):`GET /api/v1/me/sentence-plan/` 与四种推送的落点。

计划一律走真实服务路径建(`tests/sentence_plan_support.py`),不手写节点 —— 合并表要对的是
服务真正写出来的状态,而不是测试以为它会写的。
"""
import json

import pytest

from apps.judgment.models import Judgment
from apps.sentence_plan.models import SentenceNode, SentencePlan
from apps.soul_push.models import PushDelivery
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client, ready_soul
from tests.soul_push_support import enqueued, register  # noqa: F401

pytestmark = pytest.mark.django_db
ME = "/api/v1/me/sentence-plan/"
PLANS = "/api/v1/sentence-plans/"
STATION_KEYS = {"id", "n", "status", "is_home", "civilization", "realm", "sentence_years", "is_eternal",
                "started_on", "ends_on"}


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


@pytest.fixture
def eg():
    return plan.tenant("EG_DUAT")


@pytest.fixture
def eu():
    return plan.tenant("EU_HEAVEN_HELL")


@pytest.fixture
def judges(cn, eg, eu):
    return {code: plan.officer(f"judge_{code}", "JUDGE", t) for code, t in (("cn", cn), ("eg", eg), ("eu", eu))}


def _planned_soul(home, stops, name="受刑魂"):
    """带账号(与一台设备)的计划灵魂:原属第 1 站 ACTIVE,`stops` 依次 PENDING。返回 (soul, plan, client)。"""
    account, client = ready_soul(home, name=name)
    assert register(client).status_code in (200, 201)  # 同一台设备换灵魂登录是 200
    soul = account.soul
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=home)
    if stops:
        plan.bench(case, stops)
    case.conclude("PASSED", "")
    soul.refresh_from_db()
    return soul, SentencePlan.all_objects.get(soul=soul), client


def _three_stops(cn, eg, eu):
    return _planned_soul(cn, [(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])


def _get(client):
    response = client.get(ME)
    assert response.status_code == 200, response.data
    return response.data


def _statuses(data):
    return [s["status"] for s in data["stations"]]


def _sentence_pushes():
    return list(PushDelivery.objects.filter(kind__startswith="sentence_").order_by("created_at"))


# ── 读 ───────────────────────────────────────────────────────────────────


def test_a_fresh_plan_is_served_at_home_with_the_rest_not_started(cn, eg, eu):
    soul, p, client = _three_stops(cn, eg, eu)
    data = _get(client)
    assert set(data) == {"state", "rebirth_open", "stations"}
    assert (data["state"], data["rebirth_open"]) == ("serving", True)
    assert [set(s) for s in data["stations"]] == [STATION_KEYS] * 3
    assert [(s["n"], s["status"], s["civilization"], s["is_home"]) for s in data["stations"]] == [
        (1, "active", "CHINESE", True), (2, "pending", "EGYPTIAN", False), (3, "pending", "EUROPEAN", False)]
    assert data["stations"][1]["realm"]["realm_code"] == plan.stop_realm(eg)
    assert data["stations"][1]["sentence_years"] == 5


def test_a_soul_without_a_plan_gets_the_empty_state(cn):
    _, client = ready_soul(cn, name="无计划")
    assert _get(client) == {"state": "none", "rebirth_open": True, "stations": []}


def test_another_souls_plan_and_another_tenants_plan_are_invisible(cn, eg, eu):
    _, other_home, _ = _three_stops(cn, eg, eu)
    _, other_tenant, _ = _planned_soul(eg, [], name="埃及魂")
    _, client = ready_soul(cn, name="旁观魂")
    assert _get(client)["stations"] == []
    soul, mine, client = _planned_soul(cn, [], name="本人")
    ids = {s["id"] for s in _get(client)["stations"]}
    assert ids == {str(n.pk) for n in SentenceNode.all_objects.filter(plan=mine)}
    others = {str(n.pk) for n in SentenceNode.all_objects.filter(plan__in=[other_home, other_tenant])}
    assert others and not ids & others


def test_an_officer_token_is_refused(cn, judges):
    assert officer_client(judges["cn"]).get(ME).status_code in (401, 403)


def test_officer_only_fields_never_leave(cn, eg, eu):
    soul, p, client = _three_stops(cn, eg, eu)
    SentenceNode.all_objects.filter(plan=p).update(reason="SECRET-REASON")
    SentencePlan.all_objects.filter(pk=p.pk).update(cancel_reason="SECRET-CANCEL")
    body = json.dumps(_get(client), ensure_ascii=False)
    for absent in ("SECRET", "reason", "disposition", "dispatch", "request", "tenant_code", "order",
                   str(p.pk), str(p.origin_judgment_id)):
        assert absent not in body, absent


def test_dispatching_is_shown_as_not_started_and_the_plan_as_between_stations(cn, eg, eu):
    soul, p, client = _three_stops(cn, eg, eu)
    plan.serve(soul, p, 1)
    assert plan.node(p, 2).status == "DISPATCHING"
    data = _get(client)
    assert (data["state"], _statuses(data)) == ("between", ["done", "pending", "pending"])
    assert "DISPATCHING" not in json.dumps(data) and "dispatching" not in json.dumps(data)


def test_a_station_served_abroad_carries_its_dates(cn, eg, eu):
    soul, p, client = _three_stops(cn, eg, eu)
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    second = plan.node(p, 2)
    [_, current, _] = _get(client)["stations"]
    assert current["status"] == "active"
    start = second.activated_at.date()
    assert current["started_on"] == start.isoformat()
    assert current["ends_on"] == start.replace(year=start.year + 5).isoformat()


def test_a_removed_station_is_gone_entirely_and_the_rest_renumber(cn, eg, eu, judges):
    soul, p, client = _three_stops(cn, eg, eu)
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    third = plan.node(p, 3)
    PushDelivery.objects.all().delete()
    req = officer_client(judges["eu"]).post(f"{PLANS}{p.pk}/requests/",
                                            {"kind": "AMEND", "changes": {"remove": [str(third.pk)]}}, format="json")
    assert req.status_code == 201, req.data
    decided = officer_client(judges["cn"]).post(f"{PLANS}{p.pk}/requests/{req.data['id']}/decide/",
                                                {"decision": "ACCEPT"}, format="json")
    assert decided.status_code == 200, decided.data
    third.refresh_from_db()
    assert third.status == "REMOVED"
    data = _get(client)
    assert [s["n"] for s in data["stations"]] == [1, 2]
    assert str(third.pk) not in json.dumps(data) and "removed" not in json.dumps(data).lower()
    # 计划变了(站数 3 → 2)要推;没有新站可标「新」。
    [push] = _sentence_pushes()
    assert (push.kind, push.data) == ("sentence_amended", {"screen": "Life", "kind": "sentence_amended", "node_ids": []})


def test_an_added_station_is_pushed_once_and_named_for_the_new_tag(cn, eg, eu, judges):
    soul, p, client = _three_stops(cn, eg, eu)
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    PushDelivery.objects.all().delete()
    req = officer_client(judges["eu"]).post(
        f"{PLANS}{p.pk}/requests/",
        {"kind": "AMEND", "changes": {"add": [{"realm_code": plan.stop_realm(eu), "sentence_years": 2}]}},
        format="json")
    assert req.status_code == 201, req.data
    officer_client(judges["cn"]).post(f"{PLANS}{p.pk}/requests/{req.data['id']}/decide/", {"decision": "ACCEPT"},
                                      format="json")
    added = SentenceNode.all_objects.get(plan=p, added_by_request_id=req.data["id"])
    [push] = _sentence_pushes()
    assert (push.kind, push.title, push.data["node_ids"]) == ("sentence_amended", "受刑计划有变动", [str(added.pk)])
    assert [s["status"] for s in _get(client)["stations"]][-1] == "pending"


def test_waiting_is_its_own_state_and_is_pushed_once_with_its_station(cn, eg, eu):
    soul, p, client = _three_stops(cn, eg, eu)
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    Judgment.objects.create(soul=soul, tenant=eg, civilization=soul.civilization)
    PushDelivery.objects.all().delete()
    plan.serve(soul, p, 2)
    data = _get(client)
    assert (data["state"], _statuses(data)) == ("waiting", ["done", "waiting", "pending"])
    [push] = _sentence_pushes()
    assert (push.kind, push.title) == ("sentence_waiting", "一站刑满，暂留原地")
    assert push.data["node_ids"] == [str(plan.node(p, 2).pk)]


def test_cancelling_strikes_the_unserved_stations_as_pardoned(cn, eg, eu, judges):
    soul, p, client = _three_stops(cn, eg, eu)
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    PushDelivery.objects.all().delete()
    mod = plan.officer("cn_mod", "MODERATOR", cn)
    assert officer_client(mod).post(f"{PLANS}{p.pk}/cancel/", {"reason": "复核"}, format="json").status_code == 200
    data = _get(client)
    # 在受的那站 ABORTED(手动结束 → 已完成),未开始的 CANCELLED(划掉,已赦免)。
    assert (data["state"], _statuses(data)) == ("pardoned", ["done", "done", "pardoned"])
    assert [p_.kind for p_ in _sentence_pushes()] == ["sentence_pardoned"]


def test_a_completed_plan_is_pushed_once(cn, eg):
    soul, p, client = _planned_soul(cn, [(eg, plan.stop_realm(eg), 5)])
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    plan.serve(soul, p, 2)
    data = _get(client)
    assert (data["state"], _statuses(data)) == ("completed", ["done", "done"])
    assert [p_.kind for p_ in _sentence_pushes()] == ["sentence_completed"]


def test_an_eternal_station_rewrites_the_plan_as_final(cn, eg):
    account, client = ready_soul(cn, name="永久魂")
    soul = account.soul
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=cn)
    plan.bench(case, [(eg, plan.stop_realm(eg, eternal=True), 10)])
    case.conclude("PASSED", "")
    soul.refresh_from_db()
    p = SentencePlan.all_objects.get(soul=soul)
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    plan.serve(soul, p, 2)
    data = _get(client)
    assert (data["state"], _statuses(data)) == ("eternal", ["done", "eternal"])
    assert data["stations"][1]["ends_on"] is None


def test_hidden_moves_push_nothing_to_the_sentence_section(cn, eg, eu):
    """推进里灵魂看不见的那几步(调拨中、到达执行地)不推 sentence_* —— 那是别的推送(暂居)的事。"""
    soul, p, _ = _three_stops(cn, eg, eu)
    PushDelivery.objects.all().delete()
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    assert _sentence_pushes() == []


@pytest.mark.parametrize("home_code", ["EG_DUAT", "EU_HEAVEN_HELL"])
def test_a_pardon_reaches_a_soul_whose_civilization_has_no_rebirth(cn, eg, eu, home_code):
    """赦免推给所有灵魂(2026-09-27 用户决定);「全部服完」仍只推给有转生的(文案说可以申请转生)。"""
    home = eg if home_code == "EG_DUAT" else eu
    soul, p, client = _planned_soul(home, [(cn, plan.stop_realm(cn), 5)], name=f"终局魂{home_code}")
    PushDelivery.objects.all().delete()
    mod = plan.officer(f"mod_{home_code}", "MODERATOR", home)
    assert officer_client(mod).post(f"{PLANS}{p.pk}/cancel/", {"reason": "复核"}, format="json").status_code == 200
    data = _get(client)
    assert (data["state"], data["rebirth_open"]) == ("pardoned", False)
    [push] = _sentence_pushes()
    assert (push.kind, push.title) == ("sentence_pardoned", "剩余刑期已赦免")


def test_completion_still_does_not_reach_a_soul_without_rebirth(cn, eg):
    soul, p, client = _planned_soul(eg, [(cn, plan.stop_realm(cn), 5)], name="埃及服完")
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    plan.serve(soul, p, 2)
    assert _get(client)["state"] == "completed"
    assert _sentence_pushes() == []
