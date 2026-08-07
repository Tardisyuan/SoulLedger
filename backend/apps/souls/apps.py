"""
Soul app configuration.
"""
from django.apps import AppConfig


class SoulsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoAutoField"
    name = "apps.souls"
    verbose_name = "Souls"

    def ready(self):
        from apps.core.recycle_bin import register_bin_type

        # Import signal handler to register it
        from . import signals  # noqa: F401
        from .models import Soul

        # Register Soul with the global recycle bin (apps.core.recycle_bin)
        # as a "domain" entity — soft-deletable while it has no concluded
        # judgment, archivable instead once it does. See
        # Soul.has_concluded_judgment and Soul.delete_with_cascade.
        register_bin_type("soul", Soul, "domain", lambda soul: soul.name)
