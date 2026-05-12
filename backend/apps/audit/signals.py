"""
Audit signals for automatic operation logging.

When a model inheriting from AuditUserFields is created/updated/deleted,
this signal automatically creates an AuditLog entry.

Signals are connected via Django's class_prepared signal when models are
registered, so audit logging starts working before any model is saved.
"""
import logging
from django.db.models.signals import post_save, post_delete, pre_migrate, post_migrate
from django.dispatch import receiver

logger = logging.getLogger(__name__)

_connected_models = set()
_in_migration = False  # Guard: skip audit log creation during migrations


def _is_migration_context():
    """Check if we're currently in a migration or test database setup."""
    global _in_migration
    return _in_migration


@receiver(pre_migrate)
def _on_pre_migrate(sender, **kwargs):
    """Set migration guard before migrations run."""
    global _in_migration
    _in_migration = True
    logger.debug("Audit signals: entering migration context")


@receiver(post_migrate)
def _on_post_migrate(sender, **kwargs):
    """Clear migration guard after migrations complete."""
    global _in_migration
    _in_migration = False
    logger.debug("Audit signals: exiting migration context")


def _get_resource_name(instance):
    """Derive resource name from model._meta.label_lower."""
    return instance._meta.label_lower.split('.')[-1]


def _build_changes(instance, old_instance=None):
    """
    Build a changes dict from old->new field values.
    Only tracks fields on AuditUserFields (not internal fields).
    """
    if old_instance is None:
        return None

    changes = {}
    skip_fields = {'id', 'version', 'sort_code', 'create_time', 'update_time',
                    'create_user', 'update_user', 'tenant', '_state'}

    for field in instance._meta.fields:
        if field.name in skip_fields or field.name.startswith('_'):
            continue
        old_val = getattr(old_instance, field.name, None)
        new_val = getattr(instance, field.name, None)
        if old_val != new_val:
            changes[field.name] = [str(old_val) if old_val is not None else None,
                                   str(new_val) if new_val is not None else None]
    return changes if changes else None


def _create_audit_log(action, instance, changes=None):
    """Create an AuditLog entry for the given action."""
    # Skip during migrations to avoid schema-not-ready errors
    if _is_migration_context():
        return

    from apps.audit.models import AuditLog, AuditAction

    try:
        user = None
        try:
            from apps.core.request_local import get_current_user
            user = get_current_user()
        except Exception:
            pass

        tenant = None
        try:
            from apps.tenants.middleware import get_current_tenant
            tenant = get_current_tenant()
        except Exception:
            pass

        request = None
        try:
            from apps.core.request_local import get_current_request
            request = get_current_request()
        except Exception:
            pass

        ip_address = ''
        user_agent = ''
        if request:
            ip_address = _get_client_ip(request) or ''
            user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]

        AuditLog.objects.create(
            tenant=tenant,
            user=user,
            action=action,
            resource=_get_resource_name(instance),
            resource_id=str(instance.pk) if instance.pk else '',
            changes=changes,
            ip_address=ip_address,
            user_agent=user_agent,
            description=f"{action} {instance._meta.verbose_name}",
        )
    except Exception as e:
        # Silently ignore errors during migrations when database schema is incomplete
        err_str = str(e).lower()
        migration_related = any(x in err_str for x in [
            'no such table', 'undefinedtable', 'does not exist',
            'relation', 'column', 'constraint', 'programmingerror'
        ])
        if migration_related:
            return
        logger.error(f"Failed to create audit log: {e}")


def _get_client_ip(request):
    """Extract client IP from request, handling proxies."""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', None)


def _on_post_save(sender, instance, created, **kwargs):
    """Handle post_save - log CREATE or UPDATE."""
    from apps.audit.models import AuditAction

    action = AuditAction.CREATE if created else AuditAction.UPDATE
    changes = None
    if not created:
        try:
            old_instance = sender.objects.get(pk=instance.pk)
            changes = _build_changes(instance, old_instance)
        except Exception:
            pass
    _create_audit_log(action, instance, changes)


def _on_post_delete(sender, instance, **kwargs):
    """Handle post_delete - log DELETE."""
    from apps.audit.models import AuditAction
    _create_audit_log(AuditAction.DELETE, instance)


def _connect_model_signals(model):
    """Connect audit signals to a single model."""
    if model in _connected_models:
        return
    if model._meta.abstract:
        return
    # Skip self (AuditLog model)
    if model._meta.label.split('.')[-1].startswith('Audit'):
        return

    post_save.connect(_on_post_save, sender=model, dispatch_uid=f"audit_{model.__name__}_post_save")
    post_delete.connect(_on_post_delete, sender=model, dispatch_uid=f"audit_{model.__name__}_post_delete")
    _connected_models.add(model)
    logger.debug(f"Connected audit signals for {model.__name__}")


@receiver(post_save)
def _auto_connect_signals(sender, **kwargs):
    """
    Auto-connect signals on first save.
    Uses dispatch_uid to avoid duplicate connections.
    """
    _connect_model_signals(sender)
