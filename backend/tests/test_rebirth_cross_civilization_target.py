"""F-REB-11(用户 2026-11-12):判官初审定「跨文明」时一并选目标殿,办转世时灵魂迁到那里。

此前 `decide_cross_civilization` 只写一个布尔值,`complete_rebirth` 没有任何地方读它 —— 判官选了跨文明并批准,
转世结果与不跨完全一样。这里钉住:

* 初审接口:跨文明必须带目标殿;终局文明(欧洲、埃及)、与原属同一文明、不存在的殿 → 400,什么都不写;
* 可选项只列能转生、不是原属文明的启用殿;
* 选了 → 转世后 `tenant` / `home_tenant` / 归属机构都在目标殿,REINCARNATION_COMPLETED 记 from / to;
* 没选(不跨)→ 照旧留在原文明;
* 初审之后目标殿停用 → 办转世 409 `rebirth_target_unavailable`,灵魂留在候转世、原文明。
"""
import pytest

from apps.events.models import SoulEvent
from apps.reincarnation.models import Reincarnation
from apps.soul_accounts import rebirth
from apps.soul_accounts.models import RebirthApplication
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client, ready_soul, rebirth_ready_soul, sentence_served

pytestmark = pytest.mark.django_db

APPLY = "/api/v1/me/rebirth-applications/"


def _hall(code):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": f"{code} 殿"})[0]


@pytest.fixture
def halls(cn_tenant):
    return {code: _hall(code) for code in ("GR_HADES", "EU_HEAVEN_HELL", "EG_DUAT")}


def _url(application):
    return f"/api/v1/soul-accounts/rebirth-applications/{application.pk}/cross-civilization/"


def _submitted(cn_tenant, capture):
    _account, client = rebirth_ready_soul(cn_tenant)
    with capture(execute=True):
        response = client.post(APPLY, {"desired_form": "HUMAN", "statement": "愿为人"}, format="json")
    assert response.status_code == 201, response.data
    return RebirthApplication.objects.get(pk=response.data["id"]), client


def test_only_rebirth_capable_halls_of_another_civilization_are_offered(
        cn_tenant, halls, judge_user, django_capture_on_commit_callbacks):
    application, _client = _submitted(cn_tenant, django_capture_on_commit_callbacks)
    row = officer_client(judge_user).get(f"/api/v1/soul-accounts/rebirth-applications/{application.pk}/").data
    assert row["can_decide_cross_civilization"] is True
    codes = [h["code"] for h in row["cross_civilization_targets"]]
    assert codes == ["GR_HADES"], codes  # 不含欧洲 / 埃及(终局)与地府自己
    assert row["target_hall"] is None


@pytest.mark.parametrize("target, code", [
    ("", "cross_civilization_target_required"),
    ("EU_HEAVEN_HELL", "cross_civilization_target_terminal"),
    ("EG_DUAT", "cross_civilization_target_terminal"),
    ("CN_DIYU", "cross_civilization_target_same"),
    ("NO_SUCH_HALL", "cross_civilization_target_unknown"),
])
def test_a_cross_decision_without_a_valid_target_is_a_400_and_writes_nothing(
        cn_tenant, halls, judge_user, django_capture_on_commit_callbacks, target, code):
    application, _client = _submitted(cn_tenant, django_capture_on_commit_callbacks)
    refused = officer_client(judge_user).post(
        _url(application), {"cross_civilization": True, "target_tenant": target}, format="json")
    assert (refused.status_code, refused.data["code"]) == (400, code), refused.data
    application.refresh_from_db()
    assert application.cross_civilization is None and application.target_tenant_code == ""
    assert not SoulEvent.objects.filter(soul=application.soul, event_type="REBIRTH_CROSS_CIV_DECIDED").exists()


