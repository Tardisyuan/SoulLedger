"""受刑计划的改动:加减项请求、原审判官的决定、撤回、重开审判、撤销计划(设计稿 §4、§3.1,阶段 3)。

三种未结案情况(图 2)全部落成 `SentencePlanRequest`,全部由原审判官(原属租户的判官)批准:
* 情况 1:灵魂就在 X —— X 开 AMENDMENT 审判,结案时带 `plan_changes`,系统据此生成请求。
* 情况 2.1 / 2.2:灵魂不在 X —— X 的判官直接提请求(AMEND 或 REOPEN)。

锁序同 `services.py`:灵魂 → 计划 → 节点 / 请求。每一种拒绝都是 `PlanChangeRefusedError`(带 code 与 HTTP 状态),
在任何写入之前抛出,视图原样转成 4xx。
"""
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.sentence_plan.models import (
    IN_PROGRESS_PLAN_STATUSES,
    OCCUPYING_NODE_STATUSES,
    SentenceNode,
    SentenceNodeStatus,
    SentencePlan,
    SentencePlanRequest,
    SentencePlanStatus,
    SentenceRequestKind,
    SentenceRequestStatus,
)
from apps.sentence_plan.services import (
    SentencePlanService,
    _lock_nodes,
    _lock_plan,
    _lock_soul,
    _route_home_realm,
    _save,
    _tenant_id,
    last_refusal,
    notify_judges,
    record_event,
)

LIVE_NODE_STATUSES = tuple(s for s in SentenceNodeStatus if s not in (SentenceNodeStatus.REMOVED,
                                                                         SentenceNodeStatus.CANCELLED))


class PlanChangeRefusedError(Exception):
    def __init__(self, message, code, status=400, **extra):
        super().__init__(message)
        self.code = code
        self.status = status
        self.extra = extra


# ── 改动内容的校验 ───────────────────────────────────────────────────────


def normalize_changes(plan, from_tenant_code, changes, kind):
    """`changes` → `{"add": [...], "remove": [...]}`,或 `PlanChangeRefusedError`。

    * N2=(a):请求方只能给**自己文明**加节点(`tenant_code` 省略即自己;写了别的 → 400 `foreign_node`)。
    * `realm_code` 必须是请求方文明的 realm(与联审参与方同一立场,§2.1);`is_eternal` / `memory_reset`
      由服务端抄 realm。
    * 只有 PENDING 节点能被减项(§3.2);已开始的刑要 ABORTED 或撤销整份计划。
    * REOPEN 不带改动(重开审判的结论才改计划,N1=(a))。
    """
    from apps.realms.models import realm_by_code
    from apps.tenants.models import Tenant

    changes = changes or {}
    if not isinstance(changes, dict) or set(changes) - {"add", "remove"}:
        raise PlanChangeRefusedError("changes takes only `add` and `remove`", "invalid_changes")
    add, remove = changes.get("add") or [], changes.get("remove") or []
    if not isinstance(add, list) or not isinstance(remove, list):
        raise PlanChangeRefusedError("`add` and `remove` are lists", "invalid_changes")
    if kind == SentenceRequestKind.REOPEN:
        if add or remove:
            raise PlanChangeRefusedError("A REOPEN request carries no changes; the reopened judgment decides",
                                    "invalid_changes")
        return {"add": [], "remove": []}
    if not add and not remove:
        raise PlanChangeRefusedError("An AMEND request must add or remove at least one node", "empty_changes")

    from_tenant = Tenant.objects.filter(code=from_tenant_code).first()
    civilization = from_tenant.known_civilization if from_tenant else None
    added = []
    for item in add:
        if not isinstance(item, dict):
            raise PlanChangeRefusedError("Each added node is an object", "invalid_changes")
        tenant_code = item.get("tenant_code") or from_tenant_code
        if tenant_code != from_tenant_code:
            raise PlanChangeRefusedError(
                f"{from_tenant_code} may add nodes only in its own civilization, not {tenant_code}; "
                "a node elsewhere is added by the home judge through a cross-tenant judgment",
                "foreign_node",
            )
        realm = realm_by_code(item.get("realm_code"), tenant_code=from_tenant_code)
        if realm is None or civilization is None or realm.civilization != civilization:
            raise PlanChangeRefusedError(f"Realm {item.get('realm_code')!r} is not a realm of {from_tenant_code}",
                                    "foreign_realm")
        years = item.get("sentence_years")
        if years is not None and (not isinstance(years, int) or isinstance(years, bool) or years < 0):
            raise PlanChangeRefusedError("sentence_years is a non-negative integer or null", "invalid_changes")
        added.append({
            "tenant_code": from_tenant_code, "realm_code": realm.realm_code, "sentence_years": years,
            "is_eternal": realm.is_eternal, "memory_reset": realm.memory_reset_mechanism or "NONE",
            "reason": str(item.get("reason") or ""),
        })
    removed = [str(pk) for pk in remove]
    nodes = {str(n.pk): n for n in SentenceNode.all_objects.filter(plan_id=plan.pk, is_deleted=False)}
    for pk in removed:
        node = nodes.get(pk)
        if node is None:
            raise PlanChangeRefusedError(f"No node {pk} in this plan", "unknown_node")
        if node.status != SentenceNodeStatus.PENDING:
            raise PlanChangeRefusedError(
                f"Node {node.order} is {node.status}; only a PENDING node can be removed",
                "node_not_pending", node_status=node.status,
            )
    return {"add": added, "remove": removed}


