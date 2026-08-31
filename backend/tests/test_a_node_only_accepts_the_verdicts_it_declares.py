"""`required_verdicts` 是一条约束,不是一个装饰品。

`ApprovalNode.required_verdicts` 在建节点时写入(`services.py`)、在序列化器里
暴露、help_text 写着「可接受的裁决列表」—— 而**没有任何东西读它**。裁决的唯一
消费者 `WorkflowNodeActionSerializer.verdict` 是一个**固定的** ChoiceField。
2026-08-29 实跑:`required_verdicts=["CONFIRMED"]` 的节点接受了 `"PASSED"` → 200。

**模板声明的逐节点裁决约束毫无效果。**

空列表仍然表示「不限」—— 那是默认值,绝大多数节点带的就是它。这里只强制
真的有人写过的那份名单。
"""
import pytest
from rest_framework.test import APIClient

from apps.actors.models import Actor, ActorRole
from apps.authentication.models import User, UserRole
from apps.realms.models import Realm
from apps.souls.models import Soul
from apps.tenants.models import Tenant
from apps.workflow.models import ApprovalNode, ApprovalWorkflow, NodeStatus


@pytest.fixture
def node_with_a_constraint(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )
    user = User.objects.create_user(
        username="judge", password="x", role=UserRole.ADMIN, tenant=tenant
    )
    soul = Soul.objects.create(name="被审者", tenant=tenant)
    workflow = ApprovalWorkflow.objects.create(soul=soul, tenant=tenant)
    # `can_approve` is fail-closed on every axis: the node has to designate an
    # actor and the caller has to *be* it. Without this the request is 403 and
    # never reaches the verdict check this file is about.
    realm = Realm.objects.create(
        realm_code="TEST_REALM", name_en="Test", civilization="CHINESE", tenant=tenant
    )
    actor = Actor.objects.create(
        name="判官", role=ActorRole.JUDGE, realm=realm, tenant=tenant
    )
    user.actor = actor
    user.save(update_fields=["actor"])
    node = ApprovalNode.objects.create(
        workflow=workflow,
        node_name="确认庭",
        node_order=1,
        status=NodeStatus.PENDING,
        required_verdicts=["CONFIRMED"],
        approver_type="ACTOR",
        approver_actor=actor,
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client, workflow, node


def _approve(client, workflow, node, verdict):
    return client.post(
        f"/api/v1/workflows/{workflow.id}/approve_node/",
        {"node_id": str(node.id), "verdict": verdict, "notes": ""},
        format="json",
    )


@pytest.mark.django_db
def test_a_verdict_the_node_does_not_declare_is_refused(node_with_a_constraint):
    client, workflow, node = node_with_a_constraint
    response = _approve(client, workflow, node, "PASSED")
    assert response.status_code == 400, (
        f"节点声明只接受 {node.required_verdicts},却接受了 PASSED:"
        f"{response.status_code}"
    )
    node.refresh_from_db()
    assert node.status == NodeStatus.PENDING, "被拒的裁决还是把节点决掉了"
    assert node.verdict in (None, ""), node.verdict


@pytest.mark.django_db
def test_the_declared_verdict_still_works(node_with_a_constraint):
    """**断存在。** 只断「不合规的被拒」的测试,在整条路径 400 时也全绿。"""
    client, workflow, node = node_with_a_constraint
    response = _approve(client, workflow, node, "CONFIRMED")
    assert response.status_code == 200, (response.status_code, response.data)
    node.refresh_from_db()
    assert node.status == NodeStatus.APPROVED
    assert node.verdict == "CONFIRMED"


@pytest.mark.django_db
def test_an_empty_list_means_no_constraint(node_with_a_constraint):
    """默认值是 `[]`,绝大多数节点带的就是它 —— 不能因此把它们全锁死。"""
    client, workflow, node = node_with_a_constraint
    node.required_verdicts = []
    node.save(update_fields=["required_verdicts"])
    response = _approve(client, workflow, node, "PASSED")
    assert response.status_code == 200, (response.status_code, response.data)


@pytest.mark.django_db
def test_the_refusal_says_which_verdicts_are_accepted(node_with_a_constraint):
    """一个不说明白的 400,会让调用方去猜 —— 而它猜的对象正是这个字段。"""
    client, workflow, node = node_with_a_constraint
    response = _approve(client, workflow, node, "PASSED")
    assert response.data.get("required_verdicts") == ["CONFIRMED"], response.data
