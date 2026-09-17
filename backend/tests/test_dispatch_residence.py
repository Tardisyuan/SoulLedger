"""跨文明调拨是暂居,不是迁籍(2026-09-17 用户决定)。

`tenant` = 此刻管辖;`home_tenant` = 原属。调拨执行切 `tenant`、不动 `home_tenant`;
暂居租户的处置执行完毕自动回归;原租户或 ADMIN 可以手动结束暂居。
转生资格、转生申请、申诉、灵魂账号按原属。

每个用户都**不是** ADMIN,除非测试名说它是:ADMIN 绕过租户对象检查,
全用 ADMIN 的测试证明不了原租户 / 目标租户各自能做什么(apps/dispatch/permissions.py)。
"""
import pytest

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.ledger.services import LedgerService, RebirthNotApplicable
from apps.soul_accounts.models import RebirthApplication
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db


def _tenant(code):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": f"{code} 名"})[0]


@pytest.fixture
def cn():
    return _tenant("CN_DIYU")


@pytest.fixture
def eg():
    return _tenant("EG_DUAT")


@pytest.fixture
def eu():
    return _tenant("EU_HEAVEN_HELL")


def _officer(username, role, tenant):
    return User.objects.create_user(username=username, password="x", role=role, tenant=tenant)


def _residing(home, away, *, state=SoulState.DISPOSED, name="客魂"):
    """一个从 home 调拨到 away、已执行的灵魂。返回 (soul, record)。"""
    soul = Soul.objects.create(name=name, tenant=home, current_state=state)
    record = DispatchRecord.objects.create(
        source_tenant=home, target_tenant=away, soul=soul, status=DispatchStatus.APPROVED,
        reason="先在彼处受罚", tenant=home,
    )
    DispatchService.execute(record, "executor")
    soul.refresh_from_db()
    record.refresh_from_db()
    return soul, record


def _disposition(soul, tenant, *, eternal=False):
    return Disposition.objects.create(soul=soul, tenant=tenant, is_eternal=eternal)


def _returned_events(soul):
    return [e for e in SoulEvent.objects.filter(soul=soul) if e.payload.get("action") == "DISPATCH_RETURNED"]


def test_a_new_soul_belongs_to_the_tenant_it_is_created_in(cn):
    soul = Soul.objects.create(name="本土", tenant=cn)
    soul.refresh_from_db()
    assert soul.home_tenant_id == cn.pk
    assert soul.is_residing is False
    assert soul.home_civilization == "CHINESE"


# ── 暂居开始 ─────────────────────────────────────────────────────────────


def test_executing_a_dispatch_moves_jurisdiction_but_not_home(cn, eg):
    soul, record = _residing(cn, eg)
    assert record.status == DispatchStatus.EXECUTED
    assert soul.tenant_id == eg.pk
    assert soul.home_tenant_id == cn.pk
    assert soul.is_residing is True
    assert soul.civilization == "EGYPTIAN" and soul.home_civilization == "CHINESE"
    executed = [e for e in SoulEvent.objects.filter(soul=soul) if e.payload.get("action") == "DISPATCH_EXECUTED"]
    assert [e.payload["home_tenant"] for e in executed] == ["CN_DIYU"]


def test_a_residing_soul_cannot_be_dispatched_onward(cn, eg, eu):
    soul, _ = _residing(cn, eg)
    with pytest.raises(ValueError, match="return home"):
        DispatchService.propose(eg, eu, soul, None, "转往第三地")
    assert not DispatchRecord.objects.filter(soul=soul, target_tenant=eu).exists()


def test_execute_refuses_a_soul_that_is_no_longer_in_the_source_tenant(cn, eg, eu):
    soul = Soul.objects.create(name="已离开", tenant=cn, current_state=SoulState.DISPOSED)
    record = DispatchRecord.objects.create(source_tenant=cn, target_tenant=eg, soul=soul,
                                           status=DispatchStatus.APPROVED, reason="x", tenant=cn)
    Soul.all_objects.filter(pk=soul.pk).update(tenant=eu)
    with pytest.raises(ValueError):
        DispatchService.execute(record, "executor")
    record.refresh_from_db()
    soul.refresh_from_db()
    assert record.status == DispatchStatus.APPROVED and soul.tenant_id == eu.pk


# ── 处置执行完毕 → 自动回归 ────────────────────────────────────────────────


