"""
Audit signals for automatic operation logging.

When a model inheriting from AuditUserFields is created/updated/deleted,
this signal automatically creates an AuditLog entry.

Wired ONCE, from `apps/audit/apps.py::ready()` through `connect_audit_signals`
below. There used to be a second mechanism in this module — a receiver on
every `post_save` that connected a model's signals on its first save — and
the two disagreed about which models were excluded. See `connect_audit_signals`.
"""
import logging

from django.db.models.signals import post_delete, post_migrate, post_save, pre_migrate, pre_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)

_in_migration = False  # Guard: skip audit log creation during migrations


def _invalidate_permission_cache(sender, instance, created=False, **kwargs):
    """
    Invalidate permission cache and create audit log when Role or RolePermission changes.
    """
    from apps.audit.models import AuditAction, AuditLog
    from apps.core.request_local import get_current_request, get_current_user
    from apps.perm.cache import invalidate_role_permissions
    from apps.tenants.managers import get_current_tenant

    # Get the role name based on the model type
    model_name = instance._meta.label.split('.')[-1]

    # Skip during migrations
    if _is_migration_context():
        return

    # The row as it stood before this save, taken by `_on_pre_save` (same
    # wiring, see connect_audit_signals). None on create, on post_delete, and
    # when the snapshot could not be taken.
    before = getattr(instance, _AUDIT_SNAPSHOT, None)
    deleting = kwargs.get('signal') is post_delete

    role_name = None
    role_names_to_invalidate = []
    old_permissions = []
    new_permissions = []
    changes = None
    resource_id = ''

    if model_name == 'Role':
        role_name = instance.name
        resource_id = str(instance.pk) if instance.pk else ''
        # BP-07: a rename must drop the OLD name's cached answers too. Until
        # 2026-09-12 only the new name was invalidated, so the old name kept
        # passing checks for the rest of the 300s TTL.
        role_names_to_invalidate = [role_name]
        if before is not None and before.name != role_name:
            role_names_to_invalidate.append(before.name)

        # This branch cannot report a permissions diff, and pretending
        # otherwise was the previous shape:
        #
        #     old_role = sender.objects.get(pk=instance.pk)
        #     old_permissions = [... for rp in old_role.permissions.all()]
        #
        # ran **after** the save and so read the same rows as
        # `instance.permissions.all()` two lines below -- the same query on the
        # same pk, `old == new` unconditionally, no audit row ever.
        #
        # The pre_save snapshot does not fix it either, and that was tried and
        # measured: by the time anything calls `role.save()`, the RolePermission
        # rows have **already** been changed by whatever changed them, so the
        # "before" is not inside this save's scope at all. Measured snapshot:
        # `['dbg.1']` -- the new value, taken before the save.
        #
        # The place that knows both sets is the code doing the replacing, and
        # that is where the row is now written: see
        # `apps/perm/views.py::assign_role_permissions`.
        #
        # `changes` therefore stays None here. Leaving the old computation in
        # place with a broken "before" was worse than saying nothing: with
        # `old_permissions` stuck at `[]`, a `role.save()` that touched no
        # grant at all reported **every current grant as newly added** -- a
        # second, wrong entry sitting next to the correct one. Measured while
        # writing this: two `PERMISSION_CHANGE resource=role` rows for one
        # assignment.
        #
        # The field-level diff of the Role row itself (name, display_name, …)
        # is the generic UPDATE row `_on_post_save` writes from the same
        # snapshot. The cache invalidation below still runs; that is the other
        # half of this receiver's job and it does not need a diff.

    elif model_name == 'RolePermission':
        # RolePermission was modified - get the role name
        role_name = instance.role.name if hasattr(instance, 'role') and instance.role else None
        resource_id = str(instance.pk) if instance.pk else ''
        role_names_to_invalidate = [role_name] if role_name else []

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
        elif deleting or (hasattr(instance, 'is_deleted') and instance.is_deleted):
            # Hard delete (post_delete: the instance still carries its data)
            # or soft delete — either way the grant is gone.
            old_permissions = [perm_codename]
            new_permissions = []
            changes = {
                "permissions": {
                    "old": old_permissions,
                    "new": []
                }
            }
        else:
            # An update. BP-20: this used to `sender.objects.get(pk=...)` here,
            # in post_save, and so read the NEW row -- old == new on every
            # save, a row of fake diff written each time. The snapshot is the
            # only "before" there is; a save that did not move the permission
            # (conditions edited, or nothing at all) writes no PERMISSION_CHANGE
            # row -- the generic UPDATE row carries whatever else changed.
            old_codename = (
                before.permission.codename
                if before is not None and getattr(before, 'permission_id', None)
                else None
            )
            if old_codename is not None and old_codename != perm_codename:
                old_permissions = [old_codename]
                new_permissions = [perm_codename]
                changes = {
                    "permissions": {
                        "old": old_permissions,
                        "new": new_permissions
                    }
                }

    # Invalidate cache
    for name in role_names_to_invalidate:
        try:
            invalidate_role_permissions(name)
            logger.debug(f"Invalidated permission cache for role={name}")
        except Exception as e:
            logger.warning(f"Failed to invalidate permission cache for role={name}: {e}")

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

            trace_id = _get_trace_id(request)

            AuditLog.objects.create(
                tenant=tenant,
                user=user,
                action=AuditAction.PERMISSION_CHANGE,
                # model_name is the CamelCase class name ('Role', 'RolePermission'),
                # kept as-is above for the comparisons. Every other write path derives
                # `resource` from _meta.label_lower, which lowercases it — lowercase
                # here too so this doesn't split the same resource into two spellings
                # (e.g. 'rolepermission' vs 'RolePermission') in the audit log.
                resource=model_name.lower(),
                resource_id=resource_id,
                changes=changes,
                ip_address=ip_address,
                user_agent=user_agent,
                description=description,
                trace_id=trace_id,
            )
            logger.debug(f"Created PERMISSION_CHANGE audit log for {model_name} {resource_id}")
        except Exception as e:
            _swallow_or_log(e, "Failed to create permission change audit log")