def _assert_eternal_last(nodes):
    """Q5 在改动之后再问一遍:永久刑期的节点后面不能还有未执行的节点。"""
    live = [n for n in nodes if n.status in (SentenceNodeStatus.PENDING, SentenceNodeStatus.DISPATCHING,
                                             SentenceNodeStatus.ACTIVE, SentenceNodeStatus.WAITING)]
    for n in live:
        if n.is_eternal and any(m.order > n.order for m in live if m.status == SentenceNodeStatus.PENDING):
            raise PlanChangeRefusedError(f"An eternal sentence must be the last node; node {n.order} is eternal",
                                    "eternal_not_last", status=409)


# ── 提出 ─────────────────────────────────────────────────────────────────


def _assert_open_for(plan, kind):
    if plan.status not in IN_PROGRESS_PLAN_STATUSES:
        raise PlanChangeRefusedError(f"This plan is {plan.status}", "plan_closed", status=409)
    # HELD 拒绝 AMEND(§4.2);REOPEN 也拒:状态机(§3.1)里 RETRIAL 只从 ACTIVE 进。
    if plan.status == SentencePlanStatus.HELD:
        raise PlanChangeRefusedError("The plan is held on an eternal node; end that node first", "plan_held", status=409)
    if kind == SentenceRequestKind.REOPEN and plan.status == SentencePlanStatus.RETRIAL:
        raise PlanChangeRefusedError("A reopened judgment is already under way", "plan_in_retrial", status=409)
    if SentencePlanRequest.all_objects.filter(plan_id=plan.pk, is_deleted=False,
                                              status=SentenceRequestStatus.PENDING).exists():
        raise PlanChangeRefusedError("This plan already has a request awaiting the original judge",
                                "request_pending", status=409)


def _create_request(plan, soul, *, from_tenant_code, kind, changes, reason, user, judgment_id=None):
    from apps.events.models import EventType

    try:
        with transaction.atomic():
            req = SentencePlanRequest.objects.create(
                plan=plan, from_tenant_code=from_tenant_code, kind=kind, changes=changes, reason=reason,
                requested_by_judgment_id=judgment_id, create_user=user if getattr(user, "pk", None) else None,
            )
    except IntegrityError:
        # `unique_pending_sentence_request`:并发的第二条。
        raise PlanChangeRefusedError("This plan already has a request awaiting the original judge",
                                "request_pending", status=409) from None
    record_event(soul, EventType.SENTENCE_REQUEST_CREATED, {
        "sentence_plan_id": str(plan.pk), "request_id": str(req.pk), "kind": kind, "from_tenant": from_tenant_code,
    }, tenant_id=plan.tenant_id)
    notify_judges({plan.tenant_id}, "sentence_request_pending", {"soul": soul.name, "tenant": from_tenant_code},
                  plan.pk)
    return req


def file_request(plan, tenant, *, kind, changes, reason, user):
    """情况 2.1 / 2.2:X 的判官直接提请求。灵魂此刻就在 X → 400(情况 1 要开审判,§4.2)。"""
    with transaction.atomic():
        soul = _lock_soul(plan.soul)
        plan = _lock_plan(plan.pk)
        if kind not in SentenceRequestKind.values:
            raise PlanChangeRefusedError(f"Unknown kind {kind!r}", "invalid_kind")
        if soul.tenant_id == tenant.pk:
            raise PlanChangeRefusedError(
                "The soul is here; open an amendment judgment instead of filing a request", "soul_is_here",
            )
        _assert_open_for(plan, kind)
        normalized = normalize_changes(plan, tenant.code, changes, kind)
        if kind == SentenceRequestKind.REOPEN and not (reason or "").strip():
            raise PlanChangeRefusedError("A REOPEN request needs a reason", "reason_required")
        req = _create_request(plan, soul, from_tenant_code=tenant.code, kind=kind, changes=normalized,
                              reason=reason or "", user=user)
        SentencePlanService.advance(soul)
    return req


def request_from_amendment(judgment, plan_changes, reason):
    """情况 1:AMENDMENT 审判结案 → 一条 AMEND 请求(Q2)。没有改动 = 本地审判没改什么,不生成请求。
    调用方(`JudgmentConclusionService.conclude_judgment`)持有事务;拒绝时整个结案回滚。"""
    soul = _lock_soul(judgment.soul)
    plan = _lock_plan(judgment.amends_plan_id)
    if not plan_changes:
        return None
    _assert_open_for(plan, SentenceRequestKind.AMEND)
    normalized = normalize_changes(plan, judgment.tenant.code, plan_changes, SentenceRequestKind.AMEND)
    return _create_request(plan, soul, from_tenant_code=judgment.tenant.code, kind=SentenceRequestKind.AMEND,
                           changes=normalized, reason=reason, user=None, judgment_id=judgment.pk)


# ── 决定 / 撤回 ──────────────────────────────────────────────────────────


