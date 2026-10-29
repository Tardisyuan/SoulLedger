"""
REST views for workflow app.
"""
from django.db import transaction
from django.db.models import Prefetch
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed
from rest_framework.response import Response

from apps.core.client_ip import get_client_ip
from apps.core.exports import export_csv
from apps.core.mixins import TenantCreateMixin, TenantQuerySetMixin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.perm.filters import DataScopeFilter
from apps.workflow import decision_codes, segments
from apps.workflow.filters import WorkflowFilter
from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    EscalationRefusedError,
    NodeStatus,
    VerdictRefusedError,
    WorkflowTemplate,
)
from apps.workflow.serializers import (
    ApprovalNodeSerializer,
    ApprovalWorkflowExportSerializer,
    ApprovalWorkflowListSerializer,
    ApprovalWorkflowSerializer,
    ApproverPreviewSerializer,
    FlowPreviewSerializer,
    WorkflowAdjustSerializer,
    WorkflowCaseTypeSerializer,
    WorkflowConflictError,
    WorkflowNodeActionSerializer,
    WorkflowPickSerializer,
    WorkflowReasonSerializer,
    WorkflowRemindSerializer,
    WorkflowStartSerializer,
    WorkflowStatsSerializer,
    WorkflowTemplateListSerializer,
    WorkflowTemplateSerializer,
    WorkflowTemplateVersionSerializer,
    refuse_started,
)
from apps.workflow.services import WorkflowInProgressError, WorkflowService


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
    extra_permissions = {
        "publish": ["workflow.update"],
        "versions": ["workflow.read"],
        "approver_preview": ["workflow.read"],
    }
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
        qs = WorkflowTemplate._base_manager.filter(is_deleted=False).select_related(
            "tenant", "published_version"
        )
        return DataScopeFilter.filter_queryset(self.request, scope_to_tenant(qs, self.request), WorkflowTemplate)

    def get_serializer_class(self):
        if self.action == "list":
            return WorkflowTemplateListSerializer
        if self.action == "versions":
            return WorkflowTemplateVersionSerializer
        return WorkflowTemplateSerializer

    # Template versions (0018). A save (POST/PATCH with `nodes`) writes a draft;
    # this makes the draft the version new workflows are built from. It is
    # `workflow.update` because it is an edit of the template — the same people
    # who may change a template may put the change into service — and a 400
    # with the validation issues when the draft is not publishable, so the
    # editor can show them against the nodes they name.
    @extend_schema(request=None, responses=WorkflowTemplateSerializer)
    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        from apps.workflow import versioning
        from apps.workflow.serializers import template_pair_refusal

        template = self.get_object()
        # A template saved before the pair was checked on save (2026-10-29) is refused here too.
        refusal = template_pair_refusal(template.civilization, template.case_type)
        if refusal is not None:
            return Response(refusal, status=status.HTTP_400_BAD_REQUEST)
        try:
            versioning.publish(template, user=request.user)
        except versioning.NothingToPublishError:
            return Response(
                {"error": "no_draft", "detail": "该模板没有待发布的草稿。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except versioning.PublishRejectedError as rejected:
            return Response(
                {"error": "invalid_draft", "issues": rejected.issues},
                status=status.HTTP_400_BAD_REQUEST,
            )
        template.refresh_from_db()
        return Response(WorkflowTemplateSerializer(template, context={"request": request}).data)

    # Who a node's approver resolves to, for a target civilization and tenant.
    # Read-only: `preview.preview_node` calls `_resolve_approver` — the resolver
    # `_create_nodes` uses — and describes its answer with names and roles only.
    #
    # `tenant` (a tenant code) is honoured for ADMIN only, the one role that
    # sees across tenants; everybody else previews in their own tenant, and a
    # foreign code is a 403 rather than a silent substitution. With no
    # `tenant`, ADMIN gets the tenant that hosts the requested civilization
    # (`CIVILIZATION_TENANT`), since "按目标文明解析" is the question asked.
    @extend_schema(
        parameters=[
            OpenApiParameter("node", str, required=True, description="模板内节点 id"),
            OpenApiParameter("civilization", str, required=False),
            OpenApiParameter("tenant", str, required=False, description="租户代码,仅 ADMIN"),
        ],
        responses=ApproverPreviewSerializer,
    )
    @action(detail=True, methods=["get"], url_path="approver-preview")
    def approver_preview(self, request, pk=None):
        from apps.core.tenant import is_tenant_exempt
        from apps.souls.models import CIVILIZATION_TENANT, Civilization
        from apps.tenants.models import Tenant
        from apps.workflow import preview, versioning

        template = self.get_object()
        node_id = request.query_params.get("node", "")
        node = next(
            (n for n in versioning.working_nodes(template)
             if isinstance(n, dict) and str(n.get("id", "")) == node_id),
            None,
        ) if node_id else None
        if node is None:
            return Response({"error": "node_not_found"}, status=status.HTTP_404_NOT_FOUND)

        civilization = request.query_params.get("civilization") or template.civilization
        if civilization not in Civilization.values:
            return Response({"error": "invalid_civilization"}, status=status.HTTP_400_BAD_REQUEST)

        own = getattr(request, "tenant", None) or getattr(request.user, "tenant", None)
        code = request.query_params.get("tenant")
        if is_tenant_exempt(request.user):
            code = code or CIVILIZATION_TENANT.get(civilization)
            tenant = Tenant.objects.filter(code=code).first() if code else own
        elif code and (own is None or code != own.code):
            return Response({"error": "tenant_forbidden"}, status=status.HTTP_403_FORBIDDEN)
        else:
            tenant = own
        if tenant is None:
            return Response({"error": "tenant_not_found"}, status=status.HTTP_400_BAD_REQUEST)

        body = preview.preview_node(node, civilization, tenant)
        body.update({"node": node_id, "civilization": civilization, "tenant": tenant.code})
        return Response(body)

    # Read-only history, newest first. Every version the template ever had —
    # superseded ones included, because in-flight workflows may still be
    # running on them.
    @extend_schema(responses=WorkflowTemplateVersionSerializer(many=True))
    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        template = self.get_object()
        rows = template.versions.select_related("saved_by", "published_by").order_by("-number")
        return Response(WorkflowTemplateVersionSerializer(rows, many=True).data)


def _nodes_with_approver():
    """The nested node serializer reads `approver.username` / `.display_name`;
    a bare `prefetch_related("nodes")` would pay one query per decided node."""
    return Prefetch("nodes", queryset=ApprovalNode.objects.select_related("approver", "segment"))


class WorkflowPartyPermission(TenantPermission):
    """The workflow's own tenant, or a realm that runs one of its segments (第四十三批).

    `TenantPermission` compares `obj.tenant`, the convening hall. A participating realm of a merged cross-realm
    judgment must reach the workflow too — to read it, pick and adjust its own segment and decide its own
    stations — and only those (`segments.FOREIGN_ACTIONS`). The membership is `WorkflowSegment.tenant`, the
    same one `segments.foreign_workflows` widens the queryset by; which segment a request may change is decided
    in `segments` itself. Same shape as `apps/dispatch/permissions.py`.
    """

    def has_object_permission(self, request, view, obj):
        if super().has_object_permission(request, view, obj):
            return True
        if getattr(view, "action", None) not in segments.FOREIGN_ACTIONS:
            return False
        return segments.is_party(obj, getattr(request, "tenant", None))


#: The `{order}` path segment of the segment actions (1 = the workflow's own realm).
_SEGMENT_ORDER = OpenApiParameter("order", int, OpenApiParameter.PATH, description="段序号(1 = 本域)")


def _refused(exc):
    return Response({"code": exc.code, "error": str(exc), **exc.extra}, status=exc.status)


def _hook_refusals() -> tuple:
    """The business refusals a decision's end-of-flow hooks raise (`ApprovalWorkflow._finish`: the cross-realm
    bench, the appeal, the withdrawn conclusion, the sentence plan). Each carries a stable `code`; the decision
    that met one is rolled back whole and answered 409 with that code (2026-10-29). Anything else is a defect
    and stays a 500."""
    from apps.judgment.claims import ClaimRefusedError
    from apps.judgment.weighing import WeighingRefusedError
    from apps.sentence_plan.requests import PlanChangeRefusedError

    return (segments.CrossConclusionRefusedError, ClaimRefusedError, WeighingRefusedError, PlanChangeRefusedError)


def _hook_refused(exc):
    return Response({**getattr(exc, "extra", {}), "code": exc.code, "error": str(exc)},
                    status=status.HTTP_409_CONFLICT)


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
    permission_classes = [WorkflowPartyPermission, CodenamePermission]
    permission_codename = "workflow"
    extra_permissions = {
        # 第四十三批: who may pick / adjust / use the default / remind is decided per segment
        # (`apps/workflow/segments.py`); the codename only says "may read approval flows".
        'pick': ['workflow.read'],
        'adjust': ['workflow.read'],
        'use_default': ['workflow.read'],
        'remind': ['workflow.read'],
        'advance': ['workflow.advance'],
        'escalate': ['workflow.escalate'],
        'approve_node': ['workflow.approve'],
        'stats': ['workflow.read'],
        # W-1 选站列表(生成之前):只读模板与审批人名,同 `approver-preview`。
        'flow_preview': ['workflow.read'],
        'create_from_judgment': ['workflow.create'],
        'start': ['workflow.create'],
        # The choices for `start`, so the same people who may start.
        'case_types': ['workflow.create'],
        # 列表的 CSV:自己的码(用户 2026-10-29 第 3 条)。
        'export': ['workflow.export'],
    }
    queryset = ApprovalWorkflow.objects.select_related(
        "soul", "soul__tenant", "tenant", "judgment", "current_node", "current_node__approver", "coordinating_realm", "template_version"
    ).prefetch_related(_nodes_with_approver()).all()
    filterset_class = WorkflowFilter
    search_fields = WorkflowFilter.search_fields
    ordering_fields = WorkflowFilter.ordering_fields
    serializer_class = ApprovalWorkflowSerializer

    def get_queryset(self):
        """Fresh queryset to avoid stale TenantManager contextvar filters.
        Applies tenant filtering for non-ADMIN users."""
        qs = ApprovalWorkflow._base_manager.select_related(
            "soul", "soul__tenant", "tenant", "judgment", "current_node", "current_node__approver", "coordinating_realm", "template_version"
        ).prefetch_related(_nodes_with_approver()).all()
        own = DataScopeFilter.filter_queryset(self.request, scope_to_tenant(qs, self.request), ApprovalWorkflow)
        if self.action not in segments.FOREIGN_ACTIONS:
            return own
        # A participating realm reaches the workflow through its own segment, for these actions only (第四十三批).
        return own | segments.foreign_workflows(qs, self.request)

    def get_serializer_class(self):
        if self.action == "list":
            return ApprovalWorkflowListSerializer
        return ApprovalWorkflowSerializer

    # The generic create is closed (W-11). It saved a bare row — no template, no nodes, no event — which is
    # the node-less workflow `_resolve_template` exists to make impossible: un-advanceable, un-approvable,
    # un-escalatable. Nothing called it (`workflowApi.create` had no caller). A workflow is made by
    # `start` or `create_from_judgment`, both through `WorkflowService.start_workflow`.
    @extend_schema(exclude=True)
    def create(self, request, *args, **kwargs):
        raise MethodNotAllowed(request.method, detail="Use POST /workflows/start/ or /workflows/create_from_judgment/.")

    def perform_destroy(self, instance):
        """Only a flow that has not started and decides no judgment may be deleted (rbac-be1 H1, 2026-10-29).
        The delete is physical; deleting a running flow let `weighing.unfinished_flow` find nothing and release the
        held disposition — a hall lead denied approve / advance skipping the whole chain in one request — and
        deleting a finished one erased its record."""
        if instance.has_started or instance.judgment_id is not None:
            raise WorkflowConflictError(
                "workflow_in_use", "This flow has started or belongs to a judgment and cannot be deleted.")
        super().perform_destroy(instance)

    @extend_schema(
        parameters=[
            OpenApiParameter("civilization", str, required=False, description="文明代码;与 soul 二选一"),
            OpenApiParameter("soul", str, required=False, description="灵魂 uuid,取其文明;与 civilization 二选一"),
        ],
        responses={200: WorkflowCaseTypeSerializer(many=True), 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT},
    )
    @action(detail=False, methods=["get"], url_path="case-types", pagination_class=None)
    def case_types(self, request):
        """The case types `start` accepts for a civilization (`VALID_CASE_TYPES_BY_CIVILIZATION`), in
        `CaseType` declaration order. Labels are the client's (`workflow.case_types.*` in the language packs)."""
        import uuid

        from apps.souls.models import Soul
        from apps.workflow.models import CaseType
        from apps.workflow.templates import VALID_CASE_TYPES_BY_CIVILIZATION, formal_template

        civilization = request.query_params.get("civilization", "")
        soul_id = request.query_params.get("soul", "")
        if bool(civilization) == bool(soul_id):
            return Response({"code": "civilization_or_soul", "error": "Give exactly one of civilization or soul"},
                            status=status.HTTP_400_BAD_REQUEST)
        if soul_id:
            try:
                uuid.UUID(soul_id)
            except ValueError:
                return Response({"code": "soul_not_found", "error": "Soul not found"},
                                status=status.HTTP_404_NOT_FOUND)
            # Same scoping as `start`: another tenant's soul is a 404.
            soul = scope_to_tenant(Soul.objects.all(), request).filter(pk=soul_id).first()
            if soul is None:
                return Response({"code": "soul_not_found", "error": "Soul not found"},
                                status=status.HTTP_404_NOT_FOUND)
            civilization = soul.civilization
        valid = VALID_CASE_TYPES_BY_CIVILIZATION.get(civilization)
        if not valid:
            return Response({"code": "unknown_civilization", "error": f"Unknown civilization '{civilization}'"},
                            status=status.HTTP_400_BAD_REQUEST)
        rows = [
            {"value": c.value, "builtin": bool((formal_template(civilization, c) or {}).get("nodes"))}
            for c in CaseType
            if c in valid
        ]
        return Response(WorkflowCaseTypeSerializer(rows, many=True).data)

    @extend_schema(
        parameters=[
            OpenApiParameter("soul", str, required=False, description="手动发起:灵魂 id(与 case_type 或 template 同给)"),
            OpenApiParameter("case_type", str, required=False),
            OpenApiParameter("template", str, required=False, description="选定的模板;不给按案件类型取默认"),
            OpenApiParameter("judgment", str, required=False,
                             description="结案时:审判 id(案件类型按审判取);手动发起时:关联的审判"),
        ],
        responses={200: FlowPreviewSerializer, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT},
    )
    @action(detail=False, methods=["get"], url_path="flow-preview", pagination_class=None)
    def flow_preview(self, request):
        """W-1 选站列表(第四十三批):流程生成之前,本域默认流程的各站与按跨域审判顺序接在后面的外域。
        模板解析与 `start` / 结案生成同一套(`_resolve_template` / 同样校验的选定模板),所以列出的站序就是
        `skip_node_orders` 认的那些。灵魂与审判按同一个租户划界:别的殿的是 404。"""
        import uuid

        from apps.judgment.models import Judgment
        from apps.souls.models import Soul

        def param_uuid(name):
            value = request.query_params.get(name, "")
            if not value:
                return None
            try:
                return uuid.UUID(value)
            except ValueError:
                return False

        soul_id, judgment_id, template_id = param_uuid("soul"), param_uuid("judgment"), param_uuid("template")
        if False in (soul_id, judgment_id, template_id):
            return Response({"code": "not_found", "error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        judgment = None
        if judgment_id:
            judgment = (scope_to_tenant(Judgment.objects.select_related("soul", "tenant"), request)
                        .filter(pk=judgment_id).first())
            if judgment is None:
                return Response({"code": "judgment_not_found", "error": "Judgment not found"},
                                status=status.HTTP_404_NOT_FOUND)
        if soul_id:
            soul = scope_to_tenant(Soul.objects.all(), request).filter(pk=soul_id).first()
            if soul is None:
                return Response({"code": "soul_not_found", "error": "Soul not found"}, status=status.HTTP_404_NOT_FOUND)
            if judgment is not None and judgment.soul_id != soul.pk:
                return Response({"code": "judgment_not_found", "error": "Judgment not found for this soul"},
                                status=status.HTTP_404_NOT_FOUND)
            tenant = soul.tenant
        elif judgment is not None:
            soul, tenant = judgment.soul, judgment.tenant
        else:
            return Response({"code": "soul_or_judgment", "error": "Give soul or judgment"},
                            status=status.HTTP_400_BAD_REQUEST)

        case_type = request.query_params.get("case_type") or None
        if template_id:
            db_template = (
                WorkflowTemplate.objects.filter(pk=template_id, tenant=tenant, is_active=True,
                                                civilization=soul.civilization)
                .exclude(nodes_json=[])
                .first()
            )
            if db_template is None:
                return Response({"code": "template_not_found", "error": "No such template for this soul"},
                                status=status.HTTP_404_NOT_FOUND)
            template, _priority = WorkflowService.stored_template(db_template)
            case_type = db_template.case_type
        else:
            if case_type is None:
                if soul_id:
                    return Response({"code": "case_type_required", "error": "Give case_type or template"},
                                    status=status.HTTP_400_BAD_REQUEST)
                case_type = WorkflowService.judgment_case_type(soul.civilization)
            invalid = WorkflowService.validate_civilization_case_type(soul.civilization, case_type)
            if invalid:
                return Response({"code": "invalid_case_type", "error": invalid}, status=status.HTTP_400_BAD_REQUEST)
            template, _priority = WorkflowService._resolve_template(soul.civilization, case_type, tenant)
        body = segments.flow_preview(soul, case_type, tenant, template, judgment)
        return Response(FlowPreviewSerializer(body).data)

    @extend_schema(
        request=WorkflowStartSerializer,
        responses={201: ApprovalWorkflowSerializer, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT,
                   409: OpenApiTypes.OBJECT},
    )
    @action(detail=False, methods=["post"])
    def start(self, request):
        """Start an approval workflow for any soul, with a written reason (W-11).

        Same template resolution, nodes and events as `create_from_judgment`; `judgment` is optional.
        """
        from apps.audit.models import AuditAction, AuditLog
        from apps.judgment.models import Judgment
        from apps.souls.models import Soul

        body = WorkflowStartSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data

        # Another tenant's soul is a 404, not a 403: its existence is not this caller's to learn.
        soul = scope_to_tenant(Soul.objects.all(), request).filter(pk=data["soul"]).first()
        if soul is None:
            return Response({"code": "soul_not_found", "error": "Soul not found"}, status=status.HTTP_404_NOT_FOUND)
        tenant = soul.tenant

        judgment = None
        if data.get("judgment"):
            judgment = Judgment.objects.filter(pk=data["judgment"], soul=soul).first()
            if judgment is None:
                return Response({"code": "judgment_not_found", "error": "Judgment not found for this soul"},
                                status=status.HTTP_404_NOT_FOUND)
            if hasattr(judgment, "approval_workflow"):
                return Response({"code": "judgment_has_workflow", "error": "Workflow already exists for this judgment"},
                                status=status.HTTP_409_CONFLICT)

        template = None
        case_type = data.get("case_type")
        if data.get("template"):
            # The soul's own tenant, active, with nodes, and for the soul's civilization. A template that fails
            # any of these is "not found" for this soul — the editor shows which templates exist.
            db_template = (
                WorkflowTemplate.objects.filter(pk=data["template"], tenant=tenant, is_active=True,
                                                civilization=soul.civilization)
                .exclude(nodes_json=[])
                .first()
            )
            if db_template is None:
                return Response({"code": "template_not_found",
                                 "error": "No active template with nodes for this soul's civilization"},
                                status=status.HTTP_404_NOT_FOUND)
            template = WorkflowService.stored_template(db_template)
            case_type = db_template.case_type

        reason = data["reason"]
        try:
            with transaction.atomic():
                workflow = WorkflowService.start_workflow(
                    soul, case_type=case_type, tenant=tenant, template=template, judgment=judgment,
                    priority=data.get("priority"), notes=reason, exclusive=True,
                    skip_node_orders=data.get("skip_node_orders") or (), picked_by=request.user,
                    manually_started=True,
                )
                AuditLog.objects.create(
                    tenant=tenant,
                    user=request.user if request.user.is_authenticated else None,
                    action=AuditAction.CREATE,
                    resource="workflow.start",
                    resource_id=str(workflow.id),
                    description=f"手动发起审批：{workflow.workflow_name} — {reason}"[:500],
                    changes={
                        "soul": str(soul.pk),
                        "case_type": case_type,
                        "template": str(data["template"]) if data.get("template") else None,
                        "judgment": str(judgment.pk) if judgment else None,
                        "reason": reason,
                    },
                    ip_address=get_client_ip(request),
                    user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
                )
        except segments.SegmentRefusedError as refused:
            return _refused(refused)
        except WorkflowInProgressError as busy:
            return Response(
                {"code": "workflow_in_progress",
                 "error": "This soul already has a workflow of this case type in progress",
                 "workflow": str(busy.workflow.pk), "number": busy.workflow.number, "status": busy.workflow.status,
                 "case_type": busy.workflow.case_type},
                status=status.HTTP_409_CONFLICT,
            )
        except ValueError as e:
            return Response({"code": getattr(e, "code", "invalid_case_type"), "error": str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(ApprovalWorkflowSerializer(workflow, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.BINARY, 400: OpenApiTypes.OBJECT})
    @action(detail=False, methods=["get"], url_path="export", pagination_class=None)
    def export(self, request):
        """导出当前筛选下的审批流 CSV:与列表同一租户划界、同一筛选与搜索、同一权限(workflow.read)。
        列取自列表序列化器。"""
        # 一行一个实例(Design 第二十八批 W5):列表的字段加当前站、发起人、耗时,见 ApprovalWorkflowExportSerializer。
        # (注释而非文档字符串:文档字符串会进 OpenAPI 描述,而这个接口的响应结构没变。)
        return export_csv(
            request,
            qs=self.filter_queryset(self.get_queryset()).select_related("create_user"),
            serializer_class=ApprovalWorkflowExportSerializer,
            columns=[
                ("Workflow ID", "id"), ("Name", "workflow_name"), ("Soul", "soul_name"),
                ("Case Type", "case_type"), ("Priority", "priority"), ("Status", "status"),
                ("Current Node", "current_node_name"), ("Initiator", "initiator"),
                ("Started At", "created_at"), ("Completed At", "completed_at"),
                ("Duration (min)", "duration_minutes"),
                ("Appeal", "is_appeal"), ("Cross Civilization", "cross_civilization"),
            ],
            filename="workflows_export.csv",
            resource="workflow",
        )

    @extend_schema(request=WorkflowReasonSerializer, responses={200: ApprovalWorkflowSerializer,
                                                                400: OpenApiTypes.OBJECT, 409: OpenApiTypes.OBJECT})
    @action(detail=True, methods=["post"])
    def advance(self, request, pk=None):
        """
        Manually advance workflow to the next stop.

        Moves the pointer only: the stop being left is marked SKIPPED (nobody decided it) and the next one is where
        a PASS would have gone. Like `escalate` it demands a written reason and leaves an audit record naming who
        moved the flow past which stop and why (2026-10-29).
        """
        workflow = self.get_object()
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response(
                {"code": "reason_required", "error": "reason is required", "detail": "推进必须说明理由"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        node = workflow.current_node  # None on a hand-built flow with no pointer: advance only sets it
        try:
            advanced = workflow.advance_to_next(user=request.user, reason=reason)
        except _hook_refusals() as exc:
            return _hook_refused(exc)
        if not advanced:
            return Response(
                {"error": "No next node available or workflow already completed"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from apps.audit.models import AuditAction, AuditLog

        AuditLog.objects.create(
            tenant=getattr(workflow, "tenant", None),
            user=request.user if request.user.is_authenticated else None,
            action=AuditAction.EXECUTE,
            resource="workflow.advance",
            resource_id=str(workflow.id),
            description=f"推进：{getattr(node, 'node_name', '-')} — {reason}"[:500],
            changes={
                "skipped_node": str(getattr(node, "id", "")) or None,
                "skipped_node_name": getattr(node, "node_name", None),
                "reason": reason,
                "advanced_to": str(workflow.current_node_id) if workflow.current_node_id else None,
            },
            ip_address=request.META.get("REMOTE_ADDR"),
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
        )
        return Response(ApprovalWorkflowSerializer(workflow, context={"request": request}).data)

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
        # Marks the node ESCALATED before moving on. Calling `advance_to_next`
        # here left it PENDING, so `get_next_node()` handed it straight back
        # and the audit row below recorded a skip that had not happened -- its
        # `skipped_node` and `advanced_to` were measured to be the same id.
        try:
            escalated = workflow.escalate_current_node(user=request.user, reason=reason)
        except EscalationRefusedError as exc:
            # 越级最多到终审那一站(用户 2026-10-29,审查 A):越过终审、或越级会让流程直接走完,400,什么都没写。
            return Response({"code": exc.code, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except _hook_refusals() as exc:
            # Escalating past the last stop ends the flow, and with it the merged cross-realm judgment (or the
            # judgment the flow decides): a refusal there rolls the escalation back.
            return _hook_refused(exc)
        if not escalated:
            return Response(
                {"error": "No pending node to escalate past"},
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
            ip_address=get_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
        )

        return Response(ApprovalWorkflowSerializer(workflow, context={"request": request}).data)

    @extend_schema(request=WorkflowNodeActionSerializer, responses=ApprovalWorkflowSerializer)
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
            code, extra = decision_codes.block_for(node, request.user)
            return Response({"error": "Node already processed", "code": code, **extra},
                            status=status.HTTP_400_BAD_REQUEST)

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
                        "code": "no_approver",
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
                    "code": decision_codes.block_for(node, request.user)[0],
                    "error": "Not the designated approver for this node",
                    "detail": "只有该节点指定的审批人可以审批；如需推进请使用越级推进（escalate）",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        if not workflow.is_current(node):
            # Only the stop the flow stands on (2026-10-18); a later stop waits its turn. After the identity
            # check: someone who is not this stop's approver is told so first.
            return Response({"error": "This is not the current step.", "code": "not_current"},
                            status=status.HTTP_409_CONFLICT)

        verdict = serializer.validated_data["verdict"]
        notes = serializer.validated_data.get("notes", "")

        from apps.workflow import cosign

        if node.cosigners_json and cosign.blocks_approval(node, request.user, verdict in ("PASSED", "CONFIRMED")):
            return Response(
                {"code": "cosigners_pending", "error": "Co-signatures are still owed.",
                 "detail": "被加签的人还没有全部签完,你的批准暂不能生效。"},
                status=status.HTTP_409_CONFLICT,
            )
        soul_reason = serializer.validated_data.get("rejection_reason_for_soul", "")

        # 转生申请:驳回必须附一段给灵魂看的理由(2026-09-17 用户决定)。节点 notes 是内部备注。
        from apps.soul_accounts import rebirth

        if rebirth.requires_reason_for_soul(workflow, verdict) and not soul_reason.strip():
            return Response(
                {
                    "code": "reason_required",
                    "error": "rejection_reason_for_soul is required",
                    "detail": "驳回转生申请必须填写给灵魂的驳回理由(rejection_reason_for_soul);内部备注写在 notes。",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 官员端 App 驳回必须写理由(`require_reason`,桌面端不传,行为不变)。
        # 转生申请的理由已由上面那道检查负责(给灵魂的那段)。
        if (
            serializer.validated_data["require_reason"]
            and verdict not in rebirth.PASSING_VERDICTS
            and not notes.strip()
            and not rebirth.requires_reason_for_soul(workflow, verdict)
        ):
            return Response(
                {"code": "reason_required", "error": "reason is required", "detail": "驳回必须写理由。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # 决定与给灵魂的理由同一事务(申请状态的同步也在这个事务里,见下)。
            with transaction.atomic():
                success = workflow.complete_node(node.id, verdict, notes, user=request.user)
                if success and rebirth.requires_reason_for_soul(workflow, verdict):
                    rebirth.record_reason_for_soul(workflow, soul_reason.strip())
                if success:
                    # The decision on the soul's timeline: same transaction as the decision, so a failed event
                    # row rolls the approval / rejection back and the real error reaches this request.
                    node.refresh_from_db()
                    WorkflowService.record_events(workflow, node=node)
                    if workflow.case_type == "REBIRTH_APPLICATION":
                        # The application's status follows the workflow in the SAME transaction (lock order:
                        # workflow, node, then application; see rebirth.sync_from_workflow).
                        rebirth.sync_from_workflow(workflow.pk)
        except _hook_refusals() as exc:
            # The last stop of a flow that merged a cross-realm judgment ends that judgment (第四十三批), and it
            # cannot end yet — a participating realm has not filled its sentence stop; or another end-of-flow hook
            # refused (`_hook_refusals`). Nothing was recorded.
            return _hook_refused(exc)
        except VerdictRefusedError as exc:
            # `complete_node` raises when the node declares
            # `required_verdicts` and this verdict is not in it (`verdict_not_accepted`), or for SKIPPED
            # (`skipped_not_a_verdict`). A 400 rather than a 500: the client sent a verdict this node does not
            # accept, and it can see which ones it does.
            return Response(
                {
                    "code": exc.code,
                    "error": "This node does not accept that verdict.",
                    "detail": str(exc),
                    "required_verdicts": node.required_verdicts,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if success:
            # Whoever the workflow moved on to hears about it (the timeline event was written above, in the
            # decision's transaction).
            node.refresh_from_db()
            WorkflowService.announce(workflow, node=node)
            return Response(ApprovalWorkflowSerializer(workflow, context={"request": request}).data)
        # `complete_node` now re-checks the node's status under a row lock, so
        # the common reason to land here is that another decision was recorded
        # between this request's guard and that lock. "Failed to complete node"
        # would leave the caller unable to tell a lost race from a bad request
        # -- and the whole point of the lock is that the loser must find out.
        node.refresh_from_db()
        if node.status != NodeStatus.PENDING:
            return Response(
                {
                    "code": "already_handled",
                    "handled_by": decision_codes.handled_by(node),
                    "error": "This node was already decided.",
                    "detail": (
                        f"Its verdict is {node.verdict or node.status}. Your "
                        f"decision was not recorded."
                    ),
                    "node_status": node.status,
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response({"error": "Failed to complete node"}, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(responses=WorkflowStatsSerializer)
    @action(detail=True, methods=["get"])
    def stats(self, request, pk=None):
        """
        Get workflow progress statistics.
        """
        workflow = self.get_object()
        stats = WorkflowService.get_workflow_stats(workflow)
        return Response(stats)

    # ── 第四十三批:选站 / 加减站 / 按默认流程走 / 再提醒一次 ────────────────
    #
    # Who may do each is decided per segment in `apps/workflow/segments.py` (its module docstring has the
    # table); a refusal there is `SegmentRefusedError`, answered with its own code and status and nothing written.

    def _segment_response(self, request, workflow_id):
        workflow = self.get_queryset().get(pk=workflow_id)
        return Response(ApprovalWorkflowSerializer(workflow, context={"request": request}).data)

    @extend_schema(parameters=[_SEGMENT_ORDER], request=WorkflowPickSerializer,
                   responses={200: ApprovalWorkflowSerializer, 400: OpenApiTypes.OBJECT, 403: OpenApiTypes.OBJECT,
                              404: OpenApiTypes.OBJECT, 409: OpenApiTypes.OBJECT})
    @action(detail=True, methods=["post"], url_path=r"segments/(?P<order>[0-9]+)/pick")
    def pick(self, request, pk=None, order=None):
        """A participating realm picks which of its stations run (or re-picks, until its segment starts).
        `version` is the segment's as loaded; another pick since then answers 409 `segment_changed`."""
        workflow = self.get_object()
        body = WorkflowPickSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            segments.pick(workflow.pk, int(order), request.user, skip_node_ids=body.validated_data["skip_node_ids"],
                          version=body.validated_data["version"], reason=body.validated_data["reason"],
                          request=request)
        except segments.SegmentRefusedError as refused:
            return _refused(refused)
        return self._segment_response(request, workflow.pk)

    @extend_schema(request=WorkflowAdjustSerializer,
                   responses={200: ApprovalWorkflowSerializer, 400: OpenApiTypes.OBJECT, 403: OpenApiTypes.OBJECT,
                              409: OpenApiTypes.OBJECT})
    @action(detail=True, methods=["post"])
    def adjust(self, request, pk=None):
        """加减站: restore skipped stations / skip pending ones of ONE segment, after the current stop; the final
        review stays. Reason required; audited; the affected stations' approvers are told."""
        workflow = self.get_object()
        body = WorkflowAdjustSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        try:
            segments.adjust(workflow.pk, request.user, restore_node_ids=data["restore_node_ids"],
                            skip_node_ids=data["skip_node_ids"], reason=data["reason"], version=data["version"],
                            request=request)
        except segments.SegmentRefusedError as refused:
            return _refused(refused)
        return self._segment_response(request, workflow.pk)

    @extend_schema(parameters=[_SEGMENT_ORDER], request=WorkflowReasonSerializer,
                   responses={200: ApprovalWorkflowSerializer, 400: OpenApiTypes.OBJECT, 403: OpenApiTypes.OBJECT,
                              404: OpenApiTypes.OBJECT, 409: OpenApiTypes.OBJECT})
    @action(detail=True, methods=["post"], url_path=r"segments/(?P<order>[0-9]+)/use-default")
    def use_default(self, request, pk=None, order=None):
        """按默认流程走: the convening hall's admin picks every station for a realm and the flow goes on — after
        `segments.OVERDUE_DAYS` days at its gate, or at once when that realm has nobody who can pick."""
        workflow = self.get_object()
        body = WorkflowReasonSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            segments.use_default(workflow.pk, int(order), request.user, body.validated_data["reason"],
                                 request=request)
        except segments.SegmentRefusedError as refused:
            return _refused(refused)
        except segments.CrossConclusionRefusedError as exc:
            return Response({"code": exc.code, "error": str(exc)}, status=status.HTTP_409_CONFLICT)
        return self._segment_response(request, workflow.pk)

    @extend_schema(parameters=[_SEGMENT_ORDER], request=None,
                   responses={200: WorkflowRemindSerializer, 403: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT,
                              409: OpenApiTypes.OBJECT, 429: OpenApiTypes.OBJECT})
    @action(detail=True, methods=["post"], url_path=r"segments/(?P<order>[0-9]+)/remind")
    def remind(self, request, pk=None, order=None):
        """再提醒一次: the convening hall reminds a realm that has not picked. Once an hour per segment
        (429 `remind_too_soon` with `retry_after` seconds)."""
        workflow = self.get_object()
        try:
            segment = segments.remind(workflow.pk, int(order), request.user, request=request)
        except segments.SegmentRefusedError as refused:
            return _refused(refused)
        return Response(WorkflowRemindSerializer({"order": segment.order, "reminded_at": segment.last_reminded_at}).data)

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
        if request.data.get("is_appeal") or case_type == "APPEAL":
            # An APPEAL flow built here had no appeal behind it, so finishing it did nothing (2026-10-29). Appeals
            # go up their flow from the soul's side (`apps/judgment/appeals.py::file(escalate=True)`).
            return Response(
                {"code": "appeal_not_from_judgment",
                 "error": "An appeal flow is opened by the soul's appeal, not from a judgment"},
                status=status.HTTP_400_BAD_REQUEST,
            )
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
                priority=priority,
            )
        except ValueError as e:
            return Response({"code": getattr(e, "code", "invalid_case_type"), "error": str(e)},
                            status=status.HTTP_400_BAD_REQUEST)

        if workflow:
            return Response(ApprovalWorkflowSerializer(workflow, context={"request": request}).data, status=status.HTTP_201_CREATED)
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
        qs = scope_to_tenant(qs, self.request, field="workflow__tenant")
        return DataScopeFilter.filter_queryset(self.request, qs, ApprovalNode)

    def perform_destroy(self, instance):
        """A started flow's stations are fixed (rbac-be1 H2); create / update are refused in the serializer."""
        refuse_started(instance.workflow, "stations")
        super().perform_destroy(instance)
