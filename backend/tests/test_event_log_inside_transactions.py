"""A `SoulEvent` row is part of the business record: if it cannot be written, the business write rolls back and
the caller gets the REAL error (the failed insert), not a later `TransactionManagementError`.

History: `8e3f33f7` proved that `EventService.notify_user` inside a business transaction was defective; this file
began as the same experiment for `EventService.log*` and found 17 of 51 (path, context) cells silently losing the
business write while the function reported success (xfail(strict) in `dddee9e9`). The decision (user, 2026-10-10)
was fail-loud, and these cells now pin it.

Mechanism that made it silent: `AuditHandler` swallowed the exception and the registry swallowed it again, but
`Model.save_base` had already flagged the transaction `needs_rollback`, so the nearest enclosing `atomic()` rolled
back silently. Fix: `DomainEventHandler.propagate_errors` (True only for `AuditHandler`); the registry runs such
handlers first and re-raises their exception; and every call site now writes the event INSIDE the transaction of
the write it describes (so "autocommit" callers roll back too).

Each path is observed in three contexts, because the answer used to depend on who held the transaction:
    bare            the service called with no transaction open (autocommit), as a view does.
    wrapped         called inside a caller's `with transaction.atomic():`.
    wrapped_probe   same, and the caller then runs one more query.
The module is `transaction=True` so "bare" really is autocommit.

Every cell below must be LOUD_FAIL: the original injected `OperationalError` reaches the caller, the business
write is not in the database, and no event row exists. Not in the grid, with their own tests: `expire_for_tenant` and the ledger recalculation task (batch loops: one
row's failure is logged, counted in the result and does not stop the batch) and `die()` account provisioning
(kept by design: the death stands, the officers are told after commit).
"""
import datetime
from dataclasses import dataclass

import pytest
from django.db import OperationalError, connection, transaction
from django.utils import timezone

from apps.disposition.expiry import expire_for_tenant
from apps.disposition.models import Disposition
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment, JudgmentKind
from apps.reincarnation.services import ReincarnationService
from apps.soul_accounts.models import SoulAccount
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from tests import sentence_plan_support as plan
from tests.soul_account_support import rebirth_ready_soul
from tests.test_dispatch_notifications_after_commit import _conclude_with_workflow

pytestmark = pytest.mark.django_db(transaction=True)

SAFE, SILENT_LOSS, LOUD_FAIL = "SAFE", "SILENT_LOSS", "LOUD_FAIL"
BARE, WRAPPED, PROBE = "bare", "wrapped", "wrapped_probe"
CONTEXTS = (BARE, WRAPPED, PROBE)


def _cn():
    return plan.tenant("CN_DIYU")


# ── the injection ──────────────────────────────────────────────────────────────────────────────────────────


def _fail_event_inserts(event_type, hits):
    """Make the INSERT of a `SoulEvent` of this type fail, the way a real DB error would (OperationalError)."""
    table = SoulEvent._meta.db_table

    def wrapper(execute, sql, params, many, context):
        if sql.lstrip().upper().startswith("INSERT INTO") and f'"{table}"' in sql and event_type in (params or ()):
            hits.append(event_type)
            raise OperationalError("injected: soulevent insert failed")
        return execute(sql, params, many, context)

    return connection.execute_wrapper(wrapper)


@dataclass
class Seen:
    hits: int            # how many times the injected INSERT was attempted
    returned: object     # what the service returned (None if it raised)
    error: Exception | None
    persisted: bool      # the business write, read back outside any transaction
    event_rows: int      # SoulEvent rows of the injected type that exist afterwards

    @property
    def cause_is_the_failed_insert(self):
        return isinstance(self.error, OperationalError) and "injected" in str(self.error)

    @property
    def outcome(self):
        if self.error is not None:
            return LOUD_FAIL
        return SAFE if self.persisted else SILENT_LOSS


