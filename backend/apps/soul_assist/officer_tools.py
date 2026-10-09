"""官员端助手的只读工具(docs/ARCHITECTURE-officer-assist.md §2)。

**只给计数。** 官员能看的灵魂数据远多于灵魂自己,而工具结果会发给第三方模型:
不出灵魂姓名、编号、陈述、判词,也不出任何行 id。要看某个案子,回答引导去对应页面。

**范围不在这里重写。** 每个计数都经那个页面自己的视图集 `get_queryset()` 求出
(租户、暂居只读、行级 DataScope 全在里面,`apps/core/tenant.py` 无租户即空集),
与 `apps/judgment/views.py::visible_judgments` 同一个办法。所以 ADMIN 在这里也是全殿数据,
结果里的 `scope` 如实写出。

**两道权限检查**(同一张 `TOOLS` 表):
- `offered(user)`:组请求时只放入用户持有其权限码的工具 —— 模型看不见它不能用的;
- `run(name, request)`:执行时再查一次,不持有就答错误对象。模型编出的名字、或被注入诱导去调
  一个没提供的工具,都走这一道。

每个工具只收 `request`,不收任何 id:模型只能选调哪个,选不了读谁。
"""
import json
from collections import Counter

from apps.core.tenant import is_tenant_exempt
from apps.perm.checker import check_permission
from apps.soul_assist.providers import ToolSpec

#: `my_permissions` 报告的码名:「为什么我点不了批准」由 `check_permission` 回答,不由语料措辞回答。
REPORTED_CODENAMES = ("workflow.approve", "workflow.advance", "workflow.escalate", "user.manage",
                      "dispatch.approve", "dispatch.reject", "dispatch.execute", "dispatch.manage")


def _scope(request):
    return "enabled_halls" if is_tenant_exempt(request.user) else "this_hall"


def enabled_hall_ids():
    """开了助手的殿。ADMIN 跨殿,但**关了助手的殿的数据不发给模型**(用户 2026-09-29 定):
    与灵魂端「X 殿的数据只在 X 殿开着时才出去」同一条。"""
    from apps.tenants.models import Tenant

    return [t.pk for t in Tenant.objects.all() if (t.settings or {}).get("assistant_enabled") is True]


def _list_queryset(viewset_class, request, action="list"):
    """那个页面的列表会给这个调用者看的行 —— 跑视图集自己的 `get_queryset`,不重述它;
    ADMIN 再收窄到开了助手的殿。非 ADMIN 的视图集本来就只给本殿(本殿开着,才问得到这里)。"""
    qs = viewset_class(request=request, action=action, kwargs={}, format_kwarg=None).get_queryset()
    if is_tenant_exempt(request.user):
        qs = qs.filter(tenant_id__in=enabled_hall_ids())
    return qs


def _judgment_queue_counts(request):
    from apps.judgment.views import PENDING, JudgmentViewSet, queue_counts_of

    counts = queue_counts_of(_list_queryset(JudgmentViewSet, request).filter(PENDING), request.user)
    return {"scope": _scope(request), **counts}


def _my_pending_approvals(request):
    """当前节点等着**这个用户**决定的流程数,按案件类型分。判据与 `approve_node` 同一条:
    节点待审批且 `node.can_approve(user)`(ADMIN 不豁免,见那个方法的说明)。

    ponytail: 逐行在 Python 里判 `can_approve`(它含会签槽位,写不成一条 SQL);
    未结流程上万时改成按审批人列预筛。"""
    from apps.workflow.models import TERMINAL_WORKFLOW_STATUSES, NodeStatus
    from apps.workflow.views import ApprovalWorkflowViewSet

    user = request.user
    qs = _list_queryset(ApprovalWorkflowViewSet, request).exclude(status__in=TERMINAL_WORKFLOW_STATUSES)
    by_type = Counter()
    for workflow in qs:
        node = workflow.get_current_node()
        if node is not None and node.status == NodeStatus.PENDING and node.can_approve(user):
            by_type[workflow.case_type] += 1
    # `approve_node` 还要 `workflow.approve`(workflow/views.py 的 approve_node);`can_approve` 只比角色。
    # 没有这个权限时,被点名的步骤一件也办不了 —— 报 0,另给「点了名但无权」的数,不让模型去调和两个矛盾的事实。
    holds = check_permission(user, "workflow.approve")
    designated = sum(by_type.values())
    return {"scope": _scope(request), "total": designated if holds else 0,
            "by_case_type": dict(by_type) if holds else {},
            "designated_but_not_permitted": 0 if holds else designated,
            "holds_workflow_approve": holds}


def _inbox_counts(request):
    from apps.chat import inbox
    from apps.chat.views import OfficerInboxViewSet

    counts = inbox.counts(_list_queryset(OfficerInboxViewSet, request, action="folders"))
    # 殿的 id 不出去;殿名留着(「哪个殿来的信多」)。
    counts["halls"] = [{"hall_names": h["hall_names"], "count": h["count"]} for h in counts["halls"]]
    return {"scope": _scope(request), **counts}


def _my_permissions(request):
    user = request.user
    return {"role": user.role, "extra_roles": list(user.extra_roles or []), "scope": _scope(request),
            "permissions": {c: check_permission(user, c) for c in REPORTED_CODENAMES}}


#: 名字 → (所需权限码或 None, 实现, 说明)。
TOOLS = {
    "judgment_queue_counts": ("judgment.read", _judgment_queue_counts,
                              "How many open judgment cases are in the asking officer's queue: total, and per "
                              "group (mine = claimed by me, unclaimed, others = claimed by someone else, "
                              "deferred). Counts only."),
    "my_pending_approvals": ("workflow.read", _my_pending_approvals,
                             "How many workflows have a current step waiting for the asking officer's own "
                             "decision, grouped by case type, and whether the officer holds workflow.approve. If it "
                             "does not, total is 0 and designated_but_not_permitted counts the steps naming its "
                             "role that it still cannot decide. Counts only."),
    "inbox_counts": ("soul_inbox.read", _inbox_counts,
                     "Counts of letters in the hall-office inbox per folder (all, awaiting_reply, replied, "
                     "drafts, assigned_to_me, archived), unread, open / closed, and per hall. Counts only."),
    "my_permissions": (None, _my_permissions,
                       "The asking officer's role, whether the data it sees covers all halls or only its "
                       "own, and whether it holds workflow.approve / advance / escalate, user.manage and "
                       "dispatch.approve / reject / execute / manage. Use it for any 'why can't I click ...' question."),
}


def _permitted(user, name):
    codename = TOOLS[name][0]
    return codename is None or check_permission(user, codename)


def offered(user) -> list:
    """第一道:只把用户有权的工具交给模型。"""
    return [ToolSpec(name, TOOLS[name][2]) for name in TOOLS if _permitted(user, name)]


def run(name, request) -> str:
    """第二道:执行时再查。未知工具、无权的工具都答错误对象,不抛异常。"""
    if name not in TOOLS:
        return json.dumps({"error": "unknown_tool"})
    if not _permitted(request.user, name):
        return json.dumps({"error": "permission_denied", "codename": TOOLS[name][0]})
    return json.dumps(TOOLS[name][1](request), default=str, ensure_ascii=False)
