"""
Soul FilterSet — filtering, search, and ordering for Soul API.
"""
import django_filters as filters
from django.db.models import ExpressionWrapper, F, IntegerField, Q
from django.db.models.functions import Coalesce

from apps.souls.models import CIVILIZATION_TENANT, Civilization, Soul, SoulState


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
    # death_date is no longer a single DateField (see apps.souls.dates —
    # death_year/month/day support BCE years), so these compare a
    # calendar-sortable composite of the three columns instead of using a
    # plain field_name lookup. Only meaningful for CE comparisons, which is
    # all a plain DateFilter (?death_date_after=2020-01-01) can express
    # anyway; BCE souls simply never match (death_year is always negative,
    # well below any date the filter could ask for).
    death_date_after = filters.DateFilter(method="filter_death_date_after")
    death_date_before = filters.DateFilter(method="filter_death_date_before")

    # Karma range filters (aliases for backward compatibility)
    karmic_balance_min = filters.NumberFilter(method="filter_karmic_min")
    karmic_balance_max = filters.NumberFilter(method="filter_karmic_max")
    karma_min = filters.NumberFilter(method="filter_karmic_min")
    karma_max = filters.NumberFilter(method="filter_karmic_max")

    class Meta:
        model = Soul
        fields = ["current_state", "tenant__code"]

    search_fields = ["name", "birth_name", "origin_location", "description"]
    # death_date was dropped as a real field in favour of death_year/month/day
    # (see apps.souls.dates); death_year alone is still a meaningful,
    # directly sortable ordering key.
    ordering_fields = ["name", "create_time", "death_year", "merit_score", "demerit_score"]
    ordering_blacklist = ["karmic_balance"]

    def _death_sort_key(self, queryset):
        """Annotate a single sortable/comparable value from death_year/month/day.

        Missing month/day (year-only precision) fall back to Jan 1 for
        comparison purposes.
        """
        return queryset.annotate(
            _death_sort=ExpressionWrapper(
                F("death_year") * 10000 + Coalesce(F("death_month"), 1) * 100 + Coalesce(F("death_day"), 1),
                output_field=IntegerField(),
            )
        )

    def filter_death_date_after(self, queryset, name, value):
        if not value:
            return queryset
        threshold = value.year * 10000 + value.month * 100 + value.day
        return self._death_sort_key(queryset).filter(death_year__isnull=False, _death_sort__gte=threshold)

    def filter_death_date_before(self, queryset, name, value):
        if not value:
            return queryset
        threshold = value.year * 10000 + value.month * 100 + value.day
        return self._death_sort_key(queryset).filter(death_year__isnull=False, _death_sort__lte=threshold)

    def filter_search(self, queryset, name, value):
        """Search across multiple fields."""
        if not value:
            return queryset
        q = Q()
        for field in self.search_fields:
            q |= Q(**{f"{field}__icontains": value})
        return queryset.filter(q)

    def filter_civilization(self, queryset, name, value):
        """Filter by civilization (mapped from tenant code).

        Uses the reverse of apps.souls.models.TENANT_CIVILIZATION, which is
        what Soul.civilization reads forwards. A hand-written copy lived here
        until it was one of four; a filter that disagreed with the property
        would answer ?civilization=X with souls whose civilization is not X.
        """
        if not value:
            return queryset
        tenant_code = CIVILIZATION_TENANT.get(value)
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
