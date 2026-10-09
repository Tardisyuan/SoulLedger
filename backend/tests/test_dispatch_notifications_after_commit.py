"""The six `EventService.notify_user` sites in `apps/dispatch/services.py` (propose / approve / reject /
return-blocked / joint add_participant / joint conclude) send AFTER the business transaction commits.

Why (same defect `30052b65` fixed for `sentence_plan.notify_judges`): the event bus swallows a handler's
exception, but a failed notification INSERT has already marked the surrounding transaction for rollback. The
first enclosing `atomic()` then rolls back its own writes SILENTLY -- the service returns normally with a
participant / status change that is not in the database. G4 counted that as "clean" because the snapshot
equals the starting one; the caller, who was told the write succeeded, is the one who loses.

Two properties per path:
  (a) the caller's transaction rolls back after the call -> no notification row, no deferred delivery survives;
  (b) a notification that cannot be written does not take the business write with it.
"""
import re
from contextlib import suppress

import pytest
from django.db import connection, transaction
from django.db.transaction import TransactionManagementError

from apps.dispatch.models import (
    CrossTenantJudgment,
    CrossTenantJudgmentParticipant,
    DispatchRecord,
    DispatchStatus,
    JudgmentStatus,
    ParticipantRole,
)
from apps.dispatch.services import CrossTenantJudgmentService, DispatchService
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment
from apps.notifications.models import UserNotification
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as plan
from tests.test_cross_tenant_writes_are_all_or_nothing import _bench_at

pytestmark = pytest.mark.django_db

_NOTIFICATION_INSERT = re.compile(r'^\s*INSERT\s+INTO\s+"?notifications_usernotification"?', re.I)


class BoomError(Exception):
    pass


def _people():
    cn, eg = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT")
    for t in (cn, eg):
        plan.officer(f"admin_{t.code}", "ADMIN", t)  # somebody to notify in every hall
    return cn, eg


def _proposed(cn, eg):
    soul = Soul.objects.create(name="客魂", tenant=cn, current_state=SoulState.DISPOSED)
    record = DispatchRecord.objects.create(source_tenant=cn, target_tenant=eg, soul=soul, tenant=cn,
                                           status=DispatchStatus.PROPOSED, reason="x")
    return soul, record


def _propose():
    cn, eg = _people()
    soul = Soul.objects.create(name="客魂", tenant=cn, current_state=SoulState.DISPOSED)
    return (lambda: DispatchService.propose(cn, eg, soul, None, "x"),
            lambda: DispatchRecord.all_objects.filter(soul=soul, status=DispatchStatus.PROPOSED).exists())


def _approve():
    cn, eg = _people()
    soul, record = _proposed(cn, eg)
    return (lambda: DispatchService.approve(DispatchRecord.all_objects.get(pk=record.pk), "approver"),
            lambda: DispatchRecord.all_objects.get(pk=record.pk).status == DispatchStatus.APPROVED)


def _reject():
    cn, eg = _people()
    soul, record = _proposed(cn, eg)
    return (lambda: DispatchService.reject(DispatchRecord.all_objects.get(pk=record.pk), "rejector", "no"),
            lambda: DispatchRecord.all_objects.get(pk=record.pk).status == DispatchStatus.REJECTED)


def _return_blocked():
    cn, eg = _people()
    soul = Soul.objects.create(name="客魂", tenant=cn, current_state=SoulState.DISPOSED)
    record = DispatchRecord.objects.create(source_tenant=cn, target_tenant=eg, soul=soul, tenant=cn,
                                           status=DispatchStatus.APPROVED, reason="x")
    DispatchService.execute(record, "executor")
    soul.refresh_from_db()
    Judgment.objects.create(soul=soul, tenant=eg, civilization=soul.civilization)
    disposition = Disposition.objects.create(soul=soul, tenant=eg)
    return (lambda: DispositionService.execute(disposition),
            lambda: SoulEvent.all_objects.filter(soul_id=soul.pk, payload__action="DISPATCH_RETURN_BLOCKED").exists())


