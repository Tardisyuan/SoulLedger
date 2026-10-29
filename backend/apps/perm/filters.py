"""
Data scope filter: rows narrowed by the role data scope (`apps/perm/data_scope.py`, 数据范围 B2).

The old RowLevelDataScope rule layer is gone from here (its table goes in B7). A model
that is not in `data_scope.REGISTRY` comes back unchanged — the same queryset object, which
`officer_app/todo.py::_judgments_in_scope` relies on (`seen is every`).
"""
from rest_framework.request import Request

from apps.perm import data_scope


class DataScopeFilter:
    """
    Usage:
        qs = DataScopeFilter.filter_queryset(request, Soul.objects.all(), Soul)
    """

    def __init__(self, user, model_class, scope_type: str = 'READ'):
        self.user = user
        self.model_class = model_class
        self.scope_type = scope_type

    def apply(self, queryset, cache=None):
        q = data_scope.q_for(self.user, self.model_class, cache)
        return queryset if q is None else queryset.filter(q)

    @classmethod
    def filter_queryset(cls, request: Request, queryset, model_class, scope_type: str = 'READ'):
        user = request.user
        if not user.is_authenticated:
            return queryset.none()
        return cls(user, model_class, scope_type).apply(queryset, data_scope.request_cache(request))
