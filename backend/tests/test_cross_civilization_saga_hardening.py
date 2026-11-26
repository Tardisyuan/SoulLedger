"""The saga findings of the independent stage-4 review, closed (the stage-4 review (not in this repo);
apps/tenants/shard_saga.py, apps/dispatch/transfer.py, apps/tenants/global_codes.py):

  in transit    a write to a soul while its move is open -- a dispatch, a return home, a rebirth; after step 1 or
                between steps 2 and 3 -- is refused with 423 `soul_in_transit` (never a 500), or kept: never silently lost.
                Every kind of soul write the services make is tried, by the service itself.
  dead letter   a message whose delivery keeps failing counts its attempts and last error, is FAILED after
                MAX_ATTEMPTS, and `check_soul_ownership` / `relay_outbox` exit non-zero until it is retried.
  order         two messages of one subject land in the order they were sent, a failing one holds back only its
                own subject.
  one open case a claim whose case is not on its database is taken over only once the transaction that took it has
                ended; unknown (not PostgreSQL) or in progress, it stands.
  copies        the source row a transfer demotes keeps no key to the source's rows (`copy_blanks`); a late
                HOME_FOLLOWS never rewrites a soul that has come home.

Worlds are random, as in tests/test_cross_civilization_saga.py (fixed seeds plus one per run, `SAGA_SEED` replays).

    cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true DATABASE_URL=sqlite:///:memory: \\
      REDIS_URL=redis://127.0.0.1:6399/0 .venv/bin/python -m pytest --ds=config.settings_sharded -m sharded \\
      --no-cov tests/test_cross_civilization_saga_hardening.py
"""
import io
import random
import threading

import pytest
from django.conf import settings
from django.core.management import CommandError, call_command
from django.db import connection, connections, transaction

from tests.shard_support import CIVS, sharded
from tests.test_cross_civilization_saga import RUN, InjectedError, _approved, _ownership, _walk, _world, seed_of
from tests.test_cross_civilization_saga_limits import (
    _execute,
    _relay,
    _residing,
    _stuck_before_step_3,
    _three,
)
from tests.test_sharded_writes import _assign, _halls, _in_hall, cut

SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = pytest.mark.skipif(
    SQLITE, reason="SQLite has no transaction status to ask and serializes writers. Run on PG.")
#: (seed, forced write cut): one world per run, then the source's, the target's and both civilizations cut.
SEEDS = [(RUN, None), (7, "tgt"), (31, "src"), (88, "both")]


def _soul():
    from apps.souls.models import Soul

    return Soul


@pytest.fixture(autouse=True)
def _reads_everywhere():
    from apps.core.shard_reads import CONTROL_ALIAS, read_context

    with read_context(CONTROL_ALIAS):
        yield


@pytest.fixture
def world(request):
    seed, forced = request.param
    w = _world(seed_of(seed), forced)
    halls = _halls()
    _assign(*CIVS)
    with cut():
        yield w, halls


# ---- 1: a soul in transit ---------------------------------------------------------------------------------------------

def _begin(move, w, halls):
    """The soul's move begun (step 1 committed). Returns (soul pk, source hall, target hall, message kind)."""
    from apps.dispatch import transfer
    from apps.dispatch.services import DispatchService

    src, tgt = halls[w["src"]], halls[w["tgt"]]
    if move == "migrate":
        Soul = _soul()  # noqa: N806
        with _in_hall(src):
            soul = Soul.objects.create(name=f"迁籍{w['seed']}", tenant=src, current_state="REINCARNATING")
        _soul().all_objects.filter(pk=soul.pk).update(inherited_merit=11)
        with _in_hall(src), transaction.atomic():
            transfer.migrate(Soul.lock(soul.pk), tgt)
        return soul.pk, src, tgt, transfer.MIGRATE
    soul, record = _approved(w, halls)
    _soul().all_objects.filter(pk=soul.pk).update(inherited_merit=11)
    _execute(record.pk)
    if move == "execute":
        return soul.pk, src, tgt, transfer.EXECUTE
    _relay()
    with _in_hall(src):
        DispatchService.end_residence(_soul().all_objects.get(pk=soul.pk), actor=None,
                                      trigger=DispatchService.RETURN_MANUAL, reason="transit")
    return soul.pk, tgt, src, transfer.RETURN


