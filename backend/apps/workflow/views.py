"""
REST views for workflow app.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from apps.workflow.models import ApprovalWorkflow, ApprovalNode, ApprovalWorkflowStatus, NodeStatus, WorkflowTemplate
from apps.workflow.serializers import (
    ApprovalWorkflowSerializer,
    ApprovalWorkflowListSerializer,
    ApprovalNodeSerializer,
    WorkflowNodeActionSerializer,
    WorkflowTemplateSerializer,
    WorkflowTemplateListSerializer,
)
from apps.workflow.services import WorkflowService
from apps.core.permissions import TenantPermission
from apps.core.mixins import TenantQuerySetMixin, TenantCreateMixin
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin


class WorkflowTemplateViewSet(CodenameViewSetMixin, TenantQuerySetMixin, TenantCreateMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    WorkflowTemplate CRUD.
    """
    permission_classes = [TenantPermission]
    permission_codename = "workflow"
    queryset = WorkflowTemplate.objects.select_related("tenant").all()
    serializer_class = WorkflowTemplateSerializer
    ordering_fields = ["created_at", "name", "civilization"]
    pagination_class = None  # Templates are small, return full list

    def get_serializer_class(self):
        if self.action == "list":
            return WorkflowTemplateListSerializer
        return WorkflowTemplateSerializer


class ApprovalWorkflowViewSet(CodenameViewSetMixin, TenantQuerySetMixin, TenantCreateMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    ApprovalWorkflow CRUD + node actions.
    """
    permission_classes = [TenantPermission]
    permission_codename = "workflow"
    extra_permissions = {
        'advance': ['workflow.advance'],
        'approve_node': ['workflow.approve'],
        'stats': ['workflow.read'],
        'create_from_judgment': ['workflow.create'],
    }
    queryset = ApprovalWorkflow.objects.select_related(
        "soul", "soul__tenant", "tenant", "current_node", "coordinating_realm"
    ).prefetch_related("nodes").all()
    serializer_class = ApprovalWorkflowSerializer
    ordering_fields = ["created_at", "priority", "status"]

    def get_serializer_class(self):
        if self.action == "list":
            return ApprovalWorkflowListSerializer
        return ApprovalWorkflowSerializer

    @action(detail=True, methods=["post"])
    def advance(self, request, pk=None):
        """
        Manually advance workflow to next pending node.
        """
        workflow = self.get_object()
        if workflow.advance_to_next():
            return Response(ApprovalWorkflowSerializer(workflow).data)
        return Response(
            {"error": "No next node available or workflow already completed"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    @action(detail=True, methods=["post"])
    def approve_node(self, request, pk=None):
        """
        Approve/decide on the current node.
        """
        workflow = self.get_object()

        serializer = WorkflowNodeActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        node_id = request.data.get("node_id")
        if node_id:
            node = workflow.nodes.filter(id=node_id).first()
        else:
            node = workflow.get_current_node()

        if not node:
            return Response({"error": "Node not found"}, status=status.HTTP_404_NOT_FOUND)

        if node.status != NodeStatus.PENDING:
            return Response({"error": "Node already processed"}, status=status.HTTP_400_BAD_REQUEST)

        verdict = serializer.validated_data["verdict"]
        notes = serializer.validated_data.get("notes", "")

        success = workflow.complete_node(node.id, verdict, notes, user=request.user)
        if success:
            return Response(ApprovalWorkflowSerializer(workflow).data)
        return Response({"error": "Failed to complete node"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get"])
    def stats(self, request, pk=None):
        """
        Get workflow progress statistics.
        """
        workflow = self.get_object()
        stats = WorkflowService.get_workflow_stats(workflow)
        return Response(stats)

    @action(detail=False, methods=["post"])
    def create_from_judgment(self, request):
        """
        Create a workflow instance from a judgment.
        """
        judgment_id = request.data.get("judgment_id")
        if not judgment_id:
            return Response({"error": "judgment_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        from apps.judgment.models import Judgment
        tenant = getattr(request, "tenant", None)
        judgment = Judgment.objects.filter(id=judgment_id, tenant=tenant).first()
        if not judgment:
            return Response({"error": "Judgment not found"}, status=status.HTTP_404_NOT_FOUND)

        if not judgment.is_final:
            return Response({"error": "Judgment must be concluded first"}, status=status.HTTP_400_BAD_REQUEST)

        if hasattr(judgment, "approval_workflow"):
            return Response({"error": "Workflow already exists for this judgment"}, status=status.HTTP_400_BAD_REQUEST)

        case_type = request.data.get("case_type")
        is_appeal = request.data.get("is_appeal", False)
        priority = request.data.get("priority", 0)

        try:
            workflow = WorkflowService.create_from_judgment(
                judgment,
                case_type=case_type,
                is_appeal=is_appeal,
                priority=priority,
            )
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        if workflow:
            return Response(ApprovalWorkflowSerializer(workflow).data, status=status.HTTP_201_CREATED)
        return Response({"error": "Failed to create workflow"}, status=status.HTTP_400_BAD_REQUEST)


class ApprovalNodeViewSet(CodenameViewSetMixin, AuditUserViewSetMixin, TenantCreateMixin, viewsets.ModelViewSet):
    """
    ApprovalNode CRUD.
    """
    permission_classes = [TenantPermission]
    permission_codename = "workflow"
    queryset = ApprovalNode.objects.select_related("workflow", "workflow__soul", "approver", "realm", "approver_actor").all()
    serializer_class = ApprovalNodeSerializer
    ordering_fields = ["node_order", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if user.role == "ADMIN":
            return qs
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            return qs.filter(workflow__tenant=tenant)
        return qs.none()
