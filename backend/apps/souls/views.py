"""
REST views for Soul app.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.karma.services import KarmaService
from apps.souls.filters import SoulFilter
from apps.souls.models import Soul, SoulState
from apps.souls.serializers import SoulListSerializer, SoulRecordSerializer, SoulSerializer, SoulTransitionSerializer


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
    filterset_class = SoulFilter
    search_fields = SoulFilter.search_fields
    ordering_fields = SoulFilter.ordering_fields

    def get_queryset(self):
        """
        Build queryset with filtering from query params.
        Tenant isolation is handled by DataScopeViewSetMixin (via super()).
        FilterSet handles search, filters, and ordering.
        """
        qs = super().get_queryset()
        qs = qs.exclude_orphaned()

        # Karma ordering (applied here since DRF ordering runs after get_queryset)
        ordering = self.request.query_params.get('ordering', '').strip()
        if ordering in ('karmic_balance', '-karmic_balance'):
            qs = qs.order_by_karma(descending=ordering.startswith('-'))
            self._skip_filter_ordering = True

        return qs

    def filter_queryset(self, queryset):
        """Apply FilterSet filtering, skip DRF ordering if karma ordering already applied."""
        # Apply FilterSet filtering (search, filters, etc.)
        qs = super().filter_queryset(queryset)
        # Skip DRF ordering if karma ordering already applied
        if getattr(self, '_skip_filter_ordering', False):
            self._skip_filter_ordering = False
            return qs
        return qs

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
