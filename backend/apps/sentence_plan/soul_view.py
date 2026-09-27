"""灵魂端看到的受刑计划(App「我的受刑」1a / 1c):`GET /api/v1/me/sentence-plan/`。

**九档节点状态合并成灵魂看的五档**(画布 1a 合并表):

    PENDING · DISPATCHING → pending    调拨中灵魂还在原地,对它什么也没开始
    ACTIVE                → active
    WAITING               → waiting    刑满暂留,必须单独
    COMPLETED · ABORTED   → done       手动结束对灵魂同样是「这一站结束了」
    ETERNAL               → eternal
    REMOVED               → (整条不出现)已减项不再属于计划
    CANCELLED             → pardoned   随计划撤销 = 赦免:划掉但保留

计划整体六种状态(1c)见 `plan_state`;没有计划是第七种 `none`(空态)。

只出去白名单里的东西(Q10:全部节点与各自处置,不含理由、判官、请求)—— 节点的 reason、
disposition / dispatch / request 的 id、计划的 cancel_reason 都不在这里。
"""
from apps.sentence_plan.models import SentenceNodeStatus, SentencePlan, SentencePlanStatus

#: 节点状态 → 灵魂看的状态。不在表里的(REMOVED)不出去。
SOUL_STATUS = {
    SentenceNodeStatus.PENDING: "pending",
    SentenceNodeStatus.DISPATCHING: "pending",
    SentenceNodeStatus.ACTIVE: "active",
    SentenceNodeStatus.WAITING: "waiting",
    SentenceNodeStatus.COMPLETED: "done",
    SentenceNodeStatus.ABORTED: "done",
    SentenceNodeStatus.ETERNAL: "eternal",
    SentenceNodeStatus.CANCELLED: "pardoned",
}
STATION_STATUSES = ("pending", "active", "waiting", "done", "eternal", "pardoned")
#: none 无计划;serving 受刑中;between 下一站尚未开始;waiting 刑满暂留;eternal 永久;
#: pardoned 已撤销(赦免);completed 全部服完。
PLAN_STATES = ("none", "serving", "between", "waiting", "eternal", "pardoned", "completed")


def plan_state(plan, statuses):
    """1c 的六种整体状态。永久压过一切(整屏改写为定局);其次看计划终态,再看节点。"""
    if plan is None:
        return "none"
    if "eternal" in statuses:
        return "eternal"
    if plan.status == SentencePlanStatus.CANCELLED:
        return "pardoned"
    if plan.status == SentencePlanStatus.COMPLETED:
        return "completed"
    if "waiting" in statuses:
        return "waiting"
    if "active" in statuses:
        return "serving"
    return "between"


def _add_years(moment, years):
    try:
        return moment.replace(year=moment.year + years)
    except ValueError:  # 2 月 29 日
        return moment.replace(year=moment.year + years, day=28)


def _ends_on(node, status):
    """已结束的站:实际结束那天;在受 / 暂留的站:起始 + 刑期(刑满那天)。其余没有。"""
    if status == "done" and node.completed_at:
        return node.completed_at.date()
    if status in ("active", "waiting") and node.activated_at and node.sentence_years is not None:
        return _add_years(node.activated_at, node.sentence_years).date()
    return None


def soul_plan(account):
    """本人本世(`account.cycle`)最新那份计划 —— 与转生资格(`rebirth.eligibility`)读的是同一份。"""
    from apps.ledger.constants import REBIRTH_CAPABLE_CIVILIZATIONS
    from apps.realms.models import Realm
    from apps.souls.models import TENANT_CIVILIZATION, UNKNOWN_CIVILIZATION

    soul = account.soul
    plan = (
        SentencePlan.all_objects.filter(soul_id=soul.pk, cycle=account.cycle, is_deleted=False)
        .order_by("-create_time").first()
    )
    nodes = [] if plan is None else [
        n for n in plan.nodes.filter(is_deleted=False).order_by("order") if n.status in SOUL_STATUS
    ]
    realms = {r.realm_code: r for r in Realm.all_objects.filter(realm_code__in={n.realm_code for n in nodes})}
    stations = []
    for n, node in enumerate(nodes, start=1):
        status = SOUL_STATUS[node.status]
        stations.append({
            "id": node.pk, "n": n, "status": status, "is_home": node.is_home,
            "civilization": TENANT_CIVILIZATION.get(node.tenant_code, UNKNOWN_CIVILIZATION),
            "realm": realms.get(node.realm_code), "sentence_years": node.sentence_years,
            "is_eternal": node.is_eternal,
            "started_on": node.activated_at.date() if node.activated_at else None,
            "ends_on": _ends_on(node, status),
        })
    return {
        "state": plan_state(plan, {s["status"] for s in stations}),
        "rebirth_open": soul.home_civilization in REBIRTH_CAPABLE_CIVILIZATIONS,
        "stations": stations,
    }


__all__ = ["PLAN_STATES", "SOUL_STATUS", "STATION_STATUSES", "plan_state", "soul_plan"]
