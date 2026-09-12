"""`/audit-logs/timeline/?limit=` 有上界、非法值 400;`?start_date=` 垃圾值 400 而非 500。

2026-09-12 审计 BP-02 / BP-15。`apps/audit/views.py` 里:

    limit = int(request.query_params.get('limit', 50))

`abc` → ValueError 500;`-1` → 切片 `[:-1]`(Django 拒绝负索引)500;`999999999` →
全表扫描,而且答 **200**。`TIMELINE_MAX_LIMIT = 500` 就定义在同一个文件的第 23 行,
**没有任何一处引用它** —— 2026-08-29 台账 M29 把它记为「已修 1b882b7」,那次 diff
只加了这个常量。记为已修、实际未落地。

`?start_date=垃圾` 在 `get_queryset` 与 `timeline` 两处都直接进 `timestamp__date__gte`,
Django 抛 ValidationError,DRF 不认它 → 500。

身份用 MODERATOR:它持有 `audit.read` 而不是 ADMIN,所以走的是租户过滤那条路。
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.audit.views import TIMELINE_MAX_LIMIT
from apps.authentication.models import User
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant

TIMELINE = "/api/v1/audit-logs/timeline/"
LIST = "/api/v1/audit-logs/"


@pytest.fixture
def moderator_client(db):
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    role, _ = Role.objects.get_or_create(name="MODERATOR", defaults={"display_name": "Realm Lead"})
    perm, _ = Permission.objects.get_or_create(
        codename="audit.read", defaults={"name": "查看审计日志", "category": "audit"}
    )
    RolePermission.objects.get_or_create(role=role, permission=perm)
    user = User.objects.create_user(username="tl_moderator", password="x", role="MODERATOR", tenant=tenant)
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    client.tenant = tenant
    return client


def _seed_timeline_rows(tenant, n):
    AuditLog.objects.bulk_create(
        [
            AuditLog(tenant=tenant, action=AuditAction.PERMISSION_CHANGE, resource="role", resource_id=str(i))
            for i in range(n)
        ]
    )


@pytest.mark.django_db
@pytest.mark.parametrize("bad", ["abc", "-1", "0", "1.5", ""])
def test_a_non_positive_or_non_integer_limit_is_a_400(moderator_client, bad):
    response = moderator_client.get(TIMELINE, {"limit": bad})
    assert response.status_code == 400, (bad, response.status_code, response.content[:200])
    assert "limit" in str(response.data).lower(), response.data


@pytest.mark.django_db
def test_an_absurd_limit_is_clamped_to_the_declared_ceiling(moderator_client):
    _seed_timeline_rows(moderator_client.tenant, TIMELINE_MAX_LIMIT + 25)
    response = moderator_client.get(TIMELINE, {"limit": "999999999"})
    assert response.status_code == 200, response.content[:200]
    assert len(response.data) == TIMELINE_MAX_LIMIT, (
        f"返回了 {len(response.data)} 条 —— TIMELINE_MAX_LIMIT 没有被用上"
    )


@pytest.mark.django_db
def test_the_default_limit_is_still_fifty(moderator_client):
    """顺带钉住的一条:默认时间线(不带 `?resource=`)看得见 `resource="role"` 的行。

    信号写的是 `label_lower`(迁移 0009 也把旧行折成了小写),而 view 里的默认
    过滤清单曾写成 'Role' / 'RolePermission' —— 大小写敏感的 `IN` 一条都匹配不上,
    默认时间线永远是空的。这条测试播的就是小写行。
    """
    _seed_timeline_rows(moderator_client.tenant, 60)
    response = moderator_client.get(TIMELINE)
    assert response.status_code == 200
    assert len(response.data) == 50


@pytest.mark.django_db
@pytest.mark.parametrize("path", [TIMELINE, LIST])
@pytest.mark.parametrize("param", ["start_date", "end_date"])
def test_a_garbage_date_is_a_400_not_a_500(moderator_client, path, param):
    response = moderator_client.get(path, {param: "not-a-date"})
    assert response.status_code == 400, (path, param, response.status_code, response.content[:200])
    assert param in str(response.data), response.data


@pytest.mark.django_db
@pytest.mark.parametrize("path", [TIMELINE, LIST])
def test_a_well_formed_date_still_filters(moderator_client, path):
    response = moderator_client.get(path, {"start_date": "2020-01-01", "end_date": "2099-12-31"})
    assert response.status_code == 200, response.content[:200]
