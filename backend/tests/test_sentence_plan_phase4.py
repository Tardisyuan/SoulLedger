"""受刑计划阶段 4 的 Web 端给后端补的两处(docs/ARCHITECTURE-sentence-plan.md §9):

* `cross-tenant-judgments/{id}/order/` —— 发起方重排各站(§2.2「ACTIVE 前可改」),Q5 先拦一次;
* `sentence-plans/?pending_request=true` —— 「受刑请求」收件箱的列表。

用户都不是 ADMIN:ADMIN 绕过租户检查,证明不了各方各自能做什么。
"""
import pytest

from apps.dispatch.models import CrossTenantJudgment
from apps.sentence_plan import requests as plan_requests
from apps.sentence_plan.models import SentencePlanRequest
from tests.sentence_plan_support import arrive, officer, open_case, planned, serve, stop_realm, tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db
CJ = "/api/v1/dispatch/cross-tenant-judgments/"
PLANS = "/api/v1/sentence-plans/"


@pytest.fixture
def cn():
    return tenant("CN_DIYU")


@pytest.fixture
def eg():
    return tenant("EG_DUAT")


@pytest.fixture
def eu():
    return tenant("EU_HEAVEN_HELL")


# ── 重排各站 ─────────────────────────────────────────────────────────────


@pytest.fixture
def seated(cn, eg, eu):
    """挂在原审判上的联审,EG 排 2、EU 排 3,另有一个 GR 顾问(不带节点)。"""
    gr = tenant("GR_HADES")
    _, case = open_case(cn)
    clients = {t.code: officer_client(officer(f"judge_{t.code}", "JUDGE", t)) for t in (cn, eg, eu)}
    home = clients["CN_DIYU"]
    cj_id = home.post(CJ, {"title": "联审", "description": "d", "judgment": str(case.pk)}, format="json").data["id"]
    for at, order, role in ((eg, 2, "CO_JUDGE"), (eu, 3, "CO_JUDGE"), (gr, None, "ADVISOR")):
        body = {"participant_tenant": at.pk, "role": role, **({"node_order": order} if order else {})}
        assert home.post(f"{CJ}{cj_id}/participate/", body, format="json").status_code == 200
    cj = CrossTenantJudgment.objects.get(pk=cj_id)
    seat = {p.participant_tenant.code: p for p in cj.participants.select_related("participant_tenant")}
    return {"cj": cj, "c": clients, "seat": seat}


def _orders(cj):
    return dict(cj.participants.values_list("participant_tenant__code", "node_order"))


def _reorder(seated, codes, client="CN_DIYU"):
    return seated["c"][client].post(
        f"{CJ}{seated['cj'].pk}/order/",
        {"participants": [str(seated["seat"][c].pk) for c in codes]}, format="json",
    )


def test_the_initiator_swaps_two_stops(seated):
    resp = _reorder(seated, ["EU_HEAVEN_HELL", "EG_DUAT"])
    assert resp.status_code == 200, resp.data
    assert _orders(seated["cj"]) == {"EU_HEAVEN_HELL": 2, "EG_DUAT": 3, "GR_HADES": None}
    assert sorted((p["participant_tenant_code"], p["node_order"]) for p in resp.data["participants"]) == [
        ("EG_DUAT", 3), ("EU_HEAVEN_HELL", 2), ("GR_HADES", None),
    ]


def test_only_the_initiator_reorders(seated):
    assert _reorder(seated, ["EU_HEAVEN_HELL", "EG_DUAT"], client="EG_DUAT").status_code == 403
    assert _orders(seated["cj"])["EG_DUAT"] == 2


@pytest.mark.parametrize("codes", [["EG_DUAT"], ["EG_DUAT", "EG_DUAT"], ["EG_DUAT", "EU_HEAVEN_HELL", "GR_HADES"]])
def test_the_order_must_name_every_node_seat_once(seated, codes):
    """漏一个、重复一个、把顾问排进来,都拒绝,且什么都不改。"""
    assert _reorder(seated, codes).status_code == 400
    assert _orders(seated["cj"]) == {"EG_DUAT": 2, "EU_HEAVEN_HELL": 3, "GR_HADES": None}


def test_an_eternal_stop_cannot_be_moved_off_the_end(seated, eu):
    """Q5:EU 填了永久刑期(第 3 站、最后),把它挪到第 2 站 → 400,不改。"""
    code = stop_realm(eu, eternal=True)
    resp = seated["c"]["EU_HEAVEN_HELL"].post(
        f"{CJ}{seated['cj'].pk}/sentence/",
        {"participant": str(seated["seat"]["EU_HEAVEN_HELL"].pk), "realm_code": code}, format="json",
    )
    assert resp.status_code == 200, resp.data
    assert _reorder(seated, ["EU_HEAVEN_HELL", "EG_DUAT"]).status_code == 400
    assert _orders(seated["cj"])["EU_HEAVEN_HELL"] == 3


