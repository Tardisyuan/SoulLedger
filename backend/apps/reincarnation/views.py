"""
REST views for Reincarnation app.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from apps.reincarnation.models import Reincarnation
from apps.reincarnation.serializers import ReincarnationSerializer
from apps.core.permissions import TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin


class ReincarnationViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ModelViewSet):
    queryset = Reincarnation.objects.all()
    serializer_class = ReincarnationSerializer
    permission_classes = [TenantPermission]
    permission_codename = "reincarnation"
    extra_permissions = {
        'complete': ['reincarnation.complete'],
        'reborn': ['reincarnation.reborn'],
    }
    filterset_fields = ["soul", "rebirth_form", "cycle_count"]
    ordering_fields = ["reincarnated_at", "cycle_count"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if user.role == 'ADMIN':
            return qs
        tenant = getattr(self.request, 'tenant', None)
        if tenant:
            return qs.filter(tenant=tenant)
        return qs.none()

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """
        Complete a reincarnation — create rebirth record, reset soul to ALIVE.
        POST /reincarnation/{id}/complete/
        Body: { "new_identity": "...", "rebirth_form": "HUMAN", "notes": "..." }
        """
        reincarnation = self.get_object()
        soul = reincarnation.soul

        from apps.reincarnation.services import ReincarnationService
        disposition = reincarnation.disposition

        new_identity = request.data.get("new_identity", reincarnation.new_identity)
        rebirth_form = request.data.get("rebirth_form", reincarnation.rebirth_form)
        notes = request.data.get("notes", "")

        # If soul not in REINCARNATING, force it
        from apps.souls.models import SoulState
        if soul.current_state == SoulState.DISPOSED:
            soul.current_state = SoulState.REINCARNATING
            soul.save()

        updated = ReincarnationService.complete_rebirth(
            soul=soul,
            disposition=disposition,
            new_identity=new_identity,
            rebirth_form=rebirth_form,
            notes=notes,
        )

        # Refresh reincarnation record
        reincarnation.refresh_from_db()
        return Response(ReincarnationSerializer(reincarnation).data)

    @action(detail=False, methods=["post"])
    def reborn(self, request):
        """
        Create a new reincarnation for a soul and immediately complete it.
        POST /reincarnation/reborn/
        Body: { "soul_id": "...", "disposition_id": "...", "new_identity": "...", "rebirth_form": "HUMAN" }
        """
        from apps.souls.models import Soul, SoulState
        from apps.disposition.models import Disposition
        from apps.reincarnation.services import ReincarnationService

        soul_id = request.data.get("soul_id")
        disposition_id = request.data.get("disposition_id")
        new_identity = request.data.get("new_identity", "")
        rebirth_form = request.data.get("rebirth_form", "HUMAN")

        # Tenant-isolated: filter soul by tenant (ADMIN bypasses)
        user_tenant = getattr(request, "tenant", None)
        soul_qs = Soul.objects.all()
        if getattr(request.user, 'role', None) != 'ADMIN' and user_tenant:
            soul_qs = soul_qs.filter(tenant=user_tenant)

        try:
            soul = soul_qs.get(id=soul_id)
        except Soul.DoesNotExist:
            return Response(
                {"error": "NOT_FOUND", "message": "Soul not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        disposition = None
        if disposition_id:
            disp_qs = Disposition.objects.all()
            if getattr(request.user, 'role', None) != 'ADMIN' and user_tenant:
                disp_qs = disp_qs.filter(tenant=user_tenant)
            try:
                disposition = disp_qs.get(id=disposition_id)
            except Disposition.DoesNotExist:
                return Response(
                    {"error": "NOT_FOUND", "message": "Disposition not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        # Ensure soul is in REINCARNATING state
        if soul.current_state == SoulState.DISPOSED:
            soul.current_state = SoulState.REINCARNATING
            soul.save()
        elif soul.current_state != SoulState.REINCARNATING:
            return Response(
                {"error": "BAD_REQUEST", "message": f"Cannot reborn: soul is {soul.current_state}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reincarnation = ReincarnationService.complete_rebirth(
            soul=soul,
            disposition=disposition,
            new_identity=new_identity,
            rebirth_form=rebirth_form,
        )

        return Response(ReincarnationSerializer(reincarnation).data, status=status.HTTP_201_CREATED)
