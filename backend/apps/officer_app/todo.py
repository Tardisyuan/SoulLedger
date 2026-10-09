"""「待我处理」:轮到当前官员的四类事,以及单条的「还能不能处理 / 谁处理了」。

**不重新推导任何规则**,每一类都复用官员台已有的查询与判定:

* 审批节点 / 转生申请:`ApprovalWorkflowViewSet.get_queryset` 的租户 + 行级范围,再逐个问
  `ApprovalNode.can_approve`(与 `approve_node` 的闸门同一个函数);转生申请的工作流
  (case_type REBIRTH_APPLICATION)归「转生申请」,其余归「审批节点」,两类不重复计数。
* 改派请求 = 调拨提案:`DispatchRecordViewSet.proposed` 的谓词(目标殿 = 我的殿,状态 PROPOSED)。
  判官「请管理员改派」(`judgment.claims.request_reassign`)只发一条通知,没有可查询的队列,不在此列。
* 缩短冷却申请:`OfficerCooldownShorteningViewSet` 的范围(`soul__home_tenant`),状态 PENDING。

每一类还要有对应的权限码(`workflow.approve` / `dispatch.approve`)。没有时该组为空,不报错。

范围由一个「像请求的对象」(`.user` / `.tenant`)给出,这样推送(没有请求)也能算同一个数。
"""
from types import SimpleNamespace

from apps.core.tenant import scope_to_tenant
from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.perm.checker import check_permission
from apps.perm.filters import DataScopeFilter
from apps.soul_accounts.models import (
    CooldownShorteningRequest,
    CooldownShorteningStatus,
    RebirthApplication,
)
from apps.workflow import cosign, decision_codes
from apps.workflow.models import (
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    CaseType,
    NodeKind,
    NodeStatus,
)

LIST_LIMIT = 10
KINDS = ("approval", "reassignment", "cooldown", "rebirth")


def scope_of(user, request=None):
    return request or SimpleNamespace(user=user, tenant=user.tenant, method="GET")


# ── 范围内的查询(列表与详情共用)────────────────────────────────────────


def _workflows(scope):
    qs = ApprovalWorkflow._base_manager.select_related("soul", "current_node", "current_node__approver")
    return DataScopeFilter.filter_queryset(scope, scope_to_tenant(qs, scope), ApprovalWorkflow)


def _cooldowns(scope):
    qs = CooldownShorteningRequest.objects.select_related("soul", "decided_by")
    return scope_to_tenant(qs, scope, field="soul__home_tenant")


def _dispatches(scope):
    tenant = getattr(scope, "tenant", None)
    qs = DispatchRecord._base_manager.filter(is_deleted=False, target_tenant=tenant) if tenant else DispatchRecord.objects.none()
    return qs.select_related("soul")


def _waiting_workflows(scope):
    """(workflow, node) 对:当前节点待决,且我是它指定的审批人。"""
    user = scope.user
    if not check_permission(user, "workflow.approve"):
        return []
    from django.db.models import Q

    # 加签: a node with co-signers is a candidate for anyone; `can_approve` below decides.
    mine = Q(current_node__kind=NodeKind.COUNTERSIGN) | ~Q(current_node__cosigners_json=[]) | Q(
        current_node__approver_type="ROLE", current_node__approver_role=user.role)
    if user.actor_id:
        mine |= Q(current_node__approver_type="ACTOR", current_node__approver_actor_id=user.actor_id)
    qs = _workflows(scope).filter(mine, status=ApprovalWorkflowStatus.IN_PROGRESS,
                                  current_node__status=NodeStatus.PENDING).order_by("created_at")
    return [(wf, wf.current_node) for wf in qs if wf.current_node.can_approve(user)]


def _item(kind, pk, title, created_at, **extra):
    return {"kind": kind, "id": str(pk), "title": title, "created_at": created_at,
            "target": {"kind": kind, "id": str(pk)}, **extra}


def _rebirth_facts(wf):
    """转生申请条目的标题是灵魂名,「转生申请 · 名」由客户端按语言包拼;库里的 `workflow_name`
    (「转生申请: 灵魂码」,检索与审计在用)不动。申诉走同一条工作流类型,客户端要用 `is_appeal` 选措辞。"""
    return {"soul_code": wf.soul.soul_code, "is_appeal": wf.is_appeal}


def _group(items):
    return {"count": len(items), "items": items[:LIST_LIMIT]}