def _patch_route():
    from django.urls import get_resolver, reverse

    from apps.souls.views import SoulViewSet

    for callback, name in _walk(get_resolver().url_patterns):
        if getattr(callback, "cls", None) is SoulViewSet and (getattr(callback, "actions", None) or {}).get("patch"):
            return lambda pk: reverse(name, kwargs={"pk": pk})
    raise AssertionError("no PATCH route for SoulViewSet in the URLconf")


def _officer(hall):
    from apps.authentication.models import User

    name = f"transit_{hall.code.lower()}"
    return User.objects.filter(username=name).first() or User.objects.create_user(
        username=name, password="x", role="ADMIN", tenant=hall)


def _writes():
    """Every kind of write the services make to a soul: name -> (column, do(pk, hall, mark) -> value written).
    `do` raises SoulInTransit when refused; the HTTP one turns a 423 into that and fails on anything else."""
    from rest_framework.test import APIClient

    from apps.ledger.services import LedgerService
    from apps.soul_accounts.services import _ensure_soul_code, apply_contacts
    from apps.tenants.shard_saga import SoulInTransit, master_of
    from tests.conftest import sign_in

    route = _patch_route()

    def officer_edit(pk, hall, mark):  # PATCH /souls/{id}/ by the hall's ADMIN
        r = sign_in(APIClient(), _officer(hall)).patch(route(pk), {"name": mark}, format="json")
        if r.status_code == 423:
            assert r.json()["code"] == "soul_in_transit" and str(pk) in r.json()["soul_ids"], r.content
            raise SoulInTransit([pk])
        assert r.status_code == 200, (r.status_code, r.content)
        return mark

    def service_save(pk, hall, mark):  # a service that locks the soul and saves fields (e.g. stations, appeals)
        Soul = _soul()  # noqa: N806
        with _in_hall(hall), transaction.atomic():
            soul = Soul.lock(pk)
            soul.description = mark
            soul.save(update_fields=["description"])
        return mark

    def contact_email(pk, hall, mark):  # apply_contacts, in the hall's transaction (D6 when the soul is elsewhere)
        value = f"{mark}@transit.test"
        with _in_hall(hall), transaction.atomic(using=master_of(hall)):
            apply_contacts(_soul().all_objects.get(pk=pk), contact_email=value)
        return value

    def merit_recalculation(pk, hall, mark):  # LedgerService: the soul's scores from what it inherited
        with _in_hall(hall):
            return LedgerService.recalculate_soul_ledger(_soul().all_objects.get(pk=pk))["merit_score"]

    def bulk_flag(pk, hall, mark):  # a QuerySet.update on souls (stations, the ledger flag, an org's souls moved)
        with _in_hall(hall), transaction.atomic():
            _soul().all_objects.filter(pk=pk).update(origin_region=mark)
        return mark

    def soul_code(pk, hall, mark):  # an account's soul code (soul_accounts: a filtered update)
        with _in_hall(hall):
            soul = _soul().all_objects.get(pk=pk)
            _ensure_soul_code(soul)
        return soul.soul_code

    return {"officer_edit": ("name", officer_edit), "service_save": ("description", service_save),
            "contact_email": ("contact_email", contact_email), "merit_recalculation": ("merit_score", merit_recalculation),
            "bulk_update": ("origin_region", bulk_flag), "soul_code": ("soul_code", soul_code)}


def _attempt(writes, pk, hall, phase):
    """Each write once; {name: ("refused", None) | ("written", value)}."""
    from apps.tenants.shard_saga import SoulInTransit

    out = {}
    for name, (_, do) in writes.items():
        try:
            out[name] = ("written", do(pk, hall, f"{name[:6]}{phase}"))
        except SoulInTransit as e:
            assert e.status_code == 423 and e.problem_code == "soul_in_transit", e
            out[name] = ("refused", None)
    return out