def test_executing_the_residence_disposition_returns_the_soul_home(cn, eg):
    soul, record = _residing(cn, eg)
    disposition = _disposition(soul, eg)

    assert DispositionService.execute(disposition) is True

    soul.refresh_from_db()
    record.refresh_from_db()
    disposition.refresh_from_db()
    assert disposition.is_executed is True
    assert soul.tenant_id == cn.pk and soul.is_residing is False
    # 生命周期不推进:下一世还是终局,由原文明决定。
    assert soul.current_state == SoulState.DISPOSED
    assert record.status == DispatchStatus.RETURNED and record.returned_at is not None
    [event] = _returned_events(soul)
    assert event.tenant_id == cn.pk
    assert event.payload["trigger"] == "DISPOSITION_EXECUTED"
    assert (event.payload["from_tenant"], event.payload["to_tenant"]) == ("EG_DUAT", "CN_DIYU")
    audit = AuditLog.objects.filter(resource="dispatch_record", resource_id=str(record.pk))
    assert [a.changes["soul_tenant"] for a in audit] == [["EG_DUAT", "CN_DIYU"]]


def test_the_disposition_endpoint_returns_the_soul_home(cn, eg):
    soul, record = _residing(cn, eg)
    disposition = _disposition(soul, eg)
    officer = _officer("eg_mod", "MODERATOR", eg)

    response = officer_client(officer).post(f"/api/v1/disposition/{disposition.pk}/execute/", {}, format="json")

    assert response.status_code == 200, response.data
    soul.refresh_from_db()
    assert soul.tenant_id == cn.pk and soul.current_state == SoulState.DISPOSED
    assert not SoulEvent.objects.filter(soul=soul, event_type="REINCARNATION_TRIGGERED").exists()


def test_an_eternal_sentence_does_not_end_the_residence(cn, eg):
    soul, record = _residing(cn, eg)
    disposition = _disposition(soul, eg, eternal=True)

    assert DispositionService.execute(disposition) is True

    soul.refresh_from_db()
    record.refresh_from_db()
    assert soul.tenant_id == eg.pk and soul.is_residing is True
    assert record.status == DispatchStatus.EXECUTED and record.returned_at is None
    assert _returned_events(soul) == []


def test_the_home_tenant_cannot_execute_its_own_disposition_while_the_soul_is_away(cn, eg):
    soul, _ = _residing(cn, eg)
    home_disposition = _disposition(soul, cn)

    assert DispositionService.execute(home_disposition) is False

    home_disposition.refresh_from_db()
    soul.refresh_from_db()
    assert home_disposition.is_executed is False
    assert soul.tenant_id == eg.pk and soul.current_state == SoulState.DISPOSED


@pytest.mark.parametrize("target", [SoulState.REINCARNATING, SoulState.SETTLED])
def test_a_residing_soul_neither_reincarnates_nor_settles(cn, eg, target):
    soul, _ = _residing(cn, eg)
    assert soul.transition_to(target) is False
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED


def test_after_returning_a_chinese_soul_can_still_reincarnate(cn, eg):
    soul, _ = _residing(cn, eg)
    DispositionService.execute(_disposition(soul, eg))
    soul.refresh_from_db()
    assert soul.transition_to(SoulState.REINCARNATING) is True


# ── 手动结束暂居 ─────────────────────────────────────────────────────────


def _return(user, record, reason="提前结束"):
    body = {"reason": reason} if reason is not None else {}
    return officer_client(user).post(f"/api/v1/dispatch/records/{record.pk}/return-home/", body, format="json")


def test_the_home_tenant_can_end_the_residence(cn, eg):
    soul, record = _residing(cn, eg)
    home_mod = _officer("cn_mod", "MODERATOR", cn)

    response = _return(home_mod, record)

    assert response.status_code == 200, response.data
    assert response.data["status"] == "RETURNED" and response.data["returned_at"]
    soul.refresh_from_db()
    assert soul.tenant_id == cn.pk
    [event] = _returned_events(soul)
    assert event.payload["trigger"] == "MANUAL" and event.payload["reason"] == "提前结束"
    [audit] = AuditLog.objects.filter(resource="dispatch_record", resource_id=str(record.pk))
    assert audit.user_id == home_mod.pk and audit.tenant_id == cn.pk


