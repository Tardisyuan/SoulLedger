"""
Soul app configuration.
"""
from django.apps import AppConfig


class SoulsConfig(AppConfig):
    # `BigAutoField`, not `BigAutoAutoField`. The typo was real: `import_string`
    # on that name raises ImportError. It has never fired because both models in
    # this app declare explicit UUID primary keys, and Django only resolves
    # `default_auto_field` when it has to *generate* an implicit one — so the
    # first model added here without a `primary_key` would have crashed at
    # migration time. A mine, not a fault.
    default_auto_field = "django.db.models.BigAutoField"
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
