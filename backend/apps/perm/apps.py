from django.apps import AppConfig


class PermConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.perm'

    def ready(self):
        # Register Role with the global recycle bin (apps.core.recycle_bin) as
        # reference data, like Menu. Before 2026-09-12 a deleted role was a
        # soft-deleted row nothing listed and nothing could restore (BP-06).
        # Its grants are binned under the same cascade id (see
        # apps/perm/views.py::update_delete_role), so restore brings them back.
        from apps.core.recycle_bin import register_bin_type

        from .models import Role

        register_bin_type("role", Role, "reference", lambda role: role.name)
