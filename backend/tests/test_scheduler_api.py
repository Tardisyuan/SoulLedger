"""`/api/v1/scheduler/` through the real URLconf with real JWTs.

The tenant assertions are the ones that matter: a non-ADMIN with
`scheduler.read` / `scheduler.manage` sees and edits only its own tenant's
rows, and never a GLOBAL row — asserted as absence, not just as presence.
"""
import pytest
from django_celery_beat.models import CrontabSchedule, PeriodicTask
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.scheduler import services
from apps.scheduler.models import RunStatus, ScheduledJob, TaskRun
from apps.scheduler.services import sync_schedules

JOBS = "/api/v1/scheduler/jobs/"
RUNS = "/api/v1/scheduler/runs/"


def _bearer(user):
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}


@pytest.fixture
def judge_with_manage(judge_user):
    from apps.perm.models import Permission, Role, RolePermission

    role = Role.objects.get(name="JUDGE")
    for codename in ("scheduler.read", "scheduler.manage"):
        RolePermission.objects.create(role=role, permission=Permission.objects.get(codename=codename))
    return judge_user


@pytest.fixture
def synced(cn_tenant, eu_tenant):
    sync_schedules()
    return {
        "cn": ScheduledJob.objects.get(job_key="ledger.recalculate_tenant", tenant=cn_tenant),
        "eu": ScheduledJob.objects.get(job_key="ledger.recalculate_tenant", tenant=eu_tenant),
        "global": ScheduledJob.objects.get(job_key="authentication.flush_expired_tokens"),
    }


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_admin_sees_every_row_including_global_and_the_read_shape_is_complete(api_client, admin_user, synced):
    resp = api_client.get(JOBS, **_bearer(admin_user))
    assert resp.status_code == 200
    rows = {r["periodic_task_name"]: r for r in resp.json()}
    assert "authentication.flush_expired_tokens" in rows
    assert synced["cn"].periodic_task.name in rows and synced["eu"].periodic_task.name in rows
    row = rows[synced["cn"].periodic_task.name]
    assert row["scope"] == "TENANT" and row["tenant_code"] == "CN_DIYU"
    assert row["task_name"] == "ledger.recalculate_tenant"
    assert (row["minute"], row["hour"], row["timezone"]) == ("0", "0", "UTC")
    assert row["enabled"] is True and row["overdue"] is False and row["last_run"] is None
    assert row["next_run_at"] is not None and row["consecutive_failures"] == 0
    assert row["description_key"] == "scheduler.jobs.ledger_recalculate_tenant"
    assert rows["authentication.flush_expired_tokens"]["scope"] == "GLOBAL"
    assert rows["authentication.flush_expired_tokens"]["tenant"] is None


@pytest.mark.django_db
def test_a_judge_with_read_sees_only_its_tenant_and_no_global_row(api_client, judge_with_manage, synced):
    resp = api_client.get(JOBS, **_bearer(judge_with_manage))
    assert resp.status_code == 200
    names = {r["periodic_task_name"] for r in resp.json()}
    assert names and all(n.endswith("@CN_DIYU") for n in names), names
    assert synced["eu"].periodic_task.name not in names
    assert "authentication.flush_expired_tokens" not in names

    assert api_client.get(f"{JOBS}{synced['eu'].pk}/", **_bearer(judge_with_manage)).status_code == 404
    assert api_client.get(f"{JOBS}{synced['global'].pk}/", **_bearer(judge_with_manage)).status_code == 404


@pytest.mark.django_db
def test_a_judge_without_the_codename_is_refused(api_client, judge_user, synced):
    assert api_client.get(JOBS, **_bearer(judge_user)).status_code == 403
    assert api_client.get(RUNS, **_bearer(judge_user)).status_code == 403


@pytest.mark.django_db
def test_a_judge_cannot_patch_another_tenants_or_a_global_row(api_client, judge_with_manage, synced):
    for job in (synced["eu"], synced["global"]):
        resp = api_client.patch(f"{JOBS}{job.pk}/", {"enabled": False}, format="json", **_bearer(judge_with_manage))
        assert resp.status_code == 404, resp.content
        assert PeriodicTask.objects.get(pk=job.periodic_task_id).enabled is True