def _locked_pending_request(plan, request_id):
    req = (
        SentencePlanRequest.all_objects.select_for_update(of=("self",))
        .filter(pk=request_id, plan_id=plan.pk, is_deleted=False).first()
    )
    if req is None:
        raise PlanChangeRefusedError("No such request on this plan", "not_found", status=404)
    if req.status != SentenceRequestStatus.PENDING:
        raise PlanChangeRefusedError(f"This request is {req.status}", "request_closed", status=409)
    return req


def decide(plan, request_id, *, accept, reason, user):
    """原审判官决定。ACCEPT 应用改动(REOPEN 则立即在原属地开重开审判,Q7);REJECT 只记。然后推进。"""
    from apps.events.models import EventType

    with transaction.atomic():
        soul = _lock_soul(plan.soul)
        plan = _lock_plan(plan.pk)
        req = _locked_pending_request(plan, request_id)
        if accept:
            if plan.status not in IN_PROGRESS_PLAN_STATUSES:
                raise PlanChangeRefusedError(f"This plan is {plan.status}", "plan_closed", status=409)
            if plan.status == SentencePlanStatus.HELD:
                raise PlanChangeRefusedError("The plan is held on an eternal node; end that node first",
                                        "plan_held", status=409)
            if req.kind == SentenceRequestKind.REOPEN:
                _open_reopen_judgment(soul, plan, req)
            else:
                _apply(soul, plan, req)
        req.status = SentenceRequestStatus.ACCEPTED if accept else SentenceRequestStatus.REJECTED
        req.decision_reason = reason or ""
        req.decided_by = user if getattr(user, "pk", None) else None
        req.decided_at = timezone.now()
        _save(req, "status", "decision_reason", "decided_by", "decided_at")
        record_event(soul, EventType.SENTENCE_REQUEST_DECIDED, {
            "sentence_plan_id": str(plan.pk), "request_id": str(req.pk), "kind": req.kind, "status": req.status,
        }, tenant_id=plan.tenant_id)
        notify_judges({_tenant_id(req.from_tenant_code)}, "sentence_request_decided", {"soul": soul.name}, plan.pk)
        SentencePlanService.advance(soul)
    return req


def withdraw(plan, request_id, *, tenant, exempt, user):
    """请求方撤回(§4.2)。只有提出方租户(或 ADMIN)。"""
    with transaction.atomic():
        soul = _lock_soul(plan.soul)
        plan = _lock_plan(plan.pk)
        req = _locked_pending_request(plan, request_id)
        if not exempt and (tenant is None or tenant.code != req.from_tenant_code):
            raise PlanChangeRefusedError("Only the tenant that filed the request may withdraw it", "not_requester",
                                    status=403)
        req.status = SentenceRequestStatus.WITHDRAWN
        req.decided_at = timezone.now()
        _save(req, "status", "decided_at")
        SentencePlanService.advance(soul)
    return req


def _apply(soul, plan, req):
    """ACCEPT 一条 AMEND:减项 → REMOVED;加项 → 情况 1 插在当前节点之后、2.x 追加到队尾(§4.1)。"""
    nodes = _lock_nodes(plan)
    by_id = {str(n.pk): n for n in nodes}
    for pk in req.changes.get("remove", []):
        node = by_id.get(pk)
        if node is None or node.status != SentenceNodeStatus.PENDING:
            raise PlanChangeRefusedError(
                f"Node {getattr(node, 'order', pk)} is no longer PENDING", "node_not_pending", status=409,
                node_status=getattr(node, "status", None),
            )
        node.status = SentenceNodeStatus.REMOVED
        node.removed_by_request_id = req.pk
        _save(node, "status", "removed_by_request_id")
    live = [n for n in nodes if n.status in LIVE_NODE_STATUSES]
    added = req.changes.get("add", [])
    added_nodes = []
    if added:
        if req.requested_by_judgment_id is not None:
            current = [n for n in live if n.status in OCCUPYING_NODE_STATUSES]
            started = [n for n in live if n.status != SentenceNodeStatus.PENDING]
            anchor = (current or started or live)[-1].order
        else:
            anchor = max(n.order for n in live)
        shift = len(added)
        # 从后往前挪:`unique_live_sentence_node_order` 在每一行更新时就检查。
        for node in sorted((n for n in live if n.order > anchor), key=lambda n: -n.order):
            node.order += shift
            _save(node, "order")
        for i, item in enumerate(added, start=1):
            added_nodes.append(SentenceNode.objects.create(
                plan=plan, order=anchor + i, tenant_code=item["tenant_code"], is_home=False,
                status=SentenceNodeStatus.PENDING, realm_code=item["realm_code"],
                sentence_years=item["sentence_years"], is_eternal=item["is_eternal"],
                memory_reset=item["memory_reset"], added_by_request_id=req.pk,
                added_by_judgment_id=req.requested_by_judgment_id, reason=item["reason"],
            ))
        live.extend(added_nodes)
    _assert_eternal_last(live)
    touched = {item["tenant_code"] for item in added} | {by_id[pk].tenant_code for pk in req.changes.get("remove", [])}
    plan_amended(soul, plan, touched, request_id=req.pk, added=added_nodes)


