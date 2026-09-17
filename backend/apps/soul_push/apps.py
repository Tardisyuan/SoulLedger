from django.apps import AppConfig


class SoulPushConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.soul_push"
    verbose_name = "Soul push notifications"

    def ready(self):
        from . import signals  # noqa: F401
