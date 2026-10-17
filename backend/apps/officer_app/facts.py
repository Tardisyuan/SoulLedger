"""官员 App 详情里的「申请内容」(Design 第三十四批 O-01):批准前要看清的东西。

四类共用一个 `facts` 块,字段按类给:

* 审批 / 转生(走审批流):`node`(当前节点第几步、是不是最后一步)、`requester`、`requested_at`、`deadline`、
  `reason`、`history`(发起 + 已决的节点 + 当前节点)、`attachments`(案卷附件,经原有的案卷附件签名地址)。
* 调拨:`from_hall` / `to_hall`、`requester`、`reason`、`souls`。调拨记录只有一个灵魂。
* 转生:`soul`、`cycle`(第几世)、`desired_form`、`merit_balance`(功过结余 = 功 − 过)、`reason`。
* 缩短冷却:`cooldown_now_days` / `cooldown_asked_days`、`reason`。

**只读已有的列,不推导规则。** `node.is_last` 是唯一算出来的:当前节点没有条件分支、没有 `on_pass`,
且后面没有需要人决定的待审节点。拿不到把握(有分支)就是 `null`,App 退回通用的一句。
附件只列这位官员此刻真能取到的(`attachments.may_view`),地址 10 分钟有效,每次打开详情重签。
"""
from apps.judgment import attachments as case_attachments
from apps.workflow.models import AUTOMATIC_KINDS, NodeStatus

#: 时间线里「已决」的节点状态(被跳过 / 只是经过的不算一步)。
DECIDED = (NodeStatus.APPROVED, NodeStatus.REJECTED, NodeStatus.ESCALATED)


def _name(user) -> str | None:
    return (getattr(user, "display_name", "") or user.username) if user else None


def hall_ref(tenant) -> dict | None:
    return {"code": tenant.code, "display_name": tenant.display_name} if tenant else None


def _nodes(wf) -> list:
    return list(wf.nodes.order_by("node_order"))


def _is_last(node, nodes) -> bool | None:
    """没有条件分支、没有 `on_pass`、后面没有要人决定的待审节点。有分支时无从知道,返回 None。"""
    if node.branches_json:
        return None
    if node.on_pass_id:
        return False
    return not any(n.node_order > node.node_order and n.status == NodeStatus.PENDING
                   and n.kind not in AUTOMATIC_KINDS for n in nodes)


def _next_name(node, nodes) -> str | None:
    if node.branches_json:
        return None
    if node.on_pass_id:
        return node.on_pass.node_name
    later = [n for n in nodes if n.node_order > node.node_order and n.status == NodeStatus.PENDING
             and n.kind not in AUTOMATIC_KINDS]
    return later[0].node_name if later else None


def _deadline(node):
    if node is None or not node.timeout_hours or node.activated_at is None:
        return None
    from datetime import timedelta

    return node.activated_at + timedelta(hours=node.timeout_hours)


def _history(wf, node, nodes, user) -> list:
    """发起 → 已决的节点(按顺序)→ 当前节点。`mine` = 当前节点轮到我。"""
    from apps.workflow import decision_codes

    steps = [{"kind": "start", "name": "", "actor": _name(wf.create_user), "verdict": "", "comment": "",
              "at": wf.created_at, "mine": False}]
    for n in nodes:
        if n.pk == getattr(node, "pk", None) or n.status not in DECIDED:
            continue
        who = decision_codes.handled_by(n)
        steps.append({"kind": "decided", "name": n.node_name, "actor": who["name"] if who else None,
                      "verdict": n.verdict, "comment": n.notes, "at": n.decided_at, "mine": False})
    if node is not None:
        steps.append({"kind": "current", "name": node.node_name, "actor": None, "verdict": "", "comment": "",
                      "at": node.activated_at, "mine": node.can_approve(user)})
    return steps


def attachments_of(judgment, user, tenant) -> list:
    if judgment is None:
        return []
    rows = case_attachments.live(judgment).order_by("created_at")
    return [{"id": str(r.pk), "name": r.name, "content_type": r.content_type, "byte_size": r.byte_size,
             "url": case_attachments.signed_url(r, user, tenant)}
            for r in rows if case_attachments.may_view(user, r, getattr(tenant, "pk", None))]


def soul_ref(soul) -> dict:
    """事实里的灵魂:名字、编号,加 id —— App 详情里点灵魂名要打开灵魂详情(第三十九批 O-15)。"""
    return {"id": str(soul.pk), "name": soul.name, "soul_code": soul.soul_code}


def workflow_facts(wf, user, tenant, *, reason) -> dict:
    node = wf.current_node
    nodes = _nodes(wf)
    # 位置只数需要人决定的节点,「通知 / 结束」是自动经过的,不算一步。
    steps = [n for n in nodes if n.kind not in AUTOMATIC_KINDS]
    facts = {
        "soul": soul_ref(wf.soul),
        "requester": _name(wf.create_user),
        "requester_hall": hall_ref(wf.tenant),
        "requested_at": wf.created_at,
        "reason": reason,
        "history": _history(wf, node, nodes, user),
        "attachments": attachments_of(wf.judgment, user, tenant),
    }
    if node is not None:
        facts["node"] = {
            "name": node.node_name,
            "index": next((i for i, n in enumerate(steps, 1) if n.pk == node.pk), len(steps)),
            "total": len(steps),
            "is_last": _is_last(node, nodes),
            "next_name": _next_name(node, nodes),
        }
        facts["deadline"] = _deadline(node)
    return facts


def rebirth_facts(app) -> dict:
    soul = app.soul
    return {
        "soul": soul_ref(soul),
        "cycle": app.cycle,
        "desired_form": app.desired_form,
        "merit_balance": (soul.merit_score or 0) - (soul.demerit_score or 0),
    }


def dispatch_facts(row) -> dict:
    souls = [soul_ref(row.soul)] if row.soul_id else []
    return {
        "from_hall": hall_ref(row.source_tenant),
        "to_hall": hall_ref(row.target_tenant),
        "requester": _name(row.dispatched_by),
        "requester_hall": hall_ref(row.source_tenant),
        "requested_at": row.proposed_at,
        "reason": row.reason,
        "souls": souls,
        "soul_count": len(souls),
        # O-f:批准后接收方殿还要在电脑上执行,详情据此写「◐ 等接收方执行」。
        "status": row.status,
    }


def cooldown_facts(row) -> dict:
    from apps.soul_accounts.rebirth import cooldown_until, remaining_cooldown_days

    until = cooldown_until(row.application)
    return {
        "soul": soul_ref(row.soul),
        "requested_at": row.created_at,
        "reason": row.reason,
        "cooldown_now_days": remaining_cooldown_days(until) if until else 0,
        "cooldown_asked_days": row.desired_remaining_days,
    }