@sharded
@pytest.mark.parametrize("world", SEEDS, indirect=True)
@pytest.mark.parametrize("move", ["execute", "return", "migrate"])
def test_a_write_to_a_soul_in_transit_is_refused_or_kept_never_lost(world, move, monkeypatch):
    from apps.tenants.shard_saga import master_of

    w, halls = world
    writes = _writes()
    pk, source, target, kind = _begin(move, w, halls)
    where = f"seed {w['seed']} {w['cut']} {move}"
    before = {name: getattr(_soul().all_objects.get(pk=pk), col) for name, (col, _) in writes.items()}
    outcomes = {"after step 1": _attempt(writes, pk, source, 1)}
    _stuck_before_step_3(monkeypatch, kind)
    on_target = _soul()._base_manager.using(master_of(target)).filter(pk=pk, tenant_id=target.pk).exists()
    assert on_target, f"{where}: step 2 did not run; not between steps 2 and 3"
    outcomes["between step 2 and 3"] = _attempt(writes, pk, source, 2)
    _relay()
    primary = _soul()._base_manager.using(master_of(target)).get(pk=pk)
    assert primary.tenant_id == target.pk, f"{where}: the move did not complete"
    for phase, results in outcomes.items():
        for name, (outcome, value) in results.items():
            col = writes[name][0]
            if outcome == "written":  # kept: on the primary
                assert getattr(primary, col) == value, f"{where} {phase}: {name} wrote {value!r}, primary has " \
                                                       f"{getattr(primary, col)!r} -- a write lost"
            else:  # refused: no row of the soul on any database changed
                held = {getattr(r, col) for alias in settings.DATABASES
                        for r in _soul()._base_manager.using(alias).filter(pk=pk)}
                assert held == {before[name]}, f"{where} {phase}: {name} refused, yet the rows hold {held}"
    # The guard is the move's, not the soul's: once it closes, every write lands on the primary.
    done = _attempt(writes, pk, target, 3)
    primary = _soul()._base_manager.using(master_of(target)).get(pk=pk)
    for name, (outcome, value) in done.items():
        assert outcome == "written" and getattr(primary, writes[name][0]) == value, f"{where} after: {name} {outcome}"
    assert primary.merit_score != before["merit_recalculation"], f"{where}: the recalculation changed nothing"
    _ownership()


# ---- 2a: dead letters ---------------------------------------------------------------------------------------------

def _seat(w, halls):
    """A seat on a joint bench of the source hall for the target hall: one message, source -> target."""
    from apps.dispatch.models import ParticipantRole
    from apps.dispatch.services import CrossTenantJudgmentService

    src, tgt = halls[w["src"]], halls[w["tgt"]]
    with _in_hall(src):
        bench = CrossTenantJudgmentService.create("联审", "d", src, None)
        return CrossTenantJudgmentService.add_participant(bench, tgt, None, ParticipantRole.ADVISOR)


@sharded
@pytest.mark.parametrize("world", SEEDS[:2], indirect=True)
def test_a_message_that_keeps_failing_becomes_a_dead_letter_that_is_reported_until_retried(world, monkeypatch):
    from apps.dispatch.models import CrossTenantJudgmentParticipant
    from apps.dispatch.transfer import SEAT
    from apps.tenants import shard_saga
    from apps.tenants.models import ShardMessageState, ShardOutbox

    w, halls = world
    where = f"seed {w['seed']}"
    seat = _seat(w, halls)
    msg = ShardOutbox._base_manager.using(shard_saga.master_of(halls[w["src"]])).get(kind=SEAT)
    apply, done, refused = shard_saga._HANDLERS[SEAT]

    def broken(payload):
        raise InjectedError("the target's disk is full")
    monkeypatch.setitem(shard_saga._HANDLERS, SEAT, (broken, done, refused))
    for n in range(1, shard_saga.MAX_ATTEMPTS + 1):
        shard_saga.relay()
        msg.refresh_from_db()
        assert msg.attempts == n and "the target's disk is full" in msg.last_error, f"{where}: {msg.attempts}"
        expected = ShardMessageState.FAILED if n == shard_saga.MAX_ATTEMPTS else ShardMessageState.PENDING
        assert msg.state == expected, f"{where}: after {n} failures the message is {msg.state}"
    shard_saga.relay()  # a dead letter is not tried again
    msg.refresh_from_db()
    assert msg.attempts == shard_saga.MAX_ATTEMPTS, where
    out = io.StringIO()
    with pytest.raises(CommandError):
        call_command("check_soul_ownership", "--all", stdout=out)
    assert str(msg.message_id) in out.getvalue() and "FAILED" in out.getvalue(), out.getvalue()
    out = io.StringIO()
    with pytest.raises(CommandError):
        call_command("relay_outbox", stdout=out)
    assert "1 failed" in out.getvalue(), out.getvalue()
    monkeypatch.setitem(shard_saga._HANDLERS, SEAT, (apply, done, refused))  # the cause fixed
    call_command("relay_outbox", "--retry-failed", stdout=io.StringIO())
    msg.refresh_from_db()
    assert msg.state == ShardMessageState.DONE, where
    assert CrossTenantJudgmentParticipant._base_manager.using(
        shard_saga.master_of(halls[w["tgt"]])).filter(pk=seat.pk).exists(), where
    _ownership()


