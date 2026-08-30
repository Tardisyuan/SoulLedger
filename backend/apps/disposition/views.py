"""
REST views for Disposition app.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.archive import DeletionNotAllowedError
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
        'archive': ['disposition.execute'],
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

        if not DispositionService.execute(disposition):
            # `execute` now returns False, and writes nothing, when the soul is
            # not in a state the disposition can act on. It used to return True
            # unconditionally after having already saved `is_executed` -- the
            # record said "executed" while the soul had not moved, and this
            # view answered 200.
            return Response(
                {
                    "error": "Soul is not in a state this disposition can act on",
                    "detail": (
                        f"当前状态 {disposition.soul.current_state} 不允许执行该处置；"
                        f"处置未被标记为已执行"
                    ),
                    "soul_state": disposition.soul.current_state,
                },
                status=status.HTTP_409_CONFLICT,
            )

        # Souls whose cosmology has a next life go on to be reborn. The call is
        # unconditional here on purpose: `ReincarnationService.execute` answers
        # False for the terminal cosmologies rather than this view holding a
        # second copy of that list. It used to write
        # REINCARNATION_TRIGGERED for every soul including those -- see its
        # docstring.
        from apps.reincarnation.services import ReincarnationService
        ReincarnationService.execute(disposition)

        return Response(DispositionSerializer(disposition).data)

    def destroy(self, request, *args, **kwargs):
        """Soft-delete a disposition, or refuse with a clear reason when
        it's tied to a concluded verdict (Stage 4 §4.7: archivable instead —
        in practice this is true of every Disposition, since one is only
        ever created once its Judgment has concluded)."""
        disposition = self.get_object()
        reason = request.data.get("reason", "") if hasattr(request, "data") else ""
        try:
            disposition.delete_or_raise(user=request.user, reason=reason)
        except DeletionNotAllowedError as exc:
            return Response(
                {"error": str(exc), "archivable": exc.archivable},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        """Archive a disposition tied to a concluded verdict. See
        Disposition.can_delete."""
        disposition = self.get_object()
        if disposition.can_delete:
            return Response(
                {"error": "This disposition has no concluded verdict; delete it instead of archiving."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reason = request.data.get("reason", "")
        disposition.archive(user=request.user, reason=reason)
        return Response(DispositionSerializer(disposition).data)
