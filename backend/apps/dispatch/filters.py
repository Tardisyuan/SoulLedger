"""
Dispatch FilterSet — filtering, search, and ordering for Dispatch API.
"""
import django_filters as filters
from django.db.models import Q

from apps.dispatch.models import DispatchRecord, DispatchStatus


class DispatchFilter(filters.FilterSet):
    """
    FilterSet for DispatchRecord API endpoints.
    Supports search, exact match, and date filtering.
    """
    # Search across multiple fields
    search = filters.CharFilter(method="filter_search")

    # Exact match filters
    status = filters.ChoiceFilter(choices=DispatchStatus.choices)
    source_tenant = filters.NumberFilter()
    target_tenant = filters.NumberFilter()
    soul_name = filters.CharFilter(field_name="soul__name", lookup_expr="icontains")

    # Date range filters
    proposed_after = filters.DateTimeFilter(field_name="proposed_at", lookup_expr="gte")
    proposed_before = filters.DateTimeFilter(field_name="proposed_at", lookup_expr="lte")

    class Meta:
        model = DispatchRecord
        fields = ["status", "source_tenant", "target_tenant"]

    search_fields = ["soul__name", "reason"]
    ordering_fields = ["proposed_at", "status"]

    def filter_search(self, queryset, name, value):
        """Search across multiple fields."""
        if not value:
            return queryset
        q = Q()
        for field in self.search_fields:
            q |= Q(**{f"{field}__icontains": value})
        return queryset.filter(q)