def test_the_residence_tenant_cannot_send_the_soul_home_by_hand(cn, eg):
    soul, record = _residing(cn, eg)
    response = _return(_officer("eg_mod", "MODERATOR", eg), record)
    assert response.status_code == 403
    soul.refresh_from_db()
    assert soul.tenant_id == eg.pk and _returned_events(soul) == []


def test_an_uninvolved_tenant_cannot_see_the_residence(cn, eg, eu):
    soul, record = _residing(cn, eg)
    assert _return(_officer("eu_mod", "MODERATOR", eu), record).status_code == 404
    soul.refresh_from_db()
    assert soul.tenant_id == eg.pk


def test_a_home_officer_without_the_codename_is_refused(cn, eg):
    soul, record = _residing(cn, eg)
    assert _return(_officer("cn_guard", "GUARDIAN", cn), record).status_code == 403
    soul.refresh_from_db()
    assert soul.tenant_id == eg.pk


def test_admin_of_another_tenant_can_end_the_residence(cn, eg, eu):
    soul, record = _residing(cn, eg)
    assert _return(_officer("eu_admin", "ADMIN", eu), record).status_code == 200
    soul.refresh_from_db()
    assert soul.tenant_id == cn.pk


def test_manual_return_needs_a_reason(cn, eg):
    soul, record = _residing(cn, eg)
    assert _return(_officer("cn_mod", "MODERATOR", cn), record, reason=None).status_code == 400
    soul.refresh_from_db()
    assert soul.tenant_id == eg.pk


def test_a_finished_residence_cannot_be_ended_twice(cn, eg):
    soul, record = _residing(cn, eg)
    home_mod = _officer("cn_mod", "MODERATOR", cn)
    assert _return(home_mod, record).status_code == 200
    assert _return(home_mod, record).status_code == 409
    assert len(_returned_events(soul)) == 1


# ── 暂居期间的租户可见性 ──────────────────────────────────────────────────


def test_while_residing_only_the_residence_tenant_sees_the_soul(cn, eg, eu):
    """原租户在暂居期间**看不到**灵魂本身(保守默认:租户隔离沿用现状);
    它经调拨记录看得到暂居,并能手动结束暂居。"""
    soul, record = _residing(cn, eg)
    url = f"/api/v1/souls/{soul.pk}/"
    assert officer_client(_officer("eg_judge", "JUDGE", eg)).get(url).status_code == 200
    assert officer_client(_officer("cn_judge", "JUDGE", cn)).get(url).status_code == 404
    assert officer_client(_officer("eu_judge", "JUDGE", eu)).get(url).status_code == 404
    home_mod = officer_client(_officer("cn_mod", "MODERATOR", cn))
    assert home_mod.get(f"/api/v1/dispatch/records/{record.pk}/").status_code == 200


# ── 转生资格、申请与申诉按原属文明 ───────────────────────────────────────


APPLY = "/api/v1/me/rebirth-applications/"
OFFICER_APPLICATIONS = "/api/v1/soul-accounts/rebirth-applications/"


def _dispatch(soul, away):
    """把一个已存在的灵魂从它此刻的租户调拨到 away 并执行。"""
    record = DispatchRecord.objects.create(
        source_tenant_id=soul.tenant_id, target_tenant=away, soul=soul, status=DispatchStatus.APPROVED,
        reason="暂居", tenant_id=soul.tenant_id,
    )
    DispatchService.execute(record, "executor")
    soul.refresh_from_db()
    return record


def _rows(response):
    data = response.data
    return data["results"] if isinstance(data, dict) and "results" in data else data


def test_a_chinese_soul_residing_in_egypt_may_still_apply_and_home_reviews_it(
        cn, eg, django_capture_on_commit_callbacks):
    account, client = ready_soul(cn)
    _dispatch(account.soul, eg)
    assert account.soul.is_residing

    listing = client.get(APPLY).data
    assert listing["can_apply"] is True and listing["reason"] is None
    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(APPLY, {"desired_form": "HUMAN", "statement": "愿为人"}, format="json")
    assert response.status_code == 201, response.data

    application = RebirthApplication.objects.get(pk=response.data["id"])
    assert application.workflow.tenant_id == cn.pk
    cn_judge = _officer("cn_judge", "JUDGE", cn)
    eg_judge = _officer("eg_judge", "JUDGE", eg)
    assert [row["id"] for row in _rows(officer_client(cn_judge).get(OFFICER_APPLICATIONS))] == [str(application.pk)]
    assert _rows(officer_client(eg_judge).get(OFFICER_APPLICATIONS)) == []


