"""
Tenant model tests — M3.1a
"""
import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError


@pytest.mark.django_db
class TestTenantModel:
    """Test Tenant model creation and field validation."""

    def test_create_tenant_valid(self):
        """Tenant can be created with required fields."""
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.create(
            code="CN_DIYU",
            display_name="Chinese Afterlife",
            description="The Chinese underworld system",
            dispatch_enabled=True,
        )
        assert tenant.id is not None
        assert str(tenant) == "CN_DIYU"
        assert tenant.display_name == "Chinese Afterlife"
        assert tenant.is_active is True
        assert tenant.dispatch_enabled is True
        assert tenant.settings == {}

    def test_create_tenant_minimal(self):
        """Tenant with only required fields (code, display_name) creates correctly."""
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.create(code="EU_HEAVEN_HELL", display_name="European")
        assert tenant.code == "EU_HEAVEN_HELL"
        assert tenant.is_active is True  # default
        assert tenant.dispatch_enabled is False  # default

    def test_code_must_be_unique(self):
        """Two tenants cannot have the same code."""
        from apps.tenants.models import Tenant

        Tenant.objects.create(code="CN_DIYU", display_name="First")
        with pytest.raises(IntegrityError):
            Tenant.objects.create(code="CN_DIYU", display_name="Second")

    def test_code_max_length(self):
        """Code field is max 50 characters."""
        from apps.tenants.models import Tenant

        long_code = "X" * 51
        tenant = Tenant(code=long_code, display_name="Test")
        with pytest.raises(ValidationError):
            tenant.full_clean()

    def test_created_at_auto_set(self):
        """created_at is automatically set on creation."""
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.create(code="EG_DUAT", display_name="Egyptian")
        assert tenant.created_at is not None
