from django.apps import AppConfig


class MenusConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.menus'

    def ready(self):
        # Register Menu with the global recycle bin (apps.core.recycle_bin)
        # as "reference" data — 30-day bin window, hard delete available to
        # administrators after that. See Stage 4 §4.7.
        from apps.core.recycle_bin import register_bin_type

        from .models import Menu
        register_bin_type("menu", Menu, "reference", lambda menu: menu.name)