def _add_participant():
    _people()
    eg = plan.tenant("EG_DUAT")
    soul, case, cj, _ = _bench_at(eg, "empty")
    return (lambda: CrossTenantJudgmentService.add_participant(
                CrossTenantJudgment.all_objects.get(pk=cj.pk), eg, None, ParticipantRole.CO_JUDGE, node_order=2),
            lambda: CrossTenantJudgmentParticipant.all_objects.filter(judgment_id=cj.pk).exists())


def _conclude():
    _people()
    eg = plan.tenant("EG_DUAT")
    soul, case, cj, _ = _bench_at(eg, "active")
    return (lambda: CrossTenantJudgmentService.conclude(CrossTenantJudgment.all_objects.get(pk=cj.pk), "PASS", None),
            lambda: CrossTenantJudgment.all_objects.get(pk=cj.pk).status == JudgmentStatus.CONCLUDED)


def _conclude_with_workflow():
    """Same root cause outside `apps/dispatch`: `conclude_judgment(create_workflow=True)` announces the new
    workflow (a `notify_workflow_assigned`) from inside the conclusion's own transaction."""
    cn = plan.tenant("CN_DIYU")
    soul, case = plan.open_case(cn)
    from apps.actors.models import Actor, ActorRole

    # The built-in Chinese template's first node names 秦广王; give him a bench seat and an account to notify.
    actor = Actor.objects.create(name="秦广王", role=ActorRole.JUDGE, realm=plan.realm("CN_G4_HALL", "CHINESE"), tenant=cn,
                         civilization="CHINESE")
    plan.officer("qinguang", "JUDGE", cn, actor=actor)
    return (lambda: case.conclude("PASSED", "", create_workflow=True),
            lambda: Judgment.all_objects.get(pk=case.pk).is_final)


PATHS = {"propose": _propose, "approve": _approve, "reject": _reject, "return_blocked": _return_blocked,
         "add_participant": _add_participant, "conclude": _conclude,
         "conclude_with_workflow": _conclude_with_workflow}


def _fail_notification_inserts(hits):
    def wrapper(execute, sql, params, many, context):
        if _NOTIFICATION_INSERT.match(sql):
            hits.append(sql)
            raise BoomError("notification insert")
        return execute(sql, params, many, context)
    return connection.execute_wrapper(wrapper)


@pytest.mark.parametrize("name", PATHS)
def test_a_notification_that_cannot_be_written_does_not_take_the_business_write_with_it(
        name, django_capture_on_commit_callbacks):
    run, written = PATHS[name]()
    hits = []
    with _fail_notification_inserts(hits):
        # the enclosing transaction a caller (e.g. the sentence plan) may hold:
        with django_capture_on_commit_callbacks(execute=False) as callbacks, transaction.atomic():
            run()
        persisted = written()
        for send in callbacks:  # "after commit": the failure costs the notification only
            # The test's own transaction stands in for autocommit; the failed INSERT breaks it for the rest of
            # the callback (a real post-commit callback runs in autocommit and loses only that one row).
            with suppress(BoomError, TransactionManagementError), transaction.atomic():
                send()
    assert hits, "no notification INSERT was attempted, so the injection proved nothing"
    assert persisted, f"{name}: a failed notification INSERT rolled back the business write"


@pytest.mark.parametrize("name", PATHS)
def test_a_rolled_back_caller_leaves_no_notification_behind(name, django_capture_on_commit_callbacks):
    run, written = PATHS[name]()
    before = UserNotification.objects.count()
    with django_capture_on_commit_callbacks(execute=False) as callbacks, pytest.raises(BoomError), transaction.atomic():
        run()
        raise BoomError("the caller's next write fails")
    assert not written()
    assert UserNotification.objects.count() == before
    assert callbacks == [], "a rolled-back transaction left a deferred notification"