def test_ledger_rebirth_gate_asks_the_home_civilization(cn, eg, eu):
    chinese, _ = _residing(cn, eg, name="华魂")
    LedgerService.assert_rebirth_capable(chinese)
    european, _ = _residing(eu, cn, name="欧魂")
    with pytest.raises(RebirthNotApplicable):
        LedgerService.assert_rebirth_capable(european)


@pytest.mark.parametrize("home,away", [("EG_DUAT", None), ("EU_HEAVEN_HELL", "CN_DIYU")])
def test_a_soul_from_a_terminal_cosmology_stays_terminal_wherever_it_resides(
        home, away, django_capture_on_commit_callbacks):
    """本土埃及灵魂仍是终局;欧洲灵魂暂居中国,也不因暂居地有轮回而获得转生。"""
    account, client = ready_soul(_tenant(home))
    if away:
        _dispatch(account.soul, _tenant(away))
        assert account.soul.civilization == "CHINESE"
    listing = client.get(APPLY).data
    assert listing["can_apply"] is False and listing["reason"] == "terminal_cosmology"
    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(APPLY, {"desired_form": "HUMAN"}, format="json")
    assert response.status_code == 409 and response.data["code"] == "terminal_cosmology"
    assert not RebirthApplication.objects.filter(soul=account.soul).exists()


def test_an_application_rejected_before_the_dispatch_can_be_appealed_during_residence(
        cn, eg, django_capture_on_commit_callbacks):
    account, client = ready_soul(cn)
    with django_capture_on_commit_callbacks(execute=True):
        submitted = client.post(APPLY, {"desired_form": "HUMAN"}, format="json")
    application = RebirthApplication.objects.get(pk=submitted.data["id"])
    cn_judge = _officer("cn_judge", "JUDGE", cn)
    with django_capture_on_commit_callbacks(execute=True):
        decided = officer_client(cn_judge).post(
            f"/api/v1/workflows/{application.workflow_id}/approve_node/",
            {"verdict": "FAILED", "rejection_reason_for_soul": "业障未消"}, format="json")
    assert decided.status_code == 200, decided.data
    application.refresh_from_db()
    assert application.status == "REJECTED"

    _dispatch(account.soul, eg)

    assert client.get(f"{APPLY}{application.pk}/").data["can_appeal"] is True
    with django_capture_on_commit_callbacks(execute=True):
        appealed = client.post(f"{APPLY}{application.pk}/appeal/", {"statement": "请复核"}, format="json")
    assert appealed.status_code == 200 and appealed.data["status"] == "APPEALING"
    application.refresh_from_db()
    assert application.appeal_workflow.tenant_id == cn.pk


# ── API 契约:/me 与官员灵魂详情 ──────────────────────────────────────────


def test_me_reports_home_and_residence(cn, eg):
    account, client = ready_soul(cn)
    at_home = client.get("/api/v1/me/").data
    assert at_home["is_residing"] is False
    assert at_home["home_tenant"] == at_home["tenant"] == {"code": "CN_DIYU", "display_name": "CN_DIYU 名"}

    _dispatch(account.soul, eg)
    away = client.get("/api/v1/me/").data
    assert away["is_residing"] is True
    assert away["tenant"] == {"code": "EG_DUAT", "display_name": "EG_DUAT 名"}
    assert away["home_tenant"] == {"code": "CN_DIYU", "display_name": "CN_DIYU 名"}
    assert (away["civilization"], away["home_civilization"]) == ("EGYPTIAN", "CHINESE")


def test_officer_soul_detail_reports_home_and_residence(cn, eg):
    soul, _ = _residing(cn, eg)
    data = officer_client(_officer("eg_judge", "JUDGE", eg)).get(f"/api/v1/souls/{soul.pk}/").data
    assert (data["tenant_code"], data["civilization"]) == ("EG_DUAT", "EGYPTIAN")
    assert data["home_tenant"] == {"code": "CN_DIYU", "display_name": "CN_DIYU 名"}
    assert data["home_civilization"] == "CHINESE" and data["is_residing"] is True
