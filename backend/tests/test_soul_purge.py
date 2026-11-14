"""`SoulEvent.soul` is PROTECT; `Soul.purge()` is the one hard delete (user, 2026-11-14).

The event log is never removed as a side effect of a cascade. A permanent delete removes the soul's events on
purpose, in the same transaction as the soul, and writes one AuditLog row (inside that transaction) naming who
purged which soul and how many events went with it.
"""
from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.db import OperationalError, connection
from django.db.models import ProtectedError

from apps.audit.models import AuditAction, AuditLog
from apps.audit.retention import SOUL_PURGE_RESOURCE
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
    return AuditLog.objects.filter(resource=SOUL_PURGE_RESOURCE, resource_id=str(soul_pk))


def test_purge_deletes_the_events_then_the_soul_and_leaves_one_audit_row(cn_tenant, admin_user):
    soul = _soul_with_events(cn_tenant, n=3)
    other = _soul_with_events(cn_tenant, n=1)

    manifest = soul.purge(user=admin_user)

    assert not Soul.all_objects.filter(pk=soul.pk).exists()
    assert not SoulEvent.all_objects.filter(soul_id=soul.pk).exists()
    assert SoulEvent.all_objects.filter(soul=other).count() == 1  # only that soul's events
    row = _purge_rows(soul.pk).get()
    assert (row.action, row.user, row.tenant_id) == (AuditAction.DELETE, admin_user, cn_tenant.pk)
    assert row.changes == manifest
    assert manifest["events.SoulEvent"] == 3 and manifest["souls.Soul"] == 1


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


def test_the_manifest_names_every_model_the_cascade_deleted(cn_tenant, admin_user):
    """be-sec 2.1 / user 2026-11-14: the 22 CASCADE relations used to go silently. The manifest must list exactly
    the models whose rows disappeared -- checked against a before/after count of every model, not against a list
    written here, so a cascade added later is covered without touching this test."""
    from django.apps import apps

    from apps.souls.record_models import SoulRecord

    soul = _soul_with_events(cn_tenant, n=2)
    SoulRecord.objects.create(soul=soul, record_type="MERIT", civilization="CHINESE", description="善举",
                              weight=10, event_year=1920)
    models = [m for m in apps.get_models() if m._meta.managed and not m._meta.proxy]

    def counts():
        return {m._meta.label: m._base_manager.count() for m in models}

    before = counts()
    manifest = soul.purge(user=admin_user)
    after = counts()
    deleted = {label: before[label] - after[label] for label in before if after[label] < before[label]}
    deleted.pop("audit.AuditLog", None)  # the purge row itself is an insert; deletes never touch AuditLog
    assert manifest == deleted
    assert {"souls.Soul", "events.SoulEvent", "souls.SoulRecord"} <= manifest.keys()


# --- manage.py purge_soul (user, 2026-11-14:「加管理命令」; no UI entry) -------------------------------------


def _binned(tenant, n=2):
    soul = _soul_with_events(tenant, n=n)
    soul.soft_delete()
    return soul


def _purge(*args):
    out = StringIO()
    call_command("purge_soul", *args, stdout=out)
    return out.getvalue()


def _intact(soul, events):
    return Soul.all_objects.filter(pk=soul.pk).exists() and SoulEvent.all_objects.filter(soul=soul).count() == events


def test_the_command_without_yes_is_a_dry_run(cn_tenant, admin_user):
    soul = _binned(cn_tenant, n=2)
    out = _purge(str(soul.pk), "--tenant", "CN_DIYU", "--actor", "admin")
    assert "预演" in out and "2 条事件" in out and "操作人 admin" in out
    assert "'events.SoulEvent': 2" in out and "'souls.Soul': 1" in out  # the manifest, not just the events
    assert _intact(soul, 2)
    assert not _purge_rows(soul.pk).exists()


def test_the_command_with_yes_purges_and_audits_the_actor(cn_tenant, admin_user):
    soul = _binned(cn_tenant, n=2)
    _purge(str(soul.pk), "--tenant", "CN_DIYU", "--actor", "admin", "--yes")
    assert not Soul.all_objects.filter(pk=soul.pk).exists()
    assert not SoulEvent.all_objects.filter(soul_id=soul.pk).exists()
    row = _purge_rows(soul.pk).get()
    assert row.user == admin_user
    assert row.changes["events.SoulEvent"] == 2 and row.changes["souls.Soul"] == 1


def test_the_command_refuses_a_soul_of_another_hall(cn_tenant, eu_tenant, admin_user):
    soul = _binned(eu_tenant)
    with pytest.raises(CommandError):
        _purge(str(soul.pk), "--tenant", "CN_DIYU", "--actor", "admin", "--yes")
    assert _intact(soul, 2)


def test_the_command_refuses_a_soul_that_is_not_in_the_bin(cn_tenant, admin_user):
    soul = _soul_with_events(cn_tenant)
    with pytest.raises(CommandError, match="回收站"):
        _purge(str(soul.pk), "--tenant", "CN_DIYU", "--actor", "admin", "--yes")
    assert _intact(soul, 2)


def test_the_command_refuses_an_actor_who_cannot_manage_that_hall(cn_tenant, eu_tenant, judge_user, eu_admin_user):
    soul = _binned(cn_tenant)
    for actor in (judge_user.username, eu_admin_user.username, "nobody"):
        with pytest.raises(CommandError, match="管理员"):
            _purge(str(soul.pk), "--tenant", "CN_DIYU", "--actor", actor, "--yes")
    assert _intact(soul, 2)