def append_cross_stops(cross):
    """审批流程并入的跨域审判以 PASS 结束(第四十三批):参与方的站追加到灵魂受刑计划的队尾 —— 与 `_apply` 的
    2.x 追加同一条路(排在现有各站之后,永久刑期必须最后,事件 / 审计 / 通知走 `plan_amended`)。

    只在原审判**已经结案**时追加:还没结案的是存量那种先结联审、后结原审判的,参与方的站在原审判结案时
    由 `SentencePlanService.create_from_conclusion` 抄。同一场联审已经抄过 / 追加过(有本审判加的外站)就什么都不做。
    计划已经刑满(COMPLETED)而灵魂只是在等转世(REINCARNATING,本世没有审批中 / 已批准的转生申请)或已入终局
    (SETTLED):重新打开计划、灵魂经 `Soul.transition_to` 回到 DISPOSED,追加之后由 `advance` 调往第一个外站
    (2026-10-18 用户决定;SETTLED 那一半同日后补)。
    其余结束了的(撤销 = 赦免、已转世、失踪、转生已批 / 审批中)或没有建计划的:记 warning、不追加。
    """
    import logging

    from apps.dispatch.models import ParticipantRole
    from apps.judgment.models import Judgment

    if cross.judgment_id is None:
        return []
    judgment = Judgment.all_objects.filter(pk=cross.judgment_id).first()
    if judgment is None or not judgment.is_final:
        return []
    found = SentencePlan.all_objects.filter(
        origin_judgment_id=judgment.pk, is_deleted=False, status__in=IN_PROGRESS_PLAN_STATUSES,
    ).select_related("soul").first()
    reopen = found is None
    if reopen:
        found = _finished_plan(judgment)
    if found is None:
        logging.getLogger(__name__).warning(
            "sentence_plan: cross judgment %s concluded PASS but judgment %s has no plan in progress; no stops added",
            cross.pk, judgment.pk)
        return []
    soul = _lock_soul(found.soul)
    plan = _lock_plan(found.pk)
    nodes = _lock_nodes(plan)
    if any(n.added_by_judgment_id == judgment.pk and not n.is_home for n in nodes):
        return []
    seats = list(cross.participants.filter(is_deleted=False).exclude(role=ParticipantRole.ADVISOR)
                 .select_related("participant_tenant").order_by("node_order"))
    if not seats:
        return []
    if reopen and not _reopen(soul, plan, nodes, judgment):
        logging.getLogger(__name__).warning(
            "sentence_plan: cross judgment %s concluded PASS but plan %s is %s and soul %s is %s; no stops added",
            cross.pk, plan.pk, plan.status, soul.pk, soul.current_state)
        return []
    live = [n for n in nodes if n.status in LIVE_NODE_STATUSES]
    anchor = max(n.order for n in live)
    added = [
        SentenceNode.objects.create(
            plan=plan, order=anchor + i, tenant_code=seat.participant_tenant.code, is_home=False,
            status=SentenceNodeStatus.PENDING, realm_code=seat.sentence_realm_code,
            sentence_years=seat.sentence_years, is_eternal=seat.sentence_is_eternal,
            memory_reset=seat.sentence_memory_reset or "NONE", added_by_judgment_id=judgment.pk,
            reason=seat.sentence_notes,
        )
        for i, seat in enumerate(seats, start=1)
    ]
    _assert_eternal_last(live + added)
    plan_amended(soul, plan, {n.tenant_code for n in added}, judgment_id=judgment.pk, added=added)
    if reopen:
        SentencePlanService.advance(soul)  # 灵魂在原属、没有占位的站:不推就停在这里
    return added


def _finished_plan(judgment):
    """这份审判开出的、已经刑满的计划(最近的一份),或 None。撤销(CANCELLED = 赦免)的不重开:赦免是一个决定。"""
    return SentencePlan.all_objects.filter(
        origin_judgment_id=judgment.pk, is_deleted=False, status=SentencePlanStatus.COMPLETED,
    ).select_related("soul").order_by("-completed_at").first()


def _reopen(soul, plan, nodes, judgment):
    """在灵魂与计划的行锁下重开:灵魂必须在 REINCARNATING(刑满、等转世)或 SETTLED(终局:那里没有下一世,
    但计划没走完就不算结案),且本世没有审批中或已批准的转生申请 —— 那之后(转生已批、已转世 ALIVE、LOST)
    都不再回头。原属地永久刑期收尾的(有 ETERNAL 节点,也是 SETTLED)不重开:永久之后不能再有站(Q5)。
    返回是否重开了;没重开时什么都没写。
    状态经 `transition_to`(STATE_CHANGED 事件同一事务),不直接写 `current_state`。"""
    from apps.soul_accounts.models import OPEN_APPLICATION_STATUSES, RebirthApplicationStatus
    from apps.souls.models import SoulState

    if plan.status != SentencePlanStatus.COMPLETED or soul.current_state not in (
            SoulState.REINCARNATING, SoulState.SETTLED):
        return False
    if any(n.status == SentenceNodeStatus.ETERNAL for n in nodes):
        return False
    if soul.rebirth_applications.filter(
            cycle=soul.life_index,
            status__in=[*OPEN_APPLICATION_STATUSES, RebirthApplicationStatus.APPROVED]).exists():
        return False
    if not soul.transition_to(SoulState.DISPOSED, f"Sentence plan {plan.pk} reopened: cross judgment of "
                                                 f"{judgment.pk} concluded PASS"):
        return False
    soul.refresh_from_db()
    # 孟婆汤每世一次、在「最后一次候转世」时饮:重开计划后再回到候转世要重新饮(2026-10-27)。
    if soul.soup_taken_at is not None:
        soul.soup_taken_at = None
        soul.save(update_fields=["soup_taken_at"])
    plan.status = SentencePlanStatus.ACTIVE
    plan.completed_at = None
    _save(plan, "status", "completed_at")
    return True


