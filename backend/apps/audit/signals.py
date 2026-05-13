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


def _invalidate_permission_cache(sender, instance, created=False, **kwargs):
    """
    Invalidate permission cache and create audit log when Role or RolePermission changes.
    """
    from apps.perm.cache import invalidate_role_permissions
    from apps.audit.models import AuditLog, AuditAction
    from apps.core.request_local import get_current_user, get_current_request
    from apps.tenants.managers import get_current_tenant

    # Get the role name based on the model type
    model_name = instance._meta.label.split('.')[-1]

    # Skip during migrations
    if _is_migration_context():
        return

    role_name = None
    old_permissions = []
    new_permissions = []
    changes = None
    resource_id = ''

    if model_name == 'Role':
        role_name = instance.name
        resource_id = str(instance.pk) if instance.pk else ''

        # Get old permissions (before change)
        if not created:
            try:
                old_role = sender.objects.get(pk=instance.pk)
                old_permissions = sorted([
                    rp.permission.codename
                    for rp in old_role.permissions.all()
                ])
            except Exception:
                pass

        # Get new permissions (after change)
        new_permissions = sorted([
            rp.permission.codename
            for rp in instance.permissions.all()
        ]) if hasattr(instance, 'permissions') else []

        # Build changes dict if permissions changed
        if old_permissions != new_permissions:
            changes = {
                "permissions": {
                    "old": old_permissions,
                    "new": new_permissions
                }
            }

    elif model_name == 'RolePermission':
        # RolePermission was modified - get the role name
        role_name = instance.role.name if hasattr(instance, 'role') and instance.role else None
        resource_id = str(instance.pk) if instance.pk else ''

        # Get permission codename
        perm_codename = instance.permission.codename if hasattr(instance, 'permission') and instance.permission else ''

        if created:
            # Permission was added
            changes = {
                "permissions": {
                    "old": [],
                    "new": [perm_codename]
                }
            }
            new_permissions = [perm_codename]
        else:
            # For updates/deletes, we need to get old state before the operation
            # For post_delete, instance still has the data but is marked for deletion
            # For post_save on update, we can query the old state
            try:
                # Try to get the old permission from DB (works for updates, not for deletes)
                old_rp = sender.objects.get(pk=instance.pk)
                old_permissions = [old_rp.permission.codename]
                new_permissions = [perm_codename]
                changes = {
                    "permissions": {
                        "old": old_permissions,
                        "new": new_permissions
                    }
                }
            except Exception:
                # For deletes, instance still has the data
                old_permissions = [perm_codename]
                changes = {
                    "permissions": {
                        "old": old_permissions,
                        "new": []
                    }
                }

    # Invalidate cache
    if role_name:
        try:
            invalidate_role_permissions(role_name)
            logger.debug(f"Invalidated permission cache for role={role_name}")
        except Exception as e:
            logger.warning(f"Failed to invalidate permission cache for role={role_name}: {e}")

    # Create audit log if there are changes
    if changes and model_name in ('Role', 'RolePermission'):
        try:
            user = None
            try:
                user = get_current_user()
            except Exception:
                pass

            tenant = None
            try:
                tenant = get_current_tenant()
            except Exception:
                pass

            request = None
            ip_address = ''
            user_agent = ''
            try:
                request = get_current_request()
                if request:
                    ip_address = _get_client_ip(request) or ''
                    user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]
            except Exception:
                pass

            description = f"Role {role_name} permissions updated"
            if model_name == 'RolePermission':
                if created:
                    description = f"Permission added to role {role_name}"
                elif old_permissions and not new_permissions:
                    description = f"Permission removed from role {role_name}"
                else:
                    description = f"Permission updated on role {role_name}"

            AuditLog.objects.create(
                tenant=tenant,
                user=user,
                action=AuditAction.PERMISSION_CHANGE,
                resource=model_name,
                resource_id=resource_id,
                changes=changes,
                ip_address=ip_address,
                user_agent=user_agent,
                description=description,
            )
            logger.debug(f"Created PERMISSION_CHANGE audit log for {model_name} {resource_id}")
        except Exception as e:
            # Silently ignore errors during migrations
            err_str = str(e).lower()
            migration_related = any(x in err_str for x in [
                'no such table', 'undefinedtable', 'does not exist',
                'relation', 'column', 'constraint', 'programmingerror'
            ])
            if not migration_related:
                logger.error(f"Failed to create permission change audit log: {e}")


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
            from apps.tenants.managers import get_current_tenant
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


