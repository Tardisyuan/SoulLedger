"""Guard G4 (docs/ARCHITECTURE-tenant-sharding.md 4.1): failure injection on the four cross-tenant write paths.

The paths (section 1.3, "小结"): dispatch execution, return to the home hall (`end_residence`), the joint
(cross-tenant) judgment, and judgment reopen. Today each is ONE transaction, so a failure at any write
leaves the database as it was. After a split these become sagas across databases; this file is the spec
the saga must keep: whichever write step fails, (1) every table is byte-for-byte what it was before,
(2) "one soul belongs to one tenant at a time" holds, (3) no audit / notification side effect fires.

How steps are enumerated (not guessed). A dry run executes the path once under a SQL wrapper that records
every INSERT / UPDATE / DELETE; that list IS the path's write steps (n of them). Then for k = 1..n the path
is run again from the same starting state with the wrapper raising just before write k. A step the code
swallows (an `except Exception` around a write) shows up as "k did not raise" and fails the test.
The set of tables each path writes is pinned too, so a new write step cannot appear unreviewed.
"""
import re
import traceback

import pytest
from django.apps import apps
from django.db import connection, transaction
from django.db.transaction import TransactionManagementError

from apps.dispatch.models import CrossTenantJudgment, DispatchRecord, DispatchStatus, ParticipantRole
from apps.dispatch.services import CrossTenantJudgmentService, DispatchService
from apps.realms.models import SoulPathEntry
from apps.sentence_plan import requests as plan_requests
from apps.souls.models import Soul
from tests import sentence_plan_support as plan

pytestmark = pytest.mark.django_db

_WRITE = re.compile(r'^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(\w+)"?', re.I)


class InjectedError(Exception):
    pass


#: A handler that swallows the injected error (the event bus does, for notifications) leaves the enclosing
#: transaction marked for rollback, so the NEXT query raises this instead -- still a failure, still all-or-nothing.
FAILURES = (InjectedError, TransactionManagementError)


def _snapshot():
    """Every row of every model, so 'no half-applied record' needs no list of tables."""
    return {m._meta.label: sorted(map(repr, m._base_manager.values_list())) for m in apps.get_models()}


#: Set by `_writes_during` when it injects: was the failing write made from inside the event bus?
INJECTED_FROM_BUS = []


def _writes_during(action, *, fail_at=None):
    """Run `action`; return the tables written. Raise `InjectedError` just before write number `fail_at`."""
    seen = []

    def wrapper(execute, sql, params, many, context):
        found = _WRITE.match(sql)
        if found:
            seen.append(found.group(1))
            if fail_at == len(seen):
                INJECTED_FROM_BUS[:] = [any("apps/events/" in f.filename for f in traceback.extract_stack())]
                raise InjectedError(f"write {fail_at} ({found.group(1)})")
        return execute(sql, params, many, context)

    with connection.execute_wrapper(wrapper):
        action()
    return seen


def _one_tenant_at_a_time(soul_pk):
    soul = Soul.all_objects.get(pk=soul_pk)
    assert soul.tenant_id is not None and soul.home_tenant_id is not None
    executed = DispatchRecord._base_manager.filter(soul_id=soul.pk, status=DispatchStatus.EXECUTED, is_deleted=False)
    if soul.tenant_id == soul.home_tenant_id:
        assert not executed.exists(), "soul is home but a dispatch still says it resides away"
    else:
        rows = list(executed)
        assert len(rows) == 1 and rows[0].target_tenant_id == soul.tenant_id and rows[0].source_tenant_id == soul.home_tenant_id, (
            "soul resides away but no single EXECUTED dispatch accounts for it")
    assert SoulPathEntry.all_objects.filter(soul_id=soul.pk, left_at__isnull=True).count() <= 1