def plan_amended(soul, plan, touched_codes, *, request_id=None, judgment_id=None, added=()):
    """节点集合变了:事件、审计、通知(被加 / 被删节点所在文明的判官 + 原属判官)、推送。

    `added_node_ids`:新加的站 —— 推送落地时 App 在这几站上标「新」(画布 1d)。减项的站灵魂看不见,不列。"""
    from apps.audit.models import AuditAction, AuditLog
    from apps.events.models import EventType

    record_event(soul, EventType.SENTENCE_PLAN_AMENDED, {
        "sentence_plan_id": str(plan.pk), "request_id": str(request_id) if request_id else None,
        "judgment_id": str(judgment_id) if judgment_id else None,
        "added_node_ids": [str(n.pk) for n in added],
    })
    AuditLog.objects.create(
        tenant_id=plan.tenant_id, action=AuditAction.UPDATE, resource="sentence_plan", resource_id=str(plan.pk),
        changes={"request": str(request_id) if request_id else None,
                 "judgment": str(judgment_id) if judgment_id else None,
                 "nodes": [[n.order, n.tenant_code, n.status] for n in plan.nodes.order_by("order")]},
        description=f"受刑计划变更:{soul.name}"[:500],
    )
    tenant_ids = {_tenant_id(code) for code in touched_codes} | {plan.tenant_id}
    notify_judges({t for t in tenant_ids if t}, "sentence_plan_amended",
                  {"soul": soul.name, "tenant": ", ".join(sorted(touched_codes)) or "-"}, plan.pk)


# ── 重开审判(Q7、N1=(a))────────────────────────────────────────────────


def _open_reopen_judgment(soul, plan, req):
    """批准 REOPEN:原属地**立刻**开一件重开审判,即使灵魂在外地;计划进 RETRIAL。

    「一个灵魂同时只能有一个未结案审判」不改(Q7 澄清):已有未结案的(情况 1 的加减项审判还没结)
    → 409 `open_judgment`,请求留在 PENDING,原审判官等它结案后再批(§4.3 表第一行)。
    租户隔离的唯一一条写例外(`apps.core.tenant.residence_writable`)。
    """
    from apps.core.tenant import RESIDENCE_WRITE_REOPEN, residence_writable
    from apps.judgment.models import Judgment, JudgmentKind, open_judgments

    open_ids = [str(pk) for pk in open_judgments(soul).values_list("pk", flat=True)]
    if open_ids:
        raise PlanChangeRefusedError("The soul has an open judgment; decide once it is concluded or withdrawn",
                                "open_judgment", status=409, open_judgment_ids=open_ids)
    home = plan.tenant
    if soul.is_residing and not residence_writable(soul, home, RESIDENCE_WRITE_REOPEN):
        raise PlanChangeRefusedError("Only the home tenant opens a reopened judgment", "not_home", status=403)
    Judgment.objects.create(
        soul=soul, tenant=home, civilization=home.known_civilization or soul.civilization,
        court="重开审判", kind=JudgmentKind.REOPEN, amends_plan_id=plan.pk, notes="",
    )
    plan.status = SentencePlanStatus.RETRIAL
    _save(plan, "status")


def _refuse_european_retry(soul, verdict):
    """欧洲 RETRY 不是一个去处:路由会给炼狱,而炼狱期满即升天堂(docs/01_欧洲天堂地狱整体架构.md §1.2:
    炼狱只收确定得救者)。原审判结案时它重开一案(`JudgmentConclusionService`);重开审判与申诉改判
    没有「再开一案」这一步,所以拒绝 —— 要么给 PURGATORY / FAILED / PASSED,要么另开审判。"""
    from apps.judgment.models import Verdict
    from apps.souls.models import Civilization

    if verdict == Verdict.RETRY and soul.home_civilization == Civilization.EUROPEAN:
        raise PlanChangeRefusedError(
            "A European RETRY is not a destination; give a final verdict or open a new judgment",
            "retry_not_a_destination")


