"""
Tests for ApprovalWorkflow instance management.
Tests workflow creation from judgments, node approval, and workflow advancement.
"""
import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.judgment.models import Judgment
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    CaseType,
    NodeStatus,
)
from apps.workflow.services import WorkflowService


@pytest.mark.django_db
class TestWorkflowService:
    """Test WorkflowService.create_from_judgment."""

    @pytest.fixture
    def soul(self, cn_tenant):
        # civilization is derived from tenant, not directly settable
        return Soul.objects.create(
            name="测试灵魂",
            birth_date="1990-01-01",
            origin_location="北京",
            current_state=SoulState.ALIVE,
            tenant=cn_tenant,
        )

    @pytest.fixture
    def judgment(self, soul, cn_tenant):
        # Create a concluded judgment
        j = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,  # Use the derived property
            court="第一殿",
            verdict="PASSED",
            notes="Test judgment",
            is_final=True,
            concluded_at=timezone.now(),
            tenant=cn_tenant,
        )
        return j

    def test_create_workflow_from_judgment(self, judgment, soul):
        """create_from_judgment creates workflow with correct nodes."""
        workflow = WorkflowService.create_from_judgment(judgment)

        assert workflow is not None
        assert workflow.soul == soul
        assert workflow.judgment == judgment
        assert workflow.workflow_name == "十殿审判流程"
        assert workflow.status == ApprovalWorkflowStatus.IN_PROGRESS
        assert workflow.nodes.count() == 10  # Ten courts

        # First node should be current
        first_node = workflow.nodes.order_by("node_order").first()
        assert workflow.current_node == first_node
        assert first_node.status == NodeStatus.PENDING

    def test_create_workflow_auto_detects_chinese_appeal(self, judgment, soul):
        """create_from_judgment with is_appeal=True creates appeal workflow."""
        workflow = WorkflowService.create_from_judgment(judgment, is_appeal=True)

        assert workflow is not None
        assert workflow.is_appeal is True
        assert "申诉" in workflow.workflow_name
        assert workflow.nodes.count() == 4  # Appeal flow nodes

    def test_create_workflow_creates_egyptian_heart_weighing(self, db):
        """create_from_judgment uses correct template for Egyptian souls."""
        # Create Egyptian tenant
        eg_tenant, _ = Tenant.objects.get_or_create(
            code="EG_DUAT",
            defaults={"display_name": "Egyptian Duat"}
        )
        soul = Soul.objects.create(
            name="Egyptian Soul",
            birth_date="1990-01-01",
            origin_location="Cairo",
            current_state=SoulState.ALIVE,
            tenant=eg_tenant,
        )
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="Hall of Two Truths",
            verdict="PASSED",
            is_final=True,
            concluded_at=timezone.now(),
            tenant=eg_tenant,
        )

        workflow = WorkflowService.create_from_judgment(judgment)

        assert workflow is not None
        assert workflow.workflow_name == "欧西里斯称重流程"
        assert workflow.nodes.count() == 3  # Heart weighing nodes

    def test_workflow_stats(self, judgment):
        """get_workflow_stats returns correct progress."""
        workflow = WorkflowService.create_from_judgment(judgment)

        stats = WorkflowService.get_workflow_stats(workflow)

        assert stats["total_nodes"] == 10
        assert stats["completed_nodes"] == 0
        assert stats["pending_nodes"] == 10
        assert stats["progress_percent"] == 0.0

        # Complete first node
        first_node = workflow.nodes.order_by("node_order").first()
        workflow.complete_node(first_node.id, "PASSED", "Approved")

        stats = WorkflowService.get_workflow_stats(workflow)

        assert stats["completed_nodes"] == 1
        assert stats["pending_nodes"] == 9
        assert stats["progress_percent"] == 10.0


