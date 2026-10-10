"""Retention of AuditLog / LoginLog (apps/audit/retention.py).

Defaults are 365 days (AuditLog) and 180 days (LoginLog); 0 means keep forever.
Only expired rows of the task's own tenant go; the other tenant's rows and the
unexpired rows stay.
"""
import os
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.audit.models import AuditAction, AuditLog
from apps.audit.retention import prune_logs
from apps.audit.tasks import prune_logs_for_tenant, prune_untenanted_logs
from apps.authentication.models import LoginLog

OLD = timezone.now() - timedelta(days=400)
FRESH = timezone.now() - timedelta(days=5)


def _audit(tenant, when, tag="probe"):
    row = AuditLog.objects.create(tenant=tenant, action=AuditAction.VIEW, resource=tag)
    AuditLog.objects.filter(pk=row.pk).update(timestamp=when)
    return row.pk


def _login(user, when, username="u"):
    row = LoginLog.objects.create(user=user, username=username, status="SUCCESS")
    LoginLog.objects.filter(pk=row.pk).update(timestamp=when)
    return row.pk


def _alive(model, pks):
    return set(model.all_objects.filter(pk__in=pks).values_list("pk", flat=True))


@pytest.fixture
def world(db, cn_tenant, eu_tenant, admin_user, eu_admin_user):
    cn_user = admin_user
    return {
        "cn_old_audit": _audit(cn_tenant, OLD), "cn_new_audit": _audit(cn_tenant, FRESH),
        "eu_old_audit": _audit(eu_tenant, OLD), "none_old_audit": _audit(None, OLD),
        "cn_old_login": _login(cn_user, OLD), "cn_new_login": _login(cn_user, FRESH),
        "eu_old_login": _login(eu_admin_user, OLD), "ghost_old_login": _login(None, OLD, "nobody"),
    }


ENV_OVERRIDES = pytest.mark.skipif(
    "AUDIT_LOG_RETENTION_DAYS" in os.environ or "LOGIN_LOG_RETENTION_DAYS" in os.environ,
    reason="the environment overrides the defaults under test",
)


@ENV_OVERRIDES
def test_the_defaults_are_a_year_of_audit_and_half_a_year_of_logins(settings):
    assert (settings.AUDIT_LOG_RETENTION_DAYS, settings.LOGIN_LOG_RETENTION_DAYS) == (365, 180)


@ENV_OVERRIDES
def test_the_default_windows_prune_rows_past_them_and_keep_the_rest(world, cn_tenant, settings):
    # No window set here: whatever the settings default to is what runs. OLD is 400 days.
    result = prune_logs_for_tenant(str(cn_tenant.pk))
    assert result["audit_deleted"] == 1 and result["login_deleted"] == 1
    assert _alive(AuditLog, [world["cn_new_audit"]]) == {world["cn_new_audit"]}


def test_zero_still_means_keep_forever(world, cn_tenant, settings):
    settings.AUDIT_LOG_RETENTION_DAYS = settings.LOGIN_LOG_RETENTION_DAYS = 0
    assert prune_logs_for_tenant(str(cn_tenant.pk))["audit_deleted"] == 0


def test_unset_deletes_nothing(world, cn_tenant, settings):
    settings.AUDIT_LOG_RETENTION_DAYS = 0
    settings.LOGIN_LOG_RETENTION_DAYS = 0
    audit_before, login_before = AuditLog.all_objects.count(), LoginLog.all_objects.count()
    result = prune_logs_for_tenant(str(cn_tenant.pk))
    assert result["audit_deleted"] == result["login_deleted"] == 0
    assert prune_untenanted_logs()["login_deleted"] == 0
    assert (AuditLog.all_objects.count(), LoginLog.all_objects.count()) == (audit_before, login_before)


def test_a_tenant_task_deletes_only_its_own_expired_rows(world, cn_tenant, settings):
    settings.AUDIT_LOG_RETENTION_DAYS = 90
    settings.LOGIN_LOG_RETENTION_DAYS = 90
    result = prune_logs_for_tenant(str(cn_tenant.pk))

    assert result["audit_deleted"] == 1 and result["login_deleted"] == 1
    w = world
    assert _alive(AuditLog, [w["cn_old_audit"]]) == set()
    assert _alive(AuditLog, [w["cn_new_audit"], w["eu_old_audit"], w["none_old_audit"]]) == {
        w["cn_new_audit"], w["eu_old_audit"], w["none_old_audit"]}
    assert _alive(LoginLog, [w["cn_old_login"]]) == set()
    assert _alive(LoginLog, [w["cn_new_login"], w["eu_old_login"], w["ghost_old_login"]]) == {
        w["cn_new_login"], w["eu_old_login"], w["ghost_old_login"]}


def test_the_untenanted_task_only_touches_rows_no_tenant_owns(world, settings):
    settings.AUDIT_LOG_RETENTION_DAYS = 90
    settings.LOGIN_LOG_RETENTION_DAYS = 90
    prune_untenanted_logs()
    w = world
    assert _alive(AuditLog, [w["none_old_audit"]]) == set()
    assert _alive(LoginLog, [w["ghost_old_login"]]) == set()
    assert _alive(AuditLog, [w["cn_old_audit"], w["eu_old_audit"]]) == {w["cn_old_audit"], w["eu_old_audit"]}
    assert _alive(LoginLog, [w["cn_old_login"], w["eu_old_login"]]) == {w["cn_old_login"], w["eu_old_login"]}


def test_each_window_is_independent(world, cn_tenant, settings):
    settings.AUDIT_LOG_RETENTION_DAYS = 90
    settings.LOGIN_LOG_RETENTION_DAYS = 0
    prune_logs_for_tenant(str(cn_tenant.pk))
    assert _alive(AuditLog, [world["cn_old_audit"]]) == set()
    assert _alive(LoginLog, [world["cn_old_login"]]) == {world["cn_old_login"]}


def test_batches_cover_a_backlog_and_deleting_login_rows_writes_no_per_row_audit(
    cn_tenant, admin_user, settings, django_capture_on_commit_callbacks
):
    settings.LOGIN_LOG_RETENTION_DAYS = 90
    with django_capture_on_commit_callbacks(execute=True):
        pks = [_login(admin_user, OLD) for _ in range(5)]
    audit_rows = AuditLog.all_objects.count()
    # Audit rows are written on commit, so run the callbacks or a per-row post_delete would go unseen.
    with django_capture_on_commit_callbacks(execute=True):
        result = prune_logs(cn_tenant, batch_size=2)
    assert result["login_deleted"] == 5 and _alive(LoginLog, pks) == set()
    # Only the single summary row is added; a per-row post_delete would have added five.
    assert AuditLog.all_objects.count() == audit_rows + 1


def test_the_run_leaves_a_trace(world, cn_tenant, settings):
    settings.AUDIT_LOG_RETENTION_DAYS = 90
    prune_logs_for_tenant(str(cn_tenant.pk))
    trace = AuditLog.objects.get(resource="audit_retention", tenant=cn_tenant)
    assert trace.changes["audit_deleted"] == 1 and trace.changes["tenant"] == cn_tenant.code
    assert trace.changes["audit_cutoff"]


def test_the_jobs_are_in_the_schedule_registry():
    from apps.scheduler import registry

    assert registry.get("audit.prune_logs_for_tenant").scope == registry.TENANT
    assert registry.get("audit.prune_untenanted_logs").scope == registry.GLOBAL