def _fail_until_fixed(monkeypatch, kind, step="apply"):
    """The handler's `apply` (or `done`) of `kind` fails until the returned `fix()`."""
    from apps.tenants import shard_saga

    apply, done, refused = shard_saga._HANDLERS[kind]

    def broken(payload):
        raise InjectedError(f"{kind} {step} broken")
    monkeypatch.setitem(shard_saga._HANDLERS, kind,
                        (broken, done, refused) if step == "apply" else (apply, broken, refused))
    return lambda: monkeypatch.setitem(shard_saga._HANDLERS, kind, (apply, done, refused))


def _pending_kinds():
    from apps.tenants import shard_saga

    return [m.kind for alias, ids in shard_saga.masters() for m in shard_saga.pending(alias, ids)]


def _until_dead(where):
    from apps.tenants import shard_saga

    for _ in range(shard_saga.MAX_ATTEMPTS):
        shard_saga.relay()
    assert shard_saga.failed(), f"{where}: nothing FAILED after {shard_saga.MAX_ATTEMPTS} relays"


@sharded
@pytest.mark.parametrize("world", SEEDS[:2], indirect=True)
def test_a_move_that_is_a_dead_letter_keeps_its_soul_in_transit(world, monkeypatch):
    """Step 3 of a dispatch keeps failing until FAILED: the soul is still in flight -- the source row read as the one
    primary, writes refused, the record EXECUTING -- not two primaries and an open door."""
    from apps.dispatch import transfer
    from apps.dispatch.models import DispatchRecord
    from apps.tenants.shard_saga import SoulInTransit
    from tests.test_cross_civilization_saga_limits import _one_primary

    w, halls = world
    where = f"seed {w['seed']} {w['cut']}"
    soul, record = _approved(w, halls)
    _execute(record.pk)
    fix = _fail_until_fixed(monkeypatch, transfer.EXECUTE, "done")
    _until_dead(where)
    _one_primary(soul.pk, halls[w["src"]].pk, f"{where}: a dead letter")
    assert transfer.executing(DispatchRecord.all_objects.get(pk=record.pk)), where
    with pytest.raises(SoulInTransit), _in_hall(halls[w["src"]]), transaction.atomic():
        locked = _soul().lock(soul.pk)
        locked.name = "dead letter"
        locked.save(update_fields=["name"])
    fix()
    call_command("relay_outbox", "--retry-failed", stdout=io.StringIO())
    _one_primary(soul.pk, halls[w["tgt"]].pk, f"{where}: retried")
    _ownership()


