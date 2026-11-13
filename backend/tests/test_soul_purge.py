"""`SoulEvent.soul` is PROTECT; `Soul.purge()` is the one hard delete (user, 2026-11-14).

The event log is never removed as a side effect of a cascade. A permanent delete removes the soul's events on
purpose, in the same transaction as the soul, and writes one AuditLog row (inside that transaction) naming who
purged which soul and how many events went with it.
"""
import pytest
from django.db import OperationalError, connection
from django.db.models import ProtectedError

from apps.audit.models import AuditAction, AuditLog
from apps.events.models import EventType, SoulEvent
from apps.souls.models import Soul

pytestmark = pytest.mark.django_db(transaction=True)


def _soul_with_events(tenant, n=2):
    """A soul with exactly `n` events: creating a soul already logs SOUL_CREATED, so that one counts."""
    soul = Soul.objects.create(name="待销", tenant=tenant)
    for _ in range(n - SoulEvent.all_objects.filter(soul=soul).count()):
        SoulEvent.objects.create(soul=soul, tenant=tenant, event_type=EventType.SOUL_CREATED, payload={})
    return soul


def _purge_rows(soul_pk):
    return AuditLog.objects.filter(resource="soul", resource_id=str(soul_pk), changes__has_key="soul_events")


def test_purge_deletes_the_events_then_the_soul_and_leaves_one_audit_row(cn_tenant, admin_user):
    soul = _soul_with_events(cn_tenant, n=3)
    other = _soul_with_events(cn_tenant, n=1)

    assert soul.purge(user=admin_user) == 3

    assert not Soul.all_objects.filter(pk=soul.pk).exists()
    assert not SoulEvent.all_objects.filter(soul_id=soul.pk).exists()
    assert SoulEvent.all_objects.filter(soul=other).count() == 1  # only that soul's events
    row = _purge_rows(soul.pk).get()
    assert (row.action, row.user, row.tenant_id) == (AuditAction.DELETE, admin_user, cn_tenant.pk)
    assert row.changes == {"soul_events": ["3", "0"]}


def test_a_raw_delete_of_a_soul_with_events_is_refused(cn_tenant):
    soul = _soul_with_events(cn_tenant)

    with pytest.raises(ProtectedError):
        Soul.all_objects.filter(pk=soul.pk).delete()

    assert Soul.all_objects.filter(pk=soul.pk).exists()
    assert SoulEvent.all_objects.filter(soul=soul).count() == 2


def test_when_the_audit_row_cannot_be_written_nothing_is_deleted(cn_tenant, admin_user):
    soul = _soul_with_events(cn_tenant)
    hits = []

    def fail_audit_insert(execute, sql, params, many, context):
        if sql.lstrip().upper().startswith("INSERT") and AuditLog._meta.db_table in sql:
            hits.append(sql)
            raise OperationalError("injected: audit row")
        return execute(sql, params, many, context)

    with connection.execute_wrapper(fail_audit_insert), pytest.raises(OperationalError, match="injected"):
        soul.purge(user=admin_user)

    assert hits  # the injection was reached, not skipped
    assert Soul.all_objects.filter(pk=soul.pk).exists()
    assert SoulEvent.all_objects.filter(soul=soul).count() == 2
    assert not _purge_rows(soul.pk).exists()
