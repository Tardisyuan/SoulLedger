"""受刑计划测试的夹具:走真实的服务路径建计划、推进到某一站。

「节点激活生成处置」(设计稿 §7.1):外地的处置不再由测试手写 `Disposition.objects.create`,
而是灵魂到达执行地、调拨执行时由 `SentencePlanService.on_dispatch_executed` 按节点内容建。
"""
from apps.authentication.models import User
from apps.dispatch.models import CrossTenantJudgment, DispatchRecord, DispatchStatus, ParticipantRole
from apps.dispatch.services import CrossTenantJudgmentService, DispatchService
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.judgment.models import Judgment, Verdict
from apps.realms.models import Realm
from apps.sentence_plan.models import SentenceNode, SentencePlan
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

REALM_OF = {"EG_DUAT": "EGYPTIAN", "EU_HEAVEN_HELL": "EUROPEAN", "CN_DIYU": "CHINESE", "GR_HADES": "GREEK"}


def tenant(code):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": f"{code} 名"})[0]


def officer(username, role, at, **extra):
    return User.objects.create_user(username=username, password="x", role=role, tenant=at, **extra)


def realm(code, civilization, *, eternal=False, reset="NONE"):
    return Realm.objects.get_or_create(
        realm_code=code,
        defaults={"civilization": civilization, "name_local": code, "realm_type": "HELL",
                  "is_eternal": eternal, "memory_reset_mechanism": reset},
    )[0]


def stop_realm(at, *, eternal=False):
    """执行地 `at` 自己宇宙观里的一个 realm(参与方只能填自己文明的,§2.1)。"""
    suffix = "ETERNAL" if eternal else "HALL"
    return realm(f"{at.code}_TEST_{suffix}", REALM_OF[at.code], eternal=eternal).realm_code


def open_case(home, *, name="客魂", state=SoulState.JUDGING):
    soul = Soul.objects.create(name=name, tenant=home, current_state=state)
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=home)
    return soul, case


def bench(case, stops, *, conclusion="PASS"):
    """给原审判挂一场联审;`stops` = [(tenant, realm_code, years)],依次排 2、3……"""
    cj = CrossTenantJudgmentService.create("联审", "d", case.tenant, None)
    cj.judgment = case
    cj.save(update_fields=["judgment"])
    for order, (at, realm_code, years) in enumerate(stops, start=2):
        seat = CrossTenantJudgmentService.add_participant(cj, at, None, ParticipantRole.CO_JUDGE, node_order=order)
        CrossTenantJudgmentService.submit_sentence(seat, realm_code, years, "", None)
    CrossTenantJudgmentService.activate(cj)
    CrossTenantJudgmentService.conclude(cj, conclusion, None)
    return CrossTenantJudgment.objects.get(pk=cj.pk)


def planned(home, stops=(), *, name="客魂", verdict=Verdict.PASSED):
    """原属审判结案 → 计划。`stops` 同 `bench`;空 = 退化情况(只有原属节点)。返回 (soul, plan)。"""
    soul, case = open_case(home, name=name)
    if stops:
        bench(case, stops)
    case.conclude(verdict, "")
    soul.refresh_from_db()
    return soul, SentencePlan.all_objects.get(soul=soul, origin_judgment_id=case.pk)


def node(plan, order):
    return SentenceNode.all_objects.get(plan=plan, order=order, status__in=_LIVE)


_LIVE = ("PENDING", "DISPATCHING", "ACTIVE", "WAITING", "COMPLETED", "ETERNAL", "ABORTED")


def serve(soul, plan, order):
    """执行第 `order` 站挂着的处置(原属或执行地)。返回 execute 的结果。"""
    n = node(plan, order)
    return DispositionService.execute(Disposition.all_objects.get(pk=n.disposition_id))


def arrive(soul, plan, order):
    """第 `order` 站(DISPATCHING)的调拨:执行地批准并执行 → 灵魂到达,节点 ACTIVE。"""
    n = node(plan, order)
    record = DispatchRecord.all_objects.get(pk=n.dispatch_record_id)
    DispatchService.approve(record, "approver")
    DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor")
    soul.refresh_from_db()
    return DispatchRecord.all_objects.get(pk=record.pk)


def at_stop(home, away, *, name="客魂", eternal=False, years=10):
    """一个在 `away` 受第 2 站之刑的 `home` 灵魂:原属已执行、调拨已执行、第 2 站 ACTIVE。
    返回 (soul, plan, record)。"""
    soul, plan = planned(home, [(away, stop_realm(away, eternal=eternal), years)], name=name)
    serve(soul, plan, 1)
    record = arrive(soul, plan, 2)
    return soul, plan, record


def returned_events(soul):
    from apps.events.models import SoulEvent

    return [e for e in SoulEvent.objects.filter(soul=soul) if e.payload.get("action") == "DISPATCH_RETURNED"]


def records(soul, **filters):
    return DispatchRecord.all_objects.filter(soul=soul, **filters)


__all__ = [
    "DispatchStatus", "arrive", "at_stop", "bench", "node", "officer", "open_case", "planned", "realm",
    "records", "returned_events", "serve", "stop_realm", "tenant",
]
