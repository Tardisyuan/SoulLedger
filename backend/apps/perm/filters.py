"""
Data scope filters for row-level permission enforcement.
"""
from typing import Optional, List
from django.db.models import Q
from rest_framework.request import Request


class DataScopeFilter:
    """
    Builds Django Q objects from RowLevelDataScope rules.

    Usage:
        filter = DataScopeFilter(request.user, Soul)
        qs = filter.apply(Soul.objects.all())
    """

    def __init__(self, user, model_class, scope_type: str = 'READ'):
        self.user = user
        self.model_class = model_class
        self.scope_type = scope_type
        self._scopes = None

    @property
    def scopes(self):
        """Lazy-load RowLevelDataScope entries for the user's role."""
        if self._scopes is None:
            from apps.perm.models import RowLevelDataScope

            user_role = getattr(self.user, 'role', None)
            if not user_role:
                self._scopes = []
                return self._scopes

            # Normalize model name to lowercase for consistent matching
            model_name = self.model_class.__name__.lower()
            self._scopes = list(
                RowLevelDataScope.objects.filter(
                    role__name=user_role,
                    model_name__iexact=model_name,
                    scope_type=self.scope_type,
                    is_active=True,
                ).select_related('role')
            )
        return self._scopes

    def apply(self, queryset):
        """
        Apply all matching RowLevelDataScope rules as AND conditions.
        Returns filtered queryset.
        """
        if not self.scopes:
            return queryset

        # Combine all scopes with AND (all conditions must be satisfied)
        combined_q = Q()
        for scope in self.scopes:
            scope_q = self._build_q_for_scope(scope)
            if scope_q:
                combined_q &= scope_q

        if combined_q:
            return queryset.filter(combined_q)
        return queryset

    def _build_q_for_scope(self, scope) -> Optional[Q]:
        """Build a Q object from a single RowLevelDataScope entry."""
        conditions = scope.filter_conditions or {}
        if not conditions:
            return None

        civilization = scope.civilization
        q_parts = []

        for field_path, value in conditions.items():
            q = self._build_field_q(field_path, value, civilization)
            if q:
                q_parts.append(q)

        if not q_parts:
            return None

        # All conditions within a scope are ANDed together
        result = q_parts[0]
        for q in q_parts[1:]:
            result &= q
        return result

    def _build_field_q(self, field_path: str, value, civilization: str = None) -> Optional[Q]:
        """
        Build a Q object for a single field condition.

        Supports:
          - {"current_state": "PENDING"}          -> Q(current_state="PENDING")
          - {"current_state": ["PENDING", "JUDGING"]} -> Q(current_state__in=["PENDING", "JUDGING"])
          - {"judgment__created_by": "current_user"}  -> Q(judgment__create_user=self.user)
          - {"judgment__verdict": null}              -> Q(judgment__verdict__isnull=True)
        """
        if not field_path:
            return None

        # Handle null value
        if value is None or value == 'null':
            return Q(**{f"{field_path}__isnull": True})

        # Handle "current_user" special value
        if value == 'current_user':
            return Q(**{f"{field_path}": self.user})

        # Handle list of values (IN filter)
        if isinstance(value, list):
            if not value:  # Empty list
                return None
            # Check if list contains special values
            resolved_values = []
            for v in value:
                if v == 'current_user':
                    resolved_values.append(self.user)
                else:
                    resolved_values.append(v)
            return Q(**{f"{field_path}__in": resolved_values})

        # Handle civilization field specially
        if field_path == 'civilization' and civilization:
            return Q(**{f"{field_path}": civilization})

        # Plain equality
        return Q(**{field_path: value})

    @classmethod
    def filter_queryset(cls, request: Request, queryset, model_class, scope_type: str = 'READ'):
        """
        Convenience class method to apply data scope filtering.
        """
        user = request.user
        if not user.is_authenticated:
            return queryset.none()

        # ADMIN bypasses data scope filtering
        if getattr(user, 'role', None) == 'ADMIN':
            return queryset

        filter_instance = cls(user, model_class, scope_type)
        return filter_instance.apply(queryset)
