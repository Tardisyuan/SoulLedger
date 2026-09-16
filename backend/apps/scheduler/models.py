"""Schedule rows and their execution history.

`ScheduledJob` is a thin owner record over django_celery_beat's `PeriodicTask`:
beat keeps reading PeriodicTask/CrontabSchedule exactly as before, and this row
says which registry entry and which tenant that PeriodicTask belongs to, plus
the alert state. It deliberately does NOT inherit `AuditUserFields`: these rows
are written by the boot command and by celery, never by a person, so
create_user/soft-delete would be a NULL and an unused flag on every row. The
operator-visible changes (PATCH / run / rebuild) are written to the audit log
explicitly by the view instead — see views.py.

`TaskRun` is the high-volume table: one row per execution of a registered task,
written by celery signal receivers in the worker process (signals.py). Plain
model for the same reason, and because the audit signal machinery on every
insert would double the write cost of every run for rows nobody edits.
"""
from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.scheduler import registry


class JobScope(models.TextChoices):
    TENANT = "TENANT", "Tenant"
    GLOBAL = "GLOBAL", "Global"


class RunStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    RUNNING = "RUNNING", "Running"
    SUCCESS = "SUCCESS", "Success"
    FAILURE = "FAILURE", "Failure"
    RETRY = "RETRY", "Retry"
    SKIPPED = "SKIPPED", "Skipped"
    LOST = "LOST", "Lost"


#: States a run is still in flight. The reaper closes these; prune never
#: touches them.
OPEN_STATUSES = (RunStatus.PENDING, RunStatus.RUNNING, RunStatus.RETRY)
#: States a later signal must never overwrite. SKIPPED is set by the lock gate
#: before the task body ran and is followed by a SUCCESS postrun for the no-op;
#: LOST is deliberately *not* here — a run the reaper gave up on that then
#: finishes after all gets its real outcome recorded.
FINAL_STATUSES = (RunStatus.SUCCESS, RunStatus.FAILURE, RunStatus.SKIPPED)


class RunTrigger(models.TextChoices):
    SCHEDULE = "SCHEDULE", "Schedule"
    MANUAL = "MANUAL", "Manual"


ERROR_MAX = 4000
RESULT_MAX = 500


class ScheduledJob(models.Model):
    periodic_task = models.OneToOneField(
        "django_celery_beat.PeriodicTask",
        on_delete=models.CASCADE,
        related_name="scheduled_job",
    )
    job_key = models.CharField(max_length=200, db_index=True)
    # NULL = a GLOBAL job. Visible to ADMIN only: scope_to_tenant filters on
    # `tenant=<the caller's tenant>`, which a NULL never matches.
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="scheduled_jobs",
    )
    consecutive_failures = models.PositiveIntegerField(default=0)
    last_alerted_at = models.DateTimeField(null=True, blank=True)
    overdue_alerted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    # (job_key, tenant) uniqueness is carried by PeriodicTask.name being unique
    # and the name being a pure function of the pair (registry.JobSpec
    # .periodic_task_name); a UniqueConstraint here would not cover the NULL
    # tenant on either database without PG15-only `nulls_distinct`.

    class Meta:
        ordering = ["tenant__code", "job_key"]

    def __str__(self) -> str:
        return self.periodic_task.name if self.periodic_task_id else self.job_key

    @property
    def spec(self) -> registry.JobSpec | None:
        return registry.get(self.job_key)

    @property
    def scope(self) -> str:
        return JobScope.GLOBAL if self.tenant_id is None else JobScope.TENANT

    @property
    def max_runtime(self) -> int:
        spec = self.spec
        return spec.max_runtime if spec else 600


class TaskRun(models.Model):
    job = models.ForeignKey(
        ScheduledJob, on_delete=models.SET_NULL, null=True, blank=True, related_name="runs"
    )
    task_name = models.CharField(max_length=200)
    celery_task_id = models.CharField(max_length=64, unique=True)
    tenant = models.ForeignKey(
        "tenants.Tenant", on_delete=models.SET_NULL, null=True, blank=True, related_name="task_runs"
    )
    trigger = models.CharField(max_length=10, choices=RunTrigger.choices, default=RunTrigger.SCHEDULE)
    status = models.CharField(max_length=10, choices=RunStatus.choices, default=RunStatus.PENDING, db_index=True)
    queued_at = models.DateTimeField(default=timezone.now)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)
    worker_hostname = models.CharField(max_length=255, blank=True, default="")
    error = models.TextField(blank=True, default="")
    result = models.CharField(max_length=RESULT_MAX, blank=True, default="")
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["-queued_at"]
        indexes = [
            models.Index(fields=["job", "-queued_at"], name="taskrun_job_queued"),
            models.Index(fields=["task_name", "-queued_at"], name="taskrun_task_queued"),
        ]

    def __str__(self) -> str:
        return f"{self.task_name} {self.status} {self.celery_task_id}"

    def finish(self, status: str, *, error: str = "", result: str = "") -> None:
        now = timezone.now()
        self.status = status
        self.finished_at = now
        if self.started_at is not None:
            self.duration_ms = int((now - self.started_at).total_seconds() * 1000)
        if error:
            self.error = error[:ERROR_MAX]
        if result:
            self.result = result[:RESULT_MAX]
        self.save(update_fields=["status", "finished_at", "duration_ms", "error", "result"])