def observe(path, context) -> Seen:
    run, persisted, event_type = path()
    hits, result, error = [], None, None
    before = SoulEvent.all_objects.filter(event_type=event_type).count()
    with _fail_event_inserts(event_type, hits):
        try:
            if context == BARE:
                result = run()
            else:
                with transaction.atomic():
                    result = run()
                    if context == PROBE:
                        SoulEvent.all_objects.count()  # the caller's next query
        except Exception as exc:  # noqa: BLE001 -- what the caller sees is the point
            error = exc
    return Seen(len(hits), result, error, bool(persisted()),
                SoulEvent.all_objects.filter(event_type=event_type).count() - before)


# ── the paths ──────────────────────────────────────────────────────────────────────────────────────────────
# Each returns (run, persisted, event_type). `persisted` reads the BUSINESS write the event describes.


def _conclude_original(event_type):
    def path():
        soul, case = plan.open_case(_cn())
        return (lambda: Judgment.all_objects.get(pk=case.pk).conclude("PASSED", ""),
                lambda: Judgment.all_objects.get(pk=case.pk).is_final, event_type)
    return path


def _conclude_amendment():
    """judgment/services.py:271 -- the one `log_judgment_concluded` that sits lexically inside the atomic."""
    soul, p = plan.planned(_cn())
    amend = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=_cn(),
                                    kind=JudgmentKind.AMENDMENT, amends_plan_id=p.pk)
    return (lambda: Judgment.all_objects.get(pk=amend.pk).conclude("PASSED", ""),
            lambda: Judgment.all_objects.get(pk=amend.pk).is_final, "JUDGMENT_CONCLUDED")


def _transition_standalone():
    soul, _ = plan.open_case(_cn())
    return (lambda: Soul.all_objects.get(pk=soul.pk).transition_to(SoulState.DISPOSED, "x"),
            lambda: Soul.all_objects.get(pk=soul.pk).current_state == SoulState.DISPOSED, "STATE_CHANGED")


def _die(event_type):
    def path():
        soul = Soul.objects.create(name="亡魂", tenant=_cn())
        if event_type == "SOUL_ACCOUNT_CREATED":  # the write that event describes is the account, not the state
            written = lambda: SoulAccount.objects.filter(soul=soul).exists()  # noqa: E731
        else:
            written = lambda: Soul.all_objects.get(pk=soul.pk).current_state == SoulState.JUDGING  # noqa: E731
        return (lambda: Soul.all_objects.get(pk=soul.pk).die(), written, event_type)
    return path


def _expiry():
    tenant = _cn()
    soul = Soul.objects.create(name="期满", tenant=tenant, birth_year=1900, death_year=1950)
    Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.REINCARNATING)
    row = Disposition.objects.create(soul=soul, tenant=tenant, is_executed=True, executed_at=timezone.now(),
                                     sentence_years=10, term_start_year=2000, term_start_month=6,
                                     term_start_day=15)
    return (lambda: expire_for_tenant(tenant, today=datetime.date(2010, 6, 15)),
            lambda: Disposition.all_objects.get(pk=row.pk).expired_at is not None, "DISPOSITION_EXPIRED")


def _karma():
    soul = Soul.objects.create(name="功过", tenant=_cn())
    return (lambda: SoulRecord.objects.create(soul=soul, record_type="MERIT", civilization="CHINESE",
                                              description="善举", weight=10, event_year=2000),
            lambda: SoulRecord.all_objects.filter(soul=soul).exists(), "KARMA_RECALCULATED")


def _soul_created():
    return (lambda: Soul.objects.create(name="新魂", tenant=_cn()),
            lambda: Soul.all_objects.filter(name="新魂").exists(), "SOUL_CREATED")


def _correct_settlement():
    soul = Soul.objects.create(name="误结", tenant=_cn(), current_state=SoulState.SETTLED)
    return (lambda: Soul.all_objects.get(pk=soul.pk).correct_settlement(reason="录入错误"),
            lambda: Soul.all_objects.get(pk=soul.pk).current_state == SoulState.DISPOSED, "SETTLEMENT_CORRECTED")


