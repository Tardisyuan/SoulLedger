"""W-12: an admin can rerun a death registration that failed with INTERNAL_ERROR.

Only INTERNAL_ERROR (user decision 2026-10-16). SOUL_NOT_FOUND, SOUL_NOT_ALIVE,
INVALID_TRANSITION, VALIDATION_ERROR stay FAILED and are only shown: running
them again gives the same answer. The retry runs on the existing row, because
`register_death` inserts a new one and the idempotency key belongs to this one.

Not covered here: two concurrent clicks. `retry_failed` takes
`select_for_update` on the row; SQLite ignores it, so only a PostgreSQL test
could show the second click waiting and then getting 409 NOT_FAILED.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.death_sync.models import DeathRegistrationRequest, DeathRegistrationStatus, ExternalApiKey
from apps.death_sync.services import DeathSyncService
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _url(reg):
    return f"/api/v1/death-sync/registrations/{reg.id}/retry/"


@pytest.fixture
def setup(db):
    tenant = Tenant.objects.get_or_create(code="DR_RETRY", defaults={"display_name": "Retry"})[0]
    _, key_hash, prefix = ExternalApiKey.generate_key()
    key = ExternalApiKey.objects.create(
        tenant=tenant, name="k", system_type="HOSPITAL", key_hash=key_hash, key_prefix=prefix,
    )
    soul = Soul.objects.create(name="Retry Soul", tenant=tenant)
    admin = User.objects.create_user(username="dr_retry_admin", password="x", role="ADMIN", tenant=tenant)
    return tenant, key, soul, admin


def _internal_error_row(monkeypatch, tenant, key, soul, idem="retry-1"):
    """A real INTERNAL_ERROR row: register_death with die() blowing up."""
    def boom(*a, **kw):
        raise RuntimeError("db hiccup")

    with monkeypatch.context() as m:
        m.setattr(Soul, "die", boom)
        reg = DeathSyncService.register_death(
            tenant=tenant, api_key=key,
            payload={"soul_lookup": {"soul_id": str(soul.id)}, "death_date": "2026-06-01"},
            idempotency_key=idem,
        )
    assert reg.status == DeathRegistrationStatus.FAILED
    assert reg.error_code == "INTERNAL_ERROR"
    assert reg.judgment_id is None
    return reg


@pytest.mark.django_db
def test_retry_processes_the_same_row(setup, monkeypatch):
    tenant, key, soul, admin = setup
    reg = _internal_error_row(monkeypatch, tenant, key, soul)

    resp = _jwt_client(admin, tenant).post(_url(reg))

    assert resp.status_code == 200, resp.data
    assert resp.data["id"] == str(reg.id)
    assert resp.data["status"] == DeathRegistrationStatus.PROCESSED
    assert resp.data["retry_count"] == 1
    assert resp.data["error_code"] == ""
    reg.refresh_from_db()
    assert reg.status == DeathRegistrationStatus.PROCESSED
    assert reg.judgment_id is not None
    soul.refresh_from_db()
    assert soul.current_state != SoulState.ALIVE
    # No second row under the same key.
    assert DeathRegistrationRequest.objects.filter(tenant=tenant).count() == 1


@pytest.mark.django_db
def test_a_retry_that_fails_again_stays_failed_and_counts(setup, monkeypatch):
    tenant, key, soul, admin = setup
    reg = _internal_error_row(monkeypatch, tenant, key, soul)

    def boom_again(*a, **kw):
        raise RuntimeError("again")

    monkeypatch.setattr(Soul, "die", boom_again)

    resp = _jwt_client(admin, tenant).post(_url(reg))

    assert resp.status_code == 200
    assert resp.data["status"] == DeathRegistrationStatus.FAILED
    assert resp.data["error_code"] == "INTERNAL_ERROR"
    assert resp.data["retry_count"] == 1


@pytest.mark.django_db
@pytest.mark.parametrize("code", ["SOUL_NOT_FOUND", "SOUL_NOT_ALIVE", "INVALID_TRANSITION", "VALIDATION_ERROR"])
def test_other_failure_reasons_are_refused(setup, code):
    tenant, key, _, admin = setup
    reg = DeathRegistrationRequest.objects.create(
        tenant=tenant, api_key=key, source_system="HOSPITAL", idempotency_key=f"r-{code}",
        source_payload={}, status=DeathRegistrationStatus.FAILED, error_code=code,
    )
    resp = _jwt_client(admin, tenant).post(_url(reg))
    assert resp.status_code == 409
    assert resp.data["code"] == "NOT_RETRYABLE"
    reg.refresh_from_db()
    assert reg.retry_count == 0
    assert reg.error_code == code


@pytest.mark.django_db
def test_a_row_that_did_not_fail_is_refused(setup):
    tenant, key, _, admin = setup
    reg = DeathRegistrationRequest.objects.create(
        tenant=tenant, api_key=key, source_system="HOSPITAL", idempotency_key="r-ok",
        source_payload={}, status=DeathRegistrationStatus.PROCESSED,
    )
    resp = _jwt_client(admin, tenant).post(_url(reg))
    assert resp.status_code == 409
    assert resp.data["code"] == "NOT_FAILED"


@pytest.mark.django_db
def test_max_retries_is_refused(setup):
    tenant, key, _, admin = setup
    reg = DeathRegistrationRequest.objects.create(
        tenant=tenant, api_key=key, source_system="HOSPITAL", idempotency_key="r-max",
        source_payload={}, status=DeathRegistrationStatus.FAILED, error_code="INTERNAL_ERROR",
        retry_count=3, max_retries=3,
    )
    resp = _jwt_client(admin, tenant).post(_url(reg))
    assert resp.status_code == 409
    assert resp.data["code"] == "MAX_RETRIES"
    reg.refresh_from_db()
    assert reg.retry_count == 3


@pytest.mark.django_db
def test_a_non_admin_is_refused(setup, monkeypatch):
    tenant, key, soul, _ = setup
    reg = _internal_error_row(monkeypatch, tenant, key, soul)
    viewer = User.objects.create_user(username="dr_retry_viewer", password="x", role="VIEWER", tenant=tenant)
    resp = _jwt_client(viewer, tenant).post(_url(reg))
    assert resp.status_code == 403
    reg.refresh_from_db()
    assert reg.retry_count == 0


@pytest.mark.django_db
def test_another_tenants_row_is_not_found(setup, monkeypatch):
    tenant, key, soul, _ = setup
    reg = _internal_error_row(monkeypatch, tenant, key, soul)
    other = Tenant.objects.get_or_create(code="DR_RETRY_OTHER", defaults={"display_name": "Other"})[0]
    other_admin = User.objects.create_user(username="dr_retry_other", password="x", role="ADMIN", tenant=other)
    resp = _jwt_client(other_admin, other).post(_url(reg))
    assert resp.status_code == 404
    reg.refresh_from_db()
    assert reg.retry_count == 0
    assert reg.status == DeathRegistrationStatus.FAILED


# ── 重试仍失败要向上反馈(用户 2026-10-16 定):错误日志、审计行、通知本租户的 ADMIN ──

def _escalations():
    from apps.notifications.models import NotificationType, UserNotification

    return UserNotification.objects.filter(notification_type=NotificationType.DEATH_SYNC_RETRY_FAILED)


@pytest.mark.django_db
def test_a_failed_retry_is_logged_audited_and_sent_to_this_tenants_admins_only(setup, monkeypatch, caplog):
    import logging

    from apps.audit.models import AuditLog

    tenant, key, soul, admin = setup
    reg = _internal_error_row(monkeypatch, tenant, key, soul)
    second_admin = User.objects.create_user(username="dr_retry_admin2", password="x", role="ADMIN", tenant=tenant)
    User.objects.create_user(username="dr_retry_viewer2", password="x", role="VIEWER", tenant=tenant)
    other = Tenant.objects.get_or_create(code="DR_RETRY_ELSE", defaults={"display_name": "Else"})[0]
    User.objects.create_user(username="dr_retry_else_admin", password="x", role="ADMIN", tenant=other)

    def boom_again(*a, **kw):
        raise RuntimeError("secret-name-in-error")

    monkeypatch.setattr(Soul, "die", boom_again)
    with caplog.at_level(logging.ERROR, logger="apps.death_sync.views"):
        resp = _jwt_client(admin, tenant).post(_url(reg))

    assert resp.status_code == 200
    line = next(r.getMessage() for r in caplog.records if r.name == "apps.death_sync.views")
    assert str(reg.id) in line and tenant.code in line and "INTERNAL_ERROR" in line and "retry_count=1/" in line
    # 只带错误码,不带 error_message(它可能引用负载里的个人资料)。
    assert "secret-name-in-error" not in line

    audit = AuditLog.objects.get(resource="DeathRegistrationRequest", resource_id=str(reg.id), action="EXECUTE")
    assert audit.user_id == admin.pk and audit.tenant_id == tenant.pk
    assert audit.changes == {"error_code": "INTERNAL_ERROR", "retry_count": 1}

    notes = _escalations()
    # 本租户的两位 ADMIN;同租户的 VIEWER、别的租户的 ADMIN 都没有。
    assert sorted(n.user_id for n in notes) == sorted([admin.pk, second_admin.pk])
    note = notes.first()
    assert note.related_resource == "death_sync" and note.related_id == str(reg.id)
    assert note.params["reason"] == "INTERNAL_ERROR" and note.params["count"] == 1
    assert "secret-name-in-error" not in note.message


@pytest.mark.django_db
def test_a_retry_whose_payload_no_longer_validates_is_escalated_too(setup, monkeypatch):
    tenant, key, soul, admin = setup
    reg = _internal_error_row(monkeypatch, tenant, key, soul)
    reg.source_payload = {"soul_lookup": {}}  # 不再通过创建序列化器 → VALIDATION_ERROR
    reg.save()

    resp = _jwt_client(admin, tenant).post(_url(reg))

    assert resp.status_code == 200
    assert resp.data["error_code"] == "VALIDATION_ERROR"
    assert [n.user_id for n in _escalations()] == [admin.pk]


@pytest.mark.django_db
def test_a_successful_retry_escalates_nothing(setup, monkeypatch, caplog):
    import logging

    from apps.audit.models import AuditLog

    tenant, key, soul, admin = setup
    reg = _internal_error_row(monkeypatch, tenant, key, soul)
    with caplog.at_level(logging.ERROR, logger="apps.death_sync.views"):
        resp = _jwt_client(admin, tenant).post(_url(reg))

    assert resp.data["status"] == DeathRegistrationStatus.PROCESSED
    assert not [r for r in caplog.records if r.name == "apps.death_sync.views"]
    assert not _escalations().exists()
    assert not AuditLog.objects.filter(resource="DeathRegistrationRequest", action="EXECUTE").exists()
