"""
REST views for Soul app.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from apps.souls.models import Soul, SoulState
from apps.souls.serializers import (
    SoulSerializer, SoulListSerializer, SoulTransitionSerializer, SoulRecordSerializer
)
from apps.karma.services import KarmaService
from apps.core.permissions import TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin


class SoulViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Soul CRUD + state transitions + record management.
    Tenant-isolated via TenantPermission + select_related for N+1 elimination.
    """
    permission_classes = [TenantPermission]
    permission_codename = "soul"
    extra_permissions = {
        'die': ['soul.die'],
        'transition': ['soul.transition'],
        'karma': ['soul.read'],
        'add_record': ['soul.update'],
        'records': ['soul.read'],
    }
    queryset = Soul.objects.select_related("tenant").prefetch_related("records").all()
    filterset_fields = ["current_state", "tenant__code"]
    search_fields = ["name", "birth_name", "origin_location"]
    ordering_fields = ["name", "created_at", "death_date"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        # Exclude records with null tenant (orphaned records)
        qs = qs.filter(tenant__isnull=False)
        if user.role == 'ADMIN':  # SYS_ADMIN bypasses
            pass
        else:
            tenant = getattr(self.request, 'tenant', None)
            if tenant:
                qs = qs.filter(tenant=tenant)
            else:
                return qs.none()

        # Custom filtering via query params
        params = self.request.query_params

        # civilization filter (mapped from tenant code)
        civilization = params.get('civilization')
        if civilization:
            tenant_mapping = {
                'CHINESE': 'CN_DIYU',
                'EUROPEAN': 'EU_HEAVEN_HELL',
                'EGYPTIAN': 'EG_DUAT',
            }
            tenant_code = tenant_mapping.get(civilization)
            if tenant_code:
                qs = qs.filter(tenant__code=tenant_code)

        # state filter (maps to current_state)
        state = params.get('state')
        if state:
            qs = qs.filter(current_state=state)

        # karma range filters and karma ordering - annotate _karmic_balance when needed
        karma_min = params.get('karma_min')
        karma_max = params.get('karma_max')
        ordering = params.get('ordering', '').strip()
        needs_karma_annotation = (
            karma_min is not None or karma_max is not None or
            ordering in ('karmic_balance', '-karmic_balance')
        )
        if needs_karma_annotation:
            from django.db.models import F, ExpressionWrapper, IntegerField
            karma_expr = ExpressionWrapper(F('merit_score') - F('demerit_score'), output_field=IntegerField())
            qs = qs.annotate(_karmic_balance=karma_expr)
            if karma_min is not None:
                try:
                    qs = qs.filter(_karmic_balance__gte=int(karma_min))
                except ValueError:
                    pass
            if karma_max is not None:
                try:
                    qs = qs.filter(_karmic_balance__lte=int(karma_max))
                except ValueError:
                    pass
            # Apply karma ordering directly since DRF ordering runs after get_queryset returns
            if ordering in ('karmic_balance', '-karmic_balance'):
                qs = qs.order_by('_karmic_balance' if ordering == 'karmic_balance' else '-_karmic_balance')
                # Clear the filter's ordering to avoid double-ordering
                self._skip_filter_ordering = True

        return qs

    def filter_queryset(self, queryset):
        """Skip ordering if we already applied karma ordering in get_queryset."""
        if getattr(self, '_skip_filter_ordering', False):
            self._skip_filter_ordering = False
            return queryset
        return super().filter_queryset(queryset)

    def get_serializer_class(self):
        if self.action == "list":
            return SoulListSerializer
        return SoulSerializer

    @action(detail=True, methods=["post"])
    def die(self, request, pk=None):
        """Mark soul as dead and begin judgment."""
        soul = self.get_object()
        if soul.current_state != SoulState.ALIVE:
            return Response(
                {"error": f"Cannot die: soul is already {soul.current_state}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        location = request.data.get("location", "")
        death_date = request.data.get("death_date")
        success = soul.die(death_date=death_date, location=location)
        if success:
            return Response(SoulSerializer(soul).data)
        return Response({"error": "Transition failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """Manually trigger a state transition."""
        soul = self.get_object()
        serializer = SoulTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_state = serializer.validated_data["new_state"]
        reason = serializer.validated_data.get("reason", "")

        if not soul.can_transition_to(new_state):
            return Response(
                {"error": f"Invalid transition from {soul.current_state} to {new_state}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        soul.transition_to(new_state, reason)
        return Response(SoulSerializer(soul).data)

    @action(detail=True, methods=["get"])
    def karma(self, request, pk=None):
        """Get full karma summary for a soul."""
        soul = self.get_object()
        summary = KarmaService.get_karmic_summary(soul)
        return Response(summary)

    @action(detail=True, methods=["post"])
    def add_record(self, request, pk=None):
        """Add a merit or demerit record to a soul."""
        soul = self.get_object()
        serializer = SoulRecordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        record = serializer.save(soul=soul)
        return Response(SoulRecordSerializer(record).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def records(self, request, pk=None):
        """List all records for a soul."""
        soul = self.get_object()
        records = soul.records.all()
        serializer = SoulRecordSerializer(records, many=True)
        return Response(serializer.data)