def create_batch_audit_log(action, instances, changes=None):
    """
    Create audit log entries for batch operations.
    Records all resources involved in the batch operation.

    Args:
        action: AuditAction for the batch operation
        instances: List of model instances affected
        changes: Optional dict with batch operation details
    """
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
            from apps.tenants.managers import get_current_tenant
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

        # Build resource info for batch operation
        resource_names = list(set([_get_resource_name(inst) for inst in instances]))
        resource_ids = [str(inst.pk) for inst in instances if inst.pk]

        # Create description for batch operation
        instance_count = len(instances)
        resource_desc = ', '.join(resource_names)
        description = f"Batch {action} on {instance_count} {resource_desc}"

        # Prepare batch changes data
        batch_changes = {
            "batch_operation": True,
            "resource_count": instance_count,
            "resources": [
                {"resource": _get_resource_name(inst), "resource_id": str(inst.pk)}
                for inst in instances if inst.pk
            ]
        }
        if changes:
            batch_changes["details"] = changes

        # Truncate resource and resource_id to fit within database constraints
        combined_resource = ",".join(resource_names)
        combined_resource_ids = ",".join(resource_ids[:50])

        # Ensure we don't exceed CharField limits (100 chars each)
        if len(combined_resource) > 100:
            combined_resource = combined_resource[:97] + "..."
        if len(combined_resource_ids) > 100:
            combined_resource_ids = combined_resource_ids[:97] + "..."

        AuditLog.objects.create(
            tenant=tenant,
            user=user,
            action=action,
            resource=combined_resource,
            resource_id=combined_resource_ids,
            changes=batch_changes,
            ip_address=ip_address,
            user_agent=user_agent,
            description=description,
        )
        logger.debug(f"Created batch {action} audit log for {instance_count} {resource_desc}")
    except Exception as e:
        err_str = str(e).lower()
        migration_related = any(x in err_str for x in [
            'no such table', 'undefinedtable', 'does not exist',
            'relation', 'column', 'constraint', 'programmingerror'
        ])
        if migration_related:
            return
        logger.error(f"Failed to create batch audit log: {e}")


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


# Track models that have permission cache invalidation connected
_permission_cache_connected_models = set()


def _connect_permission_cache_signals(model):
    """
    Connect permission cache invalidation signals for Role and RolePermission models.
    """
    model_name = model._meta.label.split('.')[-1]

    if model_name in _permission_cache_connected_models:
        return
    if model._meta.abstract:
        return

    # Only connect for Role and RolePermission
    if model_name not in ('Role', 'RolePermission'):
        return

    post_save.connect(_invalidate_permission_cache, sender=model,
                      dispatch_uid=f"perm_cache_{model.__name__}_post_save")
    post_delete.connect(_invalidate_permission_cache, sender=model,
                        dispatch_uid=f"perm_cache_{model.__name__}_post_delete")
    _permission_cache_connected_models.add(model_name)
    logger.debug(f"Connected permission cache signals for {model.__name__}")


@receiver(post_save)
def _auto_connect_signals(sender, **kwargs):
    """
    Auto-connect signals on first save.
    Uses dispatch_uid to avoid duplicate connections.
    """
    _connect_model_signals(sender)
    _connect_permission_cache_signals(sender)


# Pre-connect permission cache signals for known models at module load
# This ensures signals fire on first save, not just subsequent saves
def _ensure_permission_cache_signals():
    """Ensure permission cache signals are connected for Role and RolePermission."""
    from apps.perm.models import Role, RolePermission
    _connect_permission_cache_signals(Role)
    _connect_permission_cache_signals(RolePermission)

# Call after function is defined to set up signals
# Note: We import inside to avoid circular imports
_ensure_permission_cache_signals()
