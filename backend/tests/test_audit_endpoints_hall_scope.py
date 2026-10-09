"""`resources`, `stats`, `timeline` and `by_trace` follow the rule the list and export already do
(2026-10-09, user decision): only a GLOBAL admin (ADMIN with no hall) reads across halls; an ADMIN
bound to a hall, and everyone else, sees their own hall's rows only.

Each endpoint is asked by a global admin (sees both halls) and by a hall-bound ADMIN (sees only
their own hall, and none of the other hall's rows anywhere in the body).
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User
from apps.tenants.models import Tenant

BASE = "/api/v1/audit-logs/"
TRACE = "trace-shared-by-both-halls"


def _client(user, tenant=None):
    token = RefreshToken.for_user(user)
    if tenant is not None:
        token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def halls(db):
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    eg = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "埃及杜阿特"})[0]
    AuditLog.objects.bulk_create([
        AuditLog(tenant=cn, action=AuditAction.CREATE, resource="soul", resource_id="1", description="cn-soul", trace_id=TRACE),
        AuditLog(tenant=cn, action=AuditAction.UPDATE, resource="role", resource_id="1", description="cn-role", trace_id=TRACE),
        AuditLog(tenant=eg, action=AuditAction.DELETE, resource="statute", resource_id="9", description="eg-statute", trace_id=TRACE),
        AuditLog(tenant=eg, action=AuditAction.UPDATE, resource="role", resource_id="9", description="eg-role", trace_id=TRACE),
    ])
    return cn, eg


@pytest.fixture
def global_admin(db):
    return _client(User.objects.create_user(username="g_admin", password="x", role="ADMIN", tenant=None))


@pytest.fixture
def bound_admin(halls):
    cn, _ = halls
    return _client(User.objects.create_user(username="b_admin", password="x", role="ADMIN", tenant=cn), cn)


def _descriptions(res):
    assert res.status_code == 200, res.content
    return sorted(row["description"] for row in res.json())


def test_resources_global_admin_sees_every_hall_bound_admin_only_their_own(global_admin, bound_admin, halls):
    assert global_admin.get(BASE + "resources/").json() == ["role", "soul", "statute"]
    own = bound_admin.get(BASE + "resources/")
    assert own.json() == ["role", "soul"]
    assert "statute" not in own.content.decode()


def test_stats_global_admin_counts_every_hall_bound_admin_only_their_own(global_admin, bound_admin, halls):
    assert global_admin.get(BASE + "stats/").json()["total_logs"] == 4
    own = bound_admin.get(BASE + "stats/")
    assert own.status_code == 200
    body = own.json()
    assert body["total_logs"] == 2
    assert {r["resource"] for r in body["top_resources"]} == {"soul", "role"}
    assert {r["action"] for r in body["action_distribution"]} == {"CREATE", "UPDATE"}


def test_stats_stays_closed_to_non_admins(halls):
    cn, _ = halls
    mod = _client(User.objects.create_user(username="m", password="x", role="MODERATOR", tenant=cn), cn)
    assert mod.get(BASE + "stats/").status_code == 403


def test_timeline_global_admin_sees_every_hall_bound_admin_only_their_own(global_admin, bound_admin, halls):
    assert _descriptions(global_admin.get(BASE + "timeline/")) == ["cn-role", "eg-role"]
    assert _descriptions(bound_admin.get(BASE + "timeline/")) == ["cn-role"]
    # an explicit resource filter does not widen it
    assert _descriptions(bound_admin.get(BASE + "timeline/", {"resource": "role"})) == ["cn-role"]
    assert "eg-" not in bound_admin.get(BASE + "timeline/", {"resource": "statute"}).content.decode()


def test_by_trace_global_admin_sees_every_hall_bound_admin_only_their_own(global_admin, bound_admin, halls):
    url = f"{BASE}trace/{TRACE}/"
    assert _descriptions(global_admin.get(url)) == ["cn-role", "cn-soul", "eg-role", "eg-statute"]
    own = bound_admin.get(url)
    assert _descriptions(own) == ["cn-role", "cn-soul"]
    assert "eg-" not in own.content.decode()

