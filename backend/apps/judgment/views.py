"""
REST views for Judgment app.
"""
from django_filters import rest_framework as filters
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantCreateMixin, TenantQuerySetMixin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.judgment.models import Judgment
from apps.judgment.serializers import JudgmentConcludeSerializer, JudgmentSerializer
from apps.souls.models import SoulState


class JudgmentFilter(filters.FilterSet):
    """Custom filter for Judgment - handles verdict=null for pending judgments."""
    has_verdict = filters.BooleanFilter(field_name="verdict", lookup_expr="isnull", exclude=True)
    verdict_null = filters.BooleanFilter(field_name="verdict", lookup_expr="isnull")

    class Meta:
        model = Judgment
        fields = ["soul", "civilization", "verdict", "is_final"]


class JudgmentViewSet(CodenameViewSetMixin, TenantQuerySetMixin, DataScopeViewSetMixin, TenantCreateMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Judgment CRUD + conclude action.
    Tenant-isolated via TenantPermission.
    """
    # CodenamePermission is what finally enforces the codenames below. Until it
    # was added they were declarative only: PermissionMiddleware never saw
    # self.action, so any role reaching this viewset with a tenant could open a
    # judgment proceeding against a soul — and perform_create then walks that
    # soul ALIVE -> JUDGING, so the write landed on two tables. GUARDIAN and
    # VIEWER hold no judgment.* codename at all and are now refused both the
    # list and the create. See apps/core/permissions.py for why middleware
    # could not do this.
    permission_classes = [TenantPermission, CodenamePermission]
    # The judgment family is read / create / execute — those three exist and
    # are granted; there is no judgment.update or judgment.delete anywhere, yet
    # this is a ModelViewSet and the mixin was generating both.
    #
    # They map to judgment.execute. The choice between judgment.execute and
    # judgment.create is not a guess and cannot go wrong: both are held by
    # exactly {ADMIN, JUDGE, MODERATOR}, so no role's access differs between
    # them. execute is the closer fit — amending or withdrawing a filed
    # judgment is an act on the case, and conclude already maps here.
    permission_codename = "judgment"
    extra_permissions = {
        'conclude': ['judgment.execute'],
        'update': ['judgment.execute'],
        'partial_update': ['judgment.execute'],
        'destroy': ['judgment.execute'],
    }
    queryset = Judgment.objects.select_related("soul", "soul__tenant", "tenant").all()
    serializer_class = JudgmentSerializer
    filterset_class = JudgmentFilter
    ordering_fields = ["created_at", "concluded_at"]

    def perform_create(self, serializer):
        judgment = serializer.save()
        soul = judgment.soul
        if soul.current_state == SoulState.ALIVE:
            soul.transition_to(SoulState.JUDGING, f"Judgment {judgment.id} initiated")

    @action(detail=True, methods=["post"])
    def conclude(self, request, pk=None):
        """
        Conclude a judgment with a verdict.
        Calls Judgment.conclude() which creates disposition and transitions soul to DISPOSED.
        Optionally creates an ApprovalWorkflow if create_workflow=true.
        """
        judgment = self.get_object()
        if judgment.is_final:
            return Response({"error": "Judgment already concluded"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = JudgmentConcludeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verdict = serializer.validated_data["verdict"]
        notes = serializer.validated_data.get("notes", "")
        create_workflow = serializer.validated_data.get("create_workflow", False)

        judgment.conclude(verdict, notes, create_workflow=create_workflow)
        return Response(JudgmentSerializer(judgment).data)
