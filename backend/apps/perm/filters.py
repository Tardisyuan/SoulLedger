"""
Data scope filters for row-level permission enforcement.
"""
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
        """Lazy-load RowLevelDataScope entries, grouped by role: ``{role: [scope, ...]}``.

        Every role the person holds counts — the primary role plus the live
        ``extra_roles`` (same set ``check_permission`` uses). A held role with
        no scope rows for this model maps to ``[]``, which means "unrestricted".
        """
        if self._scopes is None:
            from apps.perm.checker import _live_extra_roles
            from apps.perm.models import RowLevelDataScope

            user_role = getattr(self.user, 'role', None)
            if not user_role:
                self._scopes = {}
                return self._scopes

            roles = [user_role, *_live_extra_roles(self.user)]
            # Normalize model name to lowercase for consistent matching
            model_name = self.model_class.__name__.lower()
            self._scopes = {r: [] for r in roles}
            for scope in RowLevelDataScope.objects.filter(
                role__name__in=roles,
                model_name__iexact=model_name,
                scope_type=self.scope_type,
                is_active=True,
            ).select_related('role'):
                self._scopes[scope.role.name].append(scope)
        return self._scopes

    def apply(self, queryset):
        """
        Within one role, its scope rules are ANDed. Across the roles a person
        holds, a row is visible if ANY role's scope allows it (OR; user
        2026-10-27). A held role with no rule for this model allows every row.
        """
        if not self.scopes:
            return queryset

        combined = None
        for role_scopes in self.scopes.values():
            role_q = Q()
            for scope in role_scopes:
                scope_q = self._build_q_for_scope(scope)
                if scope_q:
                    role_q &= scope_q
            if not role_q:
                return queryset  # this role is unrestricted for the model
            combined = role_q if combined is None else combined | role_q
        return queryset.filter(combined)

    def _build_q_for_scope(self, scope) -> Q | None:
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

    def _build_field_q(self, field_path: str, value, civilization: str = None) -> Q | None:
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
