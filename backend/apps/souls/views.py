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
from apps.events.services import EventService
from apps.core.permissions import TenantPermission


class SoulViewSet(viewsets.ModelViewSet):
    """
    Soul CRUD + state transitions + record management.
    Tenant-isolated via TenantPermission + select_related for N+1 elimination.
    """
    permission_classes = [TenantPermission]
    queryset = Soul.objects.select_related("tenant").prefetch_related("records").all()
    filterset_fields = ["current_state", "tenant__code"]
    search_fields = ["name", "birth_name", "origin_location"]
    ordering_fields = ["created_at", "karmic_balance", "death_date"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        # Exclude records with null tenant (orphaned records)
        qs = qs.filter(tenant__isnull=False)
        if user.role == 'ADMIN':  # SYS_ADMIN bypasses
            return qs
        tenant = getattr(self.request, 'tenant', None)
        if tenant:
            return qs.filter(tenant=tenant)
        return qs.none()

    def get_serializer_class(self):
        if self.action == "list":
            return SoulListSerializer
        return SoulSerializer

    def perform_create(self, serializer):
        from apps.core.request_local import set_current_user, set_current_request, clear_current_user
        set_current_user(self.request.user)
        set_current_request(self.request)
        try:
            tenant = getattr(self.request, 'tenant', None)
            # Fall back to user's tenant if not set on request
            if not tenant:
                user = getattr(self.request, 'user', None)
                if user and getattr(user, 'tenant', None):
                    tenant = user.tenant
            soul = serializer.save()
            if tenant:
                soul.tenant = tenant
                soul.save(update_fields=['tenant'])
            EventService.log_soul_created(soul)
        finally:
            clear_current_user()

    def perform_update(self, serializer):
        from apps.core.request_local import set_current_user, set_current_request, clear_current_user
        set_current_user(self.request.user)
        set_current_request(self.request)
        try:
            super().perform_update(serializer)
        finally:
            clear_current_user()

    def perform_destroy(self, instance):
        from apps.core.request_local import set_current_user, set_current_request, clear_current_user
        set_current_user(self.request.user)
        set_current_request(self.request)
        try:
            super().perform_destroy(instance)
        finally:
            clear_current_user()

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
