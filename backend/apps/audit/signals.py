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
from contextlib import contextmanager
from contextvars import ContextVar

from django.db import router, transaction
from django.db.models.signals import post_delete, post_migrate, post_save, pre_migrate, pre_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)

_in_migration = False  # Guard: skip audit log creation during migrations

#: (label_lower, pk) of rows whose generic UPDATE row is suppressed because the
#: caller writes its own, richer audit row (hall settings / seal glyphs /
#: assistant hall switch). Per-context, so it neither leaks across requests
#: nor touches any other model or row.
_explicitly_audited: ContextVar[frozenset] = ContextVar("explicitly_audited", default=frozenset())


@contextmanager
def explicit_audit_for(instance):
    """Within the block, `instance`'s save or delete writes no generic UPDATE / DELETE row: the caller audits it
    itself (a saga retiring the copy a soul left behind: `apps/dispatch/transfer.py` `_retire`)."""
    token = _explicitly_audited.set(_explicitly_audited.get() | {(instance._meta.label_lower, str(instance.pk))})
    try:
        yield
    finally:
        _explicitly_audited.reset(token)


def _invalidate_permission_cache(sender, instance, created=False, **kwargs):
    """
    Invalidate permission cache and create audit log when Role or RolePermission changes.
    """
    from apps.audit.models import AuditAction, AuditLog
    from apps.perm.cache import invalidate_role_permissions

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
        user, tenant, request = _current_context()
        ip_address = ''
        user_agent = ''
        try:
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

        _write_row(
            router.db_for_write(AuditLog, instance=AuditLog(tenant=tenant)),
            written_on={instance._state.db},
            tenant=tenant,
            user_id=getattr(user, "pk", None),
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


def _is_migration_context():
    """Check if we're currently in a migration or test database setup."""
    global _in_migration
    return _in_migration


def _write_row(alias, *, written_on=frozenset(), **row):
    """Write one audit row INSIDE the business transaction it describes (user decision 2026-11-19): it fails, the
    business write rolls back, as a `SoulEvent` does (CLAUDE.md, 事件日志是业务记录的一部分).

    Until then the generic row was an `on_commit` write and every audit failure was logged and swallowed: a
    mutation could commit with no record of it, and `apps/audit/oncommit_guard.py` existed only because the rows
    of a `django_db` test never appeared. Pinned by `tests/test_audit_inside_transactions.py`.

    - `atomic(using=alias)`: the row's own database (the master of the hall it names, sharding stage 4). A bare
      `atomic()` opens the context's, where a row of another master is refused (WriteOutsideTransaction). Inside
      a business transaction on `alias` this is a savepoint; outside one (a plain `save()` in autocommit) it is
      the row's own transaction -- the business row is already committed then, and only the caller's error says so.
    - `mark_for_rollback_on_error`: the savepoint alone would let a caller that catches the error commit the
      business write without its row; this marks the enclosing transaction for rollback, as `Model.save` does.
    - The row knows its database before any User is put on it: assigning a related object to an instance with no
      `_state.db` asks the router where the User is written (`AuditUserFields.save` sets `create_user` /
      `update_user`), which in a context with no single civilization (SYSTEM_ADMIN) while one is write-cut is
      NoShardContext. As an on-commit write that error was swallowed and the row lost (a hall created by
      SYSTEM_ADMIN: test_sharded_writes). Callers pass `user_id` for the same reason.
    - A row of a database the open business transaction does not hold (a saga step on one master whose audit row
      names another: the relay's `atomic(using=<target>)`, a control row from a shard's step) cannot join it, and
      written in its own transaction it would outlive the step's rollback (test_cross_civilization_saga, 2026-11-20).
      It is written on that transaction's commit instead: a rolled-back step leaves no row, a committed one exactly
      one. Not when the row it describes was written on that same database (`written_on`, the instance's
      `_state.db`): then the business row went in outside the open transaction too (autocommit there, e.g. under a
      `@transaction.atomic` decorator, which holds `default` only), and the audit row goes in the same way, with
      it -- deferred, it would wait for a commit that is not the business row's. Not covered: a row autocommitted
      beside a transaction that IS on the audit row's database (a control row with no hall of its own, written in a
      hall's context from a step that holds only that hall's shard): its audit row joins the step and rolls back
      with it while the row stays. Only a second connection could write it there; no path is known to do this. Its failure then reaches the committer after the business write committed -- loud, not atomic: only a
      message (the saga outbox) could make a second database atomic with the first.
    """
    from apps.audit.models import AuditLog
    from apps.core.shard_reads import CONTROL_ALIAS

    obj = AuditLog(**row)
    obj._state.db = alias
    held = _transaction_aliases()
    if held and alias not in held and alias not in written_on:
        # On the business transaction's last commit: control's when it holds control (it commits after the shards).
        host = CONTROL_ALIAS if CONTROL_ALIAS in held else held[-1]
        # The row's own bookkeeping now: after the commit the request's user is gone, and `AuditUserFields.save`
        # would leave create_user / update_user empty (the row is the request's, as an inline one is).
        from apps.core.request_local import get_current_user

        actor = get_current_user()
        if getattr(actor, "is_authenticated", False):
            obj.create_user_id = obj.update_user_id = actor.pk

        def write():
            with transaction.atomic(using=alias):
                obj.save(force_insert=True, using=alias)

        transaction.on_commit(write, using=host)
        return obj
    with transaction.mark_for_rollback_on_error(using=alias), transaction.atomic(using=alias):
        obj.save(force_insert=True, using=alias)
    return obj


def write_audit_row(*, using=None, written_on=frozenset(), **row):
    """The one way code outside this module writes an audit row (`tests/test_audit_rows_have_one_entry.py`): the
    fields of `AuditLog.objects.create(...)`, written by `_write_row` on the master of the hall the row names.

    `tenant=` / `user=` are taken as their ids before the row exists: assigning an instance to a row with no
    database asks the router (NoShardContext for SYSTEM_ADMIN while civilizations are write-cut). `using` names
    the database when the caller already holds the row's own (a command writing on an alias it chose).
    """
    from apps.audit.models import AuditLog

    if "tenant" in row:
        row["tenant_id"] = getattr(row.pop("tenant"), "pk", None)
    if "user" in row:
        row["user_id"] = getattr(row.pop("user"), "pk", None)
    alias = using or router.db_for_write(AuditLog, instance=AuditLog(tenant_id=row.get("tenant_id")))
    return _write_row(alias, written_on=written_on, **row)


def _transaction_aliases():
    """The databases on which the code holds a transaction (a test's own wrapping blocks are not the code's)."""
    from django.db import connections

    return [a for a in connections if any(not b._from_testcase for b in connections[a].atomic_blocks)]


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
#: which was ADMIN *and* MODERATOR then (ADMIN alone since 2026-11-07, and any role granted it). All three password paths
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

#: 个人信息字段:与密钥同样只记「改了」,不记值。`AuditLog.changes` 对持有
#: `audit.read` 的角色(默认 ADMIN;MODERATOR 到 2026-11-07 为止)可读,而灵魂的联系方式按最小可见
#: 只给 `soul_account.read`。审计日志是一条绕过那道门的旁路,所以在这里堵上。
PII_FIELD_NAMES = frozenset({'contact_email', 'contact_phone'})


def _is_secret_field(field) -> bool:
    """Three independent tests, because any one of them alone decays.

    Name and hint catch what is called a secret. The type test catches what is
    *stored* as one: `EncryptedCharField` / `EncryptedJSONField` decrypt in
    `from_db_value`, so by the time a diff runs, their values are plaintext no
    matter what the column is named.
    """
    name = field.name.lower()
    if name in SECRET_FIELD_NAMES or name in PII_FIELD_NAMES:
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
        # An `auto_now` column is bookkeeping too: every save moves it, so it says nothing about what changed.
        if field.name in skip_fields or field.name.startswith('_') or getattr(field, 'auto_now', False):
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


def _current_context():
    """(user, tenant, request) for the audit row being written.

    Each read is guarded on its own: a contextvar lookup that raises (or an
    import that fails during app loading) yields None for that one value and
    never costs the row the other two.
    """
    user = tenant = request = None
    try:
        from apps.core.request_local import get_current_user
        user = get_current_user()
    except Exception:
        pass
    try:
        from apps.tenants.managers import get_current_tenant
        tenant = get_current_tenant()
    except Exception:
        pass
    try:
        from apps.core.request_local import get_current_request
        request = get_current_request()
    except Exception:
        pass
    return user, tenant, request


def _get_trace_id(request=None):
    """The request's X-Request-ID (`apps/core/trace.py`), so audit rows and log lines share one id.

    Until 2026-10-29 the id was invented here, on the first audit write of a request, and lived only on the
    audit row: no log line, no response header, no client could name it. The fallback below is for a request
    that never went through the middleware (a test's RequestFactory): one id per request, as before.
    """
    from apps.core.trace import get_trace_id, new_trace_id

    trace_id = get_trace_id()
    if trace_id:
        return trace_id
    if request is None:
        try:
            from apps.core.request_local import get_current_request
            request = get_current_request()
        except Exception:
            return ''
    if request is None:
        return ''
    trace_id = getattr(request, 'trace_id', None) or getattr(request, '_audit_trace_id', None)
    if not trace_id:
        trace_id = new_trace_id()
        request._audit_trace_id = trace_id
    return trace_id


def _row_tenant_id(instance, context_tenant):
    """审计行记在被改的那一行的殿(rbac-scope 第 13 条),不是操作人的租户上下文。

    此前取 contextvar:目标殿执行调拨改了源殿的行,审计记在目标殿;无殿 ADMIN 与 Celery 全局任务改任何殿的行,
    审计都是 NULL,那一殿的审计页看不到。模型有 `tenant` 外键就用它(为空即全局行,也照记为空);
    没有的(角色、菜单、殿本身)才退回上下文。
    """
    try:
        field = instance._meta.get_field("tenant")
    except Exception:
        field = None
    if field is not None and getattr(field, "many_to_one", False):
        return getattr(instance, field.attname, None)
    return getattr(context_tenant, "pk", None)


def _create_audit_log(action, instance, changes=None):
    """Create an AuditLog entry for the given action."""
    # Skip during migrations to avoid schema-not-ready errors
    if _is_migration_context():
        return
    if action in ('UPDATE', 'DELETE') and (instance._meta.label_lower, str(instance.pk)) in _explicitly_audited.get():
        return

    from apps.audit.models import AuditLog

    user, tenant, request = _current_context()

    ip_address = ''
    user_agent = ''
    if request:
        ip_address = _get_client_ip(request) or ''
        user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]

    trace_id = _get_trace_id(request)
    tenant_id = _row_tenant_id(instance, tenant)

    row = dict(
        tenant_id=tenant_id,
        user_id=getattr(user, "pk", None),
        action=action,
        resource=_get_resource_name(instance),
        resource_id=str(instance.pk) if instance.pk else '',
        changes=changes,
        ip_address=ip_address,
        user_agent=user_agent,
        # Empty, not a sentence: the row's action and resource say it, and the screens name them in the reader's language.
        description="",
        trace_id=trace_id,
    )

    # The database the row is written to: the master of the hall it names (sharding stage 4), which need not be
    # the one the business transaction was on (a control row of another civilization's hall).
    _write_row(router.db_for_write(AuditLog, instance=AuditLog(tenant_id=tenant_id)), written_on={instance._state.db},
               **row)


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

    user, tenant, request = _current_context()

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

    row_tenants = {_row_tenant_id(inst, tenant) for inst in instances}
    tenant_id = row_tenants.pop() if len(row_tenants) == 1 else getattr(tenant, "pk", None)
    alias = router.db_for_write(AuditLog, instance=AuditLog(tenant_id=tenant_id))
    _write_row(
        alias,
        written_on={inst._state.db for inst in instances},
        tenant_id=tenant_id,
        user_id=getattr(user, "pk", None),
        action=action,
        resource=combined_resource,
        resource_id=combined_resource_ids,
        changes=batch_changes,
        ip_address=ip_address,
        user_agent=user_agent,
        description=description,
    )
    logger.debug(f"Created batch {action} audit log for {instance_count} {resource_desc}")


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