#: Writes made from inside the event bus (notifications, bus-persisted SoulEvents, audit handler) are the only
#: ones the code swallows on failure (`HandlerRegistry._safe_call`, `AuditHandler`): the path carries on without
#: that row and logs an ERROR. That is the design today (handlers must not break business writes). A Saga must
#: keep the same split: the soul's move is atomic, these rows are best effort. Every OTHER write failing must
#: abort the whole path.
_VOLATILE = re.compile(r"datetime\.datetime\([^)]*\)|UUID\('[^']*'\)")


def _comparable(snapshot, ignore_table):
    """Two completed runs differ in clocks and fresh primary keys; blank those out before comparing them."""
    return {label: sorted(_VOLATILE.sub("~", row) for row in rows) for label, rows in snapshot.items()
            if apps.get_model(label)._meta.db_table != ignore_table}


def _run_every_step(soul_pk, action, expected_tables, capture):
    sid = transaction.savepoint()
    before = _snapshot()
    with capture(execute=True) as ok_callbacks:
        tables = _writes_during(action)
    assert set(tables) == set(expected_tables), f"write steps changed: {sorted(set(tables) ^ set(expected_tables))}"
    done = _snapshot()
    assert done != before, "the path wrote nothing, so the checks below would be vacuous"
    assert ok_callbacks, "the success path registers no on_commit side effect; nothing for rollback to withhold"
    _one_tenant_at_a_time(soul_pk)
    transaction.savepoint_rollback(sid)
    anomalies = []
    for k in range(1, len(tables) + 1):
        sid = transaction.savepoint()
        with capture(execute=True) as callbacks:
            try:
                _writes_during(action, fail_at=k)
                raised = False
            except FAILURES:
                raised = True
        if raised:
            assert callbacks == [], f"a rolled-back run (failing at write {k}) left an on_commit callback"
            assert _snapshot() == before, f"failing at write {k} ({tables[k - 1]}) left a half-applied record"
        else:
            # Swallowed: only a write made from inside the event bus may be, and then the path must have either
            # completed (minus that one row) or left nothing at all.
            assert INJECTED_FROM_BUS == [True], f"write {k} ({tables[k - 1]}) failed and the path carried on"
            now = _snapshot()
            if now != before and _comparable(now, tables[k - 1]) != _comparable(done, tables[k - 1]):
                anomalies.append((k, tables[k - 1]))
        _one_tenant_at_a_time(soul_pk)
        transaction.savepoint_rollback(sid)
    return anomalies


#: Swallowed event-bus failures that leave a half-applied state, keyed by path -> [(write number, table)].
#: Empty since plan notifications are sent after commit (`sentence_plan.services.notify_judges`).
KNOWN_PARTIAL = {}


def _guard(name, *args):
    found = _run_every_step(*args)
    assert found == KNOWN_PARTIAL.get(name, []), (
        f"{name}: swallowed event-bus failures that left a half-applied state: {found}")


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


@pytest.fixture
def eg():
    return plan.tenant("EG_DUAT")


@pytest.fixture
def eu():
    return plan.tenant("EU_HEAVEN_HELL")


@pytest.fixture(autouse=True)
def judges(cn, eg, eu):
    """A judge in every hall, so the notifications the paths send have somebody to land on."""
    return [plan.officer(f"judge_{t.code}", "JUDGE", t) for t in (cn, eg, eu)]


# ── 1. dispatch execution ──────────────────────────────────────────────────


def test_executing_a_dispatch_is_all_or_nothing(cn, eg, django_capture_on_commit_callbacks):
    soul = Soul.objects.create(name="客魂", tenant=cn, current_state="DISPOSED")
    realm = plan.realm("EG_G4_HALL", "EGYPTIAN")
    record = DispatchRecord.objects.create(source_tenant=cn, target_tenant=eg, soul=soul, tenant=cn,
                                           status=DispatchStatus.APPROVED, reason="x", target_realm=realm)
    _guard("execute", soul.pk, lambda: DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor"),
                    TABLES["execute"], django_capture_on_commit_callbacks)


