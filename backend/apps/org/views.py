"""
REST views for Organization app.
"""
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantCreateMixin, TenantQuerySetMixin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin
from apps.org.models import Organization
from apps.org.serializers import OrganizationSerializer


# The docstring below is published verbatim as the description of all six
# `/api/v1/organizations/` operations, so it names only files that exist.
#
# It used to cite `apps/tenants/management/commands/migrate_to_multitenant.py`
# as the authority on the civilization->tenant backfill. That command was
# deleted on 2026-09-03: it read `Soul.civilization`, which
# `souls/0004_remove_soul_civilization` dropped on 2026-05-08, so it could not
# run against any database this repository produces. It also kept a
# hand-written three-key tenant dict next to the imported four-key
# `CIVILIZATION_TENANT`, so it would have raised `KeyError: 'GR_HADES'` on the
# fourth iteration even with the field restored -- and it had no
# `transaction.atomic`, so it would have committed three civilizations' worth
# of updates before doing so.
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
       `category` through the civilization→tenant mapping that
       `apps/souls/models.py::CIVILIZATION_TENANT` defines and
       `apps/org/migrations/0004_backfill_organization_tenant.py` applies).
       With the
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

    @extend_schema(responses=OrganizationSerializer(many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def tree(self, request):
        """Return organization hierarchy as a tree."""
        orgs = self.get_queryset()
        roots = orgs.filter(parent__isnull=True)
        return Response(OrganizationSerializer(roots, many=True).data)
