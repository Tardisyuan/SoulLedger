"""全局管理员只读进入某殿(第五十四批 O-2,2026-10-27 用户决定)。机制见 `apps/authentication/impersonation.py`。

与代看同一套:一行 `Impersonation`(`hall` 有值)、只读、30 分钟、开始 / 结束审计。每条同时断言有与没有。
"""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.impersonation_models import Impersonation
from apps.souls.models import Soul
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

END = "/api/v1/auth/impersonate/end/"
SOULS = "/api/v1/souls/"


def view_url(tenant):
    return f"/api/v1/tenants/{tenant.code}/view/"


def _entering(admin, hall):
    response = officer_client(admin).post(view_url(hall))
    assert response.status_code == 201, response.content
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return client, response.data


@pytest.fixture
def souls(cn_tenant, eu_tenant):
    return Soul.objects.create(name="本殿的", tenant=cn_tenant), Soul.objects.create(name="别殿的", tenant=eu_tenant)


def test_only_an_admin_can_enter(admin_user, judge_user, eu_tenant, api_client):
    assert officer_client(judge_user).post(view_url(eu_tenant)).status_code == 403
    assert api_client.post(view_url(eu_tenant)).status_code == 401
    assert not Impersonation.objects.exists()
    assert not AuditLog.objects.filter(action=AuditAction.IMPERSONATE_START).exists()
    assert officer_client(admin_user).post(view_url(eu_tenant)).status_code == 201  # 对照


def test_the_token_is_the_admin_scoped_to_that_hall_and_the_start_is_audited(admin_user, eu_tenant):
    _, data = _entering(admin_user, eu_tenant)
    claims = AccessToken(data["access"])
    assert claims["user_id"] == str(admin_user.pk) and claims["tenant_code"] == "EU_HEAVEN_HELL"
    assert admin_user.tenant_id is None  # only the hall-less ADMIN enters a hall (2026-10-29)
    assert claims["imp_id"] == data["impersonation_id"] and "refresh" not in data
    record = Impersonation.objects.get()
    assert (record.hall_id, record.target_id, record.actor_id) == (eu_tenant.pk, admin_user.pk, admin_user.pk)
    start = AuditLog.objects.get(action=AuditAction.IMPERSONATE_START)
    assert (start.user_id, start.resource, start.resource_id, start.tenant_id) == (
        admin_user.pk, "tenant", "EU_HEAVEN_HELL", eu_tenant.pk)


def test_reads_are_narrowed_to_that_hall(admin_user, eu_tenant, souls):
    names = lambda r: {row["name"] for row in r.data["results"]}  # noqa: E731
    assert names(officer_client(admin_user).get(SOULS)) == {"本殿的", "别殿的"}  # 对照:平时跨殿
    viewing, _ = _entering(admin_user, eu_tenant)
    response = viewing.get(SOULS)
    assert response.status_code == 200
    assert names(response) == {"别殿的"} and "本殿的" not in names(response)


def test_an_inactive_hall_can_be_entered_and_read(admin_user, eu_tenant, souls):
    eu_tenant.is_active = False
    eu_tenant.save(update_fields=["is_active"])
    viewing, _ = _entering(admin_user, eu_tenant)
    assert {row["name"] for row in viewing.get(SOULS).data["results"]} == {"别殿的"}


@pytest.mark.parametrize("method,url", [
    ("post", SOULS),
    ("patch", "/api/v1/tenants/EU_HEAVEN_HELL/settings/"),
    ("post", "/api/v1/tenants/EU_HEAVEN_HELL/deactivate/"),
    ("post", "/api/v1/tenants/CN_DIYU/view/"),  # 查看里不能再进别的殿
    ("post", "/api/v1/auth/impersonate/"),
])
def test_every_write_is_refused(admin_user, eu_tenant, method, url):
    viewing, _ = _entering(admin_user, eu_tenant)
    before = (AuditLog.objects.count(), Soul.objects.count(), Impersonation.objects.count())
    response = getattr(viewing, method)(url, {"name": "x", "description": "x", "user_id": 1, "reason": "x"}, format="json")
    assert response.status_code == 403 and response.data["code"] == "impersonation_read_only"
    assert (AuditLog.objects.count(), Soul.objects.count(), Impersonation.objects.count()) == before
    eu_tenant.refresh_from_db()
    assert eu_tenant.is_active and eu_tenant.description != "x"