def conclude_reopened(judgment):
    """重开审判结案(N1=(a)):新裁决 + 一个新的原属节点,排在所有已开始的节点之后、未执行的节点之前
    (灵魂回原属地后先执行它)。计划 RETRIAL → ACTIVE 由随后的 `advance` 做。

    新节点的 realm 按**原属**文明与新裁决路由(同原审判);处置在节点激活时建(`_activate_home_node`),
    挂这件重开审判。永久刑期而后面还有未执行节点 → 409 `eternal_not_last`(Q5),结案回滚。
    """
    from apps.realms.models import realm_by_code

    soul = _lock_soul(judgment.soul)
    plan = _lock_plan(judgment.amends_plan_id)
    nodes = _lock_nodes(plan)
    live = [n for n in nodes if n.status in LIVE_NODE_STATUSES]
    started = [n for n in live if n.status != SentenceNodeStatus.PENDING]
    anchor = max(n.order for n in started) if started else 0
    for node in sorted((n for n in live if n.order > anchor), key=lambda n: -n.order):
        node.order += 1
        _save(node, "order")
    _refuse_european_retry(soul, judgment.verdict)
    realm_code = _route_home_realm(soul, judgment.verdict, judgment.judgment_method, judgment=judgment)
    realm = realm_by_code(realm_code, tenant_id=plan.tenant_id)
    home_code = plan.tenant.code
    new_node = SentenceNode.objects.create(
        plan=plan, order=anchor + 1, tenant_code=home_code, is_home=True, status=SentenceNodeStatus.PENDING,
        realm_code=realm.realm_code if realm else "", is_eternal=realm.is_eternal if realm else False,
        memory_reset=(realm.memory_reset_mechanism if realm else None) or "NONE",
        added_by_judgment_id=judgment.pk, reason=judgment.notes or "",
    )
    live.append(new_node)
    _assert_eternal_last(live)
    plan_amended(soul, plan, {home_code}, judgment_id=judgment.pk, added=[new_node])


# ── 申诉改判(apps/judgment/appeals.py,用户 2026-10-24 决定)───────────────


def amend_for_appeal(soul, judgment, verdict, *, keep_foreign=None):
    """申诉改判:**未执行**的部分改按新裁决,**已执行**的交还调用方记补偿。返回已执行的 `[(节点或 None, 处置)]`。

    「执行」= 处置已执行(`Disposition.is_executed`,执行即开始服刑,2026-09-25 决定)。
    * 原属地正受着的节点(ACTIVE)而处置还没执行 → 就地改:节点与处置换成新裁决路由的 realm;
    * 未开始的节点(PENDING,含联审抄来的外地站)→ REMOVED —— 它们是按原判排的;
    * 没有就地可改的节点(原属那一站已执行)→ 追加一个原属节点,内容按新裁决路由,与重开审判结案同形;
    * 外地站正在调拨或已到而处置未执行 → 409 `plan_in_transit`,等那一站执行完再决定;
    * 计划在重审 / 永久挂起 / 有待决请求 → 409 `plan_busy`;
    * 计划已结束 → 只返回已执行的部分(灵魂可能已转生,不再开新的一站)。
    没有计划的(早于受刑计划的结案)看审判自己的处置:未执行就地改,已执行记补偿。
    调用方持有灵魂行锁与事务;计划上的锁序照旧(计划 → 节点 → 处置)。
    """
    from apps.disposition.models import Disposition
    from apps.realms.models import realm_by_code

    _refuse_european_retry(soul, verdict)
    from apps.souls.models import Civilization

    if soul.home_civilization == Civilization.EUROPEAN:
        # 大罪 / 小罪(docs/01 §1.2-1.3):改判同样不能把未悔的大罪判进炼狱,也不能把只有小罪的判下地狱。
        from apps.disposition.services import DispositionService
        DispositionService.refuse_against_gravity(soul, verdict)
    realm_code = _route_home_realm(soul, verdict, judgment.judgment_method, judgment=judgment)
    realm = realm_by_code(realm_code, tenant_id=soul.home_tenant_id or soul.tenant_id)
    content = {
        "realm_code": realm.realm_code if realm else "", "is_eternal": realm.is_eternal if realm else False,
        "memory_reset": (realm.memory_reset_mechanism if realm else None) or "NONE", "sentence_years": None,
    }

    def reroute(disposition):
        from apps.realms.path import SoulPathService

        disposition.destination_realm = realm
        disposition.is_eternal = content["is_eternal"]
        disposition.memory_reset = content["memory_reset"]
        disposition.sentence_years = None
        disposition.save(update_fields=["destination_realm", "is_eternal", "memory_reset", "sentence_years",
                                        "update_time", "update_user", "version"])
        SoulPathService.enter(soul, realm, tenant_id=disposition.tenant_id)

    found = (SentencePlan.all_objects.filter(origin_judgment_id=judgment.pk, is_deleted=False)
             .order_by("-create_time").values_list("pk", flat=True).first())
    if found is None:
        own = Disposition.all_objects.select_for_update(of=("self",)).filter(judgment_id=judgment.pk).first()
        if own is None:
            return []
        if own.is_executed:
            return [(None, own)]
        reroute(own)
        return []

    plan = _lock_plan(found)
    nodes = _lock_nodes(plan)
    dispositions = {
        d.pk: d for d in Disposition.all_objects.select_for_update(of=("self",))
        .filter(pk__in=[n.disposition_id for n in nodes if n.disposition_id])
    }
    executed = [(n, dispositions[n.disposition_id]) for n in nodes
                if n.disposition_id in dispositions and dispositions[n.disposition_id].is_executed]
    if plan.status not in IN_PROGRESS_PLAN_STATUSES:
        return executed
    if plan.status != SentencePlanStatus.ACTIVE or SentencePlanRequest.all_objects.filter(
            plan_id=plan.pk, is_deleted=False, status=SentenceRequestStatus.PENDING).exists():
        raise PlanChangeRefusedError("The sentence plan is in retrial, held, or awaiting a request; decide later",
                                     "plan_busy", status=409, plan_status=plan.status)
    done = {n.pk for n, _ in executed}
    in_place = None
    for node in nodes:
        if node.status not in OCCUPYING_NODE_STATUSES or node.pk in done:
            continue
        if not (node.is_home and node.status == SentenceNodeStatus.ACTIVE):
            raise PlanChangeRefusedError("The soul is on its way to, or at, a stop whose sentence has not been "
                                         "executed yet; decide once it has", "plan_in_transit", status=409,
                                         node_order=node.order)
        in_place = node
    touched = {plan.tenant.code}
    # Foreign stops a joint judgment added and not yet started: the reviewing judge decides whether they stand
    # (2026-10-24 user decision). Asked only when there are some.
    foreign = [n for n in nodes if n.status == SentenceNodeStatus.PENDING and not n.is_home]
    if foreign and keep_foreign is None:
        raise PlanChangeRefusedError("Decide whether the not-yet-started foreign stops stay (keep_foreign_stops)",
                                     "foreign_stops_choice_required", status=400,
                                     foreign_orders=[n.order for n in foreign])
    for node in nodes:
        if node.status == SentenceNodeStatus.PENDING and not (keep_foreign and not node.is_home):
            node.status = SentenceNodeStatus.REMOVED
            _save(node, "status")
            touched.add(node.tenant_code)
    added = []
    if in_place is not None:
        reroute(dispositions[in_place.disposition_id])
        for field, value in content.items():
            setattr(in_place, field, value)
        in_place.reason = f"申诉改判:{verdict}"
        _save(in_place, *content, "reason")
    else:
        live = [n for n in nodes if n.status in LIVE_NODE_STATUSES]
        added.append(SentenceNode.objects.create(
            plan=plan, order=max(n.order for n in live) + 1, tenant_code=plan.tenant.code, is_home=True,
            status=SentenceNodeStatus.PENDING, added_by_judgment_id=judgment.pk, reason=f"申诉改判:{verdict}",
            **content,
        ))
    plan_amended(soul, plan, touched, judgment_id=judgment.pk, added=added)
    return executed


