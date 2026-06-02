"""
Soul FilterSet — filtering, search, and ordering for Soul API.
"""
import django_filters as filters
from django.db.models import Q
from apps.souls.models import Soul, SoulState, Civilization


class SoulFilter(filters.FilterSet):
    """
    FilterSet for Soul API endpoints.
    Supports search, exact match, range, and date filtering.
    """
    # Search across multiple fields
    search = filters.CharFilter(method="filter_search")

    # Exact match filters
    current_state = filters.ChoiceFilter(choices=SoulState.choices)
    state = filters.ChoiceFilter(field_name="current_state", choices=SoulState.choices)
    tenant__code = filters.CharFilter()

    # Derived civilization filter (maps to tenant)
    civilization = filters.ChoiceFilter(choices=Civilization.choices, method="filter_civilization")

    # Date range filters
    created_after = filters.DateTimeFilter(field_name="create_time", lookup_expr="gte")
    created_before = filters.DateTimeFilter(field_name="create_time", lookup_expr="lte")
    death_date_after = filters.DateFilter(field_name="death_date", lookup_expr="gte")
    death_date_before = filters.DateFilter(field_name="death_date", lookup_expr="lte")

    # Karma range filters (aliases for backward compatibility)
    karmic_balance_min = filters.NumberFilter(method="filter_karmic_min")
    karmic_balance_max = filters.NumberFilter(method="filter_karmic_max")
    karma_min = filters.NumberFilter(method="filter_karmic_min")
    karma_max = filters.NumberFilter(method="filter_karmic_max")

    class Meta:
        model = Soul
        fields = ["current_state", "tenant__code"]

    search_fields = ["name", "birth_name", "origin_location", "description"]
    ordering_fields = ["name", "create_time", "death_date", "merit_score", "demerit_score"]
    ordering_blacklist = ["karmic_balance"]

    def filter_search(self, queryset, name, value):
        """Search across multiple fields."""
        if not value:
            return queryset
        q = Q()
        for field in self.search_fields:
            q |= Q(**{f"{field}__icontains": value})
        return queryset.filter(q)

    def filter_civilization(self, queryset, name, value):
        """Filter by civilization (mapped from tenant code)."""
        if not value:
            return queryset
        civ_map = {
            Civilization.CHINESE: "CN_DIYU",
            Civilization.EUROPEAN: "EU_HEAVEN_HELL",
            Civilization.EGYPTIAN: "EG_DUAT",
        }
        tenant_code = civ_map.get(value)
        if tenant_code:
            return queryset.filter(tenant__code=tenant_code)
        return queryset.none()

    def filter_karmic_min(self, queryset, name, value):
        """Filter souls with karmic_balance >= value (karmic_balance = merit - demerit)."""
        from django.db.models import F
        return queryset.filter(merit_score__gte=value + F("demerit_score"))

    def filter_karmic_max(self, queryset, name, value):
        """Filter souls with karmic_balance <= value (karmic_balance = merit - demerit)."""
        from django.db.models import F
        return queryset.filter(merit_score__lte=value + F("demerit_score"))
