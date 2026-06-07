"""
Tests for TenantMiddleware (M3.3a).
"""
import pytest
from django.test import RequestFactory

from apps.authentication.models import User
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestTenantMiddleware:
    """M3.3a: TenantMiddleware extracts tenant from JWT claim and attaches to request."""

    def test_middleware_sets_request_tenant_from_jwt(self):
        """Request with valid JWT containing tenant_code -> request.tenant is set."""
        from rest_framework_simplejwt.tokens import AccessToken

        from apps.tenants.middleware import TenantMiddleware

        tenant = Tenant.objects.create(code="CN_DIYU", display_name="Chinese Diyu")
        user = User.objects.create(username="testuser", tenant=tenant)

        # Create JWT with tenant_code claim
        token = AccessToken.for_user(user)
        token["tenant_code"] = tenant.code

        factory = RequestFactory()
        request = factory.get("/api/v1/souls/")
        request.META["HTTP_AUTHORIZATION"] = f"Bearer {token}"

        # Run middleware
        middleware = TenantMiddleware(lambda req: req)
        processed = middleware(request)

        assert processed.tenant == tenant
        assert processed.tenant.code == "CN_DIYU"

    def test_middleware_no_jwt_sets_tenant_none(self):
        """Request without JWT -> request.tenant is None."""
        from apps.tenants.middleware import TenantMiddleware

        factory = RequestFactory()
        request = factory.get("/api/v1/souls/")

        middleware = TenantMiddleware(lambda req: req)
        processed = middleware(request)

        assert processed.tenant is None

    def test_middleware_invalid_jwt_sets_tenant_none(self):
        """Request with invalid/malformed JWT -> request.tenant is None."""
        from apps.tenants.middleware import TenantMiddleware

        factory = RequestFactory()
        request = factory.get("/api/v1/souls/")
        request.META["HTTP_AUTHORIZATION"] = "Bearer invalid.token.here"

        middleware = TenantMiddleware(lambda req: req)
        processed = middleware(request)

        assert processed.tenant is None

    def test_middleware_no_tenant_code_claim(self):
        """JWT without tenant_code claim -> request.tenant is None."""
        from rest_framework_simplejwt.tokens import AccessToken

        from apps.tenants.middleware import TenantMiddleware

        user = User.objects.create(username="noclaim")
        token = AccessToken.for_user(user)
        # No tenant_code claim added

        factory = RequestFactory()
        request = factory.get("/api/v1/souls/")
        request.META["HTTP_AUTHORIZATION"] = f"Bearer {token}"

        middleware = TenantMiddleware(lambda req: req)
        processed = middleware(request)

        assert processed.tenant is None
