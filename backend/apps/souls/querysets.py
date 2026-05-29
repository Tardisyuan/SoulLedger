"""
Custom QuerySet and Manager for Soul model.

Encapsulates karma-related filtering and annotation logic
that was previously in SoulViewSet.get_queryset().
"""
from django.db.models import QuerySet, F, ExpressionWrapper, IntegerField
from apps.tenants.managers import TenantManager


CIVILIZATION_TENANT_MAP = {
    'CHINESE': 'CN_DIYU',
    'EUROPEAN': 'EU_HEAVEN_HELL',
    'EGYPTIAN': 'EG_DUAT',
}


class SoulQuerySet(QuerySet):
    """Custom QuerySet for Soul with karma and civilization filtering."""

    def exclude_orphaned(self):
        """Exclude records with null tenant."""
        return self.filter(tenant__isnull=False)

    def filter_by_civilization(self, civilization: str):
        """Filter by civilization code (maps to tenant code)."""
        tenant_code = CIVILIZATION_TENANT_MAP.get(civilization)
        if tenant_code:
            return self.filter(tenant__code=tenant_code)
        return self

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

    Inherits tenant filtering from TenantManager (context-variable based).
    Adds karma/civilization filtering via SoulQuerySet.
    """

    def get_queryset(self):
        # Use SoulQuerySet instead of default QuerySet
        qs = SoulQuerySet(self.model, using=self._db)
        # Apply TenantManager's tenant filtering
        from apps.tenants.managers import get_current_tenant
        tenant = get_current_tenant()
        if tenant is not None:
            return qs.filter(tenant=tenant)
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
