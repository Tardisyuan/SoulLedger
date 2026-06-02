"""
Workflow FilterSet — filtering, search, and ordering for Workflow API.
"""
import django_filters as filters
from django.db.models import Q
from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus
from apps.souls.models import Civilization


class WorkflowFilter(filters.FilterSet):
    """
    FilterSet for ApprovalWorkflow API endpoints.
    Supports search, exact match, range, and date filtering.
    """
    # Search across multiple fields
    search = filters.CharFilter(method="filter_search")

    # Exact match filters
    status = filters.ChoiceFilter(choices=ApprovalWorkflowStatus.choices)
    case_type = filters.CharFilter()
    civilization = filters.ChoiceFilter(choices=Civilization.choices)
    soul_name = filters.CharFilter(field_name="soul__name", lookup_expr="icontains")

    # Date range filters
    created_after = filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_before = filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    # Priority range filters
    priority_min = filters.NumberFilter(field_name="priority", lookup_expr="gte")
    priority_max = filters.NumberFilter(field_name="priority", lookup_expr="lte")

    class Meta:
        model = ApprovalWorkflow
        fields = ["status", "case_type"]

    search_fields = ["workflow_name", "soul__name", "case_type"]
    ordering_fields = ["created_at", "priority", "status", "workflow_name"]

    def filter_search(self, queryset, name, value):
        """Search across multiple fields."""
        if not value:
            return queryset
        q = Q()
        for field in self.search_fields:
            q |= Q(**{f"{field}__icontains": value})
        return queryset.filter(q)
