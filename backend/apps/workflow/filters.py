"""
Workflow FilterSet — filtering, search, and ordering for Workflow API.
"""
import django_filters as filters
from django.db.models import Q

from apps.souls.models import Civilization
from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus


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
    # `ApprovalWorkflow` 没有 `civilization` 列 —— 它派生在 `Soul` 上,而 Soul 又
    # 从租户 code 推。声明式过滤器**不看 `Meta.fields` 也会生效**,所以这个字段
    # 一直是活的,而它一被使用就是 500:
    #     GET /api/v1/workflows/?civilization=CHINESE
    #     FieldError: Cannot resolve keyword 'civilization' into field
    # 映射到租户 code 上,而不是删掉这个过滤器:前端的工作流列表页有这个筛选项,
    # 删掉会让那个下拉静默失效 —— 又一个「看得见、点不动」。
    civilization = filters.ChoiceFilter(
        choices=Civilization.choices, method="filter_civilization"
    )
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

    def filter_civilization(self, queryset, name, value):
        """按灵魂所属租户筛文明。

        `Soul.civilization` 是从 `tenant.code` 推出来的属性,不是列,所以只能
        反向查租户 code。`CIVILIZATION_TENANT` 是那张映射表本身 —— 在这里再抄
        一份「CHINESE 就是 CN_DIYU」会成为第 N 份手抄副本,而这个仓库的
        `SoulQuerySet.filter_by_civilization` 已经是第四份了。
        """
        from apps.souls.models import CIVILIZATION_TENANT

        code = CIVILIZATION_TENANT.get(value)
        if code is None:
            # 一个映射表里没有的文明。返回空集而不是忽略这个筛选条件 ——
            # 忽略会让调用者以为「这个文明下确实有这些工作流」。
            return queryset.none()
        return queryset.filter(soul__tenant__code=code)

    def filter_search(self, queryset, name, value):
        """Search across multiple fields."""
        if not value:
            return queryset
        q = Q()
        for field in self.search_fields:
            q |= Q(**{f"{field}__icontains": value})
        return queryset.filter(q)
