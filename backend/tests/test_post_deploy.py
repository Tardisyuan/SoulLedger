"""post_deploy, the Sentry-valid monitor slugs, and the beat single-instance guard."""
import re
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django_celery_beat.models import PeriodicTask

from apps.ledger.models import BalanceSnapshot
from apps.scheduler import beat_guard, registry
from apps.scheduler.models import ScheduledJob
from apps.scheduler.services import sync_schedules

SLUG = re.compile(r"^[a-z0-9_-]{1,50}$")


def _clean_slate():
    """Creating a tenant already registers its rows (post_save); start from none."""
    PeriodicTask.objects.all().delete()


def _run(*args):
    out = StringIO()
    call_command("post_deploy", *args, stdout=out)
    return out.getvalue()


# -- slugs ------------------------------------------------------------------

@pytest.mark.django_db
def test_every_registered_task_tenant_pair_yields_a_valid_unique_slug(cn_tenant, eu_tenant):
    names = [s.periodic_task_name(t) for s in registry.REGISTRY for t in ((None,) if s.scope == registry.GLOBAL else (cn_tenant, eu_tenant))]
    assert len(names) == len(set(names))
    assert all(SLUG.match(n) for n in names), [n for n in names if not SLUG.match(n)]


def test_slug_is_deterministic_and_does_not_merge_names_sanitising_would():
    assert registry.monitor_slug("a.b@CN") == registry.monitor_slug("a.b@CN")
    assert len({registry.monitor_slug(n) for n in ("a.b", "a-b", "A.B", "a.b@CN", "a.b@cn")}) == 5
    long = registry.monitor_slug("x" * 80 + "@CN")
    assert SLUG.match(long) and long != registry.monitor_slug("x" * 80 + "@EU")


@pytest.mark.django_db
def test_a_row_with_the_old_name_is_renamed_in_place_keeping_operator_edits(cn_tenant):
    sync_schedules()
    spec = next(s for s in registry.REGISTRY if s.key == "ledger.recalculate_tenant")
    job = ScheduledJob.objects.get(job_key=spec.key, tenant=cn_tenant)
    PeriodicTask.objects.filter(pk=job.periodic_task_id).update(name=spec.legacy_name(cn_tenant), enabled=False)

    sync_schedules()

    pt = PeriodicTask.objects.get(pk=job.periodic_task_id)  # same row, not recreated
    assert pt.name == spec.periodic_task_name(cn_tenant) and pt.enabled is False


# -- post_deploy ------------------------------------------------------------

@pytest.mark.django_db
def test_refuses_with_an_unapplied_migration(cn_tenant, monkeypatch):
    from django.db.migrations.executor import MigrationExecutor

    class _M:
        app_label, name = "ledger", "9999_pending"

    _clean_slate()
    monkeypatch.setattr(MigrationExecutor, "migration_plan", lambda self, targets, clean_start=False: [(_M(), False)])
    with pytest.raises(CommandError, match="ledger.9999_pending"):
        _run()
    assert not ScheduledJob.objects.exists()


@pytest.mark.django_db
def test_registers_snapshots_once_and_reports_per_tenant(cn_tenant, eu_tenant):
    _clean_slate()
    out = _run()
    n_tenant = sum(s.scope == registry.TENANT for s in registry.REGISTRY)
    assert f"{cn_tenant.code}: {n_tenant}" in out and f"{eu_tenant.code}: {n_tenant}" in out
    assert BalanceSnapshot.objects.count() == 2 and "snapshot_balances: written" in out

    again = _run()
    assert "already written today, skipped" in again
    assert BalanceSnapshot.objects.count() == 2
    assert ScheduledJob.objects.count() == len(registry.REGISTRY) - n_tenant + 2 * n_tenant


@pytest.mark.django_db
def test_dry_run_changes_nothing_but_reports_the_real_counts(cn_tenant):
    _clean_slate()
    out = _run("--dry-run")
    assert not ScheduledJob.objects.exists() and not PeriodicTask.objects.exists()
    assert not BalanceSnapshot.objects.exists()
    assert "would run snapshot_balances" in out and "rolled back" in out
    assert f"{cn_tenant.code}: " in out


@pytest.mark.django_db
def test_warns_for_each_env_feature_that_is_off(cn_tenant, settings):
    settings.SENTRY_DSN, settings.MATRIX_ENABLED = "", False
    settings.EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
    out = _run("--dry-run")
    for needle in ("SENTRY_DSN is empty", "MATRIX_ENABLED is off", "mail is not delivered", "no celery beat"):
        assert needle in out, needle
    settings.SENTRY_DSN, settings.MATRIX_ENABLED = "https://x@y/1", True
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    settings.EMAIL_HOST = "smtp.example.test"
    out = _run("--dry-run")
    assert "SENTRY_DSN" not in out and "MATRIX_ENABLED" not in out and "EMAIL" not in out


# -- beat guard -------------------------------------------------------------

def test_a_second_beat_is_refused_and_the_first_keeps_the_key():
    assert beat_guard.claim("host-a:1") == (True, None)
    assert beat_guard.claim("host-b:2") == (False, "host-a:1")
    assert beat_guard.holder() == "host-a:1"


def test_guard_beat_exits_when_the_key_is_held(monkeypatch):
    beat_guard.claim("host-a:1")
    monkeypatch.setattr(beat_guard, "_owner", lambda: "host-b:2")
    with pytest.raises(SystemExit) as exc:
        beat_guard.guard_beat()
    assert exc.value.code == 1


def test_guard_is_wired_to_celery_beat_init():
    from celery import signals

    from apps.scheduler import signals as _  # noqa: F401

    assert any(r[0][0] == "scheduler_beat_guard" for r in signals.beat_init.receivers)