@pytest.mark.django_db
class TestApprovalWorkflowModel:
    """Test ApprovalWorkflow model methods."""

    @pytest.fixture
    def soul(self, cn_tenant):
        # civilization is derived from tenant
        return Soul.objects.create(
            name="测试灵魂",
            birth_date="1990-01-01",
            origin_location="北京",
            current_state=SoulState.ALIVE,
            tenant=cn_tenant,
        )

    @pytest.fixture
    def workflow(self, soul, cn_tenant):
        wf = ApprovalWorkflow.objects.create(
            soul=soul,
            workflow_name="测试流程",
            case_type=CaseType.ROUTINE,
            status=ApprovalWorkflowStatus.PENDING,
            tenant=cn_tenant,
        )
        # Create 3 nodes
        for i in range(1, 4):
            ApprovalNode.objects.create(
                workflow=wf,
                node_name=f"节点{i}",
                node_order=i,
                node_type="TRIAL",
                status=NodeStatus.PENDING,
            )
        wf.current_node = wf.nodes.first()
        wf.status = ApprovalWorkflowStatus.IN_PROGRESS
        wf.save()
        return wf

    def test_get_current_node(self, workflow):
        """get_current_node returns the current pending node."""
        current = workflow.get_current_node()
        assert current is not None
        assert current.node_order == 1

    def test_get_next_node(self, workflow):
        """get_next_node returns the next pending node."""
        next_node = workflow.get_next_node()
        assert next_node is not None
        assert next_node.node_order == 1  # First node is still pending

        # Complete first node
        first_node = workflow.nodes.order_by("node_order").first()
        workflow.complete_node(first_node.id, "PASSED", "")

        next_node = workflow.get_next_node()
        assert next_node is not None
        assert next_node.node_order == 2

    def test_complete_node_advances_workflow(self, workflow):
        """complete_node marks node done and advances to next."""
        first_node = workflow.nodes.order_by("node_order").first()

        result = workflow.complete_node(first_node.id, "PASSED", "Test notes")

        assert result is True
        first_node.refresh_from_db()
        assert first_node.status == NodeStatus.APPROVED
        assert first_node.verdict == "PASSED"
        assert first_node.notes == "Test notes"
        assert first_node.decided_at is not None

        workflow.refresh_from_db()
        assert workflow.current_node.node_order == 2
        assert workflow.status == ApprovalWorkflowStatus.IN_PROGRESS

    def test_complete_node_with_failed_verdict(self, workflow):
        """complete_node correctly handles FAILED verdict."""
        first_node = workflow.nodes.order_by("node_order").first()

        result = workflow.complete_node(first_node.id, "FAILED", "Rejected")

        assert result is True
        first_node.refresh_from_db()
        assert first_node.status == NodeStatus.REJECTED
        assert first_node.verdict == "FAILED"

    def test_complete_node_with_confirmed_verdict(self, workflow):
        """complete_node correctly handles CONFIRMED verdict."""
        first_node = workflow.nodes.order_by("node_order").first()

        result = workflow.complete_node(first_node.id, "CONFIRMED", "Confirmed")

        assert result is True
        first_node.refresh_from_db()
        assert first_node.status == NodeStatus.APPROVED  # CONFIRMED maps to APPROVED

    def test_complete_node_final_node_completes_workflow(self, workflow):
        """Completing the last node marks workflow as COMPLETED."""
        # Complete all but last node
        nodes = list(workflow.nodes.order_by("node_order"))
        for node in nodes[:-1]:
            workflow.complete_node(node.id, "PASSED", "")

        # Complete final node
        last_node = nodes[-1]
        result = workflow.complete_node(last_node.id, "PASSED", "Final approval")

        assert result is True
        workflow.refresh_from_db()
        assert workflow.status == ApprovalWorkflowStatus.COMPLETED
        assert workflow.current_node is None
        assert workflow.completed_at is not None

    def test_advance_to_next(self, workflow):
        """advance_to_next moves off the node it is on.

        This assertion used to read `in [2, 3]`, with a comment above it that
        argued both ways and then accepted both. **2 is the answer when
        advance does nothing** (complete_node has already left current_node on
        node 2) and **3 is the answer when it works**. The correct answer is 3
        and the actual answer was 2, so the test passed while the method it
        was named for was a no-op that reported success.

        A check that admits the broken answer is not a check.
        """
        first_node = workflow.nodes.order_by("node_order").first()
        workflow.complete_node(first_node.id, "PASSED", "")
        workflow.refresh_from_db()
        assert workflow.current_node.node_order == 2, (
            "premise: complete_node leaves the flow on node 2"
        )

        assert workflow.advance_to_next() is True
        workflow.refresh_from_db()
        assert workflow.current_node.node_order == 3, (
            f"advance_to_next left the flow on node "
            f"{workflow.current_node.node_order}. Advancing to the node we "
            f"are already standing on is what this method used to do."
        )

    def test_advance_to_next_when_no_more_nodes(self, workflow):
        """advance_to_next returns False when no more nodes."""
        # Complete all nodes
        for node in workflow.nodes.all():
            workflow.complete_node(node.id, "PASSED", "")

        result = workflow.advance_to_next()

        assert result is False


