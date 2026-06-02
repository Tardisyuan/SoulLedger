"""
Actor FilterSet — filtering, search, and ordering for Actor API.
"""
import django_filters as filters
from django.db.models import Q
from apps.actors.models import Actor, ActorRole
from apps.souls.models import Civilization


class ActorFilter(filters.FilterSet):
    """
    FilterSet for Actor API endpoints.
    Supports search, exact match, and boolean filtering.
    """
    # Search across multiple fields
    search = filters.CharFilter(method="filter_search")

    # Exact match filters
    civilization = filters.ChoiceFilter(choices=Civilization.choices)
    role = filters.ChoiceFilter(choices=ActorRole.choices)
    is_active = filters.BooleanFilter()
    realm = filters.CharFilter(field_name="realm__realm_code")

    class Meta:
        model = Actor
        fields = ["civilization", "role", "is_active"]

    search_fields = ["name", "name_zh", "name_en", "name_egy", "title", "description"]
    ordering_fields = ["civilization", "role", "name"]

    def filter_search(self, queryset, name, value):
        """Search across multiple fields."""
        if not value:
            return queryset
        q = Q()
        for field in self.search_fields:
            q |= Q(**{f"{field}__icontains": value})
        return queryset.filter(q)