@sharded
@pytest.mark.parametrize("world", SEEDS[:2], indirect=True)
def test_a_dead_letter_holds_back_the_later_messages_of_its_subject_until_retried(world, monkeypatch):
    from apps.tenants import shard_saga

    w, halls = world
    home, residence = halls[w["src"]], halls[w["tgt"]]
    where = f"seed {w['seed']} {w['cut']}"
    soul = _residing(w, halls)
    fix = _fail_until_fixed(monkeypatch, "row.save")
    _contacts(soul.pk, home, "first@dead.test")
    _until_dead(where)
    fix()
    _contacts(soul.pk, home, "second@dead.test")
    for _ in range(2):
        shard_saga.relay()
    primary = _soul()._base_manager.using(shard_saga.master_of(residence))
    assert primary.get(pk=soul.pk).contact_email != "second@dead.test", f"{where}: overtook a dead letter"
    assert len(shard_saga.failed()) == 1 and len(_pending_kinds()) == 1, f"{where}: {_pending_kinds()}"
    call_command("relay_outbox", "--retry-failed", stdout=io.StringIO())
    assert primary.get(pk=soul.pk).contact_email == "second@dead.test", f"{where}: out of order after the retry"


# ---- 2b: order per subject ------------------------------------------------------------------------------------------

def _residing_too(w, halls):
    """A second soul of the source hall residing in the target hall (no realm: `_approved` made the realms)."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus

    src = halls[w["src"]]
    with _in_hall(src):
        soul = _soul().objects.create(name=f"客魂{w['seed']}b", tenant=src, current_state="DISPOSED")
        record = DispatchRecord.objects.create(source_tenant=src, target_tenant=halls[w["tgt"]], soul=soul, tenant=src,
                                               status=DispatchStatus.APPROVED, reason="saga")
    _execute(record.pk)
    _relay()
    return soul


def _contacts(pk, home, value):
    from apps.soul_accounts.services import apply_contacts
    from apps.tenants.shard_saga import master_of

    with _in_hall(home), transaction.atomic(using=master_of(home)):
        apply_contacts(_soul().all_objects.get(pk=pk), contact_email=value)


@sharded
@pytest.mark.parametrize("world", SEEDS, indirect=True)
def test_two_writes_of_one_row_land_in_order_and_a_failure_holds_back_only_its_subject(world, monkeypatch):
    """D6: the home hall writes a residing soul's e-mail twice (two `row.save` messages), and another soul's once.
    The first delivery of the first fails: the second of the same soul waits for it, the other soul's does not."""
    from apps.tenants import shard_saga
    from apps.tenants.models import ShardMessageState, ShardOutbox

    w, halls = world
    home, residence = halls[w["src"]], halls[w["tgt"]]
    where = f"seed {w['seed']} {w['cut']}"
    one = _residing(w, halls)
    other = _residing_too(w, halls)
    _contacts(one.pk, home, "first@order.test")
    _contacts(one.pk, home, "second@order.test")
    _contacts(other.pk, home, "other@order.test")
    sent = list(ShardOutbox._base_manager.using(shard_saga.master_of(home)).filter(kind="row.save").order_by("pk"))
    assert len(sent) == 3, f"{where}: {sent}"
    apply, done, refused = shard_saga._HANDLERS["row.save"]
    first_id = sent[0].message_id

    def first_fails_once(payload):
        if payload["message_id"] == str(first_id) and not failed:
            failed.append(1)
            raise InjectedError("first delivery")
        return apply(payload)
    failed = []
    monkeypatch.setitem(shard_saga._HANDLERS, "row.save", (first_fails_once, done, refused))
    shard_saga.relay()
    states = {m.message_id: ShardOutbox._base_manager.using(shard_saga.master_of(home)).get(pk=m.pk).state for m in sent}
    assert states == {sent[0].message_id: ShardMessageState.PENDING, sent[1].message_id: ShardMessageState.PENDING,
                      sent[2].message_id: ShardMessageState.DONE}, f"{where}: {states}"
    primary = _soul()._base_manager.using(shard_saga.master_of(residence))
    assert primary.get(pk=one.pk).contact_email != "second@order.test", f"{where}: the second write overtook the first"
    assert primary.get(pk=other.pk).contact_email == "other@order.test", f"{where}: another subject was held back"
    _relay()
    assert primary.get(pk=one.pk).contact_email == "second@order.test", f"{where}: the writes landed out of order"


# ---- 2c: one open case: no clock -----------------------------------------------------------------------------------