@pytest.mark.django_db
def test_runs_are_tenant_scoped_and_filterable(api_client, judge_with_manage, admin_user, synced):
    TaskRun.objects.create(job=synced["cn"], task_name="x", celery_task_id="cn1", tenant=synced["cn"].tenant, status=RunStatus.SUCCESS)
    TaskRun.objects.create(job=synced["cn"], task_name="x", celery_task_id="cn2", tenant=synced["cn"].tenant, status=RunStatus.FAILURE)
    TaskRun.objects.create(job=synced["eu"], task_name="x", celery_task_id="eu1", tenant=synced["eu"].tenant, status=RunStatus.SUCCESS)
    TaskRun.objects.create(job=synced["global"], task_name="x", celery_task_id="g1", status=RunStatus.SUCCESS)

    judge = api_client.get(RUNS, **_bearer(judge_with_manage)).json()
    assert {r["celery_task_id"] for r in judge["results"]} == {"cn1", "cn2"}
    failed = api_client.get(RUNS, {"status": "FAILURE"}, **_bearer(judge_with_manage)).json()
    assert {r["celery_task_id"] for r in failed["results"]} == {"cn2"}
    everything = api_client.get(RUNS, **_bearer(admin_user)).json()
    assert {r["celery_task_id"] for r in everything["results"]} == {"cn1", "cn2", "eu1", "g1"}
    by_job = api_client.get(RUNS, {"job": synced["eu"].pk}, **_bearer(admin_user)).json()
    assert {r["celery_task_id"] for r in by_job["results"]} == {"eu1"}


def _ids(resp):
    assert resp.status_code == 200, resp.content
    return {r["celery_task_id"] for r in resp.json()["results"]}


@pytest.mark.django_db
def test_run_history_filters_status_list_time_range_and_search(api_client, admin_user, synced):
    from datetime import timedelta

    from django.utils import timezone

    now = timezone.now()
    cn = synced["cn"]
    TaskRun.objects.create(job=cn, task_name="ledger.recalculate_tenant", celery_task_id="ok", tenant=cn.tenant, status=RunStatus.SUCCESS, queued_at=now - timedelta(days=1))
    TaskRun.objects.create(job=cn, task_name="ledger.recalculate_tenant", celery_task_id="boom", tenant=cn.tenant, status=RunStatus.FAILURE, queued_at=now - timedelta(days=2), error="ZeroDivisionError: karma")
    TaskRun.objects.create(job=cn, task_name="ledger.recalculate_tenant", celery_task_id="lost", tenant=cn.tenant, status=RunStatus.LOST, queued_at=now - timedelta(days=10))
    TaskRun.objects.create(job=synced["global"], task_name="authentication.flush_expired_tokens", celery_task_id="g", status=RunStatus.SKIPPED, queued_at=now)
    auth = _bearer(admin_user)

    assert _ids(api_client.get(RUNS, {"status": "FAILURE,LOST"}, **auth)) == {"boom", "lost"}
    assert _ids(api_client.get(RUNS, {"status": "SKIPPED"}, **auth)) == {"g"}
    window = {"queued_after": (now - timedelta(days=3)).isoformat(), "queued_before": (now - timedelta(hours=12)).isoformat()}
    assert _ids(api_client.get(RUNS, window, **auth)) == {"ok", "boom"}
    # search matches the error text and the task name, case-insensitively.
    assert _ids(api_client.get(RUNS, {"search": "zerodivision"}, **auth)) == {"boom"}
    assert _ids(api_client.get(RUNS, {"search": "flush_expired"}, **auth)) == {"g"}
    # newest first
    resp = api_client.get(RUNS, **auth).json()
    assert [r["celery_task_id"] for r in resp["results"]] == ["g", "ok", "boom", "lost"]


