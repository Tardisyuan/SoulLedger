"""An audit row is part of the business record (user decision 2026-11-19): it is written INSIDE the transaction of
the write it describes, and if it cannot be written the business write rolls back and the caller gets the real
error. The same contract as `SoulEvent` (`tests/test_event_log_inside_transactions.py`).

Until then the generic row was an `on_commit` write and every audit failure -- generic, permission change, batch --
was logged and swallowed (`_swallow_or_log`): the mutation committed with no record of it.

Each path: the INSERT of its audit row fails (injected on every connection, the way a real DB error would) ->
the injected error reaches the caller, the business row is unchanged, no audit row exists. Then the same path
without the failure -> the business write stands and exactly ONE audit row of that kind exists.
`transaction=True`, so "rolled back" is read from a committed database, not a TestCase's.

The sharded path needs the four civ_* aliases:

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded --no-cov tests/test_audit_inside_transactions.py
"""
from contextlib import ExitStack, contextmanager

import pytest
from django.db import OperationalError, connections, transaction

from apps.audit.models import AuditAction, AuditLog
from apps.souls.models import Soul, SoulState

TABLE = AuditLog._meta.db_table


@contextmanager
def failing_audit_insert(action):
    """The INSERT of an audit row with this action fails, on whichever database it is routed to."""
    hits = []

    def wrapper(execute, sql, params, many, context):
        if sql.lstrip().upper().startswith("INSERT INTO") and f'"{TABLE}"' in sql and action in (params or ()):
            hits.append(context["connection"].alias)
            raise OperationalError("injected: auditlog insert failed")
        return execute(sql, params, many, context)

    with ExitStack() as stack:
        for conn in connections.all():
            stack.enter_context(conn.execute_wrapper(wrapper))
        yield hits


def rows(**filters):
    """Audit rows matching `filters` on every database (a sharded row is on its hall's master)."""
    return sum(AuditLog._base_manager.using(alias).filter(**filters).count() for alias in connections)


def expect_rollback(action, run):
    with failing_audit_insert(action) as hits, pytest.raises(OperationalError, match="injected"):
        run()
    assert hits, "the audit insert was never attempted: the test measured nothing"


# ── plain model save / delete (the generic rows, `_on_post_save` / `_on_post_delete`) ────────────────────────────

pytestmark = pytest.mark.django_db(transaction=True)


def test_a_create_whose_audit_row_fails_is_not_created(cn_tenant):
    def run():
        with transaction.atomic():
            Soul.objects.create(name="审计在事务里", tenant=cn_tenant, current_state=SoulState.ALIVE)

    expect_rollback(AuditAction.CREATE, run)
    assert not Soul.all_objects.filter(name="审计在事务里").exists()
    assert rows(action=AuditAction.CREATE, resource="soul") == 0

    run()
    soul = Soul.all_objects.get(name="审计在事务里")
    assert rows(action=AuditAction.CREATE, resource="soul", resource_id=str(soul.pk)) == 1


def test_an_update_whose_audit_row_fails_is_not_saved(cn_tenant):
    soul = Soul.objects.create(name="原名", tenant=cn_tenant, current_state=SoulState.ALIVE)

    def run():
        with transaction.atomic():
            s = Soul.all_objects.get(pk=soul.pk)
            s.name = "新名"
            s.save()

    expect_rollback(AuditAction.UPDATE, run)
    assert Soul.all_objects.get(pk=soul.pk).name == "原名"
    assert rows(action=AuditAction.UPDATE, resource_id=str(soul.pk)) == 0

    run()
    assert Soul.all_objects.get(pk=soul.pk).name == "新名"
    assert rows(action=AuditAction.UPDATE, resource_id=str(soul.pk)) == 1


def test_a_caller_that_catches_the_error_still_commits_nothing(cn_tenant):
    """A savepoint alone would roll back only the audit row: the caller catches, its block commits the soul with no
    record. `mark_for_rollback_on_error` in `_write_row` marks the enclosing transaction, as `Model.save` does."""
    # Django refuses the caller's next query (TransactionManagementError), so the block rolls back.
    soul = Soul.objects.create(name="原名", tenant=cn_tenant, current_state=SoulState.ALIVE)
    with failing_audit_insert(AuditAction.UPDATE) as hits, pytest.raises(Exception), transaction.atomic():  # noqa: B017
        s = Soul.all_objects.get(pk=soul.pk)
        s.name = "吞掉也不行"
        try:
            s.save()  # an update: `Soul.save` opens no transaction of its own for it
        except OperationalError:
            pass
        Soul.all_objects.count()  # the caller's next query
    assert hits
    assert Soul.all_objects.get(pk=soul.pk).name == "原名"


