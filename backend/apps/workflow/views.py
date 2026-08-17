"""
REST views for workflow app.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantCreateMixin, TenantQuerySetMixin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.workflow.filters import WorkflowFilter
from apps.workflow.models import ApprovalNode, ApprovalWorkflow, NodeStatus, WorkflowTemplate
from apps.workflow.serializers import (
    ApprovalNodeSerializer,
    ApprovalWorkflowListSerializer,
    ApprovalWorkflowSerializer,
    WorkflowNodeActionSerializer,
    WorkflowTemplateListSerializer,
    WorkflowTemplateSerializer,
)
from apps.workflow.services import WorkflowService


class WorkflowTemplateViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, TenantQuerySetMixin, TenantCreateMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    WorkflowTemplate CRUD.
    """
    # CodenamePermission is what finally enforces `workflow.*` here. Until it
    # was added, PermissionMiddleware never saw self.action and the audit
    # measured a VIEWER designing an approval template and then deleting it.
    #
    # This app is the one place in the rollout where the codenames are already
    # SEEDED on a migrate-only database — migrations 0013/0015 create the seven
    # Permission rows, 0017 grants them — so check_permission answers these
    # from RolePermission, not from ROLE_PERMISSIONS. The two agree today
    # (0017's frozen matrix was copied from the dict), but they are two
    # sources, and a database behind 0013 answers from the dict instead. Both
    # directions are pinned in apps/perm/test_matrix_snapshot.py.
    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "workflow"
    queryset = WorkflowTemplate.objects.select_related("tenant").all()
    serializer_class = WorkflowTemplateSerializer
    filterset_class = None  # Templates are small, no filtering needed
    ordering_fields = ["created_at", "name", "civilization"]
    pagination_class = None  # Templates are small, return full list

    def get_queryset(self):
        """Fresh queryset to avoid stale TenantManager contextvar filters.
        Applies tenant filtering for non-ADMIN users."""
        # _base_manager is the *unfiltered* manager (all_objects is declared
        # first on this model precisely so it takes that role), so reaching for
        # it to dodge the tenant contextvar also dropped the soft-delete
        # filter — deleted templates kept appearing in the list. Exclude them
        # explicitly rather than going back to `objects`, which would
        # reintroduce the contextvar problem this override exists to solve.
        qs = WorkflowTemplate._base_manager.filter(is_deleted=False).select_related("tenant")
        return scope_to_tenant(qs, self.request)

    def get_serializer_class(self):
        if self.action == "list":
            return WorkflowTemplateListSerializer
        return WorkflowTemplateSerializer


class ApprovalWorkflowViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, TenantQuerySetMixin, TenantCreateMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    ApprovalWorkflow CRUD + node actions.
    """
    # Enforced from here on — see WorkflowTemplateViewSet above. The
    # extra_permissions below are the reason this viewset matters most of the
    # three: `escalate` is MODERATOR-and-ADMIN, `approve_node`/`advance` are
    # JUDGE-and-ADMIN, and that split is the separation of duties the
    # MODERATOR entry in ROLE_PERMISSIONS is written around. It had never once
    # been applied to a request.
    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "workflow"
    extra_permissions = {
        'advance': ['workflow.advance'],
        'escalate': ['workflow.escalate'],
        'approve_node': ['workflow.approve'],
        'stats': ['workflow.read'],
        'create_from_judgment': ['workflow.create'],
    }
    queryset = ApprovalWorkflow.objects.select_related(
        "soul", "soul__tenant", "tenant", "current_node", "coordinating_realm"
    ).prefetch_related("nodes").all()
    filterset_class = WorkflowFilter
    search_fields = WorkflowFilter.search_fields
    ordering_fields = WorkflowFilter.ordering_fields
    serializer_class = ApprovalWorkflowSerializer

    def get_queryset(self):
        """Fresh queryset to avoid stale TenantManager contextvar filters.
        Applies tenant filtering for non-ADMIN users."""
        qs = ApprovalWorkflow._base_manager.select_related(
            "soul", "soul__tenant", "tenant", "current_node", "coordinating_realm"
        ).prefetch_related("nodes").all()
        return scope_to_tenant(qs, self.request)

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
    def escalate(self, request, pk=None):
        """
        越级推进 — force a stuck workflow past its current node.

        A realm lead (MODERATOR) configures the flow but deliberately holds
        neither workflow.approve nor workflow.advance: the ten courts exist to
        divide the decision, and a lead who could both design the flow and
        approve at any stage of it would make that division decorative.

        A flow can still stall — an approver unavailable, a node misconfigured
        — so this is the sanctioned way out. It is not `advance` under another
        name: it demands a written reason and always leaves an audit record
        naming who overrode which node and why. The cost of using it is that
        it is visible.
        """
        workflow = self.get_object()

        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response(
                {"error": "reason is required", "detail": "越级推进必须说明理由"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        node = workflow.current_node
        if not workflow.advance_to_next():
            return Response(
                {"error": "No next node available or workflow already completed"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from apps.audit.models import AuditAction, AuditLog

        AuditLog.objects.create(
            tenant=getattr(workflow, "tenant", None),
            user=request.user if request.user.is_authenticated else None,
            action=AuditAction.EXECUTE,
            resource="workflow.escalate",
            resource_id=str(workflow.id),
            description=f"越级推进：{getattr(node, 'node_name', '-')} — {reason}"[:500],
            changes={
                "skipped_node": str(getattr(node, "id", "")) or None,
                "skipped_node_name": getattr(node, "node_name", None),
                "skipped_court": getattr(node, "court_code", None),
                "reason": reason,
                "advanced_to": str(getattr(workflow.current_node, "id", "")) or None,
            },
            ip_address=request.META.get("REMOTE_ADDR"),
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
        )

        return Response(ApprovalWorkflowSerializer(workflow).data)

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

        # Approver identity. `workflow.approve` (CodenamePermission, above)
        # answers "may this user approve things" — it cannot answer "may this
        # user approve *this* node", because that depends on who the node names.
        # Every JUDGE and ADMIN holds the codename, so without this check any of
        # them could decide a node reserved for 阎罗王, and `complete_node` would
        # write their name into `node.approver` as though they were.
        #
        # `ApprovalNode.can_approve` existed to answer exactly this and was
        # never called from anywhere — the guard was written, then bypassed by
        # its own call site. This is that call site.
        #
        # `can_approve` is now the *only* gate. It used to be scoped to nodes
        # that already named an approver (`node.designates_approver and ...`),
        # which sounded conservative and was in practice a no-op: measured on
        # 2026-08-15, all 30 ApprovalNodes in the live database were SYSTEM, so
        # the condition was False for every row that existed and the guard
        # refused nothing. The scope has been removed and the nodes have been
        # given the approvers their own templates name
        # (0011_backfill_ten_court_approvers, and WorkflowService now sets them
        # at creation), so the check applies to the rows instead of stepping
        # around them.
        #
        # A node that still designates nobody is refused too — see
        # ApprovalNode.can_approve for why that is the only non-guessing
        # answer. It is refused with a different message, because "you are not
        # the approver" and "this node has no approver" are fixed differently:
        # the first is somebody else's to decide, the second is a
        # misconfiguration. Both point at `escalate`, which is the sanctioned
        # way past and leaves an AuditLog.
        if not node.can_approve(request.user):
            if not node.designates_approver:
                return Response(
                    {
                        "error": "Node designates no approver",
                        "detail": (
                            "该节点未指定审批人（approver_type=SYSTEM 或 approver_actor 为空），"
                            "无人满足其身份条件；请为节点配置审批人，或使用越级推进（escalate）"
                            "留痕推进"
                        ),
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
            return Response(
                {
                    "error": "Not the designated approver for this node",
                    "detail": "只有该节点指定的审批人可以审批；如需推进请使用越级推进（escalate）",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

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
        # `.get("priority")`, NOT `.get("priority", 0)`. The default turned every
        # request that omitted the field into an explicit "normal", which
        # `WorkflowService._resolve_priority` cannot tell from a caller who
        # actually asked for 0 — so the instance-level value would have won
        # every time and `WorkflowTemplate.priority` would have had no effect
        # through the only endpoint that creates workflows. Absent now arrives
        # as None ("not specified") and falls through to the template; a sent
        # `"priority": 0` still arrives as 0 and still wins.
        priority = request.data.get("priority")

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


class ApprovalNodeViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin, TenantCreateMixin, viewsets.ModelViewSet):
    """
    ApprovalNode CRUD.
    """
    # Enforced from here on — see WorkflowTemplateViewSet above. Nodes are the
    # rows an approval decision is written into, and they were reachable
    # directly, so leaving this viewset unenforced while enforcing
    # ApprovalWorkflowViewSet would have left `approve_node`'s gate walk-around
    # in place: POST /nodes/ and PATCH /nodes/{id}/ edit the same records.
    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "workflow"
    queryset = ApprovalNode.objects.select_related("workflow", "workflow__soul", "approver", "realm", "approver_actor").all()
    serializer_class = ApprovalNodeSerializer
    filterset_class = None  # Nodes are accessed via workflow, no direct filtering needed
    ordering_fields = ["node_order", "created_at"]

    def get_queryset(self):
        """Fresh queryset to avoid stale TenantManager contextvar filters.
        Filters by workflow__tenant since ApprovalNode has no direct tenant field."""
        qs = ApprovalNode._base_manager.select_related("workflow", "workflow__soul", "approver", "realm", "approver_actor").all()
        return scope_to_tenant(qs, self.request, field="workflow__tenant")
