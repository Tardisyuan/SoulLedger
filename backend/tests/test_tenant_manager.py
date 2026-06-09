"""
Tests for TenantManager — contextvar API and manager behavior.

Tenant filtering is now handled by ViewSet mixins (DataScopeViewSetMixin,
TenantQuerySetMixin), not by TenantManager.get_queryset().  The contextvar
API (set/get/clear) is preserved for backward compatibility with WebSocket
middleware and audit signals.
"""
import pytest

from apps.souls.models import Soul
from apps.tenants.managers import (
    TenantManager,
    clear_current_tenant,
    get_current_tenant,
    set_current_tenant,
)
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestTenantManager:
    """Test TenantManager contextvar API and manager behavior."""

    def setup_method(self):
        """Ensure contextvar is cleared before each test."""
        clear_current_tenant()

    def teardown_method(self):
        """Ensure contextvar is cleared after each test."""
        clear_current_tenant()

    def test_set_and_get_current_tenant(self):
        """set_current_tenant / get_current_tenant round-trip."""
        tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        set_current_tenant(tenant)
        assert get_current_tenant() == tenant
        clear_current_tenant()
        assert get_current_tenant() is None

    def test_tenant_manager_does_not_filter_by_contextvar(self):
        """TenantManager.get_queryset() no longer filters by contextvar.

        Tenant filtering is handled by ViewSet mixins.  The manager returns
        all rows regardless of contextvar state.
        """
        cn_tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        eu_tenant = Tenant.objects.create(code="EU_HEAVEN_HELL", display_name="European")

        Soul.objects.create(name="CN Soul", tenant=cn_tenant)
        Soul.objects.create(name="EU Soul", tenant=eu_tenant)

        mgr = TenantManager()
        mgr.model = Soul

        # Without contextvar — both visible
        assert mgr.count() == 2

        # With contextvar set — still returns all (filtering moved to ViewSets)
        set_current_tenant(cn_tenant)
        assert mgr.count() == 2

        # Switch contextvar — still returns all
        set_current_tenant(eu_tenant)
        assert mgr.count() == 2

        # Clear — still returns all
        clear_current_tenant()
        assert mgr.count() == 2

    def test_soul_objects_returns_all_without_contextvar(self):
        """Soul.objects returns all souls when no contextvar is set."""
        cn_tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        eu_tenant = Tenant.objects.create(code="EU_HEAVEN_HELL", display_name="European")

        Soul.objects.create(name="CN Soul", tenant=cn_tenant)
        Soul.objects.create(name="EU Soul", tenant=eu_tenant)

        # Soul.objects should return all souls (filtering is in ViewSets)
        assert Soul.objects.count() == 2
