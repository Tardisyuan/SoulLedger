"""The one list of scheduled jobs. Everything else in this app reads it.

A job here is a celery task that beat is supposed to fire on a cron. The
`setup_scheduled_tasks` command turns this list into `PeriodicTask` rows (one
per (job, active tenant) for TENANT jobs, one per job for GLOBAL ones); the
signal receivers record a `TaskRun` only for tasks that appear here; the API
lists exactly these. A task that is not here is not "scheduled" as far as this
app is concerned, whatever a PeriodicTask row says.

`key` IS the celery task name, on purpose. The design brief kept them as two
fields; collapsing them removes one mapping to keep in sync, and — the real
reason — the `authentication.flush_expired_tokens` PeriodicTask row that the
old `setup_token_flush_task` command wrote is already named by its task name,
so the new command adopts that row in place instead of deleting and recreating
it (which would have thrown away an operator's enabled/cron changes on the
first boot after this landed).

Tenant-scoped jobs call the existing `*_for_tenant` / `*_tenant` subtasks
directly with `tenant_id=` as a keyword, one row per tenant, instead of the old
fan-out parents (`ledger.recalculate_all` etc.). The parents still exist in
code; their PeriodicTask rows are what `LEGACY_TASKS` below removes.
"""
from dataclasses import dataclass, field

TENANT = "TENANT"
GLOBAL = "GLOBAL"

# Cron fields in django_celery_beat's own order, which is *not* the crontab(5)
# order: the five-field string in each spec below is written the crontab way
# (minute hour day_of_month month day_of_week) because that is what an
# operator will read and type.
CRON_FIELDS = ("minute", "hour", "day_of_month", "month_of_year", "day_of_week")


@dataclass(frozen=True)
class JobSpec:
    key: str
    scope: str
    cron: str
    kwargs: dict = field(default_factory=dict)
    timezone: str = "UTC"
    #: Seconds after which a RUNNING row is presumed dead and marked LOST, and
    #: the TTL of the single-flight lock. Must exceed the honest worst case of
    #: the task; for the every-5-minutes job it must also stay *under* the
    #: period, or a crashed run's lock would make the next tick SKIPPED.
    max_runtime: int = 600

    @property
    def task(self) -> str:
        return self.key

    @property
    def description_key(self) -> str:
        # Dots are nesting separators in the frontend message bundles, so the
        # task name's own dots are flattened.
        return "scheduler.jobs." + self.key.replace(".", "_")

    def periodic_task_name(self, tenant) -> str:
        return self.key if tenant is None else f"{self.key}@{tenant.code}"

    def task_kwargs(self, tenant) -> dict:
        if tenant is None:
            return dict(self.kwargs)
        return {**self.kwargs, "tenant_id": str(tenant.pk)}

    def cron_fields(self) -> dict:
        parts = self.cron.split()
        if len(parts) != 5:
            raise ValueError(f"{self.key}: cron needs 5 fields, got {self.cron!r}")
        return dict(zip(CRON_FIELDS, parts, strict=True))


REGISTRY: tuple[JobSpec, ...] = (
    # ---- tenant-scoped business jobs (one row per active tenant) ----------
    # Every soul's ledger is recomputed; the largest tenant sets the bound.
    JobSpec("ledger.recalculate_tenant", TENANT, "0 0 * * *", max_runtime=3600),
    JobSpec(
        "judgment.auto_conclude_stale_for_tenant", TENANT, "0 1 * * *",
        kwargs={"days_threshold": 30}, max_runtime=1800,
    ),
    JobSpec(
        "death_sync.cleanup_old_requests_for_tenant", TENANT, "0 2 * * *",
        kwargs={"days": 90, "batch_size": 1000}, max_runtime=1800,
    ),
    # ---- global jobs ---------------------------------------------------------
    JobSpec("authentication.flush_expired_tokens", GLOBAL, "30 3 * * *"),
    # Period 300s; lock TTL / LOST threshold 240s so a crashed run cannot make
    # the next tick SKIPPED.
    JobSpec(
        "events.retry_pending_webhooks", GLOBAL, "*/5 * * * *",
        kwargs={"older_than_seconds": 300, "limit": 200}, max_runtime=240,
    ),
    # 灵魂端推送:补发开启前 24 小时内未启用的推送 + 把停住的投递重新入队 + 查 Expo 回执
    # (apps/soul_push/services.py)。
    # 每 5 分钟;回执只查发出满 15 分钟的,所以更密没有意义。锁 240s 同上一条的理由。
    JobSpec("soul_push.sweep", GLOBAL, "*/5 * * * *", max_runtime=240),
    # ---- this app's own maintenance --------------------------------------------
    # Every 5 minutes: the finest-grained job above is 5-minutely, so a stuck
    # run is noticed within one period of its own max_runtime; two indexed
    # UPDATEs, so the frequency costs nothing.
    JobSpec("scheduler.reap_stale_runs", GLOBAL, "*/5 * * * *", max_runtime=240),
    # Every 15 minutes, deliberately coarser than reap: overdue is measured
    # with a 10-minute grace anyway, and each detection is a notification.
    JobSpec("scheduler.check_overdue", GLOBAL, "*/15 * * * *", max_runtime=240),
    # Daily, after the 00:00–02:00 business jobs have written their rows.
    JobSpec("scheduler.prune_runs", GLOBAL, "0 4 * * *", max_runtime=1800),
)

_BY_KEY = {spec.key: spec for spec in REGISTRY}

#: Celery task names whose PeriodicTask rows the sync removes: the fan-out
#: parents that the per-tenant rows replace. Matched on the row's `task`, not
#: its `name`, so a hand-made row pointing at a parent goes too.
LEGACY_TASKS = (
    "ledger.recalculate_all",
    "judgment.auto_conclude_stale",
    "death_sync.cleanup_old_requests",
)


def get(task_name: str) -> JobSpec | None:
    return _BY_KEY.get(task_name)


def tenant_specs() -> list[JobSpec]:
    return [s for s in REGISTRY if s.scope == TENANT]
