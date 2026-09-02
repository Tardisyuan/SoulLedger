"""节点可以声明「通过走哪条、否决走哪条」,而不声明时行为与从前逐字相同。

## 这个特性要修的是什么

审批流在模型里是一条**线性序列**:`nodes_json` 只存
`{id, node_name, node_type, court_code, approver_role, approver_type, node_order}`,
引擎靠 `.order_by("node_order").first()` 推进。而前端画布的 `onConnect`
允许把任意两个节点连起来 —— **画出来的分支在保存时被静默丢弃**,重载后塌回直链。
提供了一个领域里不存在的能力,是这个特性的起因。

## 向后兼容是这里最要紧的一条

`on_pass`/`on_fail` 都为空 —— 那是默认值,也是这两个字段存在之前写下的每一行
所携带的值 —— 意味着改动前的行为:

    通过 -> 按 node_order 取下一个 PENDING
    否决 -> 整个流程判为 REJECTED 并结束

所以「什么都不声明的模板,跑起来和从前一模一样」不是一句宽慰,是这个文件第一条
断言。存量 `nodes_json` 全部早于这次改动,一个会改变既有流程走法的迁移,
是穿着 schema 外衣的数据变更。

## 为什么没有环检测

`complete_node` 只跟随指向**仍是 PENDING** 的节点的边,而已决节点不会回到
PENDING。所以一条指回去的边最多被走一次,之后落回按序推进 —— 不变式做了校验器
要做的事,而且对没人故意画出来的环同样成立。下面第 5 条钉住它。
"""
import pytest

from apps.judgment.models import Judgment
from apps.souls.models import Soul
from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    NodeStatus,
)


@pytest.fixture
def flow(db, cn_tenant):
    """四个节点的直链,没有任何路由边 —— 也就是今天每一份模板的形状。"""
    soul = Soul.objects.create(name="待判者", tenant=cn_tenant, current_state="JUDGING")
    judgment = Judgment.objects.create(soul=soul, tenant=cn_tenant)
    workflow = ApprovalWorkflow.objects.create(
        workflow_name="四殿", soul=soul, judgment=judgment, tenant=cn_tenant
    )
    nodes = [
        ApprovalNode.objects.create(
            workflow=workflow,
            node_name=f"第{i}殿",
            node_order=i,
            approver_type="SYSTEM",
            status=NodeStatus.PENDING,
        )
        for i in (1, 2, 3, 4)
    ]
    workflow.current_node = nodes[0]
    workflow.save()
    return workflow, nodes


# ── 1. 不声明 = 和从前一样 ────────────────────────────────────────────

@pytest.mark.django_db
def test_no_edges_still_advances_by_order(flow):
    workflow, nodes = flow

    assert workflow.complete_node(nodes[0].id, "PASSED") is True

    workflow.refresh_from_db()
    assert workflow.current_node_id == nodes[1].id
    assert workflow.status == ApprovalWorkflowStatus.IN_PROGRESS


@pytest.mark.django_db
def test_no_edges_still_ends_a_refusal(flow):
    workflow, nodes = flow

    assert workflow.complete_node(nodes[0].id, "FAILED") is True

    workflow.refresh_from_db()
    # 与 test_a_refused_workflow_stays_refused 钉的是同一件事,在这里重述,
    # 因为这次改动动的正是那一段分支。
    assert workflow.status == ApprovalWorkflowStatus.REJECTED
    assert workflow.current_node_id is None


# ── 2. on_pass 跳到非相邻节点 ─────────────────────────────────────────

@pytest.mark.django_db
def test_on_pass_skips_ahead(flow):
    workflow, nodes = flow
    nodes[0].on_pass = nodes[2]
    nodes[0].save(update_fields=["on_pass"])

    workflow.complete_node(nodes[0].id, "PASSED")

    workflow.refresh_from_db()
    # 第 2 殿按 node_order 本该是下一个,边把它跳过了。
    assert workflow.current_node_id == nodes[2].id
    # 被跳过的节点**不改状态**:没有人对它做过决定,写成任何「已跳过」的值
    # 都是替不存在的决定记账。
    nodes[1].refresh_from_db()
    assert nodes[1].status == NodeStatus.PENDING


# ── 3. on_fail 转向而不是终止 ─────────────────────────────────────────

@pytest.mark.django_db
def test_on_fail_routes_instead_of_ending_the_flow(flow):
    workflow, nodes = flow
    nodes[0].on_fail = nodes[3]
    nodes[0].save(update_fields=["on_fail"])

    workflow.complete_node(nodes[0].id, "FAILED")

    workflow.refresh_from_db()
    assert workflow.current_node_id == nodes[3].id
    assert workflow.status == ApprovalWorkflowStatus.IN_PROGRESS
    assert workflow.completed_at is None
    # 节点自己仍然记为被否决 —— 转向的是流程,不是这一次裁决的结果。
    nodes[0].refresh_from_db()
    assert nodes[0].status == NodeStatus.REJECTED