def _reincarnation_trigger():
    soul, case = plan.open_case(_cn(), state=SoulState.DISPOSED)
    disposition = Disposition.objects.create(soul=soul, tenant=_cn())
    return (lambda: ReincarnationService.execute(Disposition.all_objects.get(pk=disposition.pk)),
            lambda: Soul.all_objects.get(pk=soul.pk).current_state == SoulState.REINCARNATING,
            "REINCARNATION_TRIGGERED")


def _rebirth(event_type):
    def path():
        account, _client = rebirth_ready_soul(_cn())
        soul = account.soul  # REINCARNATING, with a live account for this life
        return (lambda: ReincarnationService.complete_rebirth(Soul.all_objects.get(pk=soul.pk), new_identity="来生"),
                lambda: Soul.all_objects.get(pk=soul.pk).current_state == SoulState.ALIVE, event_type)
    return path


def _rebirth_submit():
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import RebirthApplication

    account, _client = rebirth_ready_soul(_cn())
    return (lambda: rebirth.submit(SoulAccount.objects.get(pk=account.pk), "HUMAN", "愿为人"),
            lambda: RebirthApplication.objects.filter(soul=account.soul).exists(), "REBIRTH_APPLICATION_SUBMITTED")


def _workflow_created():
    run, persisted = _conclude_with_workflow()
    return run, persisted, "WORKFLOW_CREATED"


def _judge(username="evlog_judge"):
    from apps.authentication.models import User

    return User.objects.get_or_create(username=username, defaults={"role": "JUDGE", "tenant": _cn()})[0]


def _workflow_decision(verdict, event_type):
    """An officer decides the current node through the real endpoint (workflow/views.py approve_node)."""
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus, NodeStatus
    from tests.soul_account_support import dead_soul, officer_client

    def path():
        tenant = _cn()
        soul = dead_soul(tenant, name="审批灵魂")
        wf = ApprovalWorkflow.objects.create(soul=soul, workflow_name="普通审批", case_type="STANDARD",
                                             status=ApprovalWorkflowStatus.IN_PROGRESS, tenant=tenant)
        node = ApprovalNode.objects.create(workflow=wf, node_name="初审", node_order=1, node_type="EVALUATION",
                                           approver_type="ROLE", approver_role="JUDGE", status=NodeStatus.PENDING,
                                           activated_at=timezone.now())
        wf.current_node = node
        wf.save(update_fields=["current_node"])
        judge = _judge()
        return (lambda: officer_client(judge).post(f"/api/v1/workflows/{wf.pk}/approve_node/",
                                                   {"verdict": verdict, "notes": "x"}, format="json"),
                lambda: ApprovalNode.all_objects.get(pk=node.pk).status != NodeStatus.PENDING, event_type)
    return path


def _workflow_timeout_reject():
    from apps.workflow import timeouts
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus
    from tests.test_workflow_timeout_and_reject_to import _age, _node, _workflow

    wf = _workflow(_cn(), [_node(1, timeout_hours=1, timeout_action="AUTO_REJECT"), _node(2)])
    _age(wf.current_node, 2)
    return (lambda: timeouts._fire(wf.pk, timezone.now()),
            lambda: ApprovalWorkflow.all_objects.get(pk=wf.pk).status == ApprovalWorkflowStatus.REJECTED
            and ApprovalNode.all_objects.filter(workflow=wf, notes="超时自动驳回").exists(), "WORKFLOW_REJECTED")


def _submitted_application():
    from apps.soul_accounts import rebirth

    account, _client = rebirth_ready_soul(_cn())
    return account, rebirth.submit(SoulAccount.objects.get(pk=account.pk), "HUMAN", "愿为人")


def _rejected_application():
    """Submitted, then the workflow is rejected and the application follows (the real sync, uninjected)."""
    from apps.soul_accounts import rebirth
    from apps.workflow.models import ApprovalWorkflow

    account, application = _submitted_application()
    ApprovalWorkflow.all_objects.filter(pk=application.workflow_id).update(status="REJECTED")
    rebirth.sync_from_workflow(application.workflow_id)
    return account, type(application).objects.get(pk=application.pk)


