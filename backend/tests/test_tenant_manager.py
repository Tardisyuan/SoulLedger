"""
Tests for TenantManager (M3.3b) — automatic tenant filtering via thread-local.
"""
import pytest
from apps.tenants.models import Tenant
from apps.tenants.managers import (
    TenantManager,
    set_current_tenant,
    get_current_tenant,
    clear_current_tenant,
)
from apps.souls.models import Soul, Civilization


@pytest.mark.django_db
class TestTenantManager:
    """M3.3b: TenantManager auto-filters querysets by thread-local tenant."""

    def setup_method(self):
        """Ensure thread-local is cleared before each test."""
        clear_current_tenant()

    def teardown_method(self):
        """Ensure thread-local is cleared after each test."""
        clear_current_tenant()

    def test_set_and_get_current_tenant(self):
        """set_current_tenant / get_current_tenant round-trip."""
        tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        set_current_tenant(tenant)
        assert get_current_tenant() == tenant
        clear_current_tenant()
        assert get_current_tenant() is None

    def test_tenant_manager_filters_by_tenant(self):
        """When thread-local tenant is set, queryset is filtered to that tenant."""
        cn_tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        eu_tenant = Tenant.objects.create(code="EU_HEAVEN_HELL", display_name="European")

        # These souls use default manager (standard Django manager)
        # We'll test with the TenantManager directly
        Soul.objects.create(name="CN Soul", civilization=Civilization.CHINESE, tenant=cn_tenant)
        Soul.objects.create(name="EU Soul", civilization=Civilization.EUROPEAN, tenant=eu_tenant)

        # Use TenantManager directly
        mgr = TenantManager()
        mgr.model = Soul

        # Without tenant set — both should be visible
        assert mgr.count() == 2

        # Set tenant to CN
        set_current_tenant(cn_tenant)
        assert mgr.count() == 1
        assert mgr.first().name == "CN Soul"

        # Switch to EU
        set_current_tenant(eu_tenant)
        assert mgr.count() == 1
        assert mgr.first().name == "EU Soul"

        # Clear
        clear_current_tenant()
        assert mgr.count() == 2

    def test_tenant_manager_soul_objects_uses_tenant_manager(self):
        """Soul.objects should use TenantManager after it's set on the model."""
        # This test is designed to work AFTER Soul.objects = TenantManager() is applied.
        # For now, test the raw TenantManager behavior.
        cn_tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        eu_tenant = Tenant.objects.create(code="EU_HEAVEN_HELL", display_name="European")

        Soul.objects.create(name="CN Soul", civilization=Civilization.CHINESE, tenant=cn_tenant)
        Soul.objects.create(name="EU Soul", civilization=Civilization.EUROPEAN, tenant=eu_tenant)

        # Verify both exist via default manager
        assert Soul.objects.count() == 2

        # Test TenantManager filtering directly
        from apps.tenants.managers import TenantManager
        mgr = TenantManager()
        mgr.model = Soul

        set_current_tenant(cn_tenant)
        assert mgr.count() == 1
        clear_current_tenant()
        assert mgr.count() == 2
