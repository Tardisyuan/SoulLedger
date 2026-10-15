"""`/audit-logs/?user_id=abc` was `qs.filter(user_id='abc')` -> ValueError -> 500. A malformed id is a 400.
Also: the detail's `user_details.tenant` is the user's hall, not the log's; `?trace_id=` filters the list."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant

LIST = "/api/v1/audit-logs/"


@pytest.fixture
def world(db):
    cn, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    eg, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Duat"})
    role, _ = Role.objects.get_or_create(name="MODERATOR", defaults={"display_name": "Realm Lead"})
    perm, _ = Permission.objects.get_or_create(codename="audit.read", defaults={"name": "r", "category": "audit"})
    RolePermission.objects.get_or_create(role=role, permission=perm)
    user = User.objects.create_user(username="au_mod", password="x", role="MODERATOR", tenant=cn)
    token = RefreshToken.for_user(user)
    token["tenant_code"] = cn.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return {"client": client, "user": user, "cn": cn, "eg": eg}


def test_a_non_integer_user_id_is_a_400(world):
    r = world["client"].get(LIST, {"user_id": "abc"})
    assert r.status_code == 400 and "user_id" in r.data


def test_a_numeric_user_id_still_filters(world):
    AuditLog.objects.create(tenant=world["cn"], user=world["user"], action=AuditAction.UPDATE, resource="soul")
    AuditLog.objects.create(tenant=world["cn"], user=None, action=AuditAction.UPDATE, resource="soul")
    r = world["client"].get(LIST, {"user_id": str(world["user"].pk)})
    assert r.status_code == 200 and r.data["count"] == 1


def test_trace_id_filters_the_list(world):
    for trace in ("t-1", "t-1", "t-2"):
        AuditLog.objects.create(tenant=world["cn"], action=AuditAction.UPDATE, resource="soul", trace_id=trace)
    assert world["client"].get(LIST, {"trace_id": "t-1"}).data["count"] == 2


def test_detail_user_tenant_is_the_users_own(world):
    """A row logged under the EG hall but acted by a CN user (a global admin works across halls)."""
    admin = User.objects.create_user(username="au_admin", password="x", role="ADMIN", tenant=None)
    admin.tenant = world["cn"]  # the user's own hall
    admin.save()
    log = AuditLog.objects.create(tenant=world["eg"], user=admin, action=AuditAction.UPDATE, resource="soul")
    from apps.audit.serializers import AuditLogDetailSerializer

    assert AuditLogDetailSerializer(log).data["user_details"]["tenant"] == "CN_DIYU"
