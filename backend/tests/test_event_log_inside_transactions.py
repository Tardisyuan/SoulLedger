"""`EventService.log*` (a `SoulEvent` row written through the event bus) called inside a business transaction.

Companion to `test_dispatch_notifications_after_commit.py` (`8e3f33f7`), which proved the same defect for
`EventService.notify_user`. This file does NOT change production code: it injects a failed `SoulEvent` INSERT
into every distinct call site and records what the caller observes.

ROOT CAUSE (one, shared by every path below)
    `AuditHandler.handle` writes the row with `SoulEvent.objects.create(...)` inside `except Exception: log`.
    Django's `Model.save_base` runs the INSERT under `mark_for_rollback_on_error`, which -- when a transaction is
    open -- flags it `needs_rollback` BEFORE the handler's `except` swallows the error. So the bus reports
    "handled", and the nearest enclosing `atomic()`:
      * has a savepoint (an inner `atomic()`): exits by rolling back to it, silently, clears the flag, and the
        function carries on and returns success  ->  the inner block's business writes are GONE   (SILENT_LOSS)
      * is the outermost block the call sits in (the caller's own `atomic()`, or `transaction.atomic()` around a
        whole request): the next query raises `TransactionManagementError`, and if there is no next query the
        block exit rolls everything back without a word.
    With no transaction open at all (autocommit) the flag is never set and only the event row is lost (SAFE).

HOW EACH PATH IS OBSERVED -- three contexts, because the answer depends on who holds the transaction
    bare            the service called with no transaction open (autocommit), as a view does today.
    wrapped         called inside a caller's `with transaction.atomic():`, nothing queried afterwards.
    wrapped_probe   same, and the caller then runs one more query (the usual "next thing a caller does").
    The module is `transaction=True` so "bare" really is autocommit (inside `django_db`'s outer transaction there
    is no autocommit to observe).

OUTCOME of one (path, context)
    SAFE         no error reached the caller and the business write is in the database
    SILENT_LOSS  no error reached the caller, the function reported success, the business write is NOT there
    LOUD_FAIL    an exception reached the caller (so it knows; the whole write rolled back, consistently)

Two tests per cell:
  * `test_current_behaviour_is_as_documented`  -- pins what happens today (green; goes red when behaviour changes,
    which is the cue to re-read the table in this docstring's sibling, the commit message).
  * `test_a_failed_event_row_never_loses_the_business_write_silently` -- the property we want. The cells that
    are SILENT_LOSS today are `xfail(strict=True)`: the suite stays green now and flips RED (XPASS) the day a
    fix lands, which forces whoever fixes it to delete the mark and update EXPECTED. Kept in the default run on
    purpose: an xfail that is never executed is the "check that can never fire" this repo keeps finding.
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
}

# What happens TODAY, measured on SQLite with the injected failure above. Columns: bare / wrapped / wrapped_probe.
EXPECTED = {}


def _row(name, bare, wrapped, probe):
    for ctx, outcome in zip(CONTEXTS, (bare, wrapped, probe), strict=True):
        EXPECTED[(name, ctx)] = outcome


S, L, F = SAFE, SILENT_LOSS, LOUD_FAIL
# The log call sits INSIDE an inner atomic() (or in a loop of them): the savepoint rolls back silently in every
# context, including a plain autocommit call. These are the dangerous ones.
_row("conclude_amendment/JUDGMENT_CONCLUDED", L, L, L)      # judgment/services.py:271; conclusion + plan advance lost
_row("die/SOUL_ACCOUNT_CREATED", L, L, L)                   # soul_accounts/services.py:155; soul is JUDGING, no account
_row("expire_for_tenant/DISPOSITION_EXPIRED", L, L, L)      # disposition/expiry.py:201; reports expired=1, nothing expired
# The log call sits after the function's own atomic(), with no transaction of its own around it: SAFE under
# autocommit, but the failure lands on whatever transaction the CALLER holds (lost silently, or next query raises).
_row("conclude/JUDGMENT_CONCLUDED", S, L, F)                # judgment/services.py:311
_row("transition_to/STATE_CHANGED", S, L, F)                # souls/models.py:652
_row("soulrecord_create/KARMA_RECALCULATED", S, L, F)       # ledger/services.py:290, via SoulRecord.save
_row("soul_create/SOUL_CREATED", S, L, F)                   # souls/models.py:372, in Soul.save
_row("correct_settlement/SETTLEMENT_CORRECTED", S, L, F)    # souls/models.py:694
_row("reincarnation_execute/REINCARNATION_TRIGGERED", S, L, F)  # reincarnation/services.py:83
_row("complete_rebirth/REINCARNATION_COMPLETED", S, L, F)   # reincarnation/services.py:244
_row("rebirth_submit/REBIRTH_APPLICATION_SUBMITTED", S, L, F)  # soul_accounts/rebirth.py:217
# The log call sits inside an outer atomic() that still has queries to run: they raise TransactionManagementError,
# the whole write rolls back, the caller is told (a 500, but nothing half-written).
_row("conclude/DISPOSITION_CREATED", F, F, F)               # disposition/services.py:192 inside conclude's atomic
_row("conclude/STATE_CHANGED", F, F, F)                     # transition_to inside conclude's atomic
_row("die/STATE_CHANGED", F, F, F)                          # transition_to inside die()'s atomic
_row("complete_rebirth/STATE_CHANGED", F, F, F)             # transition_to inside complete_rebirth's atomic
_row("complete_rebirth/SOUL_ACCOUNT_RETIRED", F, F, F)      # soul_accounts/services.py:430 inside the same atomic
# Already deferred with transaction.on_commit (workflow/services.py:659, `8e3f33f7`): a failed row costs the row only.
_row("conclude+workflow/WORKFLOW_CREATED", S, S, S)


CELLS = [(name, ctx) for name in PATHS for ctx in CONTEXTS]


def _id(cell):
    return f"{cell[0]}@{cell[1]}"


@pytest.mark.parametrize("cell", CELLS, ids=_id)
def test_current_behaviour_is_as_documented(cell):
    name, ctx = cell
    seen = observe(PATHS[name], ctx)
    assert seen.hits, "the injected INSERT was never attempted, so this proved nothing"
    summary = (f"{seen.outcome} (error={type(seen.error).__name__}, persisted={seen.persisted}, "
               f"event_rows={seen.event_rows}, returned={seen.returned!r:.40})")
    assert seen.outcome == EXPECTED.get(cell, "UNMEASURED"), f"{name} @ {ctx}: {summary}"


def _silent(cell):
    return pytest.param(cell, id=_id(cell), marks=pytest.mark.xfail(
        strict=True, reason="SILENT_LOSS: a failed SoulEvent INSERT rolls back the surrounding atomic() "
                            "silently while the function reports success"))


@pytest.mark.parametrize("cell", [_silent(c) if EXPECTED.get(c) == SILENT_LOSS else pytest.param(c, id=_id(c))
                                  for c in CELLS])
def test_a_failed_event_row_never_loses_the_business_write_silently(cell):
    """The property: either the business write survives, or the caller is told. SILENT_LOSS violates it."""
    name, ctx = cell
    seen = observe(PATHS[name], ctx)
    assert seen.hits
    assert seen.outcome != SILENT_LOSS, f"{name} @ {ctx}: function returned {seen.returned!r} but the write is gone"
