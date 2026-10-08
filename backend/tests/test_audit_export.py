"""`GET /audit-logs/export/` —— 与列表同一组筛选、同一租户划界、同一权限的 CSV。

文件取自 `filter_queryset(get_queryset())`,即列表跑的那一条,所以下面每条都拿列表当对照:
同一组参数下,文件的行数等于列表的 `count`。身份用 MODERATOR(持 `audit.read`、非 ADMIN),
走租户过滤那条路。
"""
import csv
import io

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant

EXPORT = "/api/v1/audit-logs/export/"
LIST = "/api/v1/audit-logs/"


def _client_for(user, tenant):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def tenant(db):
    return Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]


@pytest.fixture
def moderator(db, tenant):
    role, _ = Role.objects.get_or_create(name="MODERATOR", defaults={"display_name": "Realm Lead"})
    perm, _ = Permission.objects.get_or_create(
        codename="audit.read", defaults={"name": "查看审计日志", "category": "audit"}
    )
    RolePermission.objects.get_or_create(role=role, permission=perm)
    user = User.objects.create_user(username="exp_moderator", password="x", role="MODERATOR", tenant=tenant)
    return _client_for(user, tenant)


@pytest.fixture
def rows(tenant):
    other = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "埃及杜阿特"})[0]
    AuditLog.objects.bulk_create([
        AuditLog(tenant=tenant, action=AuditAction.CREATE, resource="soul", resource_id="1", description="建魂"),
        AuditLog(tenant=tenant, action=AuditAction.UPDATE, resource="soul", resource_id="2", description="改魂"),
        AuditLog(tenant=tenant, action=AuditAction.DELETE, resource="realm", resource_id="3", description="删界"),
        AuditLog(tenant=other, action=AuditAction.CREATE, resource="soul", resource_id="9", description="别殿的"),
    ])


def _csv(response):
    return list(csv.reader(io.StringIO(response.content.decode())))


@pytest.mark.django_db
def test_the_file_is_the_list_for_the_same_filters_and_nothing_from_another_tenant(moderator, rows):
    response = moderator.get(EXPORT)
    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/csv")
    header, *body = _csv(response)
    assert header[:6] == ["Timestamp", "Tenant", "User", "Action", "Resource", "Resource ID"]
    assert len(body) == moderator.get(LIST).json()["count"] == 3
    assert {r[1] for r in body} == {"CN_DIYU"}
    assert "9" not in {r[5] for r in body}


@pytest.mark.django_db
@pytest.mark.parametrize("params", [{"action": "CREATE"}, {"resource": "realm"}, {"resource_id": "2"}])
def test_every_list_filter_narrows_the_file_the_same_way(moderator, rows, params):
    body = _csv(moderator.get(EXPORT, params))[1:]
    assert 0 < len(body) < 3
    assert len(body) == moderator.get(LIST, params).json()["count"]


@pytest.mark.django_db
def test_a_malformed_date_is_a_400_not_a_file(moderator, rows):
    assert moderator.get(EXPORT, {"start_date": "垃圾"}).status_code == 400


@pytest.mark.django_db
def test_a_formula_in_free_text_is_neutralised(moderator, tenant):
    AuditLog.objects.create(
        tenant=tenant, action=AuditAction.UPDATE, resource="=cmd()", resource_id="1",
        description='=HYPERLINK("http://evil","x")',
    )
    _, row = _csv(moderator.get(EXPORT))
    assert row[4] == "'=cmd()"
    assert row[6].startswith("'=HYPERLINK")


@pytest.mark.django_db
def test_without_audit_read_it_is_refused(tenant, rows):
    user = User.objects.create_user(username="exp_viewer", password="x", role="VIEWER", tenant=tenant)
    assert _client_for(user, tenant).get(EXPORT).status_code == 403


@pytest.mark.django_db
def test_over_the_limit_is_a_400_never_a_truncated_file(moderator, rows, monkeypatch):
    monkeypatch.setattr("apps.audit.views.EXPORT_MAX_ROWS", 2)
    response = moderator.get(EXPORT)
    assert response.status_code == 400
    assert response["Content-Type"].startswith("application/json")
