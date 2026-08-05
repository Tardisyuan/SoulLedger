"""
REST views for dispatch app.
"""
from django.db import IntegrityError
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.actors.models import Actor
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.request_local import clear_current_user, set_current_request, set_current_user
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.dispatch.filters import DispatchFilter
from apps.dispatch.models import CrossTenantJudgment, DispatchRecord, DispatchStatus
from apps.dispatch.serializers import (
    CrossTenantJudgmentConcludeSerializer,
    CrossTenantJudgmentListSerializer,
    CrossTenantJudgmentParticipateSerializer,
    CrossTenantJudgmentSerializer,
    DispatchRecordListSerializer,
    DispatchRecordSerializer,
    DispatchRejectSerializer,
)
from apps.dispatch.services import CrossTenantJudgmentService, DispatchService
from apps.tenants.models import Tenant


class DispatchRecordViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    DispatchRecord CRUD + actions.
    """
    # CodenamePermission is what finally enforces the codenames below; before
    # it, PermissionMiddleware never saw self.action and they gated nothing.
    #
    # This is the largest move in the tranche, and it is JUDGE that carries it.
    # JUDGE holds no dispatch codename at all — not read, not manage, not any
    # of the three approval actions — so both viewsets close to it entirely,
    # the list included. VIEWER likewise. dispatch.manage is held by ADMIN,
    # MODERATOR and GUARDIAN; dispatch.approve/.reject/.execute by ADMIN and
    # MODERATOR only, so GUARDIAN keeps proposing and editing and loses the
    # three decisions.
    #
    # The two read moves (GET on this viewset and on CrossTenantJudgmentViewSet,
    # 200 -> 403 for JUDGE and VIEWER) are recorded in
    # apps/perm/test_matrix_snapshot.py::READ_MATRIX, not in the write
    # instrument — which is why the write instrument's prediction of 34 was
    # exact and still not the whole tranche. Note that adopting the unused
    # cross_judgment.* family, flagged as an open decision on the viewset
    # below, would reverse the JUDGE half of both read rows.
    #
    # KNOWN, MEASURED, AND NOT CLOSED BY THIS CHANGE: those three denials are
    # walkable around. `status` is writable on DispatchRecordSerializer and
    # partial_update maps to dispatch.manage, so GUARDIAN reaches APPROVED,
    # REJECTED and EXECUTED through PATCH, and the record it leaves is FALSE
    # rather than merely unauthorized: the soul's tenant FK never moves, so a
    # dispatch can read EXECUTED for a soul that never changed hands. PATCH
    # also skips the "only the target tenant may decide" guard, which is not a
    # codename at all, and skips the status state machine entirely.
    #
    # See the characterization tests in
    # backend/tests/test_perm_write_snapshot_outside_matrix.py. Closing any of
    # it — read-only `status`/`dispatched_by`, a narrower dispatch.manage, the
    # tenant guard on partial_update, the state machine on the model — is an
    # authorization or modelling decision and not this change's to take.
    # Enforced is not the same as safe here, and the tests say so out loud.
    permission_classes = [TenantPermission, CodenamePermission]
    # BINARY read / manage, plus the three named approval actions. The dict
    # defines dispatch.read and dispatch.manage as the pair, then
    # dispatch.approve / .reject / .execute on top; it has never had a
    # create/update/delete family, so those three generated codenames existed
    # nowhere. They map to dispatch.manage — the codename that was defined to
    # mean "may alter dispatch records" — leaving approve/reject/execute as
    # the separate privileges they were meant to be.
    permission_codename = "dispatch"
    extra_permissions = {
        'proposed': ['dispatch.read'],
        'history': ['dispatch.read'],
        'approve': ['dispatch.approve'],
        'reject': ['dispatch.reject'],
        'execute': ['dispatch.execute'],
        'create': ['dispatch.manage'],
        'update': ['dispatch.manage'],
        'partial_update': ['dispatch.manage'],
        'destroy': ['dispatch.manage'],
    }
    queryset = DispatchRecord.objects.select_related(
        "source_tenant", "target_tenant", "soul", "dispatched_by"
    ).all()
    filterset_class = DispatchFilter
    search_fields = DispatchFilter.search_fields
    ordering_fields = DispatchFilter.ordering_fields
    serializer_class = DispatchRecordSerializer

    def get_queryset(self):
        """Fresh queryset each call — avoids TenantManager stale class-attr filter.
        _base_manager is the *unfiltered* manager (all_objects is declared first
        on this model precisely so it takes that role), so reaching for it to
        dodge the contextvar issue also drops the soft-delete filter — deleted
        dispatch records kept appearing in the list. Exclude them explicitly
        rather than going back to `objects`, which would reintroduce the
        contextvar problem this override exists to solve."""
        return DispatchRecord._base_manager.filter(is_deleted=False).select_related(
            "source_tenant", "target_tenant", "soul", "dispatched_by"
        )

    def get_serializer_class(self):
        if self.action == "list":
            return DispatchRecordListSerializer
        return DispatchRecordSerializer

    def create(self, request, *args, **kwargs):
        """
        Route creation through DispatchService.propose() instead of the
        default ModelViewSet.create() -> serializer.save() path, so the
        business checks it runs (soul belongs to source_tenant, no active
        dispatch for the soul) are enforced before hitting the DB, and its
        side effects (dispatched_by/status/tenant set correctly, target-tenant
        notification, SoulEvent log) actually happen. dispatched_by and status
        are ignored if present in the request body — propose() always sets
        dispatched_by=request.user and status=PROPOSED, so they can't be
        spoofed via payload.

        The app-level "no active dispatch" check in propose() can't fully
        replace the DB's unique_active_dispatch constraint (models.py:86-91):
        two concurrent requests for the same soul can both pass the app-level
        check before either commits, so the DB constraint is still the source
        of truth. IntegrityError from that race is caught here and turned
        into the same 400 response as the ordinary duplicate case.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        set_current_user(request.user)
        set_current_request(request)
        try:
            dispatch_record = DispatchService.propose(
                validated.get("source_tenant"),
                validated.get("target_tenant"),
                validated.get("soul"),
                request.user,
                validated.get("reason", ""),
            )
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response(
                {"error": "An active dispatch already exists for this soul"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        finally:
            clear_current_user()

        output_serializer = DispatchRecordSerializer(dispatch_record)
        headers = self.get_success_headers(output_serializer.data)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    @action(detail=False, methods=["get"])
    def proposed(self, request):
        """
        Get pending proposals for the current tenant (as target).
        """
        tenant = getattr(request, "tenant", None)
        if not tenant:
            return Response({"error": "No tenant context"}, status=status.HTTP_400_BAD_REQUEST)

        # _base_manager (unfiltered) dodges the contextvar issue but also
        # drops the soft-delete filter — exclude deleted records explicitly.
        proposals = DispatchRecord._base_manager.filter(
            target_tenant=tenant,
            status=DispatchStatus.PROPOSED,
            is_deleted=False,
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

        # _base_manager (unfiltered) dodges the contextvar issue but also
        # drops the soft-delete filter — exclude deleted records explicitly.
        history = DispatchRecord._base_manager.filter(
            source_tenant=tenant,
            is_deleted=False,
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
    # CodenamePermission, on the cross_judgment family rather than dispatch.
    #
    # DECIDED (was an open decision through tranche 3): cross-tenant judgment
    # is a judgment activity — the same civilization that hears a soul's own
    # case should hear its cross-tenant one — so it moves to JUDGE rather than
    # staying with GUARDIAN's operational dispatch role. cross_judgment.read
    # and cross_judgment.create are held by the same three roles (ADMIN,
    # MODERATOR, JUDGE — see apps/perm/models.py), so this is a clean binary
    # swap: GUARDIAN loses cross-tenant judgments entirely, JUDGE gains full
    # access (view, participate, conclude), matching how it already reads and
    # decides on ordinary judgments. Both reads and writes moved together —
    # deliberately not split — because participate/conclude are the judgment
    # itself, not an administrative action layered on top of one.
    #
    # There is no cross_judgment.update/delete/participate/conclude codename,
    # only read/create, so every write action maps to create — the same shape
    # DispatchRecordViewSet uses for dispatch.manage. Because read and every
    # write share one codename here (as they did on dispatch.manage before),
    # this viewset still cannot exhibit the narrow-action/wide-CRUD bypass
    # found on its sibling: there is no narrower codename for PATCH to route
    # around. CrossTenantJudgmentSerializer does leave `status` and
    # `conclusion_type` writable, but since `conclude` and PATCH require the
    # same codename, reaching the same row via PATCH costs nothing beyond what
    # `conclude` already permits.
    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "cross_judgment"
    extra_permissions = {
        'participate': ['cross_judgment.create'],
        'conclude': ['cross_judgment.create'],
        'create': ['cross_judgment.create'],
        'update': ['cross_judgment.create'],
        'partial_update': ['cross_judgment.create'],
        'destroy': ['cross_judgment.create'],
    }
    queryset = CrossTenantJudgment.objects.select_related(
        "initiating_tenant"
    ).prefetch_related("participants").all()
    serializer_class = CrossTenantJudgmentSerializer
    filterset_class = None  # Cross-tenant queries use Q-filter expansion, not standard filtering
    ordering_fields = ["create_time", "status"]
    # pagination_class = None  # Removed: paginate to prevent large payloads

    def get_serializer_class(self):
        if self.action == "list":
            return CrossTenantJudgmentListSerializer
        return CrossTenantJudgmentSerializer

    def get_queryset(self):
        # Design decision: CrossTenantJudgment records are accessible to both
        # the initiating tenant and participating tenants. DataScopeViewSetMixin
        # applies tenant isolation via qs.filter(tenant=tenant) as a baseline.
        # We then expand the queryset via Q-filter to include records where the
        # current tenant is either the initiator or a participant. This is
        # intentional for cross-tenant records that need broader access.
        from django.db.models import Q
        # Fresh queryset each call — avoids TenantManager stale class-attr filter.
        # _base_manager is the *unfiltered* manager (all_objects is declared
        # first on this model precisely so it takes that role), so reaching
        # for it to dodge the contextvar issue also drops the soft-delete
        # filter — exclude deleted records explicitly rather than going back
        # to `objects`, which would reintroduce the contextvar problem this
        # override exists to solve.
        qs = CrossTenantJudgment._base_manager.filter(is_deleted=False).select_related(
            "initiating_tenant"
        ).prefetch_related("participants")
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

        tenant = Tenant.objects.filter(id=tenant_id).first()
        if not tenant:
            return Response({"error": "Tenant not found"}, status=status.HTTP_404_NOT_FOUND)

        actor = None
        if actor_id:
            actor_qs = Actor.objects.filter(id=actor_id).select_related("realm")
            if getattr(request.user, 'role', None) != 'ADMIN' and request_tenant:
                actor_qs = actor_qs.filter(tenant=request_tenant)
            actor = actor_qs.first()

        try:
            CrossTenantJudgmentService.add_participant(
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
