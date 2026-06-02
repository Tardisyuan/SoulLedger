"""
Realm FilterSet — filtering, search, and ordering for Realm API.
"""
import django_filters as filters
from django.db.models import Q
from apps.realms.models import Realm, RealmType
from apps.souls.models import Civilization


class RealmFilter(filters.FilterSet):
    """
    FilterSet for Realm API endpoints.
    Supports search, exact match, range, and boolean filtering.
    """
    # Search across multiple fields
    search = filters.CharFilter(method="filter_search")

    # Exact match filters
    civilization = filters.ChoiceFilter(choices=Civilization.choices)
    realm_type = filters.ChoiceFilter(choices=RealmType.choices)
    is_eternal = filters.BooleanFilter()

    # Range filters
    tier_min = filters.NumberFilter(field_name="tier", lookup_expr="gte")
    tier_max = filters.NumberFilter(field_name="tier", lookup_expr="lte")

    class Meta:
        model = Realm
        fields = ["civilization", "realm_type", "is_eternal"]

    search_fields = ["realm_code", "name_local", "name_zh", "name_en", "name_egy", "description"]
    ordering_fields = ["civilization", "realm_type", "tier", "name_en"]

    def filter_search(self, queryset, name, value):
        """Search across multiple fields."""
        if not value:
            return queryset
        q = Q()
        for field in self.search_fields:
            q |= Q(**{f"{field}__icontains": value})
        return queryset.filter(q)
