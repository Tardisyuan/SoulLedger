"""
REST views for Organization app.
"""
from django.db import transaction
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
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

    def get_queryset(self):
        """殿级隔离之后再按数据范围收窄(资源 `org`,数据范围 B4):本机构 / 及下级 / 自定义机构;范围外 404。"""
        from apps.perm.filters import DataScopeFilter

        return DataScopeFilter.filter_queryset(self.request, super().get_queryset(), Organization)

    @extend_schema(responses=OrganizationSerializer(many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def tree(self, request):
        """Return organization hierarchy as a tree."""
        orgs = self.get_queryset()
        # Tops of what the caller sees: the hall root, or — in a narrowed data scope — each visible unit whose parent is not.
        roots = orgs.exclude(parent__in=orgs)
        return Response(OrganizationSerializer(roots, many=True).data)

    def perform_update(self, serializer):
        """`Organization.save()` only recomputes the unit's own `level`; a move
        has to carry the whole subtree's depth with it."""
        with transaction.atomic():
            super().perform_update(serializer)
            org = serializer.instance
            for child in org.get_children_recursive()[1:]:
                child.level = child.parent.level + 1
                child.save(update_fields=["level"])

    @extend_schema(parameters=[OpenApiParameter(
        "move_to", OpenApiTypes.INT, OpenApiParameter.QUERY, required=False,
        description="Move the unit's souls and judgments to this unit (same hall, in your data scope) first.",
    )])
    def destroy(self, request, *args, **kwargs):
        """Refuse to delete a unit that still has sub-units or people, and say
        how many -- `parent` is SET_NULL, so deleting would silently turn the
        sub-units into roots and strip the people of their unit.

        名下的灵魂 / 审判(数据范围,owner_org 是 PROTECT)同样拦下;`?move_to=<机构 id>` 先把它们
        (连回收站里的)转到同殿、在操作人数据范围内的另一个机构,再删,一个事务(B3a)。子机构与人员不随 move_to 走。"""
        org = self.get_object()
        units = org.children.count()
        people = org.users.exclude(role="SOUL").count()
        souls = org.owned_souls.filter(is_deleted=False).count()
        judgments = org.owned_judgments.filter(is_deleted=False).count()
        move_to = request.query_params.get("move_to")
        if units or people or ((souls or judgments) and not move_to):
            return Response(
                {"code": "not_empty", "error": "Move its sub-units, people, souls and judgments first.",
                 "units": units, "people": people, "souls": souls, "judgments": judgments},
                status=status.HTTP_409_CONFLICT,
            )
        if move_to:
            target = self._move_target(request, org, move_to)
            with transaction.atomic():
                self._move_owned(request, org, target)
                return super().destroy(request, *args, **kwargs)
        return super().destroy(request, *args, **kwargs)

    def _move_target(self, request, org, raw):
        from rest_framework.exceptions import ValidationError

        from apps.perm import data_scope

        try:
            target = self.get_queryset().filter(pk=int(raw), tenant_id=org.tenant_id).exclude(pk=org.pk).first()
        except (TypeError, ValueError):
            target = None
        if target is None:
            raise ValidationError({"move_to": ["No such unit in this hall."]}, code="invalid_move_to")
        cache = data_scope.request_cache(request)
        for resource in ("soul", "judgment"):
            ids = data_scope.org_ids(request.user, resource, cache)
            if ids is not None and target.pk not in ids:
                raise ValidationError({"move_to": ["This unit is outside your data scope."]}, code="out_of_scope")
        return target

    @staticmethod
    def _move_owned(request, org, target) -> None:
        """名下的灵魂 / 审判整批改归属(连软删的,免得还原后指着已删的机构);审计一行记数。"""
        from apps.audit.models import AuditAction, AuditLog
        from apps.core.client_ip import get_client_ip
        from apps.judgment.models import Judgment
        from apps.souls.models import Soul

        souls = Soul.all_objects.filter(owner_org=org).update(owner_org=target)
        judgments = Judgment.all_objects.filter(owner_org=org).update(owner_org=target)
        if souls or judgments:
            AuditLog.objects.create(
                tenant_id=org.tenant_id, user=request.user, action=AuditAction.BATCH_UPDATE, resource="organization",
                resource_id=str(org.pk), description=f"owner_org moved before delete: {org.pk} -> {target.pk}",
                changes={"field": "owner_org", "from": org.pk, "to": target.pk, "souls": souls, "judgments": judgments},
                ip_address=get_client_ip(request) or None, user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
            )
