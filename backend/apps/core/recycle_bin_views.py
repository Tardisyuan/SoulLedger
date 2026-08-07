"""
Global recycle bin API (Stage 4 §4.7) — one screen listing soft-deleted
parent rows across every registered entity type, with cascade-aware
restore and a hard-delete path for reference data past its retention
window. See apps.core.recycle_bin for the underlying registry and helpers.

Administrator-only: restoring or permanently destroying records that other
parts of the app believe are gone is exactly the kind of action this
codebase otherwise reserves for ADMIN (menu.manage, user.manage, ...), and
there is no scoped-down "restore only my tenant's souls" need described in
the design doc.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core import recycle_bin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import CodenameViewSetMixin


class RecycleBinViewSet(CodenameViewSetMixin, viewsets.ViewSet):
    """Not a ModelViewSet — the bin spans multiple models, so there is no
    single queryset to back one. list()/restore()/hard_delete() below each
    build their own response from apps.core.recycle_bin."""

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "recycle_bin"
    extra_permissions = {
        "list": ["recycle_bin.read"],
        "restore": ["recycle_bin.restore"],
        "hard_delete": ["recycle_bin.hard_delete"],
    }

    def list(self, request):
        """GET /api/v1/recycle-bin/ — every soft-deleted parent row, across
        every registered entity type, with its dependent count. ADMIN sees
        every tenant's rows (matching every other ADMIN-bypass list in this
        codebase); a non-ADMIN sees only their own tenant's."""
        user = request.user
        is_admin = getattr(user, "role", None) == "ADMIN"
        tenant = getattr(request, "tenant", None)
        entries = recycle_bin.list_bin_entries(tenant=tenant, is_admin=is_admin)
        return Response({"results": entries, "count": len(entries)})

    @action(detail=False, methods=["post"])
    def restore(self, request):
        """POST /api/v1/recycle-bin/restore/  body: {"cascade_id": "..."}

        Restores every row sharing that cascade id — the parent the user
        picked in the bin and every dependent cascaded alongside it at
        delete time. Not a per-row restore: the design doc is explicit that
        the bin must not let a user restore eight dependent rows
        independently of their parent.
        """
        cascade_id = request.data.get("cascade_id")
        if not cascade_id:
            return Response({"error": "cascade_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            restored = recycle_bin.restore_cascade(cascade_id)
        except (ValueError, TypeError):
            return Response({"error": "cascade_id is not a valid UUID"}, status=status.HTTP_400_BAD_REQUEST)
        if restored == 0:
            return Response(
                {"error": "No soft-deleted rows found for this cascade_id"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"restored": restored})

    @action(detail=False, methods=["post"], url_path="hard-delete")
    def hard_delete(self, request):
        """POST /api/v1/recycle-bin/hard-delete/  body: {"entity_type": "menu", "id": 3}

        Permanently removes a reference-data row past its 30-day retention
        window. Refuses (400, not a silent no-op) for anything else: a
        domain/judicial record, a type this bin doesn't know, a row that
        isn't actually deleted, or one still inside its window — the design
        doc's point that the bin should only ever contain things safe to
        destroy is enforced here, not just in the UI.
        """
        entity_type = request.data.get("entity_type")
        pk = request.data.get("id")
        if not entity_type or pk is None:
            return Response(
                {"error": "entity_type and id are required"}, status=status.HTTP_400_BAD_REQUEST
            )
        bin_type = recycle_bin.get_bin_type(entity_type)
        if bin_type is None:
            return Response({"error": f"Unknown entity_type: {entity_type}"}, status=status.HTTP_400_BAD_REQUEST)
        if bin_type.kind != "reference":
            return Response(
                {
                    "error": (
                        f"{entity_type} is a domain record, not reference data — it has no hard "
                        "delete path. Archive it if it has a concluded judgment, or restore it "
                        "if it was deleted in error."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not recycle_bin.hard_delete(entity_type, pk):
            return Response(
                {
                    "error": (
                        "Cannot hard-delete: row not found, not deleted, or still inside its "
                        f"{recycle_bin.REFERENCE_DATA_RETENTION_DAYS}-day retention window."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