# ── 撤销(Q11)──────────────────────────────────────────────────────────


def cancel(plan, *, reason, user):
    """`sentence_plan.cancel`:**撤销 = 赦免剩余刑期,视为完成**(2026-09-19 用户决定,取代 §3.1 原来的
    「撤销 = 否认计划、灵魂在外不自动回归」)。

    1. 未开始的节点(PENDING / DISPATCHING)→ CANCELLED,进行中的调拨 → CANCELLED;
    2. 正在受的刑(ACTIVE / WAITING / ETERNAL)→ ABORTED(赦免);
    3. 待决请求 → WITHDRAWN,未结的重开审判撤案;
    4. 灵魂在外 → 回归原属(`end_residence`,与计划推进里的回归同一个函数);
    5. 计划完成的同一条路径(`SentencePlanService._complete(pardoned=True)`):灵魂进 REINCARNATING / SETTLED,
       事件、通知、推送;终态记 **CANCELLED**(与「刑满完成」的 COMPLETED 区分),`eligibility` 把两者都当作已完成。

    拒绝(什么都不写):理由为空;计划已结束;灵魂还有别的未结案审判(与正常完成一致 —— 未结案审判
    拦住回归与完成);灵魂不在能完成的状态。
    """
    from apps.audit.models import AuditAction, AuditLog
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService
    from apps.judgment.models import Judgment, JudgmentKind, open_judgments

    if not (reason or "").strip():
        raise PlanChangeRefusedError("A reason is required to cancel a sentence plan", "reason_required")
    with transaction.atomic():
        soul = _lock_soul(plan.soul)
        plan = _lock_plan(plan.pk)
        if plan.status not in IN_PROGRESS_PLAN_STATUSES:
            raise PlanChangeRefusedError(f"This plan is {plan.status}", "plan_closed", status=409)
        retrials = Judgment.all_objects.filter(
            amends_plan_id=plan.pk, kind=JudgmentKind.REOPEN, verdict__isnull=True, is_final=False, is_deleted=False,
        )
        other_open = [str(pk) for pk in open_judgments(soul).exclude(pk__in=retrials.values("pk"))
                      .values_list("pk", flat=True)]
        if other_open:
            raise PlanChangeRefusedError(
                "The soul has an open judgment; conclude or withdraw it before the plan can be cancelled",
                "open_judgment", status=409, open_judgment_ids=other_open,
            )
        by_user = user if getattr(user, "pk", None) else None
        for case in retrials:
            case.soft_delete(user=by_user, reason=f"sentence plan cancelled: {reason}")
        SentencePlanRequest.all_objects.filter(
            plan_id=plan.pk, is_deleted=False, status=SentenceRequestStatus.PENDING,
        ).update(status=SentenceRequestStatus.WITHDRAWN, decided_at=timezone.now())
        now = timezone.now()
        nodes = _lock_nodes(plan)
        for node in nodes:
            if node.status in (SentenceNodeStatus.PENDING, SentenceNodeStatus.DISPATCHING):
                if node.dispatch_record_id is not None:
                    record = DispatchRecord._base_manager.filter(pk=node.dispatch_record_id).first()
                    if record is not None and record.status in (DispatchStatus.PROPOSED, DispatchStatus.APPROVED):
                        record.transition_to(DispatchStatus.CANCELLED, decided_at=now)
                node.status = SentenceNodeStatus.CANCELLED
                _save(node, "status")
            elif node.status in (SentenceNodeStatus.ACTIVE, SentenceNodeStatus.WAITING, SentenceNodeStatus.ETERNAL):
                node.status = SentenceNodeStatus.ABORTED
                node.completed_at = now
                _save(node, "status", "completed_at")
        if soul.is_residing:
            DispatchService.end_residence(
                soul, actor=user if getattr(user, "is_authenticated", False) else "system",
                trigger=DispatchService.RETURN_ON_PLAN_CANCELLED, reason=reason,
            )
            soul = _lock_soul(soul)
        plan.cancel_reason = reason
        _save(plan, "cancel_reason")
        if not SentencePlanService._complete(soul, plan, nodes, pardoned=True):
            raise PlanChangeRefusedError(
                f"The soul is {soul.current_state}; the plan cannot be closed from there", "soul_state", status=409,
            )
        AuditLog.objects.create(
            tenant_id=plan.tenant_id, user=user if getattr(user, "is_authenticated", False) else None,
            action=AuditAction.UPDATE, resource="sentence_plan", resource_id=str(plan.pk),
            changes={"status": ["IN_PROGRESS", "CANCELLED"], "reason": reason},
            description=f"受刑计划撤销(赦免剩余刑期):{soul.name} {reason}"[:500],
        )
    return plan


