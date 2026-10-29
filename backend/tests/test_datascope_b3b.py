"""数据范围 B3b「其余补点」的接口反例(local-gates/rbac-2026-10-29/datascope-design.md「执行点」)。

角色配「本机构」(ORG)后,范围外的灵魂在转世、喝汤、发起流程、选站预览、案件类型、发牒、待发牒、
冷却待办、账簿搜索、官员助手计数与城隍通知里都不出现(404 / 不计数 / 不收通知);范围内的照常。
每条都断言两边:范围内的不是 404,范围外的是。
"""
import pytest
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.judgment.models import CityGod, Judgment
from apps.notifications.models import UserNotification
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as sp
from tests.data_scope_support import org, scope
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def units(cn_tenant):
    return org(cn_tenant, "本司"), org(cn_tenant, "他司")


@pytest.fixture
def lead(cn_tenant, units):
    """殿主(MODERATOR 持转世 / 发起流程 / 发牒的码),在「本司」,范围 = 本机构。"""
    user = sp.officer("ds_lead", "MODERATOR", cn_tenant, organization=units[0])
    scope("MODERATOR", "ORG")
    return user


def _pair(tenant, units, **fields):
    mine = Soul.objects.create(name="本司魂", tenant=tenant, owner_org=units[0], **fields)
    theirs = Soul.objects.create(name="他司魂", tenant=tenant, owner_org=units[1], **fields)
    return mine, theirs


def test_drink_soup_and_reborn_answer_404_outside_the_scope(cn_tenant, units, lead):
    mine, theirs = _pair(cn_tenant, units, current_state=SoulState.REINCARNATING)
    client = officer_client(lead)
    soup = "/api/v1/reincarnation/drink-soup/"
    assert client.post(soup, {"soul_id": str(theirs.pk)}, format="json").status_code == 404
    assert client.post(soup, {"soul_id": str(mine.pk)}, format="json").status_code == 200
    theirs.refresh_from_db()
    assert theirs.soup_taken_at is None

    reborn = "/api/v1/reincarnation/reborn/"
    outside = client.post(reborn, {"soul_id": str(theirs.pk), "new_identity": "x"}, format="json")
    assert outside.status_code == 404 and outside.data["error"] == "NOT_FOUND"
    inside = client.post(reborn, {"soul_id": str(mine.pk), "new_identity": "x"}, format="json")
    assert inside.status_code != 404, inside.data


def test_workflow_start_preview_and_case_types_answer_404_outside_the_scope(cn_tenant, units, lead):
    mine, theirs = _pair(cn_tenant, units, current_state=SoulState.JUDGING)
    client = officer_client(lead)
    def three(soul):
        return (client.post("/api/v1/workflows/start/", {"soul": str(soul.pk), "case_type": "ROUTINE",
                                                         "reason": "范围"}, format="json"),
                client.get(f"/api/v1/workflows/case-types/?soul={soul.pk}"),
                client.get(f"/api/v1/workflows/flow-preview/?soul={soul.pk}&case_type=ROUTINE"))

    for response in three(theirs):
        assert response.status_code == 404 and response.data["code"] == "soul_not_found", response.data
    for response in three(mine):
        assert response.status_code != 404, response.data

    judgment = Judgment.objects.create(soul=theirs, civilization=theirs.civilization, court="第一殿",
                                       tenant=cn_tenant, evidence_json={}, owner_org=units[1])
    by_case = client.get(f"/api/v1/workflows/flow-preview/?judgment={judgment.pk}")
    assert by_case.status_code == 404 and by_case.data["code"] == "judgment_not_found"


def test_a_warrant_is_not_issued_or_listed_as_due_outside_the_scope(cn_tenant, units, lead):
    mine, theirs = _pair(cn_tenant, units, current_state=SoulState.ALIVE,
                         fated_death_year=2000, fated_death_month=1, fated_death_day=1)
    client = officer_client(lead)
    due = client.get("/api/v1/dispatch/capture-warrants/due/")
    assert due.status_code == 200, due.data
    assert [row["id"] for row in due.data["results"]] == [mine.pk] and due.data["count"] == 1
    assert client.post("/api/v1/dispatch/capture-warrants/", {"soul": str(theirs.pk)}, format="json").status_code == 404
    assert client.post("/api/v1/dispatch/capture-warrants/", {"soul": str(mine.pk)}, format="json").status_code != 404


