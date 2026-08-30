"""Seeding a Permission row must never revoke what the dict was granting.

`check_permission` (apps/perm/checker.py) treats the database as authoritative
*iff* a row exists for that codename, and otherwise falls back to the
ROLE_PERMISSIONS dict. So creating the row without creating the grants flips a
codename from "granted by the dict" to "seeded but ungranted", which reads as
denied.

`POST /api/v1/perm/init/` did exactly that. Measured 2026-08-29 on a freshly
migrated database: 8 Permission rows existed, the endpoint created 38 more,
answered `200 {"message": "Initialized 38 permissions"}`, and revoked **69**
role-codename grants -- JUDGE lost `soul.read`, `soul.die` and
`judgment.create`; VIEWER lost `soul.read`. Migration
0017_seed_roles_and_grants names this failure mode in its own docstring and
deliberately refuses to seed the whole catalogue because of it.

That endpoint is gone (2026-08-30). `POST /perm/role-permissions/init/` seeds
rows *and* grants and is the only entry point now.

**Deleting an endpoint is not the same as removing a class of defect**, which
is why this file did not shrink to a 404 assertion. The property that matters
is "no admin action leaves a codename seeded-but-ungranted", and it is
asserted here against the surviving endpoint, through `check_permission`
rather than through row counts -- the row count was never the thing that
broke. The old endpoint reported 38 rows created and that number was true.
"""
import pytest
from django.contrib.auth import get_user_model
from django.urls import NoReverseMatch, reverse
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
_ALL_CODENAMES = sorted({c for c, _, _ in DEFAULT_PERMISSIONS})


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


def _probe_user(role_name, tenant):
    """One probe per role, reused.

    A fresh user per reading hit a UNIQUE constraint the second time round,
    and reusing one is the more honest measurement anyway: the before/after
    comparison should differ in exactly one thing, the endpoint call.
    """
    user, _ = User.objects.get_or_create(
        username=f"probe_{role_name.lower()}",
        defaults={"role": role_name, "tenant": tenant},
    )
    return user


def _effective(role_name, tenant):
    """What a role actually resolves to, through the real checker.

    Deliberately not a row count.
    """
    return {
        c for c in _ALL_CODENAMES if check_permission(_probe_user(role_name, tenant), c)
    }


def test_the_endpoint_that_could_only_do_half_the_job_is_gone():
    with pytest.raises(NoReverseMatch):
        reverse("perm:init")


@pytest.mark.django_db
def test_the_seeding_endpoint_revokes_nothing(admin_client):
    """The surviving entry point, held to the property the other one broke."""
    client, tenant = admin_client
    before = {role: _effective(role, tenant) for role in ROLE_PERMISSIONS}

    resp = client.post("/api/v1/perm/role-permissions/init/", {}, format="json")
    assert resp.status_code == 200, resp.data

    lost = {}
    for role, had in before.items():
        missing = had - _effective(role, tenant)
        if missing:
            lost[role] = sorted(missing)

    assert lost == {}, (
        f"seeding revoked grants: {lost}. Creating a Permission row moves that "
        f"codename from the ROLE_PERMISSIONS fallback to the database branch "
        f"of check_permission; without the matching RolePermission rows that "
        f"reads as denied, and the response still says success."
    )


@pytest.mark.django_db
def test_the_seeding_endpoint_actually_seeds(admin_client):
    """Positive control. An endpoint that does nothing also revokes nothing."""
    client, _ = admin_client
    assert Permission.objects.count() < len(DEFAULT_PERMISSIONS), (
        "the catalogue is already complete before the call -- this test would "
        "pass without the endpoint doing anything"
    )
    resp = client.post("/api/v1/perm/role-permissions/init/", {}, format="json")
    assert resp.status_code == 200
    seeded = set(Permission.objects.values_list("codename", flat=True))
    assert set(_ALL_CODENAMES) <= seeded, sorted(set(_ALL_CODENAMES) - seeded)


@pytest.mark.django_db
def test_no_codename_is_ever_left_seeded_but_ungranted(admin_client):
    """The property itself, independent of which endpoint produced the state.

    A row with no grant behind it denies a role that ROLE_PERMISSIONS says
    should hold it. Checking this directly means a future endpoint that
    reintroduces the half-job is caught by its effect, not by its name.
    """
    client, tenant = admin_client
    client.post("/api/v1/perm/role-permissions/init/", {}, format="json")

    orphaned = []
    for role_name, codenames in ROLE_PERMISSIONS.items():
        role = Role.objects.filter(name=role_name).first()
        if role is None:
            continue
        granted = set(
            RolePermission.objects.filter(role=role).values_list(
                "permission__codename", flat=True
            )
        )
        for codename in codenames:
            if not Permission.objects.filter(codename=codename).exists():
                continue  # not seeded: the dict branch still answers for it
            if codename not in granted:
                orphaned.append(f"{role_name}:{codename}")

    assert orphaned == [], (
        f"{len(orphaned)} codename(s) are seeded as Permission rows without the "
        f"grant ROLE_PERMISSIONS says the role holds, so check_permission's "
        f"database branch denies them: {orphaned[:10]}"
    )
