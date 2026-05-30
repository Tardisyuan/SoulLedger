"""
REST views for dispatch app.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from apps.dispatch.models import DispatchRecord, CrossTenantJudgment, CrossTenantJudgmentParticipant, DispatchStatus
from apps.dispatch.serializers import (
    DispatchRecordSerializer,
    DispatchRecordListSerializer,
    DispatchProposeSerializer,
    DispatchApproveSerializer,
    DispatchRejectSerializer,
    DispatchExecuteSerializer,
    CrossTenantJudgmentSerializer,
    CrossTenantJudgmentListSerializer,
    CrossTenantJudgmentCreateSerializer,
    CrossTenantJudgmentParticipateSerializer,
    CrossTenantJudgmentConcludeSerializer,
)
from apps.dispatch.services import DispatchService, CrossTenantJudgmentService
from apps.tenants.models import Tenant
from apps.souls.models import Soul
from apps.actors.models import Actor
from apps.core.permissions import TenantPermission
from apps.core.mixins import TenantCreateMixin
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin


class DispatchRecordViewSet(CodenameViewSetMixin, AuditUserViewSetMixin, TenantCreateMixin, viewsets.ModelViewSet):
    """
    DispatchRecord CRUD + actions.
    """
    permission_classes = [TenantPermission]
    permission_codename = "dispatch"
    extra_permissions = {
        'proposed': ['dispatch.read'],
        'history': ['dispatch.read'],
        'approve': ['dispatch.approve'],
        'reject': ['dispatch.reject'],
        'execute': ['dispatch.execute'],
    }
    queryset = DispatchRecord.objects.select_related(
        "source_tenant", "target_tenant", "soul", "dispatched_by"
    ).all()
    serializer_class = DispatchRecordSerializer
    ordering_fields = ["proposed_at", "status"]
    pagination_class = None

    def get_serializer_class(self):
        if self.action == "list":
            return DispatchRecordListSerializer
        return DispatchRecordSerializer

    def get_queryset(self):
        from django.db.models import Q
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if user.role == "ADMIN":
            return qs
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            return qs.filter(Q(source_tenant=tenant) | Q(target_tenant=tenant))
        return qs.none()

    @action(detail=False, methods=["get"])
    def proposed(self, request):
        """
        Get pending proposals for the current tenant (as target).
        """
        tenant = getattr(request, "tenant", None)
        if not tenant:
            return Response({"error": "No tenant context"}, status=status.HTTP_400_BAD_REQUEST)

        proposals = DispatchRecord.objects.filter(
            target_tenant=tenant,
            status=DispatchStatus.PROPOSED
        ).select_related("source_tenant", "soul", "dispatched_by")

        serializer = DispatchRecordListSerializer(proposals, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"])
    def history(self, request):
        """
        Get dispatch history for the current tenant.
        """
        tenant = getattr(request, "tenant", None)
        if not tenant:
            return Response({"error": "No tenant context"}, status=status.HTTP_400_BAD_REQUEST)

        history = DispatchRecord.objects.filter(
            source_tenant=tenant
        ).select_related("target_tenant", "soul").order_by("-proposed_at")

        serializer = DispatchRecordListSerializer(history, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """
        Approve a proposed dispatch.
        """
        dispatch_record = self.get_object()
        # S-M2: Verify tenant is involved in this dispatch
        if dispatch_record.source_tenant != request.tenant and dispatch_record.target_tenant != request.tenant:
            return Response({"error": "Not authorized to modify this dispatch"}, status=403)
        # S-H2: Only target tenant can approve
        if dispatch_record.target_tenant != request.tenant:
            return Response({"error": "Only target tenant can approve dispatch"}, status=403)
        approver = request.user

        try:
            dispatch_record = DispatchService.approve(dispatch_record, approver)
            return Response(DispatchRecordSerializer(dispatch_record).data)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        """
        Reject a proposed dispatch.
        """
        dispatch_record = self.get_object()
        # S-M2: Verify tenant is involved in this dispatch
        if dispatch_record.source_tenant != request.tenant and dispatch_record.target_tenant != request.tenant:
            return Response({"error": "Not authorized to modify this dispatch"}, status=403)
        serializer = DispatchRejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rejector = request.user
        reason = serializer.validated_data.get("reason", "")

        try:
            dispatch_record = DispatchService.reject(dispatch_record, rejector, reason)
            return Response(DispatchRecordSerializer(dispatch_record).data)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def execute(self, request, pk=None):
        """
        Execute an approved dispatch.
        """
        dispatch_record = self.get_object()
        # S-C1: Verify executor is from target tenant
        if dispatch_record.target_tenant != request.tenant:
            return Response({"error": "Only target tenant can execute dispatch"}, status=403)
        executor = request.user

        try:
            dispatch_record = DispatchService.execute(dispatch_record, executor)
            return Response(DispatchRecordSerializer(dispatch_record).data)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class CrossTenantJudgmentViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ModelViewSet):
    """
    CrossTenantJudgment CRUD + actions.
    """
    permission_classes = [TenantPermission]
    permission_codename = "dispatch"
    extra_permissions = {
        'participate': ['dispatch.participate'],
        'conclude': ['dispatch.conclude'],
    }
    queryset = CrossTenantJudgment.objects.select_related(
        "initiating_tenant"
    ).prefetch_related("participants").all()
    serializer_class = CrossTenantJudgmentSerializer
    ordering_fields = ["create_time", "status"]
    pagination_class = None

    def get_serializer_class(self):
        if self.action == "list":
            return CrossTenantJudgmentListSerializer
        return CrossTenantJudgmentSerializer

    def get_queryset(self):
        from django.db.models import Q
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if user.role == "ADMIN":
            return qs
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            return qs.filter(Q(initiating_tenant=tenant) | Q(participants__participant_tenant=tenant))
        return qs.none()

    def perform_create(self, serializer):
        serializer.save(tenant=getattr(self.request, "tenant", None))

    @action(detail=True, methods=["post"])
    def participate(self, request, pk=None):
        """
        Join as a participant in a cross-tenant judgment.
        """
        judgment = self.get_object()

        # Verify user's tenant is involved (initiating or already a participant)
        request_tenant = getattr(request, 'tenant', None)
        if not request_tenant:
            return Response({"error": "Tenant context required"}, status=status.HTTP_403_FORBIDDEN)
        is_initiating = judgment.initiating_tenant_id == request_tenant.pk
        is_participant = judgment.participants.filter(participant_tenant=request_tenant).exists()
        if not is_initiating and not is_participant:
            return Response({"error": "Not authorized to add participants"}, status=status.HTTP_403_FORBIDDEN)

        serializer = CrossTenantJudgmentParticipateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        tenant_id = serializer.validated_data["participant_tenant"]
        actor_id = serializer.validated_data.get("participant_actor")
        role = serializer.validated_data["role"]

        tenant = Tenant.objects.filter(id=tenant_id).select_related("realm").first()
        if not tenant:
            return Response({"error": "Tenant not found"}, status=status.HTTP_404_NOT_FOUND)

        actor = None
        if actor_id:
            actor_qs = Actor.objects.filter(id=actor_id).select_related("realm")
            if getattr(request.user, 'role', None) != 'ADMIN' and request_tenant:
                actor_qs = actor_qs.filter(tenant=request_tenant)
            actor = actor_qs.first()

        try:
            participant = CrossTenantJudgmentService.add_participant(
                judgment, tenant, actor, role
            )
            # Activate judgment if it was proposed
            if judgment.status == "PROPOSED":
                CrossTenantJudgmentService.activate(judgment)
                judgment.refresh_from_db()

            return Response(CrossTenantJudgmentSerializer(judgment).data)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def conclude(self, request, pk=None):
        """
        Conclude a cross-tenant judgment.
        """
        judgment = self.get_object()

        # Verify user's tenant is involved (initiating or a participant)
        request_tenant = getattr(request, 'tenant', None)
        if not request_tenant:
            return Response({"error": "Tenant context required"}, status=status.HTTP_403_FORBIDDEN)
        is_initiating = judgment.initiating_tenant_id == request_tenant.pk
        is_participant = judgment.participants.filter(participant_tenant=request_tenant).exists()
        if not is_initiating and not is_participant:
            return Response({"error": "Not authorized to conclude this judgment"}, status=status.HTTP_403_FORBIDDEN)

        serializer = CrossTenantJudgmentConcludeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        conclusion_type = serializer.validated_data["conclusion_type"]

        try:
            judgment = CrossTenantJudgmentService.conclude(
                judgment, conclusion_type, request.user
            )
            return Response(CrossTenantJudgmentSerializer(judgment).data)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)