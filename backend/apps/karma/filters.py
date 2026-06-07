"""
Karma Record FilterSet — filtering, search, and ordering for Karma API.
"""
import django_filters as filters
from django.db.models import Q

from apps.souls.models import Civilization
from apps.souls.record_models import RecordType, SoulRecord


class SoulRecordFilter(filters.FilterSet):
    """
    FilterSet for SoulRecord API endpoints.
    Supports search, exact match, range, and date filtering.
    """
    # Search across multiple fields
    search = filters.CharFilter(method="filter_search")

    # Exact match filters
    record_type = filters.ChoiceFilter(choices=RecordType.choices)
    civilization = filters.ChoiceFilter(choices=Civilization.choices)
    soul_name = filters.CharFilter(field_name="soul__name", lookup_expr="icontains")

    # Date range filters
    recorded_after = filters.DateTimeFilter(field_name="recorded_at", lookup_expr="gte")
    recorded_before = filters.DateTimeFilter(field_name="recorded_at", lookup_expr="lte")
    event_date_after = filters.DateFilter(field_name="event_date", lookup_expr="gte")
    event_date_before = filters.DateFilter(field_name="event_date", lookup_expr="lte")

    # Weight range filters
    weight_min = filters.NumberFilter(field_name="weight", lookup_expr="gte")
    weight_max = filters.NumberFilter(field_name="weight", lookup_expr="lte")

    class Meta:
        model = SoulRecord
        fields = ["record_type", "civilization"]

    search_fields = ["description", "soul__name", "category"]
    ordering_fields = ["recorded_at", "event_date", "weight", "record_type"]

    def filter_search(self, queryset, name, value):
        """Search across multiple fields."""
        if not value:
            return queryset
        q = Q()
        for field in self.search_fields:
            q |= Q(**{f"{field}__icontains": value})
        return queryset.filter(q)
