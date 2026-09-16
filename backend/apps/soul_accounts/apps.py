from django.apps import AppConfig


class SoulAccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.soul_accounts"
    verbose_name = "Soul accounts"

    def ready(self):
        from . import schema, signals  # noqa: F401
