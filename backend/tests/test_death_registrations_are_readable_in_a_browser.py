"""The /death-sync page can actually load its data.

`DeathRegistrationViewSet` replaces `authentication_classes` with
`[APIKeyAuthentication]` -- by design: it is the machine-to-machine write
endpoint, and external systems present a key, not a JWT. The `/death-sync`
page was calling it with a Bearer token. Measured 2026-08-29 with a real
login token:

    [ADMIN]     GET /api/v1/death-sync/register/ -> 401
    [MODERATOR] -> 401     [VIEWER] -> 401
    (same client: GET /audit-logs/ -> 200, GET /workflows/ -> 200)

So the page showed "No death registrations found." to every user including
ADMIN, permanently. This is the worst member of the "500 renders identically
to empty" family found in this audit: not a failure mode, a screen that could
never have worked, presenting itself as "there is no data".

`registrations/` is a separate read-only viewset rather than JWT auth bolted
onto the write one, because the split those classes encode is real: external
systems write with a key and are scoped by that key (`scope_to_api_key`,
deliberately fail-closed); operators read in a browser and are scoped by
tenant. Merging them would have meant weakening one of the two scoping rules
to cover the other's callers.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.death_sync.models import DeathRegistrationRequest, ExternalApiKey
from apps.tenants.models import Tenant

User = get_user_model()


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def registrations(db):
    mine = Tenant.objects.get_or_create(
        code="DR_MINE", defaults={"display_name": "Mine"}
    )[0]
    theirs = Tenant.objects.get_or_create(
        code="DR_THEIRS", defaults={"display_name": "Theirs"}
    )[0]

    def _key(tenant, name):
        _, key_hash, prefix = ExternalApiKey.generate_key()
        return ExternalApiKey.objects.create(
            tenant=tenant, name=name, system_type="HOSPITAL",
            key_hash=key_hash, key_prefix=prefix,
        )

    DeathRegistrationRequest.objects.create(
        tenant=mine, api_key=_key(mine, "k1"),
        source_system="HOSP_A", idempotency_key="mine-1",
        source_payload={"name": "MINE"},
    )
    DeathRegistrationRequest.objects.create(
        tenant=theirs, api_key=_key(theirs, "k2"),
        source_system="HOSP_B", idempotency_key="theirs-1",
        source_payload={"name": "THEIRS"},
    )
    admin = User.objects.create_user(
        username="dr_admin", password="x", role="ADMIN", tenant=mine
    )
    return mine, theirs, admin


@pytest.mark.django_db
def test_an_admin_can_read_the_registrations_in_a_browser(registrations):
    mine, _, admin = registrations
    resp = _jwt_client(admin, mine).get("/api/v1/death-sync/registrations/")
    assert resp.status_code == 200, (
        f"got {resp.status_code}. An empty page is indistinguishable from a "
        f"page that cannot be opened, which is how this went unnoticed."
    )
    results = resp.data["results"] if "results" in resp.data else resp.data
    assert len(results) == 1, f"expected this tenant's one row, got {results}"


@pytest.mark.django_db
def test_it_does_not_show_another_tenants_registrations(registrations):
    mine, _, admin = registrations
    resp = _jwt_client(admin, mine).get("/api/v1/death-sync/registrations/")
    # `source_payload` is not serialized, so assert on a field that is --
    # my first version looked for the name and would have "passed" against a
    # response containing both rows.
    body = str(resp.data)
    assert "mine-1" in body
    assert "theirs-1" not in body, (
        "another tenant's death registrations leaked. ADMIN is globally exempt "
        "from tenant scoping by default; this endpoint opts out, for the same "
        "reason the ledger export did."
    )


@pytest.mark.django_db
def test_a_non_admin_is_refused(registrations):
    """Matches ExternalApiKeyViewSet beside it. There is no death_sync codename."""
    mine, _, _ = registrations
    viewer = User.objects.create_user(
        username="dr_viewer", password="x", role="VIEWER", tenant=mine
    )
    resp = _jwt_client(viewer, mine).get("/api/v1/death-sync/registrations/")
    assert resp.status_code == 403, resp.status_code


@pytest.mark.django_db
def test_it_is_read_only(registrations):
    """Writing is the machine endpoint's job, with a key and an idempotency check."""
    mine, _, admin = registrations
    resp = _jwt_client(admin, mine).post(
        "/api/v1/death-sync/registrations/", {}, format="json"
    )
    assert resp.status_code in (403, 405), resp.status_code


@pytest.mark.django_db
def test_the_machine_endpoint_still_refuses_a_jwt(registrations):
    """The split is the point, and it must stay.

    If someone later 'fixes' the 401 by adding JWT auth to the write endpoint,
    `scope_to_api_key` -- which fails closed on a missing key -- would be
    scoping requests that have no key. This is the assertion that notices.
    """
    mine, _, admin = registrations
    resp = _jwt_client(admin, mine).get("/api/v1/death-sync/register/")
    assert resp.status_code == 401, (
        f"the API-key endpoint accepted a JWT ({resp.status_code}); its "
        f"queryset is scoped by api_key, not by tenant"
    )