def test_executing_a_plan_stop_dispatch_is_all_or_nothing(cn, eg, django_capture_on_commit_callbacks):
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5)])
    plan.serve(soul, p, 1)
    record = DispatchRecord.all_objects.get(pk=plan.node(p, 2).dispatch_record_id)
    DispatchService.approve(record, "approver")
    _guard("execute_plan", soul.pk, lambda: DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor"),
                    TABLES["execute_plan"], django_capture_on_commit_callbacks)


# ── 2. return to the home hall ─────────────────────────────────────────────


def test_a_manual_return_home_is_all_or_nothing(cn, eg, django_capture_on_commit_callbacks):
    soul, p, record = plan.at_stop(cn, eg)
    _guard("return_manual", soul.pk, lambda: DispatchService.end_residence(
        Soul.all_objects.get(pk=soul.pk), actor=None, trigger=DispatchService.RETURN_MANUAL, reason="x"),
        TABLES["return_manual"], django_capture_on_commit_callbacks)


def test_the_automatic_return_when_a_stop_is_served_is_all_or_nothing(cn, eg, django_capture_on_commit_callbacks):
    soul, p, record = plan.at_stop(cn, eg)
    _guard("return_auto", soul.pk, lambda: plan.serve(soul, p, 2), TABLES["return_auto"], django_capture_on_commit_callbacks)


# Tables each path writes inside its transaction, measured by the dry run (audit rows and notifications come
# later, on_commit, so they are not steps of the path). That includes the joint add/conclude notifications:
# they ran in the transaction until `tests/test_dispatch_notifications_after_commit.py`, and a failed
# notification INSERT then rolled the participant / conclusion back silently (the guard read that as "clean").
_EXEC = {"dispatch_dispatchrecord", "events_soulevent", "realms_soulpathentry", "souls_soul"}
_PLAN = {"sentence_plan_sentencenode"}
TABLES = {
    "execute": _EXEC,
    "execute_plan": _EXEC | _PLAN | {"disposition_disposition"},
    "return_manual": _EXEC | _PLAN | {"audit_auditlog", "sentence_plan_sentenceplan"},
    "return_auto": _EXEC | _PLAN | {"audit_auditlog", "sentence_plan_sentenceplan", "disposition_disposition"},
    "joint_add": {"dispatch_crosstenantjudgmentparticipant"},
    "joint_submit": {"dispatch_crosstenantjudgmentparticipant"},
    "joint_activate": {"dispatch_crosstenantjudgment"},
    "joint_conclude": {"dispatch_crosstenantjudgment"},
    "reopen_decide": {"events_soulevent", "judgment_judgment", "judgment_judgmentcasecounter",
                      "sentence_plan_sentenceplan",
                      "sentence_plan_sentenceplanrequest"},
    "reopen_conclude": _EXEC | _PLAN | {"audit_auditlog", "sentence_plan_sentenceplan", "disposition_disposition",
                                         "judgment_judgment"},
}



# ── 3. the joint (cross-tenant) judgment ───────────────────────────────────
#
# A bench never moves the soul by itself (sentence nodes are made when the original judgment concludes), so for
# these paths the invariant is the plain one: the soul stays where it is and the bench rows are all-or-nothing.


def _bench_at(eg, stage):
    """An original case at CN with a bench of one EG seat, taken to `stage`. Returns (soul, case, cj, seat)."""
    cn = plan.tenant("CN_DIYU")
    soul, case = plan.open_case(cn)
    cj = CrossTenantJudgmentService.create("联审", "d", cn, None)
    cj.judgment = case
    cj.save(update_fields=["judgment"])
    seat = None
    if stage != "empty":
        seat = CrossTenantJudgmentService.add_participant(cj, eg, None, ParticipantRole.CO_JUDGE, node_order=2)
    if stage in ("submitted", "active"):
        CrossTenantJudgmentService.submit_sentence(seat, plan.stop_realm(eg), 5, "", None)
    if stage == "active":
        CrossTenantJudgmentService.activate(cj)
    return soul, case, cj, seat