@sharded
@pytest.mark.parametrize("world", SEEDS[:3], indirect=True)
def test_a_claim_whose_writer_cannot_be_known_finished_is_never_taken_over(world):
    """The claim names a case not on its database and a transaction that is in progress or unknown (SQLite has no
    transaction status to ask): the next opener is refused, however old the claim -- never a second open case."""
    import uuid
    from datetime import timedelta

    from django.utils import timezone

    from apps.judgment.services import OpenCaseRefusedError
    from apps.tenants import global_codes
    from apps.tenants.models import OpenCaseClaim
    from apps.tenants.shard_saga import master_of

    w, halls = world
    soul = _residing(w, halls)
    hall = random.Random(str(w["seed"])).choice([halls[w["tgt"]], halls[w["src"]]])
    alias = master_of(hall)
    claim_txn = global_codes._case_txn(alias)
    assert global_codes._writer_finished(claim_txn) is False, claim_txn  # this test's own transaction, or unknown
    OpenCaseClaim.objects.using("default").create(
        soul_id=soul.pk, judgment_id=uuid.uuid4(), tenant_id=hall.pk, case_txn=claim_txn)
    OpenCaseClaim.objects.using("default").filter(soul_id=soul.pk).update(claimed_at=timezone.now() - timedelta(days=1))
    from tests.test_cross_civilization_saga_limits import _open, _open_cases

    with pytest.raises(OpenCaseRefusedError) as refused:
        _open(_soul().all_objects.get(pk=soul.pk), hall)
    assert refused.value.code == "open_case", f"seed {w['seed']}: {refused.value}"
    assert _open_cases(soul.pk) == set(), f"seed {w['seed']}: a case opened past a claim in flight"


@sharded
@NEEDS_ROW_LOCKS
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_a_claim_is_held_while_its_case_transaction_runs_and_taken_over_once_it_rolls_back():
    """Real PostgreSQL: one opener's transaction writes its case and stays open (however long: no clock); the other
    is refused. It then rolls back: the other opens, taking the claim over."""
    from apps.core.shard_reads import CONTROL_ALIAS, read_context
    from apps.judgment.services import JudgmentService, OpenCaseRefusedError

    seed = random.randrange(10**6)
    rng = random.Random(seed)
    src_civ, tgt_civ = rng.sample(CIVS, 2)
    w = {"seed": seed, "src": src_civ, "tgt": tgt_civ, "cut": sorted({src_civ, tgt_civ}), "realm": False}
    halls = _halls()
    _assign(*CIVS)
    first, second = rng.sample([halls[src_civ], halls[tgt_civ]], 2)
    where = f"seed {seed} {first.code} holds, {second.code} waits"
    with cut(), read_context(CONTROL_ALIAS):
        soul = _residing(w, halls)
        opened, rolled_back = threading.Event(), threading.Event()
        errors = []

        class RollbackError(Exception):
            pass

        def holder():
            try:
                with read_context(CONTROL_ALIAS), _in_hall(first), transaction.atomic():
                    JudgmentService.open_case(soul, actor=None, tenant=first)
                    opened.set()
                    assert rolled_back.wait(60), "the main thread never let go"
                    raise RollbackError
            except RollbackError:
                pass
            except Exception as e:  # noqa: BLE001 -- reported below
                errors.append(repr(e))
                opened.set()
            finally:
                connections.close_all()

        t = threading.Thread(target=holder)
        t.start()
        try:
            assert opened.wait(60), f"{where}: the holder never opened"
            assert errors == [], f"{where}: {errors}"
            with _in_hall(second), pytest.raises(OpenCaseRefusedError) as refused:
                JudgmentService.open_case(soul, actor=None, tenant=second)
            assert refused.value.code == "open_case", f"{where}: {refused.value}"
        finally:
            rolled_back.set()
            t.join(60)
        assert not t.is_alive(), f"{where}: the holder did not finish"
        with _in_hall(second):
            case = JudgmentService.open_case(soul, actor=None, tenant=second)
        from tests.test_cross_civilization_saga_limits import _claims, _open_cases

        assert _open_cases(soul.pk) == {case.pk} and _claims(soul.pk) == [case.pk], where


# ---- copies: the demoted row, the home copy ---------------------------------------------------------------------------