@pytest.mark.django_db
class TestApprovalWorkflowAPI:
    """Test workflow API endpoints."""

    @pytest.fixture
    def soul(self, cn_tenant):
        # civilization is derived from tenant
        return Soul.objects.create(
            name="测试灵魂",
            birth_date="1990-01-01",
            origin_location="北京",
            current_state=SoulState.ALIVE,
            tenant=cn_tenant,
        )

    @pytest.fixture
    def workflow(self, soul, cn_tenant, admin_user):
        # The node designates `admin_user`'s own actor. It used to designate
        # nobody (approver_type defaults to ACTOR with approver_actor NULL),
        # which `approve_node` waved through on the `workflow.approve` codename
        # alone — the hole `workflow/0011_backfill_ten_court_approvers` and the
        # gate in `views.approve_node` close. With `can_approve` as the only
        # gate an undesignated node is refused, so leaving this blank would make
        # test_approve_node assert 403 for a reason it is not about.
        from apps.actors.models import Actor

        approver = Actor.objects.create(
            name="测试审批人", civilization="CHINESE", role="JUDGE", tenant=cn_tenant
        )
        admin_user.actor = approver
        admin_user.save(update_fields=["actor"])

        wf = ApprovalWorkflow.objects.create(
            soul=soul,
            workflow_name="测试流程",
            case_type=CaseType.ROUTINE,
            status=ApprovalWorkflowStatus.PENDING,
            tenant=cn_tenant,
        )
        ApprovalNode.objects.create(
            workflow=wf,
            node_name="节点1",
            node_order=1,
            node_type="TRIAL",
            status=NodeStatus.PENDING,
            approver_type="ACTOR",
            approver_actor=approver,
        )
        wf.current_node = wf.nodes.first()
        wf.status = ApprovalWorkflowStatus.IN_PROGRESS
        wf.save()
        return wf

    @pytest.fixture
    def authenticated_client(self, api_client, admin_user):
        api_client.force_authenticate(user=admin_user)
        return api_client

    def test_list_workflows(self, authenticated_client, workflow):
        """GET /api/v1/workflows/ returns workflow list."""
        response = authenticated_client.get("/api/v1/workflows/")

        assert response.status_code == 200
        assert len(response.data["results"] if "results" in response.data else response.data) >= 1

    def test_get_workflow_detail(self, authenticated_client, workflow):
        """GET /api/v1/workflows/{id}/ returns workflow with nodes."""
        response = authenticated_client.get(f"/api/v1/workflows/{workflow.id}/")

        assert response.status_code == 200
        assert response.data["workflow_name"] == "测试流程"
        assert "nodes" in response.data
        assert len(response.data["nodes"]) == 1

    def test_approve_node(self, authenticated_client, workflow):
        """POST /api/v1/workflows/{id}/approve_node/ approves current node."""
        node = workflow.nodes.first()
        response = authenticated_client.post(
            f"/api/v1/workflows/{workflow.id}/approve_node/",
            {"verdict": "PASSED", "notes": "Test approval", "node_id": str(node.id)},
            format="json"
        )

        assert response.status_code == 200
        # With only one node, completing it marks workflow as COMPLETED
        assert response.data["status"] == ApprovalWorkflowStatus.COMPLETED

    def test_approve_node_requires_pending_status(self, authenticated_client, cn_tenant, soul):
        """Cannot approve already-processed node."""
        # Create a workflow with 2 nodes
        wf = ApprovalWorkflow.objects.create(
            soul=soul,
            workflow_name="测试流程",
            case_type=CaseType.ROUTINE,
            status=ApprovalWorkflowStatus.IN_PROGRESS,
            tenant=cn_tenant,
        )
        node1 = ApprovalNode.objects.create(
            workflow=wf, node_name="节点1", node_order=1,
            node_type="TRIAL", status=NodeStatus.PENDING,
        )
        ApprovalNode.objects.create(
            workflow=wf, node_name="节点2", node_order=2,
            node_type="TRIAL", status=NodeStatus.PENDING,
        )
        wf.current_node = node1
        wf.save()

        # Complete the first node
        wf.complete_node(node1.id, "PASSED", "")

        # Now try to approve the already-completed node1
        response = authenticated_client.post(
            f"/api/v1/workflows/{wf.id}/approve_node/",
            {"verdict": "PASSED", "notes": "Test", "node_id": str(node1.id)},
            format="json"
        )

        assert response.status_code == 400
        assert "already processed" in response.data["error"]

    def test_advance_workflow(self, authenticated_client, cn_tenant, soul):
        """POST /api/v1/workflows/{id}/advance/ advances to next node."""
        # Create a fresh workflow with 2 nodes
        wf = ApprovalWorkflow.objects.create(
            soul=soul,
            workflow_name="测试流程",
            case_type=CaseType.ROUTINE,
            status=ApprovalWorkflowStatus.IN_PROGRESS,
            tenant=cn_tenant,
        )
        node1 = ApprovalNode.objects.create(
            workflow=wf, node_name="节点1", node_order=1,
            node_type="TRIAL", status=NodeStatus.PENDING,
        )
        node2 = ApprovalNode.objects.create(
            workflow=wf, node_name="节点2", node_order=2,
            node_type="TRIAL", status=NodeStatus.PENDING,
        )
        wf.current_node = node1
        wf.save()

        # Initially current_node is node 1
        wf.refresh_from_db()
        assert wf.current_node.node_order == 1

        # Complete node 1 - this should set current_node to node 2
        wf.complete_node(node1.id, "PASSED", "")
        wf.refresh_from_db()
        assert wf.current_node == node2
        assert wf.current_node.node_order == 2

        # Node 2 is the last pending node and it is the one we are standing
        # on, so there is nowhere to advance to.
        #
        # This assertion used to read `== 200` with the comment "advance is a
        # no-op". It was accurate about the behaviour and it was pinning a
        # defect: `advance_to_next` computed the next node as
        # `get_next_node()`, which returns the first PENDING node -- i.e. the
        # one `current_node` already pointed at -- assigned it to itself, and
        # returned True. Every call reported success and moved nothing, on the
        # only route out of a stalled workflow.
        response = authenticated_client.post(
            f"/api/v1/workflows/{wf.id}/advance/",
            format="json"
        )
        assert response.status_code == 400, (
            f"Expected 400 (no next node), got {response.status_code}. A 200 "
            f"here is the interface reporting a move it did not make."
        )
        wf.refresh_from_db()
        assert wf.current_node == node2, "advance moved the pointer anyway"

    def test_advance_actually_moves_when_there_is_somewhere_to_go(
        self, authenticated_client, cn_tenant, soul
    ):
        """The other half. Without this, returning 400 unconditionally passes."""
        wf = ApprovalWorkflow.objects.create(
            soul=soul, workflow_name="可推进流程", case_type=CaseType.ROUTINE,
            status=ApprovalWorkflowStatus.IN_PROGRESS, tenant=cn_tenant,
        )
        node1 = ApprovalNode.objects.create(
            workflow=wf, node_name="节点1", node_order=1,
            node_type="TRIAL", status=NodeStatus.PENDING,
        )
        node2 = ApprovalNode.objects.create(
            workflow=wf, node_name="节点2", node_order=2,
            node_type="TRIAL", status=NodeStatus.PENDING,
        )
        wf.current_node = node1
        wf.save()

        response = authenticated_client.post(
            f"/api/v1/workflows/{wf.id}/advance/", format="json"
        )
        assert response.status_code == 200, response.data
        wf.refresh_from_db()
        assert wf.current_node == node2, (
            f"advance answered 200 and left the flow on "
            f"{wf.current_node.node_name if wf.current_node else None}"
        )

    def test_workflow_stats_endpoint(self, authenticated_client, workflow):
        """GET /api/v1/workflows/{id}/stats/ returns progress stats."""
        response = authenticated_client.get(f"/api/v1/workflows/{workflow.id}/stats/")

        assert response.status_code == 200
        assert "total_nodes" in response.data
        assert "completed_nodes" in response.data
        assert "pending_nodes" in response.data
        assert "progress_percent" in response.data
        # Verify values are reasonable (not negative, not absurd)
        assert response.data["total_nodes"] >= 0
        assert response.data["completed_nodes"] >= 0
        assert response.data["pending_nodes"] >= 0
        assert 0 <= response.data["progress_percent"] <= 100

    def test_unauthenticated_access_denied(self, api_client, workflow):
        """Unauthenticated requests return 401."""
        response = api_client.get(f"/api/v1/workflows/{workflow.id}/")
        assert response.status_code == 401