def test_a_hard_delete_whose_audit_row_fails_is_not_deleted():
    """No `atomic()` of the caller's: `Collector.delete` holds its own transaction around post_delete. (A soul's
    `delete()` is a soft delete -- a save -- so the row here is a grant, deleted for real.)"""
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name="TXN_DEL", defaults={"display_name": "T"})
    perm, _ = Permission.objects.get_or_create(codename="txn.delete", defaults={"name": "T", "category": "test"})
    rp = RolePermission.objects.create(role=role, permission=perm)

    expect_rollback(AuditAction.DELETE, lambda: RolePermission.objects.filter(pk=rp.pk).delete())
    assert RolePermission.objects.filter(pk=rp.pk).exists()
    assert rows(action=AuditAction.DELETE, resource_id=str(rp.pk)) == 0

    RolePermission.objects.filter(pk=rp.pk).delete()
    assert not RolePermission.objects.filter(pk=rp.pk).exists()
    assert rows(action=AuditAction.DELETE, resource="rolepermission", resource_id=str(rp.pk)) == 1


def test_a_bare_create_of_a_soul_rolls_back_too(cn_tenant):
    """`Soul.save` holds a transaction around a create (SOUL_CREATED), so no caller `atomic()` is needed."""
    expect_rollback(
        AuditAction.CREATE,
        lambda: Soul.objects.create(name="无事务", tenant=cn_tenant, current_state=SoulState.ALIVE),
    )
    assert not Soul.all_objects.filter(name="无事务").exists()


def test_a_bare_update_outside_any_transaction_fails_loudly(cn_tenant):
    """The ceiling, pinned: `Model.save` sends post_save after its own write, so with no transaction open
    (autocommit) the update is already committed when its audit row fails. The caller is told (the error), never
    silence; a business path that must not commit without its row opens a transaction (as every service here does)."""
    soul = Soul.objects.create(name="原名", tenant=cn_tenant, current_state=SoulState.ALIVE)

    def run():
        s = Soul.all_objects.get(pk=soul.pk)
        s.name = "无事务"
        s.save()

    expect_rollback(AuditAction.UPDATE, run)
    assert Soul.all_objects.get(pk=soul.pk).name == "无事务"
    assert rows(action=AuditAction.UPDATE, resource_id=str(soul.pk)) == 0


# ── permission change (`_invalidate_permission_cache`) ──────────────────────────────────────────────────────────


def test_a_grant_whose_permission_change_row_fails_is_not_granted():
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name="TXN_ROLE", defaults={"display_name": "T"})
    perm, _ = Permission.objects.get_or_create(codename="txn.permission", defaults={"name": "T", "category": "test"})

    def run():
        with transaction.atomic():
            RolePermission.objects.create(role=role, permission=perm)

    expect_rollback(AuditAction.PERMISSION_CHANGE, run)
    assert not RolePermission.objects.filter(role=role, permission=perm).exists()
    assert rows(action=AuditAction.PERMISSION_CHANGE, resource="rolepermission") == 0
    assert rows(action=AuditAction.CREATE, resource="rolepermission") == 0  # its generic row went with it

    run()
    assert RolePermission.objects.filter(role=role, permission=perm).exists()
    assert rows(action=AuditAction.PERMISSION_CHANGE, resource="rolepermission") == 1


# ── batch (`create_batch_audit_log`, through the real view) ─────────────────────────────────────────────────────