def test_seating_a_participant_is_all_or_nothing(eg, django_capture_on_commit_callbacks):
    soul, case, cj, _ = _bench_at(eg, "empty")
    _guard("joint_add", soul.pk, lambda: CrossTenantJudgmentService.add_participant(
        CrossTenantJudgment.all_objects.get(pk=cj.pk), eg, None, ParticipantRole.CO_JUDGE, node_order=2),
        TABLES["joint_add"], django_capture_on_commit_callbacks)


def test_filling_a_sentence_is_all_or_nothing(eg, django_capture_on_commit_callbacks):
    soul, case, cj, seat = _bench_at(eg, "seated")
    realm_code = plan.stop_realm(eg)  # outside the measured action: creating the realm is not a step of the path
    _guard("joint_submit", soul.pk, lambda: CrossTenantJudgmentService.submit_sentence(
        type(seat).all_objects.get(pk=seat.pk), realm_code, 5, "", None),
        TABLES["joint_submit"], django_capture_on_commit_callbacks)


def test_convening_the_bench_is_all_or_nothing(eg, django_capture_on_commit_callbacks):
    soul, case, cj, seat = _bench_at(eg, "submitted")
    _guard("joint_activate", soul.pk, lambda: CrossTenantJudgmentService.activate(
        CrossTenantJudgment.all_objects.get(pk=cj.pk)), TABLES["joint_activate"], django_capture_on_commit_callbacks)


def test_concluding_the_bench_is_all_or_nothing(eg, django_capture_on_commit_callbacks):
    soul, case, cj, seat = _bench_at(eg, "active")
    _guard("joint_conclude", soul.pk, lambda: CrossTenantJudgmentService.conclude(
        CrossTenantJudgment.all_objects.get(pk=cj.pk), "PASS", None),
        TABLES["joint_conclude"], django_capture_on_commit_callbacks)


# ── 4. judgment reopen ─────────────────────────────────────────────────────


def _reopen_requested(cn, eg, eu, judges):
    """Soul is in Europe (stop 3 active); Egypt's stop is served; Egypt's judge has filed a REOPEN."""
    soul, p = plan.planned(cn, [(eg, plan.stop_realm(eg), 5), (eu, plan.stop_realm(eu), 7)])
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    plan.serve(soul, p, 2)
    plan.arrive(soul, p, 3)
    req = plan_requests.file_request(p, eg, kind="REOPEN", changes={}, reason="新证据", user=judges[1])
    return soul, p, req


def test_approving_a_reopen_is_all_or_nothing(cn, eg, eu, judges, django_capture_on_commit_callbacks):
    from apps.sentence_plan.models import SentencePlan

    soul, p, req = _reopen_requested(cn, eg, eu, judges)
    _guard("reopen_decide", soul.pk, lambda: plan_requests.decide(
        SentencePlan.all_objects.get(pk=p.pk), req.pk, accept=True, reason="", user=judges[0]),
        TABLES["reopen_decide"], django_capture_on_commit_callbacks)


def test_concluding_a_reopened_judgment_and_sending_the_soul_home_is_all_or_nothing(
        cn, eg, eu, judges, django_capture_on_commit_callbacks):
    from apps.judgment.models import Judgment
    from apps.sentence_plan.models import SentencePlan

    soul, p, req = _reopen_requested(cn, eg, eu, judges)
    plan_requests.decide(SentencePlan.all_objects.get(pk=p.pk), req.pk, accept=True, reason="", user=judges[0])
    plan.serve(soul, p, 3)
    retrial = Judgment.all_objects.get(soul=soul, kind="REOPEN")
    _guard("reopen_conclude", soul.pk, lambda: Judgment.all_objects.get(pk=retrial.pk).conclude("FAILED", ""),
           TABLES["reopen_conclude"], django_capture_on_commit_callbacks)