def _rebirth_submit_workflow_created():
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import RebirthApplication

    account, _client = rebirth_ready_soul(_cn())
    return (lambda: rebirth.submit(SoulAccount.objects.get(pk=account.pk), "HUMAN", "愿为人"),
            lambda: RebirthApplication.objects.filter(soul=account.soul).exists(), "WORKFLOW_CREATED")


def _rebirth_appeal(event_type):
    def path():
        from apps.soul_accounts import rebirth
        from apps.soul_accounts.models import RebirthApplication

        account, application = _rejected_application()
        return (lambda: rebirth.appeal(SoulAccount.objects.get(pk=account.pk), application.pk, "申诉"),
                lambda: RebirthApplication.objects.get(pk=application.pk).appeal_workflow_id is not None,
                event_type)
    return path


def _rebirth_sync():
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import RebirthApplication, RebirthApplicationStatus
    from apps.workflow.models import ApprovalWorkflow

    account, application = _submitted_application()
    ApprovalWorkflow.all_objects.filter(pk=application.workflow_id).update(status="REJECTED")
    return (lambda: rebirth.sync_from_workflow(application.workflow_id),
            lambda: RebirthApplication.objects.get(pk=application.pk).status == RebirthApplicationStatus.REJECTED,
            "REBIRTH_STATUS_CHANGED")


def _rebirth_cooldown_decide():
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import CooldownShorteningRequest, CooldownShorteningStatus

    account, application = _rejected_application()
    request = rebirth.request_cooldown_shortening(SoulAccount.objects.get(pk=account.pk), "家中有事")
    judge = _judge()
    return (lambda: rebirth.decide_cooldown_shortening(request.pk, judge, approve=False, note="冷却照旧"),
            lambda: CooldownShorteningRequest.objects.get(pk=request.pk).status == CooldownShorteningStatus.REJECTED,
            "COOLDOWN_SHORTENING_DECIDED")


def _rebirth_cross_civ():
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import RebirthApplication

    account, application = _submitted_application()
    judge = _judge()
    return (lambda: rebirth.decide_cross_civilization(application.pk, judge, True),
            lambda: RebirthApplication.objects.get(pk=application.pk).cross_civilization is True,
            "REBIRTH_CROSS_CIV_DECIDED")


PATHS = {
    # judgment conclusion (ORIGINAL) -- three different log calls on one call stack
    "conclude/JUDGMENT_CONCLUDED": _conclude_original("JUDGMENT_CONCLUDED"),
    "conclude/DISPOSITION_CREATED": _conclude_original("DISPOSITION_CREATED"),
    "conclude/STATE_CHANGED": _conclude_original("STATE_CHANGED"),
    "conclude_amendment/JUDGMENT_CONCLUDED": _conclude_amendment,
    "conclude+workflow/WORKFLOW_CREATED": _workflow_created,
    "transition_to/STATE_CHANGED": _transition_standalone,
    "die/STATE_CHANGED": _die("STATE_CHANGED"),
    "die/SOUL_ACCOUNT_CREATED": _die("SOUL_ACCOUNT_CREATED"),
    "expire_for_tenant/DISPOSITION_EXPIRED": _expiry,
    "soulrecord_create/KARMA_RECALCULATED": _karma,
    "soul_create/SOUL_CREATED": _soul_created,
    "correct_settlement/SETTLEMENT_CORRECTED": _correct_settlement,
    "reincarnation_execute/REINCARNATION_TRIGGERED": _reincarnation_trigger,
    "complete_rebirth/REINCARNATION_COMPLETED": _rebirth("REINCARNATION_COMPLETED"),
    "complete_rebirth/STATE_CHANGED": _rebirth("STATE_CHANGED"),
    "complete_rebirth/SOUL_ACCOUNT_RETIRED": _rebirth("SOUL_ACCOUNT_RETIRED"),
    "rebirth_submit/REBIRTH_APPLICATION_SUBMITTED": _rebirth_submit,
    "rebirth_submit/WORKFLOW_CREATED": _rebirth_submit_workflow_created,
    "rebirth_appeal/WORKFLOW_CREATED": _rebirth_appeal("WORKFLOW_CREATED"),
    "rebirth_appeal/REBIRTH_STATUS_CHANGED": _rebirth_appeal("REBIRTH_STATUS_CHANGED"),
    "rebirth_sync/REBIRTH_STATUS_CHANGED": _rebirth_sync,
    "rebirth_cooldown_decide/COOLDOWN_SHORTENING_DECIDED": _rebirth_cooldown_decide,
    "rebirth_cross_civ/REBIRTH_CROSS_CIV_DECIDED": _rebirth_cross_civ,
    # workflow decisions: the timeline event is written in the decision's transaction (`record_events`)
    "workflow_approve/WORKFLOW_APPROVED": _workflow_decision("PASSED", "WORKFLOW_APPROVED"),
    "workflow_reject/WORKFLOW_REJECTED": _workflow_decision("FAILED", "WORKFLOW_REJECTED"),
    "workflow_timeout_reject/WORKFLOW_REJECTED": _workflow_timeout_reject,
}