@pytest.mark.django_db
class TestJudgmentWorkflowIntegration:
    """Test integration between Judgment.conclude and workflow creation."""

    @pytest.fixture
    def soul(self, cn_tenant):
        # civilization is derived from tenant
        #
        # JUDGING,不是 ALIVE:这个类里的每条测试都要 `conclude`,而 JUDGING 是
        # 它的真实前置条件(生产路径是 `soul.die()` 把灵魂送进去)。此前这里是
        # ALIVE,而 `conclude` **丢掉了 `transition_to` 的返回值** —— judgment
        # 标记 final、处置已创建,而灵魂还是 ALIVE,没有测试断言过灵魂状态。
        return Soul.objects.create(
            name="测试灵魂",
            birth_date="1990-01-01",
            origin_location="北京",
            current_state=SoulState.JUDGING,
            tenant=cn_tenant,
        )

    @pytest.fixture
    def judgment(self, soul, cn_tenant):
        return Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            is_final=False,
            tenant=cn_tenant,
        )

    def test_conclude_with_create_workflow(self, judgment, cn_tenant):
        """Judgment.conclude with create_workflow=True creates workflow."""
        # First conclude the judgment with workflow creation
        judgment.conclude("PASSED", "Test verdict", create_workflow=True)

        assert judgment.is_final is True
        assert judgment.verdict == "PASSED"

        # Check workflow was created
        workflow = getattr(judgment, "approval_workflow", None)
        assert workflow is not None
        assert workflow.soul == judgment.soul
        assert workflow.status == ApprovalWorkflowStatus.IN_PROGRESS

    def test_conclude_without_create_workflow(self, judgment):
        """Judgment.conclude with create_workflow=False (default) doesn't create workflow."""
        judgment.conclude("PASSED", "Test verdict")

        assert judgment.is_final is True

        # No workflow should be created
        assert not hasattr(judgment, "approval_workflow") or judgment.approval_workflow is None

    def test_judgment_api_conclude_with_workflow(self, cn_tenant, soul, django_user_model):
        """API conclude endpoint supports create_workflow parameter."""
        client = APIClient()
        user = django_user_model.objects.create_user(
            username="admin",
            password="admin123",
            role="ADMIN",
            tenant=cn_tenant,
        )
        client.force_authenticate(user=user)

        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            is_final=False,
            tenant=cn_tenant,
        )

        response = client.post(
            f"/api/v1/judgment/{judgment.id}/conclude/",
            {"verdict": "PASSED", "notes": "Test", "create_workflow": True},
            format="json"
        )

        assert response.status_code == 200
        judgment.refresh_from_db()
        assert judgment.is_final is True

        # Verify workflow created via API
        workflow_response = client.get(f"/api/v1/workflows/?judgment={judgment.id}")
        assert workflow_response.status_code == 200
        workflows = workflow_response.data["results"] if "results" in workflow_response.data else workflow_response.data
        assert len(workflows) == 1
