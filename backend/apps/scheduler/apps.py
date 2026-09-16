from django.apps import AppConfig


class SchedulerConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.scheduler"
    verbose_name = "Scheduler"

    def ready(self) -> None:
        # Connects the celery signal receivers (task lifecycle → TaskRun rows,
        # worker_ready → orphan cleanup) and the Tenant post_save receiver
        # (new tenant → its per-tenant schedule rows). Import-time connection,
        # same shape as apps.events / apps.audit.
        from apps.scheduler import signals  # noqa: F401