# ── 4. 指向已决节点时回退到默认 ───────────────────────────────────────

@pytest.mark.django_db
def test_an_edge_into_a_decided_node_falls_back(flow):
    workflow, nodes = flow
    # 对照:先让第 1 殿指向第 4 殿,证明路由在工作。少了这一步,下面那条断言
    # 在「功能根本不存在」时同样成立。
    nodes[0].on_pass = nodes[3]
    nodes[0].save(update_fields=["on_pass"])
    workflow.complete_node(nodes[0].id, "PASSED")
    workflow.refresh_from_db()
    assert workflow.current_node_id == nodes[3].id, "路由未生效,下面的断言无意义"

    # 现在让第 4 殿指回已经判掉的第 1 殿。
    nodes[3].refresh_from_db()
    nodes[3].on_pass = nodes[0]
    nodes[3].save(update_fields=["on_pass"])

    workflow.complete_node(nodes[3].id, "PASSED")

    workflow.refresh_from_db()
    # 回到已决节点是无意义的,所以走默认:按序的下一个 PENDING。
    assert workflow.current_node_id == nodes[1].id


# ── 5. 环不挂死 ───────────────────────────────────────────────────────

@pytest.mark.django_db
def test_a_cycle_terminates(flow):
    """两个节点互指,流程仍然在有限步内结束。

    这是「不需要环检测」那句话的证据。没有它,那句话只是一个说法。
    """
    workflow, nodes = flow
    nodes[0].on_pass = nodes[1]
    nodes[0].save(update_fields=["on_pass"])
    nodes[1].on_pass = nodes[0]
    nodes[1].save(update_fields=["on_pass"])

    # 对照:先证明路由**确实在工作**。没有这一步,下面那条断言在「功能根本
    # 不存在」时同样成立 —— 它就分不出「守卫拒了这条边」和「压根没有边」。
    nodes[0].on_pass = nodes[3]
    nodes[0].save(update_fields=["on_pass"])
    workflow.complete_node(nodes[0].id, "PASSED")
    workflow.refresh_from_db()
    assert workflow.current_node_id == nodes[3].id, "路由未生效,下面的断言无意义"

    # 现在造环:第 4 殿指回第 1 殿,而第 1 殿已不是 PENDING。
    nodes[3].refresh_from_db()
    nodes[3].on_pass = nodes[0]
    nodes[3].save(update_fields=["on_pass"])

    workflow.complete_node(nodes[3].id, "PASSED")
    workflow.refresh_from_db()
    # 边被拒,落回按序推进的下一个 PENDING —— 第 2 殿。
    assert workflow.current_node_id == nodes[1].id


# ── 6. 跨流程的边被拒 ─────────────────────────────────────────────────

@pytest.mark.django_db
def test_an_edge_into_another_workflow_is_refused(db, cn_tenant, flow):
    """FK 是 `"self"`,schema 拦不住指向别的流程的节点。

    跟随这种边会把 `current_node` 设成本流程并不拥有的行,而 `complete_node`
    自己的 `filter(workflow=self)` 随后会拒绝对它的每一次裁决 —— 一个卡在
    自己动不了的节点上的流程。拒绝这条边,留在默认路径上,是可恢复的那一边。
    """
    workflow, nodes = flow
    other_soul = Soul.objects.create(name="另一位", tenant=cn_tenant, current_state="JUDGING")
    other_judgment = Judgment.objects.create(soul=other_soul, tenant=cn_tenant)
    other_flow = ApprovalWorkflow.objects.create(
        workflow_name="别的流程", soul=other_soul, judgment=other_judgment, tenant=cn_tenant
    )
    foreign = ApprovalNode.objects.create(
        workflow=other_flow,
        node_name="别处的节点",
        node_order=1,
        approver_type="SYSTEM",
        status=NodeStatus.PENDING,
    )
    # 对照:同一个节点先指向本流程内一个合法目标,证明路由在工作。
    nodes[0].on_pass = nodes[2]
    nodes[0].save(update_fields=["on_pass"])
    workflow.complete_node(nodes[0].id, "PASSED")
    workflow.refresh_from_db()
    assert workflow.current_node_id == nodes[2].id, "路由未生效,下面的断言无意义"

    # 换成指向别的流程的节点。
    nodes[2].refresh_from_db()
    nodes[2].on_pass = foreign
    nodes[2].save(update_fields=["on_pass"])

    workflow.complete_node(nodes[2].id, "PASSED")

    workflow.refresh_from_db()
    # 边被拒,落回按序:第 2 殿仍然 PENDING 且 node_order 最小。
    assert workflow.current_node_id == nodes[1].id
    # 而且没有碰到别人的流程。
    other_flow.refresh_from_db()
    assert other_flow.current_node_id is None
    foreign.refresh_from_db()
    assert foreign.status == NodeStatus.PENDING
