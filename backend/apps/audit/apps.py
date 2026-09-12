from django.apps import AppConfig


class AuditConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.audit'

    def ready(self):
        # THE ONE PLACE audit signals are wired. `connect_audit_signals` decides
        # which models are audited and which receivers each gets (pre_save for
        # the diff, post_save, post_delete, plus the permission-cache handler
        # on Role / RolePermission).
        #
        # Until 2026-09-12 (BP-10 / DB-01) there were two mechanisms: this
        # loop, which connected post_save/post_delete only, and a lazy
        # `_auto_connect_signals` receiver on *every* post_save in signals.py
        # that added pre_save on a model's first save and excluded
        # Role / RolePermission / SoulEvent. This loop bypassed those
        # exclusions and never connected pre_save for Role, so a role rename
        # produced an UPDATE audit row with `changes=None`.
        import logging

        from django.apps import apps

        from apps.audit.signals import connect_audit_signals

        connected = sum(1 for model in apps.get_models() if connect_audit_signals(model))
        if connected:
            logging.getLogger(__name__).debug(f"Connected audit signals to {connected} models")