@sharded
@pytest.mark.parametrize("world", [(RUN, "src"), (12, "both"), (41, "src")], indirect=True)
def test_the_source_row_a_transfer_demotes_keeps_no_key_to_the_sources_rows(world):
    """Gap 4d: the copy left on the source's master names the new hall and has its keys to other shard rows blank
    (`copy_blanks`): they named the source hall's rows."""
    from apps.core.shard_sync import copy_blanks
    from apps.tenants.shard_saga import master_of

    w, halls = world
    soul, record = _approved(w, halls)
    blanks = copy_blanks(_soul())
    held = {f: getattr(_soul().all_objects.get(pk=soul.pk), f) for f in blanks}
    assert blanks and any(v is not None for v in held.values()), f"seed {w['seed']}: nothing to blank: {held}"
    _execute(record.pk)
    _relay()
    src_alias = master_of(halls[w["src"]])
    copy = _soul()._base_manager.using(src_alias).get(pk=soul.pk)
    assert copy.tenant_id == halls[w["tgt"]].pk, f"seed {w['seed']}: not a copy"
    assert {f: getattr(copy, f) for f in blanks} == dict.fromkeys(blanks), f"seed {w['seed']}: {copy.__dict__}"
    _ownership()


@sharded
@pytest.mark.parametrize("seed", [RUN, 3, 64, 918])
def test_a_late_home_follows_does_not_move_a_soul_that_has_come_home(seed, monkeypatch):
    """A soul moves on from a residence to a third civilization; the home copy's HOME_FOLLOWS is held up while the soul
    comes home. Delivered late, it names the residence the soul left -- the home row, now the primary, stays home."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService
    from apps.dispatch.transfer import HOME_FOLLOWS
    from apps.tenants import shard_saga
    from apps.tenants.shard_saga import master_of

    checked = DispatchService.check_executable

    def onward_allowed(record, soul):  # as tests/test_cross_civilization_saga_limits.py limit 3
        if soul.is_residing and soul.tenant_id == record.source_tenant_id:
            return None
        return checked(record, soul)
    monkeypatch.setattr(DispatchService, "check_executable", staticmethod(onward_allowed))
    seed = seed_of(seed)
    t = _three(seed)
    halls = _halls()
    _assign(*CIVS)
    home, a, b = halls[t["home"]], halls[t["a"]], halls[t["b"]]
    where = f"seed {seed} {t}"
    with cut():
        soul, first = _approved({"seed": seed, "src": t["home"], "tgt": t["a"], "realm": False}, halls)
        _execute(first.pk)
        _relay()
        with _in_hall(a):
            onward = DispatchRecord.objects.create(source_tenant=a, target_tenant=b, soul=soul, tenant=a,
                                                   status=DispatchStatus.APPROVED, reason="onward")
        apply, done, refused = shard_saga._HANDLERS[HOME_FOLLOWS]

        def held_up(payload):
            raise InjectedError("home shard unreachable")
        monkeypatch.setitem(shard_saga._HANDLERS, HOME_FOLLOWS, (held_up, done, refused))
        _execute(onward.pk)
        for _ in range(3):
            shard_saga.relay()
        assert DispatchRecord.all_objects.get(pk=onward.pk).status == DispatchStatus.EXECUTED, where
        with _in_hall(home):
            DispatchService.end_residence(_soul().all_objects.get(pk=soul.pk), actor=None,
                                          trigger=DispatchService.RETURN_MANUAL, reason="home")
        for _ in range(3):
            shard_saga.relay()
        late = [m for alias, ids in shard_saga.masters() for m in shard_saga.pending(alias, ids) if m.kind == HOME_FOLLOWS]
        assert len(late) == 1, f"{where}: {late}"
        assert _soul()._base_manager.using(master_of(home)).get(pk=soul.pk).tenant_id == home.pk, where
        monkeypatch.setitem(shard_saga._HANDLERS, HOME_FOLLOWS, (apply, done, refused))
        _relay()
        assert _soul()._base_manager.using(master_of(home)).get(pk=soul.pk).tenant_id == home.pk, \
            f"{where}: a late HOME_FOLLOWS moved the soul that came home"
        _ownership()
