"""跨文明调拨是暂居,不是迁籍(2026-09-17 用户决定);受刑计划用它搬运(docs/ARCHITECTURE-sentence-plan.md)。

`tenant` = 此刻管辖;`home_tenant` = 原属。调拨执行切 `tenant`、不动 `home_tenant`;
受刑计划的一站刑满 → 回归 → 原属检查剩余节点(§3.3);原租户或 ADMIN 可以手动结束暂居(节点 ABORTED)。
无计划的暂居(手动调拨)照旧:处置执行完毕自动回归。
转生申请要计划全部完成(Q6);资格、申请、申诉、灵魂账号按原属。

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
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client, ready_soul, rebirth_ready_soul

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


# ── 无计划的暂居(手动调拨)────────────────────────────────────────────────
#
# 受刑计划之外的调拨照旧可以手动发起(Q3)。这种暂居里暂居地的处置不挂节点,
# 执行完毕照旧自动回归;永久刑期不回归。撤案后不再自动补回归(G4/G6,见下面计划那一节)。


def test_without_a_plan_executing_the_residence_disposition_returns_the_soul_home(cn, eg):
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


def test_without_a_plan_an_eternal_sentence_does_not_end_the_residence(cn, eg):
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


# ── 受刑计划的一站:到达、刑满、回归(设计稿 §3.3)─────────────────────────
#
# 夹具 `plan.at_stop`:原属审判结案(挂 PASS 联审)→ 原属处置执行 → 系统调拨 → 执行地批准并执行。
# 执行地的处置由调拨执行时按节点内容建(「节点激活生成处置」),测试不手写。


def _node(plan_, order):
    return plan.node(plan_, order)


def test_serving_the_home_node_dispatches_the_next_stop_instead_of_moving_the_soul(cn, eg):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 12)])

    assert plan.serve(soul, p, 1) is True

    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED and soul.tenant_id == cn.pk
    assert _node(p, 1).status == "COMPLETED" and _node(p, 2).status == "DISPATCHING"
    [record] = plan.records(soul)
    assert (record.status, record.source_tenant_id, record.target_tenant_id) == ("PROPOSED", cn.pk, eg.pk)
    assert record.dispatched_by_id is None and _node(p, 2).dispatch_record_id == record.pk
    proposed = [e for e in SoulEvent.objects.filter(soul=soul) if e.payload.get("action") == "DISPATCH_PROPOSED"]
    assert [e.actor for e in proposed] == ["system"]


def test_arriving_activates_the_stop_with_the_disposition_the_bench_decided(cn, eg):
    soul, p, record = plan.at_stop(cn, eg, years=12)

    stop = _node(p, 2)
    assert soul.tenant_id == eg.pk and stop.status == "ACTIVE" and stop.activated_at is not None
    disposition = Disposition.all_objects.get(pk=stop.disposition_id)
    assert (disposition.tenant_id, disposition.sentence_years) == (eg.pk, 12)
    assert disposition.destination_realm.realm_code == stop.realm_code == "EG_DUAT_TEST_HALL"
    assert disposition.sentence_node_id == stop.pk and disposition.judgment_id is None
    assert disposition.can_delete is False
    assert SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_NODE_ACTIVATED", tenant=eg).count() == 1


def test_serving_the_stop_returns_the_soul_and_completes_the_plan(cn, eg):
    soul, p, record = plan.at_stop(cn, eg)

    assert plan.serve(soul, p, 2) is True

    soul.refresh_from_db()
    record.refresh_from_db()
    p.refresh_from_db()
    assert soul.tenant_id == cn.pk and soul.is_residing is False
    assert record.status == DispatchStatus.RETURNED
    [event] = _returned_events(soul)
    assert event.payload["trigger"] == "DISPOSITION_EXECUTED"
    assert _node(p, 2).status == "COMPLETED"
    # 回原属地检查:没有剩余节点 → 计划完成,中国灵魂进轮回(Q6 从此开放申请)。
    assert p.status == "COMPLETED" and p.completed_at is not None
    assert soul.current_state == SoulState.REINCARNATING
    assert SoulEvent.objects.filter(soul=soul, event_type="REINCARNATION_TRIGGERED").count() == 1


def test_the_disposition_endpoint_serves_the_stop(cn, eg):
    soul, p, _ = plan.at_stop(cn, eg)
    stop = _node(p, 2)
    officer = _officer("eg_mod", "MODERATOR", eg)

    response = officer_client(officer).post(f"/api/v1/disposition/{stop.disposition_id}/execute/", {}, format="json")

    assert response.status_code == 200, response.data
    soul.refresh_from_db()
    assert soul.tenant_id == cn.pk and soul.current_state == SoulState.REINCARNATING
    # 转生触发只记一次:计划完成时由 `advance` 记,视图不再补一次。
    assert SoulEvent.objects.filter(soul=soul, event_type="REINCARNATION_TRIGGERED").count() == 1


def test_a_terminal_cosmology_settles_when_its_plan_completes(eu, eg):
    soul, p, _ = plan.at_stop(eu, eg, name="欧魂")
    plan.serve(soul, p, 2)
    soul.refresh_from_db()
    p.refresh_from_db()
    assert p.status == "COMPLETED" and soul.current_state == SoulState.SETTLED
    assert not SoulEvent.objects.filter(soul=soul, event_type="REINCARNATION_TRIGGERED").exists()


def test_the_scenario_from_the_brief_home_then_b_then_c(cn, eg, eu):
    """原话:属于 A,判 ABC 三地;先 A,再 B,回 A 查还有 C,去 C,回 A 查没有了 → 开放转世申请。"""
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    assert soul.tenant_id == eg.pk

    plan.serve(soul, p, 2)
    soul.refresh_from_db()
    # 同一次推进里:回原属 → 查剩余 → 调往 C。
    assert soul.tenant_id == cn.pk and _node(p, 3).status == "DISPATCHING"
    plan.arrive(soul, p, 3)
    assert soul.tenant_id == eu.pk
    plan.serve(soul, p, 3)

    soul.refresh_from_db()
    p.refresh_from_db()
    assert soul.tenant_id == cn.pk and p.status == "COMPLETED"
    assert [n.status for n in p.nodes.order_by("order")] == ["COMPLETED"] * 3
    targets = [r.target_tenant.code for r in plan.records(soul).order_by("proposed_at")]
    assert targets == ["EG_DUAT", "EU_HEAVEN_HELL"]
    assert soul.current_state == SoulState.REINCARNATING


def test_an_eternal_stop_holds_the_soul_and_the_plan(cn, eg):
    soul, p, record = plan.at_stop(cn, eg, eternal=True)

    assert plan.serve(soul, p, 2) is True

    soul.refresh_from_db()
    record.refresh_from_db()
    p.refresh_from_db()
    assert soul.tenant_id == eg.pk and record.status == DispatchStatus.EXECUTED
    assert _node(p, 2).status == "ETERNAL" and p.status == "HELD"
    assert _returned_events(soul) == []


def test_ending_an_eternal_stop_by_hand_aborts_it_and_the_plan_goes_on(cn, eg):
    soul, p, record = plan.at_stop(cn, eg, eternal=True)
    plan.serve(soul, p, 2)

    response = _return(_officer("cn_mod", "MODERATOR", cn), record)

    assert response.status_code == 200, response.data
    soul.refresh_from_db()
    p.refresh_from_db()
    assert _node(p, 2).status == "ABORTED" and _node(p, 2).completed_at is not None
    assert soul.tenant_id == cn.pk and p.status == "COMPLETED"


def test_ending_an_active_stop_by_hand_aborts_it_and_the_next_stop_is_dispatched(cn, eg, eu):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])
    plan.serve(soul, p, 1)
    record = plan.arrive(soul, p, 2)

    assert _return(_officer("cn_mod", "MODERATOR", cn), record).status_code == 200

    soul.refresh_from_db()
    assert _node(p, 2).status == "ABORTED" and _node(p, 3).status == "DISPATCHING"
    assert Disposition.all_objects.get(pk=_node(p, 2).disposition_id).is_executed is False


# ── 调拨被拒(Q4)与手动调拨(Q3)────────────────────────────────────────


def test_a_refused_stop_goes_back_to_pending_and_the_home_judges_are_told(cn, eg):
    from apps.notifications.models import UserNotification

    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    home_judge, away_judge = _officer("cn_judge", "JUDGE", cn), _officer("eg_judge", "JUDGE", eg)
    plan.serve(soul, p, 1)
    [record] = plan.records(soul)

    response = officer_client(_officer("eg_mod", "MODERATOR", eg)).post(
        f"/api/v1/dispatch/records/{record.pk}/reject/", {"reason": "不收"}, format="json")

    assert response.status_code == 200, response.data
    stop = _node(p, 2)
    assert stop.status == "PENDING" and stop.dispatch_record_id is None
    [refused] = SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_NODE_REFUSED")
    assert refused.payload["dispatch_status"] == "REJECTED"
    told = {n.user_id for n in UserNotification.objects.filter(notification_type="SENTENCE_NODE_REFUSED")}
    assert home_judge.pk in told and away_judge.pk not in told
    # 不自动重试:没有第二条调拨。
    assert plan.records(soul).count() == 1


def test_a_cancelled_stop_goes_back_to_pending_too(cn, eg):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    plan.serve(soul, p, 1)
    [record] = plan.records(soul)
    DispatchService.cancel(record, "canceller")
    assert _node(p, 2).status == "PENDING"
    assert plan.records(soul).count() == 1


def test_a_manual_dispatch_is_refused_while_a_plan_is_in_progress(cn, eg):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    mod = officer_client(_officer("cn_mod", "MODERATOR", cn))
    body = {"source_tenant": cn.pk, "target_tenant": eg.pk, "soul": str(soul.pk), "reason": "手动调拨：灵魂需移送目标文明受审，理由写足二十字"}

    response = mod.post("/api/v1/dispatch/records/", body, format="json")

    assert response.status_code == 400 and response.data["code"] == "sentence_plan_active"
    assert not plan.records(soul).exists()


def test_a_soul_without_a_plan_can_still_be_dispatched_by_hand(cn, eg):
    soul = Soul.objects.create(name="无计划", tenant=cn, current_state=SoulState.DISPOSED)
    mod = officer_client(_officer("cn_mod", "MODERATOR", cn))
    body = {"source_tenant": cn.pk, "target_tenant": eg.pk, "soul": str(soul.pk), "reason": "手动调拨：灵魂需移送目标文明受审，理由写足二十字"}
    assert mod.post("/api/v1/dispatch/records/", body, format="json").status_code == 201


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


# ── 未结案审判拦下回归(2026-09-18 用户决定)────────────────────────────


def _open_judgment(soul, tenant):
    from apps.judgment.models import Judgment
    return Judgment.objects.create(soul=soul, tenant=tenant, civilization=soul.civilization)


def _blocked_events(soul):
    return [e for e in SoulEvent.objects.filter(soul=soul) if e.payload.get("action") == "DISPATCH_RETURN_BLOCKED"]


def test_an_open_judgment_blocks_the_automatic_return_and_leaves_a_reason(cn, eg):
    soul, record = _residing(cn, eg)
    case = _open_judgment(soul, eg)
    disposition = _disposition(soul, eg)

    assert DispositionService.execute(disposition) is True

    disposition.refresh_from_db()
    soul.refresh_from_db()
    record.refresh_from_db()
    assert disposition.is_executed is True
    assert soul.tenant_id == eg.pk and soul.is_residing is True
    assert record.status == DispatchStatus.EXECUTED and record.returned_at is None
    assert _returned_events(soul) == []
    [event] = _blocked_events(soul)
    assert event.tenant_id == eg.pk
    assert event.payload["code"] == "open_judgment"
    assert event.payload["open_judgment_ids"] == [str(case.pk)]
    assert event.payload["disposition_id"] == str(disposition.pk)
    assert event.payload["dispatch_id"] == str(record.pk)


def test_an_open_judgment_in_the_home_tenant_also_blocks(cn, eg):
    """「未结案」不分租户:原属租户在调拨前开的案,也拦。"""
    soul, _ = _residing(cn, eg)
    _open_judgment(soul, cn)
    DispositionService.execute(_disposition(soul, eg))
    soul.refresh_from_db()
    assert soul.is_residing and len(_blocked_events(soul)) == 1


@pytest.mark.parametrize("closed", ["concluded", "withdrawn"])
def test_a_closed_judgment_does_not_block(cn, eg, closed):
    soul, _ = _residing(cn, eg)
    case = _open_judgment(soul, eg)
    if closed == "concluded":
        from apps.judgment.models import Judgment
        Judgment.all_objects.filter(pk=case.pk).update(verdict="FAILED", is_final=True)
    else:
        case.soft_delete()
    DispositionService.execute(_disposition(soul, eg))
    soul.refresh_from_db()
    assert soul.tenant_id == cn.pk and _blocked_events(soul) == []


def test_manual_return_with_an_open_judgment_is_409_with_a_code(cn, eg):
    soul, record = _residing(cn, eg)
    case = _open_judgment(soul, eg)

    response = _return(_officer("cn_mod", "MODERATOR", cn), record)

    assert response.status_code == 409, response.data
    assert response.data["code"] == "open_judgment"
    assert response.data["open_judgment_ids"] == [str(case.pk)]
    assert "open judgment" in response.data["error"]
    soul.refresh_from_db()
    record.refresh_from_db()
    assert soul.tenant_id == eg.pk and record.status == DispatchStatus.EXECUTED
    assert _returned_events(soul) == []


def test_admin_manual_return_is_blocked_too(cn, eg, eu):
    soul, record = _residing(cn, eg)
    _open_judgment(soul, eg)
    assert _return(_officer("eu_admin", "ADMIN", eu), record).data["code"] == "open_judgment"


def test_without_a_plan_withdrawing_the_blocking_judgment_no_longer_returns_the_soul(cn, eg):
    """`resume_return_after_case_closed` 已删(G4/G6):无计划的暂居撤案后留在原地,等原属手动 `return-home`。"""
    soul, record = _residing(cn, eg)
    case = _open_judgment(soul, eg)
    DispositionService.execute(_disposition(soul, eg))
    case.delete_or_raise()
    soul.refresh_from_db()
    assert soul.is_residing and _returned_events(soul) == []
    assert _return(_officer("cn_mod", "MODERATOR", cn), record).status_code == 200


# ── 刑满暂留(WAITING,Q7):受刑计划里被未结案审判拦下的回归 ─────────────────


def test_an_open_judgment_holds_the_served_soul_at_the_stop_as_waiting(cn, eg):
    from apps.notifications.models import UserNotification

    soul, p, record = plan.at_stop(cn, eg)
    judges = {"cn": _officer("cn_judge", "JUDGE", cn), "eg": _officer("eg_judge", "JUDGE", eg)}
    case = _open_judgment(soul, eg)

    assert plan.serve(soul, p, 2) is True

    soul.refresh_from_db()
    record.refresh_from_db()
    p.refresh_from_db()
    stop = _node(p, 2)
    assert stop.status == "WAITING" and stop.completed_at is None
    assert Disposition.all_objects.get(pk=stop.disposition_id).is_executed is True
    assert soul.tenant_id == eg.pk and record.status == DispatchStatus.EXECUTED and p.status == "ACTIVE"
    [waiting] = SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_NODE_WAITING")
    assert waiting.tenant_id == eg.pk and waiting.payload["order"] == 2
    [blocked] = _blocked_events(soul)
    assert blocked.payload["open_judgment_ids"] == [str(case.pk)]
    told = {n.user_id for n in UserNotification.objects.filter(notification_type="SENTENCE_NODE_WAITING")}
    assert told == {judges["cn"].pk, judges["eg"].pk}


def test_withdrawing_the_last_open_judgment_releases_the_waiting_soul(cn, eg):
    soul, p, record = plan.at_stop(cn, eg)
    case = _open_judgment(soul, eg)
    plan.serve(soul, p, 2)

    response = officer_client(_officer("eg_judge", "JUDGE", eg)).delete(f"/api/v1/judgment/{case.pk}/")

    assert response.status_code == 204, getattr(response, "data", None)
    soul.refresh_from_db()
    record.refresh_from_db()
    p.refresh_from_db()
    assert _node(p, 2).status == "COMPLETED"
    assert soul.tenant_id == cn.pk and record.status == DispatchStatus.RETURNED
    [event] = _returned_events(soul)
    assert event.payload["trigger"] == "JUDGMENT_CLOSED"
    assert p.status == "COMPLETED" and soul.current_state == SoulState.REINCARNATING


def test_withdrawing_one_of_two_open_judgments_keeps_the_soul_waiting(cn, eg):
    soul, p, _ = plan.at_stop(cn, eg)
    first, second = _open_judgment(soul, eg), _open_judgment(soul, cn)
    plan.serve(soul, p, 2)
    first.delete_or_raise()
    soul.refresh_from_db()
    assert soul.is_residing and _node(p, 2).status == "WAITING" and _returned_events(soul) == []
    second.delete_or_raise()
    soul.refresh_from_db()
    assert soul.tenant_id == cn.pk and _node(p, 2).status == "COMPLETED"


def test_withdrawing_a_judgment_before_the_stop_is_served_does_not_return_the_soul(cn, eg):
    """刑还没满(节点 ACTIVE):撤案不触发回归;永久刑期(ETERNAL)也不。"""
    soul, p, _ = plan.at_stop(cn, eg)
    _open_judgment(soul, eg).delete_or_raise()
    soul.refresh_from_db()
    assert soul.is_residing and _node(p, 2).status == "ACTIVE"

    soul2, p2, _ = plan.at_stop(cn, eg, name="永久客魂", eternal=True)
    plan.serve(soul2, p2, 2)
    _open_judgment(soul2, eg).delete_or_raise()
    soul2.refresh_from_db()
    assert soul2.is_residing and _returned_events(soul2) == []


def test_a_waiting_soul_can_be_ended_by_hand_once_nothing_is_open(cn, eg):
    soul, p, record = plan.at_stop(cn, eg)
    case = _open_judgment(soul, eg)
    plan.serve(soul, p, 2)
    mod = _officer("cn_mod", "MODERATOR", cn)
    assert _return(mod, record).status_code == 409
    from apps.judgment.models import Judgment
    # 绕开撤案(撤案会推进并自动回归):只剩手动结束这一条路,节点记 ABORTED。
    Judgment.all_objects.filter(pk=case.pk).update(is_deleted=True)
    assert _return(mod, record).status_code == 200
    assert _node(p, 2).status == "ABORTED"


# ── 暂居期间的租户可见性 ──────────────────────────────────────────────────


def test_while_residing_the_home_tenant_reads_the_soul_and_an_uninvolved_tenant_does_not(cn, eg, eu):
    """暂居只读例外(2026-09-18 用户决定):原属租户读得到,无关租户照旧 404。"""
    soul, record = _residing(cn, eg)
    url = f"/api/v1/souls/{soul.pk}/"
    assert officer_client(_officer("eg_judge", "JUDGE", eg)).get(url).status_code == 200
    home = officer_client(_officer("cn_judge", "JUDGE", cn))
    detail = home.get(url)
    assert detail.status_code == 200
    assert detail.data["is_residing"] is True and detail.data["tenant_code"] == "EG_DUAT"
    assert officer_client(_officer("eu_judge", "JUDGE", eu)).get(url).status_code == 404
    home_mod = officer_client(_officer("cn_mod", "MODERATOR", cn))
    assert home_mod.get(f"/api/v1/dispatch/records/{record.pk}/").status_code == 200


# ── 暂居只读例外:读 ─────────────────────────────────────────────────────


def _ids(response):
    assert response.status_code == 200, getattr(response, "data", None)
    return {str(row["id"]) for row in _rows(response)}


@pytest.fixture
def away(cn, eg):
    """暂居埃及的中国灵魂,带暂居地的一份审判、一份处置、一条功过记录。"""
    from apps.judgment.models import Judgment
    from apps.souls.record_models import SoulRecord

    soul, record = _residing(cn, eg)
    judgment = Judgment.objects.create(soul=soul, tenant=eg, civilization=soul.civilization,
                                       verdict="FAILED", is_final=True)
    disposition = _disposition(soul, eg)
    deed = SoulRecord.objects.create(soul=soul, tenant=eg, record_type="DEMERIT", category="x",
                                     description="暂居地记下的过", weight=3)
    return {"soul": soul, "record": record, "judgment": judgment, "disposition": disposition, "deed": deed}


def test_the_home_tenant_reads_the_residence_judgment_disposition_events_and_records(cn, eg, away):
    soul = away["soul"]
    home = officer_client(_officer("cn_judge", "JUDGE", cn))

    assert str(soul.pk) in _ids(home.get("/api/v1/souls/"))
    assert home.get(f"/api/v1/souls/{soul.pk}/karma/").status_code == 200
    records = home.get(f"/api/v1/souls/{soul.pk}/records/")
    assert records.status_code == 200 and str(away["deed"].pk) in {str(r["id"]) for r in records.data}

    assert str(away["judgment"].pk) in _ids(home.get(f"/api/v1/judgment/?soul={soul.pk}"))
    assert home.get(f"/api/v1/judgment/{away['judgment'].pk}/").status_code == 200
    assert home.get(f"/api/v1/judgment/{away['judgment'].pk}/citations/").status_code == 200

    assert str(away["disposition"].pk) in _ids(home.get(f"/api/v1/disposition/?soul={soul.pk}"))
    assert home.get(f"/api/v1/disposition/{away['disposition'].pk}/").status_code == 200

    executed = [e for e in SoulEvent.objects.filter(soul=soul) if e.payload.get("action") == "DISPATCH_EXECUTED"]
    assert executed and executed[0].tenant_id == eg.pk
    assert str(executed[0].pk) in _ids(home.get(f"/api/v1/events/?soul={soul.pk}"))
    assert home.get(f"/api/v1/events/{executed[0].pk}/").status_code == 200


def test_an_uninvolved_tenant_still_reads_nothing(eu, away):
    soul = away["soul"]
    other = officer_client(_officer("eu_judge", "JUDGE", eu))
    assert str(soul.pk) not in _ids(other.get("/api/v1/souls/"))
    for url in (f"/api/v1/souls/{soul.pk}/karma/", f"/api/v1/judgment/{away['judgment'].pk}/",
                f"/api/v1/disposition/{away['disposition'].pk}/"):
        assert other.get(url).status_code == 404, url
    assert _ids(other.get(f"/api/v1/judgment/?soul={soul.pk}")) == set()
    assert _ids(other.get(f"/api/v1/events/?soul={soul.pk}")) == set()


def test_the_pending_queue_does_not_offer_the_home_tenant_a_residence_case(cn, eg):
    soul, _ = _residing(cn, eg, state=SoulState.JUDGING)
    case = _open_judgment(soul, eg)
    eg_queue = officer_client(_officer("eg_judge", "JUDGE", eg)).get("/api/v1/judgment/next/")
    assert eg_queue.status_code == 200 and eg_queue.data["judgment"]["id"] == str(case.pk)
    cn_queue = officer_client(_officer("cn_judge", "JUDGE", cn)).get("/api/v1/judgment/next/")
    assert cn_queue.status_code == 200 and cn_queue.data["judgment"] is None


# ── 暂居只读例外:写一律拒绝 ─────────────────────────────────────────────


def test_the_home_tenant_cannot_write_to_the_residing_soul_or_its_residence_rows(cn, eg, away):
    """MODERATOR 持有下面每个动作的权限码,所以 404 来自租户隔离,不是 403 权限码。"""
    soul = away["soul"]
    home = officer_client(_officer("cn_mod", "MODERATOR", cn))
    writes = [
        ("patch", f"/api/v1/souls/{soul.pk}/", {"name": "改名"}),
        ("post", f"/api/v1/souls/{soul.pk}/die/", {}),
        ("post", f"/api/v1/souls/{soul.pk}/transition/", {"new_state": "LOST"}),
        ("post", f"/api/v1/souls/{soul.pk}/add_record/", {"record_type": "MERIT", "category": "x", "weight": 1}),
        ("patch", f"/api/v1/judgment/{away['judgment'].pk}/", {"notes": "改"}),
        ("post", f"/api/v1/judgment/{away['judgment'].pk}/archive/", {"reason": "x"}),
        ("post", f"/api/v1/disposition/{away['disposition'].pk}/execute/", {}),
        ("patch", f"/api/v1/disposition/{away['disposition'].pk}/", {"notes": "改"}),
        ("delete", f"/api/v1/disposition/{away['disposition'].pk}/", {}),
    ]
    for method, url, body in writes:
        response = getattr(home, method)(url, body, format="json")
        assert response.status_code == 404, (method, url, response.status_code)

    opened = home.post("/api/v1/judgment/", {"soul": str(soul.pk)}, format="json")
    assert opened.status_code == 400 and "soul" in opened.data

    soul.refresh_from_db()
    away["disposition"].refresh_from_db()
    away["judgment"].refresh_from_db()
    assert soul.name == "客魂" and soul.tenant_id == eg.pk and soul.current_state == SoulState.DISPOSED
    assert away["disposition"].is_executed is False and away["judgment"].notes == ""
    assert not away["judgment"].is_archived


def test_the_home_tenant_cannot_withdraw_a_pending_residence_case(cn, eg):
    soul, _ = _residing(cn, eg)
    case = _open_judgment(soul, eg)
    home = officer_client(_officer("cn_mod", "MODERATOR", cn))
    assert home.delete(f"/api/v1/judgment/{case.pk}/").status_code == 404
    assert home.post(f"/api/v1/judgment/{case.pk}/conclude/", {"verdict": "PASSED"}, format="json").status_code == 404
    case.refresh_from_db()
    assert case.is_deleted is False and case.verdict is None


# ── 暂居只读例外:边界 ───────────────────────────────────────────────────


def test_the_exception_ends_with_the_residence(cn, eg, away):
    soul = away["soul"]
    DispatchService.end_residence(soul, actor="system", trigger=DispatchService.RETURN_MANUAL)
    soul.refresh_from_db()
    home = officer_client(_officer("cn_judge", "JUDGE", cn))
    assert home.get(f"/api/v1/souls/{soul.pk}/").status_code == 200  # 回到本土,普通隔离
    assert home.get(f"/api/v1/judgment/{away['judgment'].pk}/").status_code == 404
    assert home.get(f"/api/v1/disposition/{away['disposition'].pk}/").status_code == 404
    assert _ids(home.get(f"/api/v1/judgment/?soul={soul.pk}")) == set()
    eg_judge = officer_client(_officer("eg_judge", "JUDGE", eg))
    assert eg_judge.get(f"/api/v1/souls/{soul.pk}/").status_code == 404


def test_the_exception_does_not_reach_a_soul_that_is_not_residing(cn, eg):
    native = Soul.objects.create(name="埃及本土", tenant=eg, current_state=SoulState.DISPOSED)
    eg_case = _disposition(native, eg)
    home = officer_client(_officer("cn_judge", "JUDGE", cn))
    assert home.get(f"/api/v1/souls/{native.pk}/").status_code == 404
    assert home.get(f"/api/v1/disposition/{eg_case.pk}/").status_code == 404
    assert str(native.pk) not in _ids(home.get("/api/v1/souls/"))


def test_the_exception_does_not_reach_a_third_tenants_row_on_the_residing_soul(cn, eg, eu, away):
    """暂居在埃及的灵魂身上挂着一条欧洲租户的处置(比如上一段暂居留下的):原属不放宽到它。"""
    stray = _disposition(away["soul"], eu)
    home = officer_client(_officer("cn_judge", "JUDGE", cn))
    assert home.get(f"/api/v1/disposition/{stray.pk}/").status_code == 404
    assert str(stray.pk) not in _ids(home.get(f"/api/v1/disposition/?soul={away['soul'].pk}"))


def test_the_residence_tenant_does_not_gain_the_home_tenants_rows(cn, eg, away):
    """例外只朝原属一个方向放宽:暂居地看不到原属租户在这个灵魂上的处置。"""
    home_row = _disposition(away["soul"], cn)
    eg_judge = officer_client(_officer("eg_judge", "JUDGE", eg))
    assert eg_judge.get(f"/api/v1/disposition/{home_row.pk}/").status_code == 404


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


def test_a_soul_serving_its_plan_abroad_may_not_apply_until_the_plan_completes(
        cn, eg, django_capture_on_commit_callbacks):
    """Q6(反转了原来的「暂居中仍可申请」):计划全部完成才开放;开放后按原属审批。"""
    from apps.judgment.models import Judgment
    from apps.sentence_plan.models import SentencePlan

    account, client = ready_soul(cn)
    soul = account.soul
    judgment = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=cn)
    plan.bench(judgment, [(eg, plan.stop_realm(eg), 5)])
    judgment.conclude("PASSED", "")
    p = SentencePlan.all_objects.get(soul=soul)
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    assert soul.is_residing

    listing = client.get(APPLY).data
    assert listing["can_apply"] is False and listing["reason"] == "sentence_in_progress"
    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(APPLY, {"desired_form": "HUMAN", "statement": "愿为人"}, format="json")
    assert response.status_code == 409 and response.data["code"] == "sentence_in_progress"
    assert not RebirthApplication.objects.filter(soul=soul).exists()

    plan.serve(soul, p, 2)
    listing = client.get(APPLY).data
    assert listing["can_apply"] is True and listing["reason"] is None
    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(APPLY, {"desired_form": "HUMAN"}, format="json")
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
    account, client = rebirth_ready_soul(cn)
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


def _me_tenant(code):
    """/me 的租户:殿司展示名没填时三语都退回 display_name(`Tenant.hall_names`)。"""
    name = f"{code} 名"
    return {"code": code, "display_name": name, "hall_names": {"zh-Hans": name, "en": name, "egy": name}}


def test_me_reports_home_and_residence(cn, eg):
    account, client = ready_soul(cn)
    at_home = client.get("/api/v1/me/").data
    assert at_home["is_residing"] is False
    assert at_home["home_tenant"] == at_home["tenant"] == _me_tenant("CN_DIYU")

    _dispatch(account.soul, eg)
    away = client.get("/api/v1/me/").data
    assert away["is_residing"] is True
    assert away["tenant"] == _me_tenant("EG_DUAT")
    assert away["home_tenant"] == _me_tenant("CN_DIYU")
    assert (away["civilization"], away["home_civilization"]) == ("EGYPTIAN", "CHINESE")


def test_officer_soul_detail_reports_home_and_residence(cn, eg):
    soul, _ = _residing(cn, eg)
    data = officer_client(_officer("eg_judge", "JUDGE", eg)).get(f"/api/v1/souls/{soul.pk}/").data
    assert (data["tenant_code"], data["civilization"]) == ("EG_DUAT", "EGYPTIAN")
    assert data["home_tenant"] == {"code": "CN_DIYU", "display_name": "CN_DIYU 名"}
    assert data["home_civilization"] == "CHINESE" and data["is_residing"] is True
