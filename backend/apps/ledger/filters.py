"""
Ledger Record FilterSet — filtering, search, and ordering for the Ledger API.
"""
import django_filters as filters
from django.db.models import ExpressionWrapper, F, IntegerField, Q
from django.db.models.functions import Coalesce

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
    # event_date is no longer a single DateField (event_year/month/day
    # support BCE years — see apps.souls.dates), so these compare a
    # calendar-sortable composite of the three columns. Only meaningful for
    # CE comparisons, same as before (a plain DateFilter can't express BCE
    # values either); BCE records simply never match.
    event_date_after = filters.DateFilter(method="filter_event_date_after")
    event_date_before = filters.DateFilter(method="filter_event_date_before")

    # Weight range filters
    weight_min = filters.NumberFilter(field_name="weight", lookup_expr="gte")
    weight_max = filters.NumberFilter(field_name="weight", lookup_expr="lte")

    class Meta:
        model = SoulRecord
        fields = ["record_type", "civilization"]

    search_fields = ["description", "soul__name", "category"]
    # event_date was dropped as a real field in favour of
    # event_year/month/day; event_year alone is still directly sortable.
    ordering_fields = ["recorded_at", "event_year", "weight", "record_type"]

    def _event_sort_key(self, queryset):
        return queryset.annotate(
            _event_sort=ExpressionWrapper(
                F("event_year") * 10000 + Coalesce(F("event_month"), 1) * 100 + Coalesce(F("event_day"), 1),
                output_field=IntegerField(),
            )
        )

    def filter_event_date_after(self, queryset, name, value):
        if not value:
            return queryset
        threshold = value.year * 10000 + value.month * 100 + value.day
        return self._event_sort_key(queryset).filter(event_year__isnull=False, _event_sort__gte=threshold)

    def filter_event_date_before(self, queryset, name, value):
        if not value:
            return queryset
        threshold = value.year * 10000 + value.month * 100 + value.day
        return self._event_sort_key(queryset).filter(event_year__isnull=False, _event_sort__lte=threshold)

    def filter_search(self, queryset, name, value):
        """Search across multiple fields."""
        if not value:
            return queryset
        q = Q()
        for field in self.search_fields:
            q |= Q(**{f"{field}__icontains": value})
        return queryset.filter(q)