def test_the_target_is_recorded_and_shown_to_the_soul(cn_tenant, halls, judge_user, django_capture_on_commit_callbacks):
    application, client = _submitted(cn_tenant, django_capture_on_commit_callbacks)
    decided = officer_client(judge_user).post(
        _url(application), {"cross_civilization": True, "target_tenant": "GR_HADES"}, format="json")
    assert decided.status_code == 200, decided.data
    assert decided.data["target_hall"] == {"code": "GR_HADES", "display_name": "GR_HADES 殿"}
    application.refresh_from_db()
    assert application.target_tenant_code == "GR_HADES"
    payload = SoulEvent.objects.get(soul=application.soul, event_type="REBIRTH_CROSS_CIV_DECIDED").payload
    assert payload["target_tenant"] == "GR_HADES"
    assert client.get(f"{APPLY}{application.pk}/").data["target_hall"]["code"] == "GR_HADES"

    # 改成不跨:目标一并清掉。
    again = officer_client(judge_user).post(
        _url(application), {"cross_civilization": False, "target_tenant": "GR_HADES"}, format="json")
    assert again.status_code == 200 and again.data["target_hall"] is None
    application.refresh_from_db()
    assert (application.cross_civilization, application.target_tenant_code) == (False, "")


# ── 办转世 ────────────────────────────────────────────────────────────────


def _approved(cn_tenant, *, cross, target=""):
    account, _client = ready_soul(cn_tenant, name="愿转")
    sentence_served(account)
    application = rebirth.submit(account, desired_form="HUMAN")
    RebirthApplication.objects.filter(pk=application.pk).update(
        status="APPROVED", cross_civilization=cross, target_tenant_code=target)
    return Soul.objects.get(pk=account.soul_id)


def _reborn(admin_user, soul):
    return officer_client(admin_user).post(
        "/api/v1/reincarnation/reborn/", {"soul_id": str(soul.pk)}, format="json")


def test_a_cross_civilization_rebirth_lands_in_the_target_hall(cn_tenant, halls, admin_user):
    soul = _approved(cn_tenant, cross=True, target="GR_HADES")
    response = _reborn(admin_user, soul)
    assert response.status_code == 201, response.data
    soul = Soul.all_objects.select_related("tenant", "home_tenant", "owner_org").get(pk=soul.pk)
    assert soul.current_state == SoulState.ALIVE
    assert (soul.tenant.code, soul.home_tenant.code) == ("GR_HADES", "GR_HADES")
    assert soul.owner_org.tenant_id == halls["GR_HADES"].pk
    assert soul.is_residing is False
    payload = SoulEvent.objects.get(soul=soul, event_type="REINCARNATION_COMPLETED").payload
    assert (payload["from_tenant"], payload["to_tenant"]) == ("CN_DIYU", "GR_HADES")
    # 转世记录上也有(be-domain 1.6):行留在来源殿,from / to 记两头。
    row = Reincarnation.all_objects.select_related("tenant", "from_tenant", "to_tenant").get(soul=soul)
    assert (row.tenant.code, row.from_tenant.code, row.to_tenant.code) == ("CN_DIYU", "CN_DIYU", "GR_HADES")


@pytest.mark.parametrize("cross", [False, None])
def test_without_a_cross_decision_the_soul_stays_where_it_was(cn_tenant, halls, admin_user, cross):
    soul = _approved(cn_tenant, cross=cross)
    assert _reborn(admin_user, soul).status_code == 201
    soul = Soul.all_objects.select_related("tenant", "home_tenant").get(pk=soul.pk)
    assert (soul.tenant.code, soul.home_tenant.code) == ("CN_DIYU", "CN_DIYU")
    payload = SoulEvent.objects.get(soul=soul, event_type="REINCARNATION_COMPLETED").payload
    assert payload["to_tenant"] is None
    row = Reincarnation.all_objects.get(soul=soul)
    assert row.from_tenant_id == row.to_tenant_id == row.tenant_id == cn_tenant.pk


def test_a_target_hall_closed_after_the_decision_refuses_the_rebirth(cn_tenant, halls, admin_user):
    soul = _approved(cn_tenant, cross=True, target="GR_HADES")
    Tenant.objects.filter(code="GR_HADES").update(is_active=False)
    refused = _reborn(admin_user, soul)
    assert (refused.status_code, refused.data["code"]) == (409, "rebirth_target_unavailable"), refused.data
    soul = Soul.all_objects.select_related("tenant").get(pk=soul.pk)
    assert soul.current_state == SoulState.REINCARNATING and soul.tenant.code == "CN_DIYU"
