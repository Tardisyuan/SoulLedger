"""
Tests for TenantPermission's cross-check between the JWT's tenant_code
claim (request.tenant, set by apps.tenants.middleware before authentication
runs) and the authenticated user's actual current tenant (M15 finding C7).

Without this check, a token minted before an admin moved a user to a
different tenant keeps granting access under the old tenant_code until
the token naturally expires — nothing else in the pipeline re-derives
tenant from the live user record. These are unit tests against
has_permission directly rather than a full API round trip: the defect is
entirely in that one method, and a real endpoint would only add DB/view
machinery that has nothing to do with what's being verified here.
"""
import pytest
from django.test import RequestFactory

from apps.authentication.models import User
from apps.core.permissions import TenantPermission
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestTenantPermissionCrossCheck:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.create(code="TPX_A", display_name="Tenant A")
        self.tenant_b = Tenant.objects.create(code="TPX_B", display_name="Tenant B")
        self.factory = RequestFactory()
        self.permission = TenantPermission()

    def _request(self, user, request_tenant):
        request = self.factory.get("/api/v1/souls/")
        request.user = user
        request.tenant = request_tenant
        return request

    def test_matching_tenant_and_token_claim_is_allowed(self):
        user = User.objects.create_user(username="tpx_match", password="x", role="VIEWER", tenant=self.tenant_a)
        request = self._request(user, self.tenant_a)
        assert self.permission.has_permission(request, None) is True

    def test_a_stale_token_claiming_a_different_tenant_is_refused(self):
        """The user's real tenant is A, but the presented token's
        tenant_code resolved to B (e.g. minted before the user was moved
        from B to A, or after being moved from A to B and back) — this
        must not be trusted."""
        user = User.objects.create_user(username="tpx_stale", password="x", role="VIEWER", tenant=self.tenant_a)
        request = self._request(user, self.tenant_b)
        assert self.permission.has_permission(request, None) is False

    def test_a_user_with_no_tenant_is_refused_even_with_a_token_claim(self):
        user = User.objects.create_user(username="tpx_notenant", password="x", role="VIEWER", tenant=None)
        request = self._request(user, self.tenant_a)
        assert self.permission.has_permission(request, None) is False

    def test_no_tenant_on_the_request_is_still_refused(self):
        user = User.objects.create_user(username="tpx_notoken", password="x", role="VIEWER", tenant=self.tenant_a)
        request = self._request(user, None)
        assert self.permission.has_permission(request, None) is False

    def test_admin_bypasses_the_cross_check_entirely(self):
        """ADMIN is the codebase's one intentionally global-scope role
        (see apps/authentication/views.py's UserViewSet.get_queryset
        docstring) — a mismatched or absent tenant must not block it."""
        admin = User.objects.create_user(username="tpx_admin", password="x", role="ADMIN", tenant=None)
        request = self._request(admin, self.tenant_b)
        assert self.permission.has_permission(request, None) is True

    def test_unauthenticated_is_refused(self):
        from django.contrib.auth.models import AnonymousUser

        request = self._request(AnonymousUser(), self.tenant_a)
        assert self.permission.has_permission(request, None) is False
