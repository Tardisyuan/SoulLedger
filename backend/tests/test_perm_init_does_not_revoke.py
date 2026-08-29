"""Seeding a Permission row must not silently revoke what the dict was granting.

`check_permission` (apps/perm/checker.py) treats the database as
authoritative *iff* a row exists for that codename, and otherwise falls back
to the ROLE_PERMISSIONS dict. Creating the row without creating the grants
flips a codename from "granted by the dict" to "seeded but ungranted", which
reads as denied.

`POST /api/v1/perm/init/` did exactly that. Measured 2026-08-29 on a freshly
migrated database: 8 Permission rows existed, the endpoint created 38 more,
answered `200 {"message": "Initialized 38 permissions"}`, and revoked **69**
role-codename grants -- JUDGE lost `soul.read`, `soul.die` and
`judgment.create`; VIEWER lost `soul.read`.

Migration 0017_seed_roles_and_grants names this failure mode in its own
docstring and deliberately refuses to seed the whole catalogue because of it.

These tests are written against `check_permission` rather than against row
counts, because the row count was never the thing that broke. Counting rows is
how this stayed invisible: the response reported 38 created and that number was
true.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.perm.checker import check_permission
from apps.perm.models import (
    DEFAULT_PERMISSIONS,
    ROLE_PERMISSIONS,
    Permission,
    Role,
    RolePermission,
)
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
def admin_client(db):
    tenant = Tenant.objects.get_or_create(
        code="PI_T", defaults={"display_name": "Perm Init"}
    )[0]
    admin = User.objects.create_user(
        username="pi_admin", password="x", role="ADMIN", tenant=tenant
    )
    return _jwt_client(admin, tenant), tenant


_ALL_CODENAMES = sorted({c for c, _, _ in DEFAULT_PERMISSIONS})


def _probe_user(role_name, tenant):
    """One probe per role, reused -- the probe must not vary between readings.

    Creating a fresh user for each reading is what my first version did, and
    it hit a UNIQUE constraint the second time round. Reusing one user is also
    the more honest measurement: the before/after comparison should differ in
    exactly one thing, the endpoint call.
    """
    user, _ = User.objects.get_or_create(
        username=f"probe_{role_name.lower()}",
        defaults={"role": role_name, "tenant": tenant},
    )
    return user


def _effective(role_name, tenant):
    """What a role actually resolves to, through the real checker.

    Deliberately not a row count. The row count was never the thing that broke
    -- the endpoint reported 38 rows created and that number was true.
    """
    user = _probe_user(role_name, tenant)
    return {c for c in _ALL_CODENAMES if check_permission(user, c)}


@pytest.mark.django_db
def test_init_permissions_revokes_nothing(admin_client):
    client, tenant = admin_client
    before = {role: _effective(role, tenant) for role in ROLE_PERMISSIONS}

    resp = client.post("/api/v1/perm/init/", {}, format="json")
    assert resp.status_code == 200, resp.data

    lost = {}
    for role, had in before.items():
        now = _effective(role, tenant)
        missing = had - now
        if missing:
            lost[role] = sorted(missing)

    assert lost == {}, (
        f"POST /perm/init/ revoked grants: {lost}. Seeding a Permission row "
        f"moves that codename from the ROLE_PERMISSIONS fallback to the "
        f"database branch of check_permission; without the matching "
        f"RolePermission rows that reads as denied. The response still says "
        f"'Initialized N permissions', which is true and is why this was "
        f"invisible."
    )


@pytest.mark.django_db
def test_init_permissions_seeds_the_catalogue(admin_client):
    """Positive control: it must still do the job it is named for."""
    client, _ = admin_client
    resp = client.post("/api/v1/perm/init/", {}, format="json")
    assert resp.status_code == 200
    seeded = set(Permission.objects.values_list("codename", flat=True))
    expected = {c for c, _, _ in DEFAULT_PERMISSIONS}
    assert expected <= seeded, sorted(expected - seeded)


@pytest.mark.django_db
def test_init_permissions_does_not_resurrect_a_revoked_grant(admin_client):
    """The fix is additive, and must stay additive.

    Delegating to `init_role_permissions` would have been the shorter fix and
    a different kind of destruction: that endpoint clears every grant and
    rebuilds from the dict, so a grant an operator deliberately removed
    through the UI would come back. An operator asking to "initialize
    permissions" has not asked for that either.
    """
    client, tenant = admin_client
    # Seed everything first, so every codename is DB-authoritative.
    client.post("/api/v1/perm/init/", {}, format="json")

    judge = Role.objects.filter(name="JUDGE").first()
    assert judge is not None, "JUDGE role missing; migration 0017 not applied"
    victim = Permission.objects.filter(codename="soul.read").first()
    assert victim is not None
    RolePermission.objects.filter(role=judge, permission=victim).delete()

    probe = User.objects.create_user(
        username="pi_judge", password="x", role="JUDGE", tenant=tenant
    )
    assert check_permission(probe, "soul.read") is False, (
        "setup failed: the grant was not actually revoked"
    )

    resp = client.post("/api/v1/perm/init/", {}, format="json")
    assert resp.status_code == 200
    assert resp.data["grants_materialized"] == 0, (
        "nothing was newly seeded, so nothing should have been granted"
    )
    assert check_permission(probe, "soul.read") is False, (
        "a deliberately revoked grant came back"
    )
