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

from apps.authentication.models import User, UserRole
from apps.core.permissions import HasValidApiKey, TenantPermission
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

    # -- the other half of the bypass --------------------------------------
    #
    # `test_admin_bypasses_the_cross_check_entirely` above says ADMIN gets
    # through. Nothing said that *only* ADMIN does, and that omission is not
    # theoretical: changing the bypass from `== "ADMIN"` to
    # `in ("ADMIN", "MODERATOR")` -- handing a second role a global
    # cross-tenant exemption -- left the **entire backend suite green**, 2694
    # passed, 0 failed, 259 seconds.
    #
    # Two things had to line up for that. This class parametrized only VIEWER
    # and ADMIN, so no other role's behaviour was stated anywhere. And
    # `apps/perm/test_matrix_snapshot.py`'s `role_clients` puts every role's
    # user in one tenant with a matching token, so the mismatch branch is
    # never taken there either -- instrumenting the whole suite found 328 test
    # functions reaching `has_object_permission`, 224 of which take the ADMIN
    # short-circuit on every single call, and **zero** that exercise both
    # paths.
    #
    # Derived from `UserRole.values` rather than listed, so a role added later
    # is covered without anyone remembering to come back here.

    @pytest.mark.parametrize(
        "role", [r for r in UserRole.values if r != UserRole.ADMIN]
    )
    def test_no_other_role_bypasses_the_cross_check(self, role):
        user = User.objects.create_user(
            username=f"tpx_only_{role.lower()}",
            password="x",
            role=role,
            tenant=self.tenant_a,
        )
        request = self._request(user, self.tenant_b)
        assert self.permission.has_permission(request, None) is False, (
            f"{role} was let through a tenant mismatch. ADMIN is the one "
            f"globally-scoped role in this codebase; a second one is a "
            f"cross-tenant exemption nobody declared."
        )

    @pytest.mark.parametrize(
        "role", [r for r in UserRole.values if r != UserRole.ADMIN]
    )
    def test_no_other_role_bypasses_the_object_check(self, role):
        """The object layer separately -- it has its own copy of the bypass."""

        class _Obj:
            pass

        obj = _Obj()
        obj.tenant = self.tenant_b

        user = User.objects.create_user(
            username=f"tpx_obj_{role.lower()}",
            password="x",
            role=role,
            tenant=self.tenant_a,
        )
        request = self._request(user, self.tenant_a)
        assert self.permission.has_object_permission(request, None, obj) is False, (
            f"{role} reached an object belonging to another tenant"
        )

    def test_admin_still_bypasses_the_object_check(self):
        """The positive control. Without it, a permission class that refuses
        everyone satisfies both assertions above."""

        class _Obj:
            pass

        obj = _Obj()
        obj.tenant = self.tenant_b

        admin = User.objects.create_user(
            username="tpx_obj_admin", password="x", role="ADMIN", tenant=self.tenant_a
        )
        request = self._request(admin, self.tenant_a)
        assert self.permission.has_object_permission(request, None, obj) is True

    def test_exactly_one_role_holds_the_bypass(self):
        """Stated as a count, so a second exemption is visible as a number.

        The per-role tests above would each fail individually; this one says
        what the invariant is, which is the sentence someone reads when they
        are deciding whether to add a role to that tuple.
        """
        bypassing = []
        for role in UserRole.values:
            user = User.objects.create_user(
                username=f"tpx_count_{role.lower()}",
                password="x",
                role=role,
                tenant=self.tenant_a,
            )
            if self.permission.has_permission(self._request(user, self.tenant_b), None):
                bypassing.append(role)
        assert bypassing == [UserRole.ADMIN], (
            f"roles bypassing the tenant cross-check: {bypassing}. "
            f"Exactly one role is meant to be globally scoped."
        )


class TestHasValidApiKey:
    """HasValidApiKey backs the three apps.death_sync views authenticated by
    APIKeyAuthentication instead of Django session/JWT auth (see
    apps.death_sync.views: DeathRegistrationViewSet, WebhookViewSet,
    DeathSyncHealthView).

    Those views used to inherit the project-wide default
    (IsAuthenticated), which checks request.user.is_authenticated.
    APIKeyAuthentication.authenticate() returns (AnonymousUser(), api_key)
    on a *successful* authentication — AnonymousUser.is_authenticated is
    always False by definition — so IsAuthenticated rejected every request
    with a perfectly valid API key with 403, before the view ever ran.
    There was no way to reach these views over real HTTP.

    HasValidApiKey checks request.api_key instead, which
    APIKeyAuthentication sets if and only if it authenticated the request
    successfully. These are unit tests against has_permission directly,
    the same pattern as TestTenantPermissionCrossCheck above — no DB or
    view machinery is needed to exercise this method.
    """

    def setup_method(self):
        self.permission = HasValidApiKey()
        self.factory = RequestFactory()

    def _request(self, api_key):
        request = self.factory.get("/api/v1/death-sync/register/")
        if api_key is not None:
            request.api_key = api_key
        return request

    def test_request_with_api_key_set_is_allowed(self):
        """api_key can be any truthy sentinel here — has_permission only
        checks for presence, not validity (validity is APIKeyAuthentication's
        job, upstream)."""
        request = self._request(api_key=object())
        assert self.permission.has_permission(request, None) is True

    def test_request_with_no_api_key_attribute_is_refused(self):
        """No Authorization: ApiKey header at all: APIKeyAuthentication.
        authenticate() returns None (this authenticator does not apply), so
        request.api_key is never set. This must be refused rather than
        allowed — AllowAny would let it through, and the views read
        request.api_key unconditionally (e.g.
        DeathRegistrationViewSet.create()), which would crash with
        AttributeError instead of cleanly denying."""
        request = self._request(api_key=None)
        assert self.permission.has_permission(request, None) is False

    def test_request_with_api_key_none_explicitly_is_refused(self):
        request = self.factory.get("/api/v1/death-sync/register/")
        request.api_key = None
        assert self.permission.has_permission(request, None) is False

    def test_object_permission_mirrors_has_permission(self):
        allowed_request = self._request(api_key=object())
        denied_request = self._request(api_key=None)
        assert self.permission.has_object_permission(allowed_request, None, object()) is True
        assert self.permission.has_object_permission(denied_request, None, object()) is False
