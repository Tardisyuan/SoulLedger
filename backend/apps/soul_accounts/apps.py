from django.apps import AppConfig


class SoulAccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.soul_accounts"
    verbose_name = "Soul accounts"

    def ready(self):
        # JWTs signed with a SECRET_KEY_FALLBACKS key still verify (apps/core/jwt_fallback.py).
        from apps.core.jwt_fallback import install

        from . import schema, signals  # noqa: F401

        install()
