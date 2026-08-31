"""
Custom QuerySet and Manager for Soul model.

Encapsulates karma-related filtering and annotation logic
that was previously in SoulViewSet.get_queryset().
"""
from django.db.models import ExpressionWrapper, F, IntegerField, QuerySet

from apps.tenants.managers import TenantManager

# `CIVILIZATION_TENANT_MAP` and `filter_by_civilization` were deleted 2026-08-31.
#
# The map was the **fourth** hand-written copy of civilization→tenant, and it
# was missing GREEK — while the comment on `apps.souls.models.CIVILIZATION_TENANT`
# says in so many words that this mapping "existed in three more places, each
# free to drift", which is why that one is exported and callers are told to
# import it.
#
# The method was also fail-OPEN: an unrecognised civilization hit
# `return self` — the whole queryset. Measured 2026-08-29:
# `filter_by_civilization("GREEK")` returned every soul, Chinese ones included.
# `apps/souls/filters.py::filter_civilization`, the one the API actually uses,
# returns `.none()` on the same input. **Two methods with the same name, one
# fail-closed and one fail-open**, and the fail-open one had no callers — so
# the next caller would have got the silent full set.
#
# Anything needing this direction imports `CIVILIZATION_TENANT` from
# `apps.souls.models`. `tests/test_no_second_copy_of_the_civilization_map.py`
# keeps a fifth copy from appearing.


class SoulQuerySet(QuerySet):
    """Custom QuerySet for Soul with karma and civilization filtering."""

    def exclude_orphaned(self):
        """Exclude records with null tenant."""
        return self.filter(tenant__isnull=False)

    def filter_by_state(self, state: str):
        """Filter by current_state."""
        if state:
            return self.filter(current_state=state)
        return self

    def annotate_karma_balance(self):
        """Annotate queryset with _karmic_balance = merit_score - demerit_score."""
        karma_expr = ExpressionWrapper(
            F('merit_score') - F('demerit_score'),
            output_field=IntegerField()
        )
        return self.annotate(_karmic_balance=karma_expr)

    def filter_by_karma_range(self, karma_min=None, karma_max=None):
        """Filter by karma balance range. Annotates if needed."""
        qs = self
        if karma_min is not None or karma_max is not None:
            qs = qs.annotate_karma_balance()
            if karma_min is not None:
                try:
                    qs = qs.filter(_karmic_balance__gte=int(karma_min))
                except ValueError:
                    pass
            if karma_max is not None:
                try:
                    qs = qs.filter(_karmic_balance__lte=int(karma_max))
                except ValueError:
                    pass
        return qs

    def order_by_karma(self, descending=False):
        """Order by karma balance. Annotates if needed."""
        qs = self.annotate_karma_balance()
        return qs.order_by('-_karmic_balance' if descending else '_karmic_balance')


class SoulManager(TenantManager):
    """Custom Manager for Soul model combining TenantManager with SoulQuerySet.

    Tenant filtering is handled by ViewSet mixins (DataScopeViewSetMixin),
    not by the manager. This avoids stale contextvar filters on class-level
    queryset attributes.
    """

    def get_queryset(self):
        # Use SoulQuerySet instead of default QuerySet
        # Tenant filtering is handled by ViewSet mixins
        qs = SoulQuerySet(self.model, using=self._db)
        if hasattr(self.model, 'is_deleted'):
            qs = qs.filter(is_deleted=False)
        return qs

    def exclude_orphaned(self):
        return self.get_queryset().exclude_orphaned()

    def filter_by_civilization(self, civilization: str):
        return self.get_queryset().filter_by_civilization(civilization)

    def filter_by_state(self, state: str):
        return self.get_queryset().filter_by_state(state)

    def filter_by_karma_range(self, karma_min=None, karma_max=None):
        return self.get_queryset().filter_by_karma_range(karma_min, karma_max)

    def order_by_karma(self, descending=False):
        return self.get_queryset().order_by_karma(descending)