OUTSIDE_THE_GRID = {"expire_for_tenant/DISPOSITION_EXPIRED", "die/SOUL_ACCOUNT_CREATED"}
GRID = [name for name in PATHS if name not in OUTSIDE_THE_GRID]
CELLS = [(name, ctx) for name in GRID for ctx in CONTEXTS]


def _id(cell):
    return f"{cell[0]}@{cell[1]}"


@pytest.mark.parametrize("cell", CELLS, ids=_id)
def test_a_failed_event_row_rolls_the_business_write_back_and_raises_the_real_error(cell):
    name, ctx = cell
    seen = observe(PATHS[name], ctx)
    assert seen.hits, "the injected INSERT was never attempted, so this proved nothing"
    assert seen.outcome == LOUD_FAIL, f"{name} @ {ctx}: {seen.outcome} (persisted={seen.persisted})"
    assert seen.cause_is_the_failed_insert, f"{name} @ {ctx}: caller saw {seen.error!r}, not the failed insert"
    assert not seen.persisted, f"{name} @ {ctx}: the business write survived a failed event row"
    assert seen.event_rows == 0


@pytest.mark.parametrize("ctx", CONTEXTS)
def test_a_failed_account_event_undoes_the_account_but_not_the_death_by_design(ctx, caplog):
    """`provision_on_death` (soul_accounts/services.py) deliberately does NOT let an account-opening failure roll
    the death back: "death is a fact, the account is derived, `backfill_soul_accounts` fills the gap". So the
    account and its SOUL_ACCOUNT_CREATED event roll back TOGETHER in a savepoint (consistent, not silent: it is
    logged at ERROR with the original exception) and the soul is still JUDGING. This is the one place the
    fail-loud rule does not reach the caller; it was a documented decision before this change."""
    path = PATHS["die/SOUL_ACCOUNT_CREATED"]
    seen = observe(path, ctx)
    assert seen.hits and seen.error is None
    assert not seen.persisted and seen.event_rows == 0          # no account, no event
    assert isinstance(seen.returned, Judgment)                   # the death stands
    assert any(r.exc_info and isinstance(r.exc_info[1], OperationalError) and "provisioning" in r.getMessage()
               for r in caplog.records), "swallowed without logging the original exception"


def test_expiry_logs_counts_and_continues_when_one_row_event_cannot_be_written(caplog):
    run, persisted, event_type = _expiry()
    hits = []
    with _fail_event_inserts(event_type, hits):
        result = run()
    assert hits
    assert not persisted(), "the row was marked expired although its event row could not be written"
    assert result["expired"] == 0 and len(result["failed"]) == 1
    assert any("left unexpired" in r.getMessage() and r.exc_info and isinstance(r.exc_info[1], OperationalError)
               for r in caplog.records), "the failure was not logged with the original exception"


