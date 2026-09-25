"""Permission-matrix rules decided by the product owner on 2026-09-25.

* ADMIN always has everything: a revoke on an ADMIN cell is refused
  (`admin_always_all`) and nothing is written.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant

CHANGES = "/api/v1/perm/role-permissions/changes/"
CODENAMES = ("soul.read", "soul.update")


def _client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    invalidate_all_permissions()
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    for name in UserRole.values:
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})
    perms = {
        c: Permission.objects.get_or_create(codename=c, defaults={"name": c, "category": "soul"})[0]
        for c in CODENAMES
    }
    admin = User.objects.create_user(username="rules_admin", password="x", role="ADMIN", tenant=tenant)
    yield {"tenant": tenant, "perms": perms, "admin": admin, "client": _client(admin)}
    invalidate_all_permissions()


def _held(role, codename):
    return RolePermission.objects.filter(role__name=role, permission__codename=codename).exists()


def _post(world, changes, **extra):
    res = world["client"].post(CHANGES, {"changes": changes, **extra}, format="json")
    assert res.status_code == 200, res.content
    return res.json()


# ── 1. ADMIN always has everything ─────────────────────────────────────


def test_a_revoke_on_an_admin_cell_is_refused_and_nothing_is_written(world):
    admin_role = Role.objects.get(name="ADMIN")
    RolePermission.objects.get_or_create(role=admin_role, permission=world["perms"]["soul.read"])
    version = Role.objects.get(name="ADMIN").version
    body = _post(world, [
        {"role": "ADMIN", "permission_id": world["perms"]["soul.read"].pk, "action": "revoke"},
        {"role": "JUDGE", "permission_id": world["perms"]["soul.update"].pk, "action": "grant"},
    ])
    got = [(r["role"], r["status"], r["code"]) for r in body["results"]]
    assert got == [("ADMIN", "refused", "admin_always_all"), ("JUDGE", "saved", None)]
    assert body["refused"] == 1 and body["saved"] == 1
    assert _held("ADMIN", "soul.read")
    assert Role.objects.get(name="ADMIN").version == version  # no write, no version bump


def test_a_grant_to_admin_is_still_accepted(world):
    body = _post(world, [{"role": "ADMIN", "permission_id": world["perms"]["soul.update"].pk, "action": "grant"}])
    assert [r["status"] for r in body["results"]] == ["saved"]
    assert _held("ADMIN", "soul.update")
