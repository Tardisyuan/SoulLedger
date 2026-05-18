"""
Soul app configuration.
"""
from django.apps import AppConfig


class SoulsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoAutoField"
    name = "apps.souls"
    verbose_name = "Souls"

    def ready(self):
        # Import signal handler to register it
        from . import signals  # noqa: F401