def _is_migration_context():
    """Check if we're currently in a migration or test database setup."""
    global _in_migration
    return _in_migration


def _swallow_or_log(exc, what):
    """Decide whether an audit-write failure is expected, and log it if not.

    WHAT THIS REPLACES. Three copies of:

        err_str = str(e).lower()
        migration_related = any(x in err_str for x in [
            'no such table', 'undefinedtable', 'does not exist',
            'relation', 'column', 'constraint', 'programmingerror'
        ])
        if migration_related:
            return          # not even a log line

    PostgreSQL's ordinary runtime errors contain those substrings:

        insert or update on table ... violates foreign key **constraint** ...
        null value in **column** ... violates not-null **constraint**
        **relation** ... does not exist

    So any real audit-write failure of those shapes was dropped in total
    silence. (C17's `inet` DataError happened to match none of them, which is
    the only reason it ever produced a log line.)

    The honest test is **the context, not the message**: `_is_migration_context()`
    already tracks whether a migration is running, and it is the thing the
    substring list was standing in for. Outside that context every failure is
    logged, always -- an audit row that could not be written is exactly the
    event nobody can afford to have swallowed.
    """
    if _is_migration_context():
        logger.debug(f"{what} skipped during migration: {exc}")
        return
    logger.error(f"{what}: {exc}", exc_info=True)



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


#: Marker written in place of a secret's before/after values.
#:
#: The field name is KEPT and only the values are replaced. "The signing secret
#: was rotated at 03:14 by user X" is exactly what an audit log is for; the
#: secret itself is not. Dropping the key entirely would lose the event.
REDACTED = "[redacted]"

#: Field names whose VALUES never enter an audit row.
#:
#: Measured 2026-09-07, before this existed: changing a password wrote BOTH the
#: old and the new `pbkdf2_sha256$…` hash into `AuditLog.changes`, and
#: `AuditLogSerializer` returns `changes` to anyone holding `audit.read` —
#: which is ADMIN *and* MODERATOR. All three password paths
#: (`views.py:196`, `:622`, `:724`) use `set_password` + `save(update_fields=)`,
#: and `_on_post_save` does not look at `update_fields`, so every one of them
#: was audited in full.
#:
#: Hashes, not plaintext — but a password hash is offline-crackable material,
#: and `signing_secret` / `source_payload` are decrypted by their field's
#: `from_db_value` before this function ever sees them, so those two were
#: plaintext.
SECRET_FIELD_NAMES = frozenset({
    'password', 'signing_secret', 'key_hash', 'raw_key', 'api_key',
    'secret', 'token', 'access_token', 'refresh_token', 'source_payload',
})