def test_expiry_does_not_let_one_failed_row_stop_the_others():
    run, persisted, event_type = _expiry()
    tenant = _cn()
    soul = Soul.objects.create(name="期满乙", tenant=tenant, birth_year=1900, death_year=1950)
    Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.REINCARNATING)
    Disposition.objects.create(soul=soul, tenant=tenant, is_executed=True, executed_at=timezone.now(),
                                        sentence_years=10, term_start_year=2000, term_start_month=6,
                                        term_start_day=15)
    calls = []
    table = SoulEvent._meta.db_table

    def fail_first(execute, sql, params, many, context):
        if sql.lstrip().upper().startswith("INSERT INTO") and f'"{table}"' in sql and event_type in (params or ()):
            calls.append(1)
            if len(calls) == 1:
                raise OperationalError("injected: soulevent insert failed")
        return execute(sql, params, many, context)

    with connection.execute_wrapper(fail_first):
        result = run()
    assert (result["expired"], len(result["failed"])) == (1, 1)
    assert Disposition.all_objects.filter(expired_at__isnull=False).count() == 1


def test_the_ledger_task_logs_counts_and_continues_when_one_soul_cannot_be_recalculated(caplog):
    from apps.ledger.tasks import recalculate_tenant_ledgers

    tenant = _cn()
    soul = Soul.objects.create(name="功过乙", tenant=tenant)
    SoulRecord.objects.create(soul=soul, record_type="MERIT", civilization="CHINESE", description="善举",
                              weight=10, event_year=2000)
    Soul.all_objects.filter(pk=soul.pk).update(merit_score=0)
    hits = []
    with _fail_event_inserts("KARMA_RECALCULATED", hits):
        result = recalculate_tenant_ledgers(str(tenant.pk))
    assert hits
    assert result["updated"] == 0 and result["failed"] == [str(soul.pk)]
    assert Soul.all_objects.get(pk=soul.pk).merit_score == 0, "new scores survived a failed event row"
    assert any(r.exc_info and isinstance(r.exc_info[1], OperationalError) for r in caplog.records)


def test_a_failed_account_opening_tells_the_admins_after_commit_and_only_then():
    """`die()` keeps its design (death stands, account backfilled later) but no longer fails quietly: the
    soul's home-tenant admins -- and the acting officer, if any -- get one in-app notification each, sent by
    `transaction.on_commit`, so a failed notification insert can never take the death with it."""
    from apps.authentication.models import User
    from apps.notifications.models import UserNotification

    tenant = _cn()
    admins = [User.objects.create_user(username=f"evlog_admin{i}", role="ADMIN", tenant=tenant) for i in (1, 2)]
    User.objects.create_user(username="evlog_other_hall_admin", role="ADMIN", tenant=plan.tenant("EG_DUAT"))
    User.objects.create_user(username="evlog_judge_not_admin", role="JUDGE", tenant=tenant)
    soul = Soul.objects.create(name="亡魂", tenant=tenant)
    hits = []
    with _fail_event_inserts("SOUL_ACCOUNT_CREATED", hits), transaction.atomic():
        judgment = Soul.all_objects.get(pk=soul.pk).die()
        assert UserNotification.objects.count() == 0, "notified before the death committed"
    assert hits and judgment is not None
    assert Soul.all_objects.get(pk=soul.pk).current_state == SoulState.JUDGING          # death committed
    assert not SoulAccount.objects.filter(soul=soul).exists()                           # no account
    notes = UserNotification.objects.filter(related_resource="soul", related_id=str(soul.pk))
    assert sorted(n.user_id for n in notes) == sorted(a.pk for a in admins)             # one per home admin
    assert all("backfill_soul_accounts" in n.message and "亡魂" in n.message for n in notes)
