"""
REST views for Organization app.
"""
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantCreateMixin, TenantQuerySetMixin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin
from apps.org.models import Organization
from apps.org.serializers import OrganizationSerializer


class OrganizationViewSet(
    CodenameViewSetMixin, TenantQuerySetMixin, TenantCreateMixin, AuditUserViewSetMixin, viewsets.ModelViewSet
):
    """
    Organization CRUD.

    Both blockers a previous pass on this file recorded — no codename family,
    no `tenant` field — are resolved as of this change:

    1. Gated now via `CodenameViewSetMixin`: reads (`list`/`retrieve`) resolve
       to `org.read`, held by all five roles; writes (`create`/`update`/
       `partial_update`/`destroy`) are remapped through `extra_permissions` to
       `org.manage`, held by ADMIN and MODERATOR only. `CodenamePermission` is
       added to `permission_classes` alongside `TenantPermission` — the two
       answer different questions ("may this role do this at all" vs. "in this
       tenant") and both must hold, same pairing as every other enforced
       viewset.
    2. `Organization` now carries a `tenant` FK (nullable, backfilled from
       `category` via the same CIV_TO_TENANT mapping
       `apps/tenants/management/commands/migrate_to_multitenant.py` uses for
       other models — see apps/org/models.py and the org migrations). With the
       field present, `TenantQuerySetMixin.get_queryset()`'s `hasattr` guard no
       longer skips filtering, so non-ADMIN roles are scoped to their own
       tenant's org tree like everywhere else. `TenantCreateMixin` is added so
       new orgs are stamped with the creator's tenant on `create()` — same
       pairing as JudgmentViewSet/WorkflowTemplateViewSet — otherwise a freshly
       created org would land with `tenant=None` and be invisible to its own
       creator's next `list()`.
    """
    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "org"
    extra_permissions = {
        "create": ["org.manage"],
        "update": ["org.manage"],
        "partial_update": ["org.manage"],
        "destroy": ["org.manage"],
        # `tree` is a read — same codename as list/retrieve. Without this
        # entry, CodenameViewSetMixin's fallback for an action absent from
        # both extra_permissions and ACTION_PERM_MAP synthesizes "org.tree",
        # a codename nothing declares or grants — orphaned, and caught
        # project-wide by apps/perm/test_codename_coverage.py.
        "tree": ["org.read"],
    }
    queryset = Organization.objects.all()
    serializer_class = OrganizationSerializer

    @action(detail=False, methods=["get"])
    def tree(self, request):
        """Return organization hierarchy as a tree."""
        orgs = self.get_queryset()
        roots = orgs.filter(parent__isnull=True)
        return Response(OrganizationSerializer(roots, many=True).data)