def test_the_journal_search_does_not_total_a_soul_outside_the_scope(cn_tenant, units, lead):
    from apps.souls.record_models import SoulRecord

    mine, theirs = _pair(cn_tenant, units, current_state=SoulState.JUDGING)
    for soul in (mine, theirs):
        SoulRecord.objects.create(soul=soul, record_type="MERIT", category="CHARITY", description="d", weight=7,
                                  event_year=2000)
    client = officer_client(lead)
    month = timezone.localtime().strftime("%Y-%m")
    hidden = client.get(f"/api/v1/ledger/journal/?month={month}&search=他司魂").data
    assert (hidden["received"], hidden["record_count"], hidden["count"]) == (0, 0, 0)
    shown = client.get(f"/api/v1/ledger/journal/?month={month}&search=本司魂").data
    assert (shown["received"], shown["record_count"], shown["count"]) == (7, 1, 1)
    # 不搜索时合计仍是本殿全部(fix-scope-rest「合计出本殿」),明细只给范围内的。
    whole = client.get(f"/api/v1/ledger/journal/?month={month}").data
    assert (whole["received"], whole["count"]) == (14, 1)


def test_cooldown_todos_follow_the_souls_scope(cn_tenant, units, judge_user, django_capture_on_commit_callbacks):
    from apps.officer_app import todo
    from tests.test_rebirth_cooldown_shortening import _rejected_soul, _request

    account, client, _ = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    assert _request(client).status_code == 201
    judge_user.organization = units[0]
    judge_user.save(update_fields=["organization"])
    scope("JUDGE", "ORG")
    Soul.all_objects.filter(pk=account.soul_id).update(owner_org=units[1])
    assert todo.build(judge_user)["cooldowns"]["count"] == 0
    Soul.all_objects.filter(pk=account.soul_id).update(owner_org=units[0])
    assert todo.build(judge_user)["cooldowns"]["count"] == 1


def test_the_assistants_queue_count_leaves_out_cases_outside_the_scope(cn_tenant, units, judge_user):
    from apps.soul_assist import officer_tools

    mine, theirs = _pair(cn_tenant, units, current_state=SoulState.JUDGING)
    for soul, unit in ((mine, units[0]), (theirs, units[1])):
        Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=cn_tenant,
                                evidence_json={}, owner_org=unit)
    judge_user.organization = units[0]
    judge_user.save(update_fields=["organization"])
    request = Request(APIRequestFactory().get("/"))
    request.user, request.tenant = judge_user, cn_tenant
    import json

    assert json.loads(officer_tools.run("judgment_queue_counts", request))["total"] == 2
    scope("JUDGE", "ORG")
    request = Request(APIRequestFactory().get("/"))
    request.user, request.tenant = judge_user, cn_tenant
    assert json.loads(officer_tools.run("judgment_queue_counts", request))["total"] == 1


def test_a_hall_admin_outside_the_scope_is_not_told_of_a_city_god_case(cn_tenant, units,
                                                                       django_capture_on_commit_callbacks):
    """城隍名下没有官员时退给殿主;看不到这件案子的殿主不收(收件人再过 visible_to)。"""
    inside = sp.officer("lead_in", "MODERATOR", cn_tenant, organization=units[0])
    outside = sp.officer("lead_out", "MODERATOR", cn_tenant, organization=units[1])
    scope("MODERATOR", "ORG")
    from apps.judgment import city_gods
    from apps.judgment.models import CityGodStatus

    god = CityGod.objects.create(tenant=cn_tenant, name="酆都城隍", is_default=True)
    soul = Soul.objects.create(name="张三", tenant=cn_tenant, current_state=SoulState.JUDGING, owner_org=units[0])
    judgment = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=cn_tenant,
                                       evidence_json={}, owner_org=units[0], city_god=god,
                                       city_god_status=CityGodStatus.PENDING)
    with django_capture_on_commit_callbacks(execute=True):
        city_gods.received(judgment)
    assert UserNotification.objects.filter(user=inside, notification_type="CITY_GOD_CASE_RECEIVED").exists()
    assert not UserNotification.objects.filter(user=outside).exists()


def test_ending_a_residence_hands_the_callers_soul_its_home_unit(cn_tenant, eu_tenant, units):
    """end_residence 把归属机构同步回调用方的那份对象:之后整行 save() 不会把暂居殿的根写回去。"""
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService

    soul = Soul.objects.create(name="暂居魂", tenant=cn_tenant, current_state=SoulState.DISPOSED, owner_org=units[0])
    record = DispatchRecord.objects.create(soul=soul, source_tenant=cn_tenant, target_tenant=eu_tenant,
                                           status=DispatchStatus.APPROVED, reason="r", tenant=cn_tenant)
    DispatchService.execute(record, "executor")
    stale = Soul.all_objects.get(pk=soul.pk)
    assert stale.owner_org_id != units[0].pk
    DispatchService.end_residence(stale, actor="system", trigger=DispatchService.RETURN_MANUAL)
    assert stale.owner_org_id == units[0].pk
    stale.save()
    assert Soul.all_objects.get(pk=soul.pk).owner_org_id == units[0].pk