def build(user, request=None):
    scope = scope_of(user, request)
    waiting = _waiting_workflows(scope)
    plain = [(wf, n) for wf, n in waiting if wf.case_type != CaseType.REBIRTH_APPLICATION]
    rebirth_wfs = [wf for wf, _ in waiting if wf.case_type == CaseType.REBIRTH_APPLICATION]
    from django.db.models import Q

    apps_by_wf = {}
    for app in RebirthApplication.objects.filter(Q(workflow__in=rebirth_wfs) | Q(appeal_workflow__in=rebirth_wfs)):
        apps_by_wf[app.workflow_id] = apps_by_wf[app.appeal_workflow_id] = app

    approvals = [_item("approval", wf.pk, wf.workflow_name, node.activated_at or wf.created_at,
                       node_name=node.node_name) for wf, node in plain]
    rebirths = [_item("rebirth", apps_by_wf[wf.pk].pk, wf.soul.name, wf.created_at, **_rebirth_facts(wf))
                for wf in rebirth_wfs if wf.pk in apps_by_wf]

    cooldowns, reassignments = [], []
    if check_permission(user, "workflow.approve"):
        cooldowns = [_item("cooldown", c.pk, c.soul.name, c.created_at)
                     for c in _cooldowns(scope).filter(status=CooldownShorteningStatus.PENDING).order_by("created_at")]
    if check_permission(user, "dispatch.approve"):
        reassignments = [_item("reassignment", d.pk, d.soul.name if d.soul_id else "", d.proposed_at)
                         for d in _dispatches(scope).filter(status=DispatchStatus.PROPOSED).order_by("proposed_at")]
    return {"approvals": _group(approvals), "reassignments": _group(reassignments),
            "cooldowns": _group(cooldowns), "rebirths": _group(rebirths)}


def total(user) -> int:
    return sum(group["count"] for group in build(user).values())


# ── 单条详情 ─────────────────────────────────────────────────────────────


def _state(actionable, code=None, handled_by=None, handled_at=None, **extra):
    return {"actionable": actionable, "state": "actionable" if actionable else code,
            "handled_by": handled_by, "handled_at": handled_at, **extra}


def _workflow_state(wf, user):
    node = wf.current_node
    if node is None:
        last = wf.nodes.exclude(decided_at=None).order_by("-decided_at").first()
        return _state(False, "already_handled", decision_codes.handled_by(last) if last else None,
                      last.decided_at if last else None, cosigners=[], waiting_on_cosigner=None)
    verdicts = list(node.required_verdicts or [])
    blocked = decision_codes.block_for(node, user)
    if blocked is None:
        return _state(True, node_id=str(node.pk), required_verdicts=verdicts, **cosign.facts(node, user))
    code, extra = blocked
    # 流程已经往下走:当前节点是别人的,但刚才被决定的是上一个节点。
    if code == "permission_changed":
        last = wf.nodes.exclude(decided_at=None).order_by("-decided_at").first()
        if last is not None and last.pk != node.pk:
            return _state(False, "already_handled", decision_codes.handled_by(last), last.decided_at,
                          cosigners=[], waiting_on_cosigner=None)
    return _state(False, code, extra.get("handled_by"), node.decided_at, node_id=str(node.pk),
                  required_verdicts=verdicts, cosigners=[], waiting_on_cosigner=None)


def workflow_for(scope, kind, pk):
    """The in-scope workflow behind an `approval` / `rebirth` item, or None."""
    if kind == "rebirth":
        app = RebirthApplication.objects.filter(pk=pk).first()
        return app and _workflows(scope).filter(pk=app.appeal_workflow_id or app.workflow_id).first()
    if kind == "approval":
        return _workflows(scope).filter(pk=pk).exclude(case_type=CaseType.REBIRTH_APPLICATION).first()
    return None


def detail(user, kind, pk, request=None):
    """None = 范围之外(404)。其余都带 `actionable` / `state` / `handled_by`。"""
    scope = scope_of(user, request)
    if kind in ("approval", "rebirth"):
        wf = workflow_for(scope, kind, pk)
        if wf is None:
            return None
        return {"kind": kind, "id": str(pk), "title": wf.soul.name if kind == "rebirth" else wf.workflow_name,
                "workflow_id": str(wf.pk), "created_at": wf.created_at,
                **(_rebirth_facts(wf) if kind == "rebirth" else {}), **_workflow_state(wf, user)}
    if kind == "cooldown":
        row = _cooldowns(scope).filter(pk=pk).first()
        if row is None:
            return None
        pending = row.status == CooldownShorteningStatus.PENDING
        ok = pending and check_permission(user, "workflow.approve")
        who = decision_codes.person(row.decided_by)
        return {"kind": kind, "id": str(row.pk), "title": row.soul.name, "created_at": row.created_at,
                **_state(ok, "already_handled" if not pending else "permission_changed", who, row.decided_at)}
    if kind == "reassignment":
        row = _dispatches(scope).filter(pk=pk).first()
        if row is None:
            return None
        pending = row.status == DispatchStatus.PROPOSED
        ok = pending and check_permission(user, "dispatch.approve")
        return {"kind": kind, "id": str(row.pk), "title": row.soul.name if row.soul_id else "",
                "created_at": row.proposed_at,
                # 调拨记录不存「谁决定的」,只有状态与时刻。
                **_state(ok, "already_handled" if not pending else "permission_changed", None, row.decided_at)}
    return None
