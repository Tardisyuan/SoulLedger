"""被拒的审批流终止在 REJECTED,而不是一路走到 COMPLETED。

`complete_node` 把非 PASSED/CONFIRMED 的裁决记为节点 REJECTED,然后**无条件推进**。
实测(改之前):

    complete_node(FAILED) -> True
    n1.status = REJECTED
    workflow.status = IN_PROGRESS, current_node = N2
    ...把三个节点全部拒绝之后:
    workflow.status = COMPLETED, completed_at 已设

**一个在十殿每一殿都被判有罪的灵魂,最终状态与每一殿都通过的灵魂完全一样。**
而 `ApprovalWorkflowStatus.REJECTED` —— 那个专门用来区分这两件事的状态 ——
在整个代码库里从未被赋值过。

这个文件同时钉住「哪些状态可达」这件事本身。七个声明成员里
`APPROVED` / `APPEAL` / `EXCEPTION` 至今无处赋值,而 `WorkflowFilter.status` 把它们
当筛选值提供 —— **那三个选项永远匹配不到任何行**。不在这里替它们发明语义:
把可达集合写成一条断言,增删任何一个都得有人明确决定,而不是无声地漂移。
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
    soul = Soul.objects.create(
        name="被拒者", tenant=cn_tenant, current_state="JUDGING"
    )
    judgment = Judgment.objects.create(soul=soul, tenant=cn_tenant)
    workflow = ApprovalWorkflow.objects.create(
        workflow_name="三殿", soul=soul, judgment=judgment, tenant=cn_tenant
    )
    nodes = [
        ApprovalNode.objects.create(
            workflow=workflow,
            node_name=f"第{i}殿",
            node_order=i,
            approver_type="SYSTEM",
            status=NodeStatus.PENDING,
        )
        for i in (1, 2, 3)
    ]
    workflow.current_node = nodes[0]
    workflow.save()
    return workflow, nodes


@pytest.mark.django_db
def test_a_refusal_ends_the_flow_and_says_so(flow):
    workflow, nodes = flow

    assert workflow.complete_node(nodes[0].id, "FAILED", notes="不合格") is True

    workflow.refresh_from_db()
    nodes[0].refresh_from_db()
    assert nodes[0].status == NodeStatus.REJECTED
    assert workflow.status == ApprovalWorkflowStatus.REJECTED, (
        f"被拒之后流程状态是 {workflow.status} —— 它此前是 IN_PROGRESS,"
        f"并会一路走到 COMPLETED"
    )
    assert workflow.current_node is None
    assert workflow.completed_at is not None


@pytest.mark.django_db
def test_the_nodes_after_a_refusal_are_left_alone(flow):
    """它们没有被走到,所以不该被改写成任何「已决」的值。

    断言仍是 PENDING,而不是断言「不是 APPROVED」——后者在一个把它们写成
    REJECTED 的实现下也成立,而那会声称三个人做了他们没做的决定。
    """
    workflow, nodes = flow
    workflow.complete_node(nodes[0].id, "FAILED")

    for node in nodes[1:]:
        node.refresh_from_db()
        assert node.status == NodeStatus.PENDING


@pytest.mark.django_db
def test_a_refused_flow_cannot_be_walked_past(flow):
    """核心的那一条。

    被拒之后余下的节点仍是 PENDING。没有终态守卫的话,决定其中最后一个会把
    `get_next_node()` 变成 None,于是流程被翻成 **COMPLETED** —— 拒绝就这样被
    走过去抹掉了。
    """
    workflow, nodes = flow
    workflow.complete_node(nodes[0].id, "FAILED")

    assert workflow.complete_node(nodes[1].id, "PASSED") is False
    assert workflow.complete_node(nodes[2].id, "PASSED") is False

    workflow.refresh_from_db()
    assert workflow.status == ApprovalWorkflowStatus.REJECTED
    assert workflow.completed_at is not None


@pytest.mark.django_db
def test_an_all_passed_flow_still_completes(flow):
    """正对照。没有它,一个「任何裁决都终止流程」的实现同样满足上面三条,
    而那会让审批流一个节点都走不过。"""
    workflow, nodes = flow
    for node in nodes:
        assert workflow.complete_node(node.id, "PASSED") is True

    workflow.refresh_from_db()
    assert workflow.status == ApprovalWorkflowStatus.COMPLETED
    assert workflow.current_node is None
    assert all(
        ApprovalNode.objects.get(pk=n.pk).status == NodeStatus.APPROVED for n in nodes
    )


@pytest.mark.django_db
def test_a_refused_flow_and_a_completed_flow_are_distinguishable(flow, cn_tenant):
    """把这件事直接说出来,因为它才是这条缺陷的后果。

    上面几条各自成立时,「两者可区分」仍然可能不成立 —— 比如两条路径都写
    COMPLETED 而只有节点状态不同。这一条比较的是两条流程的**行**。
    """
    refused, nodes = flow
    refused.complete_node(nodes[0].id, "FAILED")

    soul = Soul.objects.create(
        name="通过者", tenant=cn_tenant, current_state="JUDGING"
    )
    judgment = Judgment.objects.create(soul=soul, tenant=cn_tenant)
    passed = ApprovalWorkflow.objects.create(
        workflow_name="三殿", soul=soul, judgment=judgment, tenant=cn_tenant
    )
    node = ApprovalNode.objects.create(
        workflow=passed, node_name="唯一", node_order=1,
        approver_type="SYSTEM", status=NodeStatus.PENDING,
    )
    passed.current_node = node
    passed.save()
    passed.complete_node(node.id, "PASSED")

    refused.refresh_from_db()
    passed.refresh_from_db()
    assert refused.status != passed.status, (
        f"两条流程的状态都是 {refused.status} —— 一个被拒的灵魂和一个通过的灵魂"
        f"从流程行上看不出区别"
    )


@pytest.mark.django_db
def test_which_workflow_statuses_are_reachable_is_stated(flow):
    """七个声明成员里,只有四个走得到。

    `APPROVED` / `APPEAL` / `EXCEPTION` 无处赋值,而 `WorkflowFilter.status` 用
    `ApprovalWorkflowStatus.choices` 把它们当筛选值提供 —— 三个永远匹配不到任何行
    的选项。这条不替它们发明语义,只把现状写成一句会红的话:哪天有人让其中一个
    可达、或者把它删掉,这里就得跟着改,而那是一次明确的决定。
    """
    declared = set(ApprovalWorkflowStatus.values)
    reachable = {"PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED"}
    unreachable = declared - reachable

    assert unreachable == {"APPROVED", "APPEAL", "EXCEPTION"}, (
        f"可达/不可达的划分变了:现在不可达的是 {sorted(unreachable)}。"
        f"要么让它们可达,要么删掉 —— 别让筛选器继续提供匹配不到任何行的选项。"
    )