@pytest.mark.django_db
def test_run_history_filters_and_search_never_reach_past_the_tenant_scope(api_client, judge_with_manage, synced):
    """The new filters narrow the scoped queryset; none of them can widen it —
    not a status list naming the foreign row's status, not ?tenant=<other>,
    not a search hitting the foreign / GLOBAL row's error text."""
    TaskRun.objects.create(job=synced["cn"], task_name="x", celery_task_id="mine", tenant=synced["cn"].tenant, status=RunStatus.FAILURE, error="needle mine")
    TaskRun.objects.create(job=synced["eu"], task_name="x", celery_task_id="eu", tenant=synced["eu"].tenant, status=RunStatus.FAILURE, error="needle eu")
    TaskRun.objects.create(job=synced["global"], task_name="x", celery_task_id="g", status=RunStatus.LOST, error="needle global")
    auth = _bearer(judge_with_manage)

    assert _ids(api_client.get(RUNS, {"status": "FAILURE,LOST"}, **auth)) == {"mine"}
    assert _ids(api_client.get(RUNS, {"search": "needle"}, **auth)) == {"mine"}
    assert _ids(api_client.get(RUNS, {"search": "needle eu"}, **auth)) == set()
    assert _ids(api_client.get(RUNS, {"search": "needle global"}, **auth)) == set()
    assert _ids(api_client.get(RUNS, {"tenant": synced["eu"].tenant_id}, **auth)) == set()
    assert _ids(api_client.get(RUNS, {"queued_after": "2000-01-01T00:00:00Z"}, **auth)) == {"mine"}


# ---------------------------------------------------------------------------
# PATCH
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_patch_repoints_to_a_new_schedule_and_leaves_the_shared_one_untouched(api_client, judge_with_manage, synced):
    cn, eu = synced["cn"], synced["eu"]
    assert cn.periodic_task.crontab_id == eu.periodic_task.crontab_id  # shared row
    shared_id = cn.periodic_task.crontab_id

    resp = api_client.patch(
        f"{JOBS}{cn.pk}/", {"hour": "5", "minute": "30", "timezone": "Asia/Shanghai", "enabled": False},
        format="json", **_bearer(judge_with_manage),
    )
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert (body["minute"], body["hour"], body["timezone"], body["enabled"]) == ("30", "5", "Asia/Shanghai", False)

    shared = CrontabSchedule.objects.get(pk=shared_id)
    assert (shared.minute, shared.hour, str(shared.timezone)) == ("0", "0", "UTC")
    assert PeriodicTask.objects.get(pk=eu.periodic_task_id).crontab_id == shared_id
    assert PeriodicTask.objects.get(pk=cn.periodic_task_id).crontab_id != shared_id

    log = AuditLog.objects.filter(resource="ScheduledJob", resource_id=str(cn.pk), action="UPDATE").latest("create_time")
    assert log.user == judge_with_manage and log.tenant == cn.tenant
    assert log.changes["hour"] == {"old": "0", "new": "5"} and log.changes["enabled"] == {"old": True, "new": False}
    assert "minute" in log.changes and "timezone" in log.changes and "day_of_week" not in log.changes


@pytest.mark.django_db
def test_patch_rejects_a_bad_cron_and_a_bad_timezone(api_client, admin_user, synced):
    job = synced["global"]
    # One good write first, so the "no further audit row" assertion below is
    # measured against a table this test has provably written to (the
    # on-commit guard in pytest.ini refuses an absence check on an empty one).
    assert api_client.patch(f"{JOBS}{job.pk}/", {"enabled": True}, format="json", **_bearer(admin_user)).status_code == 200
    audit_rows = AuditLog.objects.filter(resource="ScheduledJob", resource_id=str(job.pk)).count()
    assert audit_rows == 1
    before = PeriodicTask.objects.get(pk=job.periodic_task_id).crontab_id

    assert api_client.patch(f"{JOBS}{job.pk}/", {"hour": "25"}, format="json", **_bearer(admin_user)).status_code == 400
    assert api_client.patch(f"{JOBS}{job.pk}/", {"minute": "not-a-minute"}, format="json", **_bearer(admin_user)).status_code == 400
    assert api_client.patch(f"{JOBS}{job.pk}/", {"timezone": "Mars/Olympus"}, format="json", **_bearer(admin_user)).status_code == 400
    assert PeriodicTask.objects.get(pk=job.periodic_task_id).crontab_id == before
    assert AuditLog.objects.filter(resource="ScheduledJob", resource_id=str(job.pk)).count() == audit_rows


@pytest.mark.django_db
def test_put_is_not_routed(api_client, admin_user, synced):
    resp = api_client.put(f"{JOBS}{synced['global'].pk}/", {"enabled": False}, format="json", **_bearer(admin_user))
    assert resp.status_code == 405


# ---------------------------------------------------------------------------
# run / rebuild
# ---------------------------------------------------------------------------