# ── 重新发起调拨 ────────────────────────────────────────────────────────


def retry_dispatch(plan, node_id, *, user):
    """调拨被拒或取消后节点退回 PENDING(Q4、D5 不自动重试):官员对这一站重新发起调拨。

    走的是首次发起的同一条路径 —— `SentencePlanService.advance` → `_step` → `_dispatch` —— 这里只在
    它前面加「这一站确实被拒过、现在轮到它」的检查,并在它后面确认调拨真的发出去了。拒绝(什么都不写):
    计划不在进行中(`plan_closed` / `plan_held`);节点不存在(`unknown_node` 404)、不是外地的 PENDING
    (`node_not_retryable`)、从没被拒或取消过(`not_refused`)、前面还有没执行的节点(`not_next`);
    灵魂不在原属(`soul_away`);有未结案审判(`open_judgment`)、待决请求(`request_pending`);
    调拨没发出去(`dispatch_not_started`,例如还有一条手动调拨在 PROPOSED)。

    锁序同本 app:灵魂 → 计划 → 节点 → 调拨记录。并发的第二个调用在锁后看到节点已是 DISPATCHING,
    答 409 `node_not_retryable`。事件写在这笔业务的事务里。
    """
    from apps.events.models import EventType
    from apps.judgment.models import open_judgments

    with transaction.atomic():
        soul = _lock_soul(plan.soul)
        plan = _lock_plan(plan.pk)
        if plan.status == SentencePlanStatus.HELD:
            raise PlanChangeRefusedError("The plan is held on an eternal stop", "plan_held", status=409)
        if plan.status not in (SentencePlanStatus.ACTIVE, SentencePlanStatus.RETRIAL):
            raise PlanChangeRefusedError(f"This plan is {plan.status}", "plan_closed", status=409)
        nodes = _lock_nodes(plan)
        node = next((n for n in nodes if str(n.pk) == str(node_id)), None)
        if node is None:
            raise PlanChangeRefusedError("No such stop on this plan", "unknown_node", status=404)
        if node.status != SentenceNodeStatus.PENDING or node.is_home:
            raise PlanChangeRefusedError(f"This stop is {node.status}; there is nothing to send again",
                                         "node_not_retryable", status=409)
        if last_refusal(node) is None:
            raise PlanChangeRefusedError("This stop's dispatch was never refused or cancelled", "not_refused",
                                         status=409)
        if next(n for n in nodes if n.status == SentenceNodeStatus.PENDING).pk != node.pk:
            raise PlanChangeRefusedError("An earlier stop is still waiting to start", "not_next", status=409)
        if soul.is_residing:
            raise PlanChangeRefusedError("The soul is not at home", "soul_away", status=409)
        if open_judgments(soul).exists():
            raise PlanChangeRefusedError("The soul has an open judgment", "open_judgment", status=409)
        if SentencePlanRequest.all_objects.filter(
            plan_id=plan.pk, is_deleted=False, status=SentenceRequestStatus.PENDING,
        ).exists():
            raise PlanChangeRefusedError("A request on this plan awaits the original judge", "request_pending",
                                         status=409)
        SentencePlanService.advance(soul)
        node = SentenceNode.all_objects.get(pk=node.pk)
        if node.status != SentenceNodeStatus.DISPATCHING:
            raise PlanChangeRefusedError("The dispatch could not be started now", "dispatch_not_started", status=409)
        record_event(soul, EventType.SENTENCE_NODE_REDISPATCHED, {
            "sentence_plan_id": str(plan.pk), "node_id": str(node.pk), "order": node.order,
            "tenant_code": node.tenant_code, "dispatch_id": str(node.dispatch_record_id),
        })
    return node


__all__ = [
    "PlanChangeRefusedError", "SentencePlan", "cancel", "retry_dispatch", "conclude_reopened", "decide", "file_request",
    "normalize_changes", "request_from_amendment", "withdraw", "amend_for_appeal",
]