def test_the_order_is_fixed_once_the_bench_is_convened(seated):
    assert seated["c"]["CN_DIYU"].post(f"{CJ}{seated['cj'].pk}/activate/", {}, format="json").status_code == 200
    assert _reorder(seated, ["EU_HEAVEN_HELL", "EG_DUAT"]).status_code == 400
    assert _orders(seated["cj"])["EG_DUAT"] == 2


def test_a_meeting_with_no_judgment_has_nothing_to_order(cn, eg):
    home = officer_client(officer("judge_meeting", "JUDGE", cn))
    cj_id = home.post(CJ, {"title": "会议", "description": "d"}, format="json").data["id"]
    home.post(f"{CJ}{cj_id}/participate/", {"participant_tenant": eg.pk, "role": "CO_JUDGE"}, format="json")
    seat = CrossTenantJudgment.objects.get(pk=cj_id).participants.get()
    resp = home.post(f"{CJ}{cj_id}/order/", {"participants": [str(seat.pk)]}, format="json")
    assert resp.status_code == 400
    seat.refresh_from_db()
    assert seat.node_order is None


# ── 收件箱列表 ───────────────────────────────────────────────────────────


def test_pending_request_lists_only_plans_awaiting_a_decision(cn, eg, eu):
    """情况 2.1:灵魂在 EG 服完第 2 站、回了家、正被调往 EU,EG 的判官提重开审判。"""
    _, quiet = planned(cn, name="无请求")
    soul, plan = planned(cn, [(eg, stop_realm(eg), 5), (eu, stop_realm(eu), 5)], name="有请求")
    serve(soul, plan, 1)
    arrive(soul, plan, 2)
    serve(soul, plan, 2)
    judge_eg = officer("judge_eg_inbox", "JUDGE", eg)
    req = plan_requests.file_request(plan, eg, kind="REOPEN", changes=None, reason="新证据", user=judge_eg)
    home, away = officer_client(officer("judge_cn_inbox", "JUDGE", cn)), officer_client(judge_eg)

    assert [p["id"] for p in home.get(PLANS, {"pending_request": "true"}).data["results"]] == [str(plan.pk)]
    assert [p["id"] for p in away.get(PLANS, {"pending_request": "true"}).data["results"]] == [str(plan.pk)]
    assert str(quiet.pk) in [p["id"] for p in home.get(PLANS, {"pending_request": "false"}).data["results"]]
    assert str(plan.pk) not in [p["id"] for p in home.get(PLANS, {"pending_request": "false"}).data["results"]]

    SentencePlanRequest.all_objects.filter(pk=req.pk).update(status="WITHDRAWN")
    assert home.get(PLANS, {"pending_request": "true"}).data["count"] == 0



# ── 按租户代码入席(Web 入席表单;非 ADMIN 查不到别的租户的数字 id)──────────────


def test_the_initiator_seats_a_tenant_by_its_code(cn, eg, eu):
    _, case = open_case(cn)
    home = officer_client(officer("judge_home", "JUDGE", cn))
    cj_id = home.post(CJ, {"title": "联审", "description": "d", "judgment": str(case.pk)}, format="json").data["id"]
    seat = home.post(f"{CJ}{cj_id}/participate/",
                     {"participant_tenant_code": "EG_DUAT", "role": "CO_JUDGE", "node_order": 2}, format="json")
    assert seat.status_code == 200, seat.data
    assert _orders(CrossTenantJudgment.objects.get(pk=cj_id)) == {"EG_DUAT": 2}

    both = home.post(f"{CJ}{cj_id}/participate/",
                     {"participant_tenant": eu.pk, "participant_tenant_code": "EU_HEAVEN_HELL", "role": "ADVISOR"},
                     format="json")
    neither = home.post(f"{CJ}{cj_id}/participate/", {"role": "ADVISOR"}, format="json")
    unknown = home.post(f"{CJ}{cj_id}/participate/", {"participant_tenant_code": "XX_NOWHERE", "role": "ADVISOR"},
                        format="json")
    assert (both.status_code, neither.status_code, unknown.status_code) == (400, 400, 404)
    assert _orders(CrossTenantJudgment.objects.get(pk=cj_id)) == {"EG_DUAT": 2}
