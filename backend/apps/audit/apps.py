from django.apps import AppConfig


class AuditConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.audit'

    def ready(self):
        # Connect audit signals to all models inheriting from AuditUserFields
        from django.apps import apps
        from django.db.models.signals import post_save, post_delete
        from apps.core.models import AuditUserFields
        from apps.audit.signals import _on_post_save, _on_post_delete

        connected = 0
        for model in apps.get_models():
            if model is AuditUserFields or not issubclass(model, AuditUserFields):
                continue
            if model._meta.abstract:
                continue
            if model._meta.label.split('.')[-1].startswith('Audit'):
                continue

            post_save.connect(_on_post_save, sender=model, dispatch_uid=f"audit_{model.__name__}_post_save")
            post_delete.connect(_on_post_delete, sender=model, dispatch_uid=f"audit_{model.__name__}_post_delete")
            connected += 1

        if connected:
            import logging
            logging.getLogger(__name__).debug(f"Connected audit signals to {connected} models")
