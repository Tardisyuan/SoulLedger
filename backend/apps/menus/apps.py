from django.apps import AppConfig


class MenusConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.menus'

    def ready(self):
        # Register Menu with the global recycle bin (apps.core.recycle_bin)
        # as "reference" data — 30-day bin window, hard delete available to
        # administrators after that. See Stage 4 §4.7.
        from django.db.models.signals import post_delete, post_save

        from apps.core.recycle_bin import register_bin_type

        from .models import Menu, MenuButton
        from .views import bump_menus

        for model in (Menu, MenuButton):  # the sidebar's per-process copy (apps/menus/views.py::menu_rows)
            post_save.connect(bump_menus, sender=model, dispatch_uid=f"menus-save-{model.__name__}")
            post_delete.connect(bump_menus, sender=model, dispatch_uid=f"menus-delete-{model.__name__}")
        register_bin_type(
            "menu", Menu, "reference", lambda menu: menu.name,
            location=lambda menu: {"kind": "parent", "value": menu.parent.name} if menu.parent_id else None,
        )
