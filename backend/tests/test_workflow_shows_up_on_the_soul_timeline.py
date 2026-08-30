"""审批流在灵魂的时间线上留下痕迹。

`apps/events/services.py` 从 M12 Phase 2 起就有 `log_workflow_created` /
`_approved` / `_rejected` / `notify_workflow_assigned`,而 **`apps/workflow/`
从头到尾没有从 `apps/events/` import 过任何东西**。排除测试后,四个方法只剩四个定义。
`RealtimeEventPublisher.publish_workflow` 与 `event_bus.publish_workflow` 同样零
非测试调用者。

后果:`EventType.WORKFLOW_*` 从不出现在 `SoulEvent` 里。**一个灵魂的时间线从
JUDGMENT_CONCLUDED 直接跳到 DISPOSITION_CREATED,中间那条十殿审批链 —— 带着名字和
裁决的那一段 —— 整个不存在。** 也没有任何审批人被通知有任务指派给他。

`tests/test_workflow_events.py` 与 `test_event_bus_integration.py` 里有 6 条测试
**直接调这些方法并通过** —— 正是「测试执行了一个没人调用的函数」那个形状。那些测试
对函数本身是诚实的;**没有任何东西在检查有没有人调它**。

所以这个文件一次都不调那四个方法。它走接口、走服务层,然后去数据库里查
`SoulEvent` 行 —— 断言的是**痕迹**,不是调用。
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.events.models import SoulEvent
from apps.judgment.models import Judgment
from apps.souls.models import Soul
from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    NodeStatus,
)


def events_for(soul, event_type=None):
    qs = SoulEvent.objects.filter(soul=soul)
    if event_type:
        qs = qs.filter(event_type=event_type)
    return list(qs)


@pytest.fixture
def judge_client(api_client, admin_user, cn_tenant):
    """调用者被指定为第一个节点的审批人。

    `approve_node` 现在只接受该节点指定的审批人(未指定审批人的节点一律 403,
    见 views.py 的说明)。不做这一步的话,这个文件里每一条都会因为一个与它无关的
    理由变红,而那不是它们要测的东西。"""
    from apps.actors.models import Actor

    actor = Actor.objects.create(
        name="第一殿主", civilization="CHINESE", role="JUDGE",
        tenant=cn_tenant, is_active=True,
    )
    admin_user.actor = actor
    admin_user.save(update_fields=["actor"])

    token = RefreshToken.for_user(admin_user)
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    api_client.first_node_actor = actor
    return api_client


@pytest.fixture
def soul(db, cn_tenant):
    return Soul.objects.create(name="有时间线的", tenant=cn_tenant, current_state="JUDGING")


def make_flow(soul, tenant, node_count=2, first_actor=None):
    judgment = Judgment.objects.create(soul=soul, tenant=tenant)
    workflow = ApprovalWorkflow.objects.create(
        workflow_name="两殿", soul=soul, judgment=judgment, tenant=tenant
    )
    nodes = [
        ApprovalNode.objects.create(
            workflow=workflow, node_name=f"第{i}殿", node_order=i,
            approver_type="ACTOR" if i == 1 and first_actor else "SYSTEM",
            approver_actor=first_actor if i == 1 else None,
            status=NodeStatus.PENDING,
        )
        for i in range(1, node_count + 1)
    ]
    workflow.current_node = nodes[0]
    workflow.save()
    return workflow, nodes


@pytest.mark.django_db
def test_creating_a_workflow_lands_on_the_timeline(soul, cn_tenant):
    from apps.workflow.services import WorkflowService

    judgment = Judgment.objects.create(soul=soul, tenant=cn_tenant)
    before = len(events_for(soul))

    WorkflowService.create_from_judgment(judgment)

    created = events_for(soul, "WORKFLOW_CREATED")
    assert len(created) == 1, (
        f"创建审批流后 SoulEvent 里没有 WORKFLOW_CREATED(总事件 "
        f"{before} → {len(events_for(soul))})"
    )
    assert created[0].payload.get("workflow_name")


@pytest.mark.django_db
def test_an_approval_lands_on_the_timeline(judge_client, soul, cn_tenant):
    workflow, nodes = make_flow(soul, cn_tenant, first_actor=judge_client.first_node_actor)

    response = judge_client.post(
        f"/api/v1/workflows/{workflow.id}/approve_node/",
        {"verdict": "PASSED", "notes": "过"},
        format="json",
    )
    assert response.status_code == 200, response.data

    approved = events_for(soul, "WORKFLOW_APPROVED")
    assert len(approved) == 1, "通过一个节点之后时间线上没有 WORKFLOW_APPROVED"
    # 载荷里要有**是哪一殿、判了什么** —— 一条只说「有事发生」的时间线条目,
    # 和没有这条条目相比,只多占一行。
    assert approved[0].payload["node_name"] == "第1殿"
    assert approved[0].payload["verdict"] == "PASSED"


@pytest.mark.django_db
def test_a_refusal_lands_on_the_timeline_and_is_not_filed_as_an_approval(
    judge_client, soul, cn_tenant
):
    """两个事件类型要真的分开。

    只断言「有 WORKFLOW_REJECTED」的话,一个两种情况都发两条的实现也能过。
    """
    workflow, nodes = make_flow(soul, cn_tenant, first_actor=judge_client.first_node_actor)

    response = judge_client.post(
        f"/api/v1/workflows/{workflow.id}/approve_node/",
        {"verdict": "FAILED", "notes": "不合格"},
        format="json",
    )
    assert response.status_code == 200, response.data

    assert len(events_for(soul, "WORKFLOW_REJECTED")) == 1
    assert events_for(soul, "WORKFLOW_APPROVED") == []
    assert events_for(soul, "WORKFLOW_REJECTED")[0].payload["reason"] == "不合格"


@pytest.mark.django_db
def test_the_timeline_has_no_workflow_events_before_anything_happens(soul, cn_tenant):
    """反对照。

    没有它,一个「对每个灵魂都写三条 WORKFLOW_* 」的实现同样满足上面三条,
    而那样的时间线不携带任何信息。
    """
    make_flow(soul, cn_tenant)
    assert events_for(soul, "WORKFLOW_APPROVED") == []
    assert events_for(soul, "WORKFLOW_REJECTED") == []


@pytest.mark.django_db
def test_the_approver_of_the_next_node_is_notified(judge_client, soul, cn_tenant):
    """指派通知。`notify_workflow_assigned` 此前同样零调用者 ——
    **没有任何审批人被告知有任务等着他**。"""
    from apps.actors.models import Actor
    from apps.authentication.models import User
    from apps.notifications.models import UserNotification

    actor = Actor.objects.create(
        name="第二殿主", civilization="CHINESE", role="JUDGE", tenant=cn_tenant, is_active=True
    )
    approver = User.objects.create_user(
        username="second_court", password="x", role="JUDGE", tenant=cn_tenant, actor=actor
    )

    workflow, nodes = make_flow(soul, cn_tenant, first_actor=judge_client.first_node_actor)
    nodes[1].approver_type = "ACTOR"
    nodes[1].approver_actor = actor
    nodes[1].save()

    before = UserNotification.objects.filter(user=approver).count()
    judge_client.post(
        f"/api/v1/workflows/{workflow.id}/approve_node/",
        {"verdict": "PASSED"},
        format="json",
    )

    after = UserNotification.objects.filter(user=approver).count()
    assert after == before + 1, (
        f"流程推进到第二殿之后,那位审批人的通知数 {before} → {after}"
    )


@pytest.mark.django_db
def test_nobody_is_notified_when_the_flow_ends(judge_client, soul, cn_tenant):
    """反对照:终止之后 `current_node` 是 None,那正是该通知谁都不通知的时候。"""
    from apps.notifications.models import UserNotification

    workflow, nodes = make_flow(
        soul, cn_tenant, node_count=1, first_actor=judge_client.first_node_actor
    )
    before = UserNotification.objects.count()

    judge_client.post(
        f"/api/v1/workflows/{workflow.id}/approve_node/",
        {"verdict": "PASSED"},
        format="json",
    )

    assert UserNotification.objects.count() == before