@pytest.fixture
def fake_send(monkeypatch):
    import config.celery

    sent = []
    monkeypatch.setattr(config.celery.app, "send_task", lambda *a, **k: sent.append((a, k)))
    return sent


@pytest.mark.django_db
def test_run_enqueues_a_pending_row_and_409s_while_the_lock_is_held(api_client, judge_with_manage, synced, fake_send):
    from django.core.cache import cache

    cn = synced["cn"]
    resp = api_client.post(f"{JOBS}{cn.pk}/run/", **_bearer(judge_with_manage))
    assert resp.status_code == 202, resp.content
    body = resp.json()
    assert body["status"] == "PENDING" and body["trigger"] == "MANUAL" and body["triggered_by"] == judge_with_manage.pk
    assert len(fake_send) == 1
    (name,), kwargs = fake_send[0]
    assert name == "ledger.recalculate_tenant"
    assert kwargs["kwargs"] == {"tenant_id": str(cn.tenant_id)} and kwargs["task_id"] == body["celery_task_id"]
    assert AuditLog.objects.filter(resource="ScheduledJob", resource_id=str(cn.pk), action="EXECUTE").exists()

    key = services.lock_key(cn.job_key, cn.tenant_id)
    cache.add(key, "running-elsewhere", timeout=60)
    try:
        resp = api_client.post(f"{JOBS}{cn.pk}/run/", **_bearer(judge_with_manage))
        assert resp.status_code == 409
        assert len(fake_send) == 1 and TaskRun.objects.filter(job=cn).count() == 1
    finally:
        cache.delete(key)


@pytest.mark.django_db
def test_run_reports_a_broker_failure_and_marks_the_row(api_client, admin_user, synced, monkeypatch):
    import config.celery

    def refuse(*a, **k):
        raise ConnectionError("broker down")

    monkeypatch.setattr(config.celery.app, "send_task", refuse)
    resp = api_client.post(f"{JOBS}{synced['global'].pk}/run/", **_bearer(admin_user))
    assert resp.status_code == 503
    run = TaskRun.objects.get(job=synced["global"])
    assert run.status == RunStatus.FAILURE and "broker down" in run.error


@pytest.mark.django_db
def test_run_on_a_foreign_or_global_row_is_404_for_a_judge(api_client, judge_with_manage, synced, fake_send):
    for job in (synced["eu"], synced["global"]):
        assert api_client.post(f"{JOBS}{job.pk}/run/", **_bearer(judge_with_manage)).status_code == 404
    assert fake_send == [] and TaskRun.objects.count() == 0


@pytest.mark.django_db
def test_rebuild_is_admin_only_and_restores_missing_rows(api_client, admin_user, judge_with_manage, synced):
    assert api_client.post(f"{JOBS}rebuild/", **_bearer(judge_with_manage)).status_code == 403

    synced["cn"].periodic_task.delete()
    resp = api_client.post(f"{JOBS}rebuild/", **_bearer(admin_user))
    assert resp.status_code == 200, resp.content
    assert resp.json()["created"] == 1
    assert ScheduledJob.objects.filter(job_key="ledger.recalculate_tenant", tenant=synced["cn"].tenant).exists()
    assert AuditLog.objects.filter(resource="ScheduledJob", resource_id="rebuild", action="EXECUTE").exists()


# ---------------------------------------------------------------------------
# health
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_health_detailed_exposes_overdue_jobs(client, admin_user, synced):
    from datetime import timedelta

    from django.utils import timezone

    ok = client.get("/health/detailed/", **_bearer(admin_user))
    assert ok.status_code == 200 and ok.json()["scheduler"] == "ok" and "scheduler_overdue" not in ok.json()

    job = synced["global"]  # 03:30 UTC daily
    long_ago = timezone.now() - timedelta(days=3)
    ScheduledJob.objects.filter(pk=job.pk).update(created_at=long_ago)
    PeriodicTask.objects.filter(pk=job.periodic_task_id).update(date_changed=long_ago)

    bad = client.get("/health/detailed/", **_bearer(admin_user))
    # 200 and status "ok" on purpose: overdue is reported, not escalated —
    # database/redis keep their 503 semantics, a dead beat is not this process.
    assert bad.status_code == 200
    assert bad.json()["scheduler"] == "overdue" and bad.json()["status"] == "ok"
    assert bad.json()["scheduler_overdue"] == ["authentication.flush_expired_tokens"]