def test_exit_writes_one_end_row_and_kills_the_token(admin_user, eu_tenant):
    viewing, _ = _entering(admin_user, eu_tenant)
    viewing.get(SOULS, HTTP_X_IMP_PAGE="/judgment")
    assert viewing.post(END).data["ended"] is True
    end = AuditLog.objects.get(action=AuditAction.IMPERSONATE_END)
    assert (end.resource, end.resource_id, end.changes["hall"], end.changes["pages"]) == ("tenant", "EU_HEAVEN_HELL", "EU_HEAVEN_HELL", 1)
    again = viewing.get(SOULS)
    assert again.status_code == 403 and again.data["code"] == "impersonation_ended"
    assert officer_client(admin_user).get(SOULS).status_code == 200  # 管理员自己的会话照旧


def test_it_expires(admin_user, eu_tenant):
    viewing, _ = _entering(admin_user, eu_tenant)
    Impersonation.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    response = viewing.get(SOULS)
    assert response.status_code == 403 and response.data["code"] == "impersonation_expired"
    assert AuditLog.objects.get(action=AuditAction.IMPERSONATE_END).changes["how"] == "expired"


def test_a_token_whose_hall_claim_was_swapped_is_refused(admin_user, eu_tenant, cn_tenant):
    _, data = _entering(admin_user, eu_tenant)
    token = AccessToken(data["access"])
    token["tenant_code"] = cn_tenant.code  # 重签不了;这里模拟一张 imp_id 对不上殿的令牌
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    response = client.get(SOULS)
    assert response.status_code == 403 and response.data["code"] == "impersonation_invalid"


def test_entering_a_hall_supersedes_an_open_session(admin_user, eu_tenant, cn_tenant):
    _entering(admin_user, cn_tenant)
    _entering(admin_user, eu_tenant)
    assert list(Impersonation.objects.filter(ended_at__isnull=True).values_list("hall_id", flat=True)) == [eu_tenant.pk]
    assert AuditLog.objects.filter(action=AuditAction.IMPERSONATE_END, changes__how="superseded").count() == 1


def test_the_session_dies_if_the_admin_loses_the_role(admin_user, eu_tenant):
    viewing, _ = _entering(admin_user, eu_tenant)
    admin_user.role = "JUDGE"
    admin_user.save()
    assert viewing.get(SOULS).status_code == 403


def _rows(response):
    data = response.data
    return data["results"] if isinstance(data, dict) else data


def test_the_users_list_is_narrowed_to_that_hall(admin_user, eu_tenant, cn_tenant, django_user_model):
    django_user_model.objects.create_user(username="cn_judge", password="x" * 16, role="JUDGE", tenant=cn_tenant)
    django_user_model.objects.create_user(username="eu_judge", password="x" * 16, role="JUDGE", tenant=eu_tenant)
    everyone = {row["username"] for row in _rows(officer_client(admin_user).get("/api/v1/users/"))}
    assert {"cn_judge", "eu_judge"} <= everyone  # 对照:平时跨殿
    viewing, _ = _entering(admin_user, eu_tenant)
    response = viewing.get("/api/v1/users/")
    assert response.status_code == 200
    names = {row["username"] for row in _rows(response)}
    assert "eu_judge" in names and "cn_judge" not in names and "admin" not in names


def test_another_halls_soul_is_not_readable_by_id(admin_user, eu_tenant, souls):
    theirs, mine = souls
    viewing, _ = _entering(admin_user, eu_tenant)
    assert viewing.get(f"{SOULS}{mine.pk}/").status_code == 200
    assert viewing.get(f"{SOULS}{theirs.pk}/").status_code == 404


def test_tenant_permission_treats_a_hall_view_as_hall_bound(admin_user, eu_tenant, cn_tenant):
    """`TenantPermission` 的 ADMIN 旁路走 `is_tenant_exempt`:查看中只认这一殿。此前它直接比 `role == "ADMIN"`。"""
    from types import SimpleNamespace

    from apps.core.permissions import TenantPermission

    perm, view = TenantPermission(), SimpleNamespace()
    theirs = Soul.objects.create(name="别殿", tenant=cn_tenant)
    mine = Soul.objects.create(name="本殿", tenant=eu_tenant)
    plain = SimpleNamespace(user=admin_user, tenant=eu_tenant)
    assert perm.has_permission(plain, view) and perm.has_object_permission(plain, view, theirs)  # 对照:平时跨殿

    admin_user.hall_view = eu_tenant.pk
    viewing = SimpleNamespace(user=admin_user, tenant=eu_tenant)
    assert perm.has_permission(viewing, view)
    assert perm.has_object_permission(viewing, view, mine)
    assert not perm.has_object_permission(viewing, view, theirs)
    assert not perm.has_permission(SimpleNamespace(user=admin_user, tenant=cn_tenant), view)
    assert not perm.has_permission(SimpleNamespace(user=admin_user, tenant=None), view)
