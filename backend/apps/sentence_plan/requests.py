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
    from apps.realms.models import Realm
    from apps.souls.models import TENANT_CIVILIZATION

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

    civilization = TENANT_CIVILIZATION.get(from_tenant_code)
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
        realm = Realm.all_objects.filter(realm_code=item.get("realm_code") or "", is_deleted=False).first()
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
            live.append(SentenceNode.objects.create(
                plan=plan, order=anchor + i, tenant_code=item["tenant_code"], is_home=False,
                status=SentenceNodeStatus.PENDING, realm_code=item["realm_code"],
                sentence_years=item["sentence_years"], is_eternal=item["is_eternal"],
                memory_reset=item["memory_reset"], added_by_request_id=req.pk,
                added_by_judgment_id=req.requested_by_judgment_id, reason=item["reason"],
            ))
    _assert_eternal_last(live)
    touched = {item["tenant_code"] for item in added} | {by_id[pk].tenant_code for pk in req.changes.get("remove", [])}
    plan_amended(soul, plan, touched, request_id=req.pk)


def plan_amended(soul, plan, touched_codes, *, request_id=None, judgment_id=None):
    """节点集合变了:事件、审计、通知(被加 / 被删节点所在文明的判官 + 原属判官)、推送。"""
    from apps.audit.models import AuditAction, AuditLog
    from apps.events.models import EventType

    record_event(soul, EventType.SENTENCE_PLAN_AMENDED, {
        "sentence_plan_id": str(plan.pk), "request_id": str(request_id) if request_id else None,
        "judgment_id": str(judgment_id) if judgment_id else None,
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
    from apps.souls.models import TENANT_CIVILIZATION

    open_ids = [str(pk) for pk in open_judgments(soul).values_list("pk", flat=True)]
    if open_ids:
        raise PlanChangeRefusedError("The soul has an open judgment; decide once it is concluded or withdrawn",
                                "open_judgment", status=409, open_judgment_ids=open_ids)
    home = plan.tenant
    if soul.is_residing and not residence_writable(soul, home, RESIDENCE_WRITE_REOPEN):
        raise PlanChangeRefusedError("Only the home tenant opens a reopened judgment", "not_home", status=403)
    Judgment.objects.create(
        soul=soul, tenant=home, civilization=TENANT_CIVILIZATION.get(home.code, soul.civilization),
        court="重开审判", kind=JudgmentKind.REOPEN, amends_plan_id=plan.pk, notes="",
    )
    plan.status = SentencePlanStatus.RETRIAL
    _save(plan, "status")


def conclude_reopened(judgment):
    """重开审判结案(N1=(a)):新裁决 + 一个新的原属节点,排在所有已开始的节点之后、未执行的节点之前
    (灵魂回原属地后先执行它)。计划 RETRIAL → ACTIVE 由随后的 `advance` 做。

    新节点的 realm 按**原属**文明与新裁决路由(同原审判);处置在节点激活时建(`_activate_home_node`),
    挂这件重开审判。永久刑期而后面还有未执行节点 → 409 `eternal_not_last`(Q5),结案回滚。
    """
    from apps.realms.models import Realm

    soul = _lock_soul(judgment.soul)
    plan = _lock_plan(judgment.amends_plan_id)
    nodes = _lock_nodes(plan)
    live = [n for n in nodes if n.status in LIVE_NODE_STATUSES]
    started = [n for n in live if n.status != SentenceNodeStatus.PENDING]
    anchor = max(n.order for n in started) if started else 0
    for node in sorted((n for n in live if n.order > anchor), key=lambda n: -n.order):
        node.order += 1
        _save(node, "order")
    realm_code = _route_home_realm(soul, judgment.verdict, judgment.judgment_method)
    realm = Realm.all_objects.filter(realm_code=realm_code, is_deleted=False).first()
    home_code = plan.tenant.code
    live.append(SentenceNode.objects.create(
        plan=plan, order=anchor + 1, tenant_code=home_code, is_home=True, status=SentenceNodeStatus.PENDING,
        realm_code=realm.realm_code if realm else "", is_eternal=realm.is_eternal if realm else False,
        memory_reset=(realm.memory_reset_mechanism if realm else None) or "NONE",
        added_by_judgment_id=judgment.pk, reason=judgment.notes or "",
    ))
    _assert_eternal_last(live)
    plan_amended(soul, plan, {home_code}, judgment_id=judgment.pk)


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


__all__ = [
    "PlanChangeRefusedError", "SentencePlan", "cancel", "conclude_reopened", "decide", "file_request",
    "normalize_changes", "request_from_amendment", "withdraw",
]
