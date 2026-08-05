"""
REST views for Disposition app.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantQuerySetMixin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.disposition.models import Disposition
from apps.disposition.serializers import DispositionExecuteSerializer, DispositionSerializer
from apps.disposition.services import DispositionService


class DispositionViewSet(CodenameViewSetMixin, TenantQuerySetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Disposition CRUD + execute action.
    Tenant-isolated via TenantPermission.
    """
    # CodenamePermission is what finally enforces the codenames below; before
    # it, PermissionMiddleware never saw self.action and they gated nothing.
    # The binary shape below is what makes the change here uneven: `read` is
    # held by four of five roles so only VIEWER loses the list, while `execute`
    # is held by two, so JUDGE and GUARDIAN lose the writes they had. That is
    # the declared policy, not a side effect of attaching this class.
    permission_classes = [TenantPermission, CodenamePermission]
    # BINARY: read / execute. ROLE_PERMISSIONS defines exactly those two —
    # read for ADMIN, JUDGE, GUARDIAN and MODERATOR; execute for ADMIN and
    # MODERATOR — and there is no disposition.manage. The viewset is a
    # ModelViewSet, so the mixin was also generating disposition.create,
    # .update and .delete, which exist nowhere and are held by nobody.
    #
    # Those three writes map to disposition.execute, this module's only write
    # verb. Carrying out a disposition and authoring one are the same
    # privilege here in practice, and no third codename can be introduced
    # without seeding and granting it.
    permission_codename = "disposition"
    extra_permissions = {
        'execute': ['disposition.execute'],
        'create': ['disposition.execute'],
        'update': ['disposition.execute'],
        'partial_update': ['disposition.execute'],
        'destroy': ['disposition.execute'],
    }
    queryset = Disposition.objects.select_related(
        "soul", "soul__tenant", "destination_realm", "tenant"
    ).all()
    serializer_class = DispositionSerializer
    filterset_fields = ["soul", "is_executed", "is_eternal", "memory_reset"]
    ordering_fields = ["created_at", "executed_at"]

    @action(detail=True, methods=["post"])
    def execute(self, request, pk=None):
        """
        Execute a disposition: mark executed, transition soul to REINCARNATING.
        POST /disposition/{id}/execute/
        """
        disposition = self.get_object()
        if disposition.is_executed:
            return Response({"error": "Already executed"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = DispositionExecuteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        DispositionService.execute(disposition)

        # Also trigger ReincarnationService.execute
        from apps.reincarnation.services import ReincarnationService
        ReincarnationService.execute(disposition)

        return Response(DispositionSerializer(disposition).data)