#: Substrings that make a field name secret regardless of the set above.
#: A name blacklist alone only covers fields that exist today; this covers the
#: next `webhook_secret` or `reset_token` without anyone remembering to come here.
SECRET_NAME_HINTS = ('password', 'secret', 'token', 'api_key', 'private_key')


def _is_secret_field(field) -> bool:
    """Three independent tests, because any one of them alone decays.

    Name and hint catch what is called a secret. The type test catches what is
    *stored* as one: `EncryptedCharField` / `EncryptedJSONField` decrypt in
    `from_db_value`, so by the time a diff runs, their values are plaintext no
    matter what the column is named.
    """
    name = field.name.lower()
    if name in SECRET_FIELD_NAMES:
        return True
    if any(hint in name for hint in SECRET_NAME_HINTS):
        return True
    return type(field).__name__.startswith('Encrypted')


def _build_changes(instance, old_instance=None):
    """
    Build a changes dict from old->new field values.
    Only tracks fields on AuditUserFields (not internal fields).

    Secret-valued fields record that they changed, never what they changed to —
    see `SECRET_FIELD_NAMES` and `test_audit_never_records_a_secret.py`.
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
            if _is_secret_field(field):
                changes[field.name] = [REDACTED, REDACTED]
            else:
                changes[field.name] = [str(old_val) if old_val is not None else None,
                                       str(new_val) if new_val is not None else None]
    return changes if changes else None


def _get_trace_id(request=None):
    """Extract or generate trace_id from request for correlation."""
    if request is None:
        try:
            from apps.core.request_local import get_current_request
            request = get_current_request()
        except Exception:
            return ''

    if request is None:
        return ''

    # Check for existing trace_id on request (set by middleware)
    trace_id = getattr(request, '_audit_trace_id', None)
    if trace_id:
        return trace_id

    # Generate new trace_id from request headers or create one
    import uuid
    trace_id = request.META.get('HTTP_X_TRACE_ID', '')
    if not trace_id:
        trace_id = uuid.uuid4().hex[:16]

    # Cache on request for reuse within same request
    if request:
        request._audit_trace_id = trace_id
    return trace_id


def _create_audit_log(action, instance, changes=None):
    """Create an AuditLog entry for the given action."""
    # Skip during migrations to avoid schema-not-ready errors
    if _is_migration_context():
        return

    from apps.audit.models import AuditLog

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

        trace_id = _get_trace_id(request)

        from django.db import transaction
        transaction.on_commit(lambda: AuditLog.objects.create(
            tenant=tenant,
            user=user,
            action=action,
            resource=_get_resource_name(instance),
            resource_id=str(instance.pk) if instance.pk else '',
            changes=changes,
            ip_address=ip_address,
            user_agent=user_agent,
            description=f"{action} {instance._meta.verbose_name}",
            trace_id=trace_id,
        ))
    except Exception as e:
        _swallow_or_log(e, "Failed to create audit log")


def _get_client_ip(request):
    """Delegates to the one validated implementation.

    This used to return `X-Forwarded-For`'s first entry unchecked, straight
    into a `GenericIPAddressField`. On PostgreSQL an unparseable value raised
    DataError inside the audit write and the mutation committed *without* an
    audit row -- one header, no record. See apps/core/client_ip.py.
    """
    from apps.core.client_ip import get_client_ip

    return get_client_ip(request)


#: 快照挂在实例上的属性名。用一个不像业务字段的名字,免得跟模型自己的列撞上。
_AUDIT_SNAPSHOT = "_audit_row_before_save"



def _on_pre_save(sender, instance, **kwargs):
    """Take the row as it stands **before** this save, for post_save to diff against.

    WHY THIS EXISTS. `_on_post_save` used to do:

        old_instance = sender.objects.get(pk=instance.pk)
        changes = _build_changes(instance, old_instance)

    post_save fires **after** the row is written, so that query returns the
    **new** row. `_build_changes` compared the instance with itself, every
    field was equal, and `changes` came out None. Measured end to end on
    PostgreSQL: `UPDATE approvalworkflow changes=None`.

    `AuditLog.changes` is documented as `{"field": ["old", "new"]}` and is what
    `/audit-logs/timeline/` renders. **It had never once carried the diff of an
    UPDATE.** `apps/audit/tests.py` has no signal tests at all, so nothing said
    otherwise.

    `_base_manager`, not `objects`: several models here have a tenant-scoped
    default manager, and the snapshot must not depend on whichever tenant
    contextvar happens to be set on the thread doing the save.
    """
    if instance.pk is None:
        setattr(instance, _AUDIT_SNAPSHOT, None)
        return
    try:
        setattr(instance, _AUDIT_SNAPSHOT, sender._base_manager.get(pk=instance.pk))
    except Exception:
        # First save of a row with a client-assigned pk, or the table is not
        # there yet during a migration. Either way there is no "before".
        setattr(instance, _AUDIT_SNAPSHOT, None)


def _on_post_save(sender, instance, created, **kwargs):
    """Handle post_save - log CREATE or UPDATE (or DELETE for soft deletes)."""
    from apps.audit.models import AuditAction

    # Detect soft delete: is_deleted changed from False to True
    is_soft_delete = (
        not created
        and hasattr(instance, 'is_deleted')
        and instance.is_deleted
    )

    if is_soft_delete:
        action = AuditAction.DELETE
    elif created:
        action = AuditAction.CREATE
    else:
        action = AuditAction.UPDATE

    changes = None
    if not created and not is_soft_delete:
        old_instance = getattr(instance, _AUDIT_SNAPSHOT, None)
        if old_instance is not None:
            changes = _build_changes(instance, old_instance)
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

    from apps.audit.models import AuditLog

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
        _swallow_or_log(e, "Failed to create batch audit log")


def is_audited_model(model) -> bool:
    """Which concrete models get audit rows. One list, consulted once.

    - Must inherit `AuditUserFields`; abstract classes are skipped.
    - Not `AuditLog` itself — auditing the audit trail recurses. Identity, not
      a `label.startswith('Audit')` prefix: an `AuditPolicy` added later would
      silently get no rows at all, and "no rows" is not a shape anyone goes
      looking for.
    - Not `SoulEvent`: it is the soul's own event log, written by EventService,
      and mirroring it into AuditLog doubled every entry.

    Role and RolePermission ARE audited. The old lazy connector excluded them
    "to avoid duplicate CREATE/UPDATE logs" next to the PERMISSION_CHANGE
    rows, but `apps.py` connected them anyway, so the exclusion never held —
    and it was the reason no `pre_save` ever ran for Role, i.e. why a role
    rename was recorded with `changes=None` (BP-10 / DB-01). The two kinds
    of row answer different questions (what changed on the row vs. which
    grant moved) and both are wanted.
    """
    from apps.audit.models import AuditLog
    from apps.core.models import AuditUserFields

    if model is AuditUserFields or not issubclass(model, AuditUserFields):
        return False
    if model._meta.abstract or model is AuditLog:
        return False
    return model._meta.label.split('.')[-1] != 'SoulEvent'


def connect_audit_signals(model) -> bool:
    """Wire every receiver an audited model gets. Returns whether it was one.

    `dispatch_uid` makes this idempotent, so calling it twice for a model
    (tests, `apps.py` re-entry) connects nothing twice.
    """
    if not is_audited_model(model):
        return False
    name = model.__name__
    # pre_save is what makes `changes` on an UPDATE row real: it takes the
    # row as it stood before the write. See `_on_pre_save`.
    pre_save.connect(_on_pre_save, sender=model, dispatch_uid=f"audit_{name}_pre_save")
    post_save.connect(_on_post_save, sender=model, dispatch_uid=f"audit_{name}_post_save")
    post_delete.connect(_on_post_delete, sender=model, dispatch_uid=f"audit_{name}_post_delete")
    if model._meta.label.split('.')[-1] in ('Role', 'RolePermission'):
        post_save.connect(_invalidate_permission_cache, sender=model,
                          dispatch_uid=f"perm_cache_{name}_post_save")
        post_delete.connect(_invalidate_permission_cache, sender=model,
                            dispatch_uid=f"perm_cache_{name}_post_delete")
    logger.debug(f"Connected audit signals for {name}")
    return True
