"""
Workflow FilterSet — filtering, search, and ordering for Workflow API.
"""
import django_filters as filters
from django.db.models import DateTimeField, F, Func, Q
from django.utils import timezone

from apps.souls.models import Civilization
from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus, NodeStatus


class _AddHours(Func):
    """`timestamp + hours` computed by the database. Django cannot spell `int * timedelta` on SQLite
    ("Invalid arguments for operator *"), so each vendor gets its own form. The PostgreSQL branch is not
    exercised by the SQLite suite -- see the PG-only note in the test module."""

    arity = 2
    output_field = DateTimeField()
    template = "(%(expressions)s)"

    def as_sqlite(self, compiler, connection, **extra):
        ts, hours = (compiler.compile(e) for e in self.get_source_expressions())
        return f"strftime('%%Y-%%m-%%d %%H:%%M:%%f', {ts[0]}, '+' || {hours[0]} || ' hours')", [*ts[1], *hours[1]]

    def as_sql(self, compiler, connection, **extra):
        ts, hours = (compiler.compile(e) for e in self.get_source_expressions())
        return f"({ts[0]} + {hours[0]} * INTERVAL '1 hour')", [*ts[1], *hours[1]]


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
    # 「已超时」:进行中、当前节点还在等人、且它有超时时限并且已过。与 `timeouts.py` 的 `_due` 同一道时钟
    # (`activated_at + timeout_hours`),但**不看 `timed_out_at`** —— 提醒类动作触发过之后节点仍在等,仍然是超时的。
    overdue = filters.BooleanFilter(method="filter_overdue")

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

    def filter_overdue(self, queryset, name, value):
        """`overdue=true` 只留已超时的,`overdue=false` 只留其余;全在 SQL 里算,不拉行进 Python。"""
        if value is None:
            return queryset
        deadline = _AddHours(F("current_node__activated_at"), F("current_node__timeout_hours"))
        late = Q(
            status=ApprovalWorkflowStatus.IN_PROGRESS,
            current_node__status=NodeStatus.PENDING,
            current_node__timeout_hours__isnull=False,
            current_node__activated_at__isnull=False,
        )
        overdue = queryset.filter(late).annotate(_deadline=deadline).filter(_deadline__lt=timezone.now())
        return overdue if value else queryset.exclude(pk__in=overdue.values("pk"))

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