def test_a_batch_deactivate_whose_row_fails_deactivates_no_one(admin_user, cn_tenant):
    from rest_framework.test import APIClient

    from apps.authentication.models import User

    users = [User.objects.create_user(username=f"txn_batch_{i}", password="x", role="JUDGE", tenant=cn_tenant)
             for i in range(2)]
    ids = [str(u.pk) for u in users]
    client = APIClient()
    client.force_authenticate(admin_user)

    def run():
        return client.post("/api/v1/users/batch_deactivate/", {"user_ids": ids}, format="json")

    expect_rollback(AuditAction.BATCH_UPDATE, run)
    assert User.objects.filter(pk__in=ids, is_active=True).count() == 2
    assert rows(action=AuditAction.BATCH_UPDATE) == 0

    res = run()
    assert res.status_code == 200, res.content
    assert User.objects.filter(pk__in=ids, is_active=True).count() == 0
    assert rows(action=AuditAction.BATCH_UPDATE) == 1


# ── sharded: a soul on its civilization's shard, the audit row on that shard ────────────────────────────────────


@pytest.mark.sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_a_soul_on_a_civilization_shard_rolls_back_with_its_audit_row():
    from tests.test_shard_sync import HAS_SHARDS

    if not HAS_SHARDS:
        pytest.skip("needs the four civ_* aliases (--ds=config.settings_sharded)")
    from tests.test_sharded_writes import GREEK, _assign, _halls, _in_hall, cut

    halls = _halls()
    _assign("GREEK")
    hall = halls["GREEK"]

    def run():
        with _in_hall(hall), transaction.atomic():
            Soul.objects.create(name="希腊审计", tenant=hall, current_state=SoulState.ALIVE)

    with cut("GREEK"):
        with failing_audit_insert(AuditAction.CREATE) as hits, pytest.raises(OperationalError, match="injected"):
            run()
        assert hits == [GREEK], hits  # the row's own master, not the context's default
        assert not Soul._base_manager.using(GREEK).filter(name="希腊审计").exists()
        assert rows(action=AuditAction.CREATE, resource="soul") == 0

        run()
        soul = Soul._base_manager.using(GREEK).get(name="希腊审计")
        assert AuditLog._base_manager.using(GREEK).filter(
            action=AuditAction.CREATE, resource="soul", resource_id=str(soul.pk)).count() == 1
        assert rows(action=AuditAction.CREATE, resource="soul", resource_id=str(soul.pk)) == 1


@pytest.mark.sharded
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_a_rolled_back_step_on_one_master_leaves_no_audit_row_on_another():
    """The saga's shape (test_cross_civilization_saga, 2026-11-20): a step holds a transaction on ONE master (the
    relay's `atomic(using=<target>)`) and writes an audit row that names no hall -- control's. Written in its own
    transaction it outlived the step's rollback; it now waits for the step's commit. Rolled back: no row anywhere
    and the soul unchanged. Committed: exactly one row, on control."""
    from tests.test_shard_sync import HAS_SHARDS

    if not HAS_SHARDS:
        pytest.skip("needs the four civ_* aliases (--ds=config.settings_sharded)")
    from apps.audit.signals import create_batch_audit_log
    from apps.perm.models import Role
    from tests.test_sharded_writes import GREEK, _assign, _halls, _in_hall, cut

    halls = _halls()
    _assign("GREEK")
    role, _ = Role.objects.get_or_create(name="SAGA_ROLE", defaults={"display_name": "S"})
    with cut("GREEK"):
        with _in_hall(halls["GREEK"]):
            soul = Soul.objects.create(name="步骤前", tenant=halls["GREEK"], current_state=SoulState.ALIVE)

        def step(fail):
            with transaction.atomic(using=GREEK):
                s = Soul._base_manager.using(GREEK).get(pk=soul.pk)
                s.name = "步骤后"
                s.save(using=GREEK)
                create_batch_audit_log(AuditAction.BATCH_UPDATE, [role])
                if fail:
                    raise RuntimeError("the step's next write failed")

        with pytest.raises(RuntimeError):
            step(fail=True)
        assert Soul._base_manager.using(GREEK).get(pk=soul.pk).name == "步骤前"
        assert rows(action=AuditAction.BATCH_UPDATE) == 0

        step(fail=False)
        assert Soul._base_manager.using(GREEK).get(pk=soul.pk).name == "步骤后"
        assert rows(action=AuditAction.BATCH_UPDATE) == 1
        assert AuditLog._base_manager.using("default").filter(action=AuditAction.BATCH_UPDATE).count() == 1
