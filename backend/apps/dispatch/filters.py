"""
Dispatch FilterSet — filtering, search, and ordering for Dispatch API.
"""
import django_filters as filters
from django.db.models import Q

from apps.dispatch.models import CrossTenantJudgment, DispatchRecord, DispatchStatus, JudgmentStatus


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


class CrossTenantJudgmentFilter(filters.FilterSet):
    """跨域审判列表(审计 2026-10-17 第 11 条):状态、「我方发起 / 我方参与」、标题搜索。

    `side` 只在 `get_queryset` 已经限定的行里再分:发起方是本殿,或本殿坐在参与方里而不是发起方。
    没有租户的调用方(免租户的 ADMIN)没有「我方」,`side` 不起作用。
    """

    status = filters.ChoiceFilter(choices=JudgmentStatus.choices)
    side = filters.ChoiceFilter(choices=[("initiated", "initiated"), ("participating", "participating")],
                                method="filter_side")
    search = filters.CharFilter(field_name="title", lookup_expr="icontains")

    class Meta:
        model = CrossTenantJudgment
        fields = ["status"]

    def filter_side(self, queryset, name, value):
        tenant = getattr(self.request, "tenant", None) or getattr(self.request.user, "tenant", None)
        if tenant is None:
            return queryset
        if value == "initiated":
            return queryset.filter(initiating_tenant=tenant)
        # `.distinct()`:连了 participants,同一殿坐两个席位时一行会回来两次(同 get_queryset 的理由)。
        return queryset.filter(participants__participant_tenant=tenant).exclude(initiating_tenant=tenant).distinct()
