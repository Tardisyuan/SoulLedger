"""`GET /perm/role-permissions/all/`: every role's grants in one response (perf review 2026-10-27 #10).

The permissions page used to ask `roles/<name>/permissions/` once per role. The bulk read must say,
role for role, exactly what the per-role read says, and stay ADMIN-only like it.
"""
import pytest
from rest_framework.test import APIClient

from apps.authentication.models import User, UserRole
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant

URL = "/api/v1/perm/role-permissions/all/"


def _client(role):
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN_DIYU"})
    user = User.objects.create_user(username=f"bulk-{role}", password="x", role=role, tenant=tenant)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_each_role_reads_as_its_own_endpoint_reads():
    for name in (UserRole.ADMIN, UserRole.JUDGE, UserRole.VIEWER):
        Role.objects.get_or_create(name=name, defaults={"display_name": name})
    read = Permission.objects.get_or_create(codename="soul.read", defaults={"name": "r", "category": "soul"})[0]
    Permission.objects.get_or_create(codename="soul.delete", defaults={"name": "d", "category": "soul"})
    RolePermission.objects.get_or_create(role=Role.objects.get(name=UserRole.VIEWER), permission=read)
    admin = _client(UserRole.ADMIN)

    response = admin.get(URL)
    assert response.status_code == 200
    by_role = {row["role"]: row for row in response.data}
    assert set(by_role) == set(Role.objects.values_list("name", flat=True))
    for name, row in by_role.items():
        single = admin.get(f"/api/v1/perm/roles/{name}/permissions/").data
        assert row["permissions"] == single["permissions"], name
        assert [d["id"] for d in row["details"]] == [d["id"] for d in single["details"]], name


@pytest.mark.django_db
def test_a_viewer_cannot_read_every_roles_grants():
    Role.objects.get_or_create(name=UserRole.VIEWER, defaults={"display_name": "v"})
    assert _client(UserRole.VIEWER).get(URL).status_code == 403
