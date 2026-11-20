"""The four limits stage 4 part C shipped with, closed (apps/tenants/shard_saga.py, apps/dispatch/transfer.py,
apps/tenants/global_codes.py; tests/test_cross_civilization_saga.py is the saga's own G4):

  1 two primaries   between step 2 and step 3 a soul has a primary-looking row on two masters. While its move is
                    PENDING, every read across them sees the source's and not the target's (`shard_saga.arriving`,
                    `shard_reads._not_arriving`); after step 3 it sees the target's alone.
  2 one open case   a REOPEN at home and a case where the soul resides are written on two databases; the
                    control-side OpenCaseClaim (UNIQUE soul_id) lets exactly one through, and is given back when the
                    case's write fails or the case closes.
  3 home copy       a soul moving on from a residence to a third civilization: the home shard's copy follows it
                    (HOME_FOLLOWS), so `primary_alias` and `check_soul_ownership` see where it is.
  4 relay sweep     a broker outage loses the on-commit kick, never the message (a PostgreSQL row): the beat job
                    `sharding.relay_outbox` or `manage.py relay_outbox` delivers each once, the inbox dedupes.

Worlds are random: fixed seeds -- the first three forcing each write cut (only the source's civilization, only the
target's, both) -- and one drawn per run (`RUN`, `SAGA_SEED=<n>` replays it); the seed is in every failure message.

    cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true DATABASE_URL=sqlite:///:memory: \\
      REDIS_URL=redis://127.0.0.1:6399/0 .venv/bin/python -m pytest --ds=config.settings_sharded -m sharded \\
      --no-cov tests/test_cross_civilization_saga_limits.py
"""
import random
import threading

import pytest
from django.conf import settings
from django.core.management import call_command
from django.db import connection, connections, transaction

from tests.test_cross_civilization_saga import (
    RUN,
    InjectedError,
    _account,
    _approved,
    _messages,
    _ownership,
    _redeliver,
    _snapshot,
    _world,
    seed_of,
)
from tests.test_shard_sync import CIVS, sharded
from tests.test_sharded_writes import _assign, _halls, _in_hall, cut

SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = pytest.mark.skipif(
    SQLITE, reason="SQLite serializes writers; two openers cannot both be past the read check at once. Run on PG.")
#: (seed, forced write cut). RUN draws its world (and its cut) per run.
SEEDS = [(RUN, None), (3, "tgt"), (29, "src"), (64, "both"), (205, None), (918, None)]


@pytest.fixture(autouse=True)
def _reads_everywhere():
    """As tests/test_cross_civilization_saga.py: reads go to every master, the way a management command reads."""
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


def _soul():
    from apps.souls.models import Soul

    return Soul


def _execute(record_pk):
    from apps.dispatch.models import DispatchRecord
    from apps.dispatch.services import DispatchService

    DispatchService.execute(DispatchRecord.all_objects.get(pk=record_pk), "executor")


def _relay():
    from apps.tenants.shard_saga import relay_until_quiet

    relay_until_quiet()


# ---- 1: no read sees two primaries ----------------------------------------------------------------------------------

def _stuck_before_step_3(monkeypatch, kind):
    """Step 2 commits, step 3 fails: the move stays PENDING with a primary-looking row on both masters."""
    from apps.tenants import shard_saga

    apply, _, refused = shard_saga._HANDLERS[kind]

    def fail(payload):
        raise InjectedError("step 3")
    monkeypatch.setitem(shard_saga._HANDLERS, kind, (apply, fail, refused))
    shard_saga.relay()  # logs the failure, leaves the message pending
    monkeypatch.undo()


def _seen(pk):
    """What reads across the masters say of one soul: the hall of every row each read form returns."""
    Soul = _soul()  # noqa: N806
    rows = Soul.all_objects.filter(pk=pk)
    return {
        "list": [s.tenant_id for s in rows.all()],
        "values": list(rows.values_list("tenant_id", flat=True)),
        "count": rows.count(),
        "exists": rows.exists(),
        "get": Soul.all_objects.get(pk=pk).tenant_id,
    }


def _one_primary(pk, hall, where):
    seen = _seen(pk)
    assert seen == {"list": [hall], "values": [hall], "count": 1, "exists": True, "get": hall}, f"{where}: {seen}"
    pks = list(_soul().all_objects.values_list("pk", flat=True))
    assert len(pks) == len(set(pks)), f"{where}: a read of every soul returned one twice"


def _rows_on_masters(pk):
    from apps.tenants.models import Tenant
    from apps.tenants.shard_saga import master_of

    Soul = _soul()  # noqa: N806
    return {(alias, t) for alias in settings.DATABASES
            for t in Soul._base_manager.using(alias).filter(pk=pk).values_list("tenant_id", flat=True)
            if alias == master_of(Tenant._base_manager.using("default").get(pk=t))}


def _opened_in(pk, hall):
    """A soul account of soul `pk` opened in `hall` (where `_primary_soul` looks first, absent a move)."""
    from apps.authentication.models import User

    account = _account(_soul()(pk=pk))
    User.objects.filter(pk=account.user_id).update(tenant=hall)
    return account.user_id


def _account_reads(user_id):
    """The alias the soul account's own requests read (`soul_primary_alias`), asked as a new request asks it."""
    from apps.authentication.models import User
    from apps.core.shard_reads import soul_primary_alias

    return soul_primary_alias(User.objects.get(pk=user_id))


def _moving(pk):
    from apps.tenants.models import GlobalCode
    from apps.tenants.soul_directory import MOVING

    return list(GlobalCode.objects.using("default").filter(kind=MOVING, value=str(pk)).values_list("tenant_id", flat=True))


def _window(monkeypatch, kind, pk, source, target, where):
    """Stuck between step 2 and 3: both rows on their masters, reads see the source's only; then step 3. The soul's
    own account -- opened in the target hall, so absent the move its lookup starts on the master holding the
    arriving row -- reads the source's master until step 3 (control's SOUL_MOVING row, `soul_directory`), then the
    target's; the row goes with the move. Mutation: `_primary_soul` without `moving_from` -> the target's master in
    the window."""
    from apps.tenants.shard_saga import master_of

    user_id = _opened_in(pk, target)
    _stuck_before_step_3(monkeypatch, kind)
    on_masters = _rows_on_masters(pk)
    assert {t for _, t in on_masters} == {source.pk, target.pk}, f"{where}: not in the window: {on_masters}"
    _one_primary(pk, source.pk, f"{where} between step 2 and step 3")
    assert _moving(pk) == [source.pk], f"{where}: {_moving(pk)}"
    assert _account_reads(user_id) == master_of(source), f"{where}: the account read the arriving row's master"
    _relay()
    _one_primary(pk, target.pk, f"{where} after step 3")
    assert _moving(pk) == [], f"{where}: the move closed, its SOUL_MOVING row stayed"
    from apps.tenants.soul_directory import whereabouts

    assert whereabouts(pk) == (None, target.pk), f"{where}: SOUL_LIVES_IN {whereabouts(pk)}"
    assert _account_reads(user_id) == master_of(target), f"{where} after step 3"


@sharded
@pytest.mark.parametrize("world", SEEDS, indirect=True)
def test_between_step_2_and_step_3_a_dispatched_soul_reads_as_its_source_row_only(world, monkeypatch):
    from apps.dispatch.transfer import EXECUTE

    w, halls = world
    soul, record = _approved(w, halls)
    _execute(record.pk)
    _one_primary(soul.pk, halls[w["src"]].pk, f"seed {w['seed']} execute: step 1 only")
    _window(monkeypatch, EXECUTE, soul.pk, halls[w["src"]], halls[w["tgt"]], f"seed {w['seed']} execute")
    _ownership()


@sharded
@pytest.mark.parametrize("world", SEEDS[:4], indirect=True)
def test_between_step_2_and_step_3_a_soul_going_home_reads_as_its_residence_row_only(world, monkeypatch):
    from apps.dispatch.services import DispatchService
    from apps.dispatch.transfer import RETURN

    w, halls = world
    soul, record = _approved(w, halls)
    _execute(record.pk)
    _relay()
    with _in_hall(halls[w["src"]]):
        DispatchService.end_residence(_soul().all_objects.get(pk=soul.pk), actor=None,
                                      trigger=DispatchService.RETURN_MANUAL, reason="window")
    _window(monkeypatch, RETURN, soul.pk, halls[w["tgt"]], halls[w["src"]], f"seed {w['seed']} return")
    _ownership()


@sharded
@pytest.mark.parametrize("world", SEEDS[:4], indirect=True)
def test_between_step_2_and_step_3_a_reborn_soul_reads_as_its_origin_row_only(world, monkeypatch):
    from apps.dispatch import transfer

    w, halls = world
    src, tgt = halls[w["src"]], halls[w["tgt"]]
    Soul = _soul()  # noqa: N806
    with _in_hall(src):
        soul = Soul.objects.create(name=f"迁籍{w['seed']}", tenant=src, current_state="REINCARNATING")
        with transaction.atomic():
            transfer.migrate(Soul.lock(soul.pk), tgt)
    _window(monkeypatch, transfer.MIGRATE, soul.pk, src, tgt, f"seed {w['seed']} migrate")
    _ownership()


# ---- 2: one open case per soul, across databases ----------------------------------------------------------------------

def _residing(w, halls):
    """A JUDGING soul of the source (home) hall residing in the target hall, on another master."""
    from apps.tenants.shard_saga import master_of

    soul, record = _approved(w, halls)
    _execute(record.pk)
    _relay()
    alias = master_of(halls[w["tgt"]])
    with transaction.atomic(using=alias):
        _soul()._base_manager.using(alias).filter(pk=soul.pk).update(current_state="JUDGING")
    return _soul().all_objects.get(pk=soul.pk)


def _open(soul, hall, **kw):
    from apps.judgment.services import JudgmentService

    with _in_hall(hall):
        return JudgmentService.open_case(soul, actor=None, tenant=hall, **kw)


def _open_cases(pk):
    from apps.judgment.models import Judgment

    return {j for alias in settings.DATABASES for j in Judgment._base_manager.using(alias).filter(
        soul_id=pk, verdict__isnull=True, is_final=False, is_deleted=False).values_list("pk", flat=True)}


def _claims(pk):
    from apps.tenants.models import OpenCaseClaim

    return list(OpenCaseClaim.objects.using("default").filter(soul_id=pk).values_list("judgment_id", flat=True))


@pytest.fixture
def blind_read_check(monkeypatch):
    """Both openers past the read across masters before either case is there: what two databases at once give."""
    from apps.judgment import models

    monkeypatch.setattr(models, "open_judgments", lambda soul: models.Judgment.all_objects.none())


@sharded
@pytest.mark.parametrize("world", SEEDS, indirect=True)
def test_a_reopen_at_home_and_a_case_where_the_soul_resides_open_one_case(world, blind_read_check):
    """Sequential, the read check blinded: the second opener -- home or residence, by seed -- is refused by the claim."""
    from apps.judgment.services import OpenCaseRefusedError

    w, halls = world
    soul = _residing(w, halls)
    halls_in_order = [halls[w["tgt"]], halls[w["src"]]]
    random.Random(w["seed"]).shuffle(halls_in_order)
    first, second = halls_in_order
    case = _open(soul, first)
    with pytest.raises(OpenCaseRefusedError) as refused:
        _open(soul, second)
    where = f"seed {w['seed']} {first.code} then {second.code}"
    assert refused.value.code == "open_case" and refused.value.open_ids == [case.pk], f"{where}: {refused.value}"
    assert _open_cases(soul.pk) == {case.pk}, f"{where}: {_open_cases(soul.pk)}"
    assert _claims(soul.pk) == [case.pk], where


@sharded
@pytest.mark.parametrize("world", SEEDS[:4], indirect=True)
def test_a_case_write_that_fails_gives_the_claim_back(world, blind_read_check):
    from apps.judgment.services import OpenCaseRefusedError
    from apps.tenants.shard_saga import master_of

    w, halls = world
    soul = _residing(w, halls)
    alias = master_of(halls[w["tgt"]])
    with transaction.atomic(using=alias):
        _soul()._base_manager.using(alias).filter(pk=soul.pk).update(current_state="REINCARNATING")
    hall = random.Random(w["seed"]).choice([halls[w["tgt"]], halls[w["src"]]])
    with pytest.raises(OpenCaseRefusedError) as refused:  # refused after the claim: the write rolls back
        _open(_soul().all_objects.get(pk=soul.pk), hall)
    assert refused.value.code == "cannot_enter_judgment", f"seed {w['seed']}: {refused.value}"
    assert _claims(soul.pk) == [], f"seed {w['seed']}: the failed write kept its claim"
    with transaction.atomic(using=alias):
        _soul()._base_manager.using(alias).filter(pk=soul.pk).update(current_state="JUDGING")
    case = _open(_soul().all_objects.get(pk=soul.pk), hall)  # at once, not after the grace period
    assert _claims(soul.pk) == [case.pk], f"seed {w['seed']}"


@sharded
@pytest.mark.parametrize("world", SEEDS[:4], indirect=True)
def test_a_closed_case_gives_the_claim_back_and_a_stale_one_is_taken_over(world, blind_read_check,
                                                                          django_capture_on_commit_callbacks):
    from apps.tenants.models import OpenCaseClaim
    from apps.tenants.shard_saga import master_of

    w, halls = world
    soul = _residing(w, halls)
    case = _open(soul, halls[w["tgt"]])
    alias = master_of(halls[w["tgt"]])
    with django_capture_on_commit_callbacks(using=alias, execute=True), transaction.atomic(using=alias):
        case.is_deleted = True  # withdrawn
        case.save(update_fields=["is_deleted"])
    assert _claims(soul.pk) == [], f"seed {w['seed']}: a withdrawn case kept the claim"
    again = _open(soul, halls[w["src"]])
    assert _claims(soul.pk) == [again.pk], f"seed {w['seed']}"
    # A close that sends no signal (a bulk update): the claim names a closed case; the next opener takes it over.
    from apps.judgment.models import Judgment

    with transaction.atomic(using=master_of(halls[w["src"]])):
        Judgment._base_manager.using(master_of(halls[w["src"]])).filter(pk=again.pk).update(is_deleted=True)
    third = _open(soul, halls[w["tgt"]])
    assert list(OpenCaseClaim.objects.using("default").filter(soul_id=soul.pk).values_list(
        "judgment_id", flat=True)) == [third.pk], f"seed {w['seed']}"


@sharded
@NEEDS_ROW_LOCKS
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_two_civilizations_opening_a_case_on_one_soul_at_once_open_exactly_one(monkeypatch):
    """Real threads on real PostgreSQL: the home hall and the residence each past the read across masters (held at
    the claim until both are there), each writing its case on its own master; one case, one refusal."""
    from apps.core.shard_reads import CONTROL_ALIAS, read_context
    from apps.judgment.services import JudgmentService, OpenCaseRefusedError
    from apps.tenants import global_codes

    seed = random.randrange(10**6)
    rng = random.Random(seed)
    src_civ, tgt_civ = rng.sample(CIVS, 2)
    w = {"seed": seed, "src": src_civ, "tgt": tgt_civ, "cut": sorted({src_civ, tgt_civ}), "realm": False}
    halls = _halls()
    _assign(*CIVS)
    with cut(), read_context(CONTROL_ALIAS):
        soul = _residing(w, halls)
        barrier = threading.Barrier(2, timeout=30)
        original = global_codes.claim_open_case

        def at_once(*args, **kwargs):
            barrier.wait()
            return original(*args, **kwargs)

        monkeypatch.setattr(global_codes, "claim_open_case", at_once)
        opened, refused, errors = [], [], []

        def opener(hall):
            try:
                with read_context(CONTROL_ALIAS), _in_hall(hall):
                    opened.append(JudgmentService.open_case(soul, actor=None, tenant=hall).pk)
            except OpenCaseRefusedError as e:
                refused.append(e.code)
            except Exception as e:  # noqa: BLE001 -- reported below
                errors.append(repr(e))
            finally:
                connections.close_all()

        threads = [threading.Thread(target=opener, args=(halls[c],)) for c in (src_civ, tgt_civ)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        where = f"seed {seed} {src_civ}/{tgt_civ}"
        assert errors == [], f"{where}: {errors}"
        assert len(opened) == 1 and refused == ["open_case"], f"{where}: opened {opened}, refused {refused}"
        assert _open_cases(soul.pk) == set(opened), f"{where}: {_open_cases(soul.pk)}"
        assert _claims(soul.pk) == opened, where


# ---- 3: the home copy follows a move to a third civilization --------------------------------------------------------

def _three(seed):
    rng = random.Random(seed)
    home, a, b = rng.sample(CIVS, 3)
    # Three distinct masters: at most one of the three stays on control.
    cut_civs = rng.choice([[home, a, b], [a, b], [home, b], [home, a]])
    return {"seed": seed, "home": home, "a": a, "b": b, "cut": sorted(set(cut_civs))}


@sharded
@pytest.mark.parametrize("seed", [s for s, _ in SEEDS])
def test_a_soul_moving_on_to_a_third_civilization_takes_its_home_copy_along(seed, monkeypatch):
    """Today the business refuses to dispatch a residing soul onward (it goes home first:
    `DispatchService.check_executable` / `propose`), so this relaxes that one check and keeps the rest: the saga's
    data must hold if that rule ever changes, or a path that skips it appears."""
    from apps.core.bare_ids import primary_alias
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService
    from apps.soul_accounts.models import SoulAccount
    from apps.tenants.shard_saga import master_of

    checked = DispatchService.check_executable

    def onward_allowed(record, soul):
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
        account = _account(soul)
        _execute(first.pk)
        _relay()
        with _in_hall(a):
            onward = DispatchRecord.objects.create(source_tenant=a, target_tenant=b, soul=soul, tenant=a,
                                                   status=DispatchStatus.APPROVED, reason="onward")
        _execute(onward.pk)
        _relay()
        Soul = _soul()  # noqa: N806
        home_alias = master_of(home)
        copy = Soul._base_manager.using(home_alias).get(pk=soul.pk)
        assert (copy.tenant_id, copy.home_tenant_id) == (b.pk, home.pk), f"{where}: the home copy names {copy.tenant_id}"
        assert primary_alias(copy) == master_of(b), f"{where}: the home copy reads as primary on {primary_alias(copy)}"
        assert not any(Soul._base_manager.using(alias).filter(pk=soul.pk, tenant_id=a.pk).exists()
                       for alias in settings.DATABASES), f"{where}: a row still names the residence left"
        _ownership()
        if home_alias != "default":  # deleting the home shard's copy is a copy's delete
            with transaction.atomic(using=home_alias):
                Soul._base_manager.using(home_alias).filter(pk=soul.pk).delete()
            assert SoulAccount.objects.get(pk=account.pk).soul_id == soul.pk, where
            assert Soul._base_manager.using(master_of(b)).filter(pk=soul.pk, tenant_id=b.pk).exists(), where


# ---- 4: the relay sweep after a broker outage -----------------------------------------------------------------------

@sharded
@pytest.mark.parametrize("world", SEEDS[:5], indirect=True)
def test_a_broker_outage_loses_no_message_and_the_sweep_delivers_each_once(world, monkeypatch,
                                                                           django_capture_on_commit_callbacks):
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.scheduler import registry
    from apps.tenants import tasks
    from apps.tenants.models import ShardInbox, ShardMessageState, ShardOutbox
    from apps.tenants.shard_saga import master_of

    w, halls = world
    where = f"seed {w['seed']}"
    assert registry.get("sharding.relay_outbox") is not None, "the relay has no beat job of its own"
    kicks = []

    def down(*args, **kwargs):
        kicks.append(1)
        raise ConnectionRefusedError("broker down")
    monkeypatch.setattr(tasks.relay_outbox, "delay", down)
    records, src = [], halls[w["src"]]
    first = _approved(w, halls)[1]
    with _in_hall(src):
        other = _soul().objects.create(name=f"客魂{w['seed']}b", tenant=src, current_state="DISPOSED")
        second = DispatchRecord.objects.create(source_tenant=src, target_tenant=halls[w["tgt"]], soul=other, tenant=src,
                                               status=DispatchStatus.APPROVED, reason="saga")
    for record in (first, second):
        with django_capture_on_commit_callbacks(using=master_of(src), execute=True), \
                transaction.atomic(using=master_of(src)):
            _execute(record.pk)
        records.append(record.pk)
    assert len(kicks) == 2, f"{where}: the on-commit kick did not try the broker"
    sent = ShardOutbox._base_manager.using(master_of(src)).filter(subject__in=[f"dispatch:{pk}" for pk in records])
    assert sorted(sent.values_list("state", flat=True)) == [ShardMessageState.PENDING] * 2, f"{where}: lost"
    assert all(DispatchRecord.all_objects.get(pk=pk).status == DispatchStatus.APPROVED for pk in records)

    # The broker is back: the beat sweep (the task itself) or the command, by seed.
    if random.Random(w["seed"]).random() < 0.5:
        tasks.relay_outbox()
        _relay()  # the follow-on messages a step sends
    else:
        call_command("relay_outbox", verbosity=0)
    assert sorted(sent.values_list("state", flat=True)) == [ShardMessageState.DONE] * 2, f"{where}: not delivered"
    assert all(DispatchRecord.all_objects.get(pk=pk).status == DispatchStatus.EXECUTED for pk in records), where
    inbox = ShardInbox._base_manager.using(master_of(halls[w["tgt"]]))
    ids = list(sent.values_list("message_id", flat=True))
    assert sorted(inbox.filter(message_id__in=ids).values_list("message_id", flat=True)) == sorted(ids), where
    done = _snapshot()
    _redeliver(set(_messages()) - set(ids))  # the two once more, as if the relay died before closing them
    assert _snapshot() == done, f"{where}: a redelivery applied again"
    assert inbox.filter(message_id__in=ids).count() == 2, where
    _ownership()


@sharded
@NEEDS_ROW_LOCKS
@pytest.mark.django_db(databases="__all__", transaction=True)
def test_two_relays_at_once_deliver_each_message_once_and_fail_none(monkeypatch):
    """Real threads on real PostgreSQL: the on-commit kick's relay and the sweep's (`sharding.sync_shards` every
    minute) over the same PENDING messages, meeting at each message (a rendezvous per message id) so both deliver it
    at the same moment. Every message closes once, none is noted as a failure (115 once logged
    WriteOutsideTransaction from a relay; this is the race it was suspected of), each dispatch is EXECUTED."""
    from apps.core.shard_reads import CONTROL_ALIAS, read_context
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.tenants import shard_saga
    from apps.tenants.models import ShardInbox, ShardMessageState
    from apps.tenants.shard_saga import master_of

    seed = random.randrange(10**6)
    rng = random.Random(seed)
    w = _world(seed)
    halls = _halls()
    _assign(*CIVS)
    where = f"seed {seed} {w['src']}->{w['tgt']} cut {w['cut']}"
    print(f"two relays: {where}")
    monkeypatch.setattr(shard_saga, "_kick", lambda: None)  # the relays below are the only ones
    failures, errors = [], []
    noted = shard_saga._note_failure

    def note(alias, msg, error):
        failures.append(f"{msg.kind}: {type(error).__name__}: {error}")
        return noted(alias, msg, error)
    monkeypatch.setattr(shard_saga, "_note_failure", note)
    meet, lock = {}, threading.Lock()
    deliver = shard_saga.deliver

    def together(msg):
        with lock:
            barrier = meet.setdefault(msg.message_id, threading.Barrier(2, timeout=3))
        try:
            barrier.wait()
        except threading.BrokenBarrierError:
            pass  # the other relay held this one back or had closed it already: deliver alone
        return deliver(msg)
    monkeypatch.setattr(shard_saga, "deliver", together)

    with cut(), read_context(CONTROL_ALIAS):
        src, tgt = halls[w["src"]], halls[w["tgt"]]
        records = [_approved(w, halls)[1].pk]
        with _in_hall(src):
            for i in range(rng.randint(1, 3)):
                other = _soul().objects.create(name=f"并发{seed}-{i}", tenant=src, current_state="DISPOSED")
                records.append(DispatchRecord.objects.create(source_tenant=src, target_tenant=tgt, soul=other,
                                                             tenant=src, status=DispatchStatus.APPROVED,
                                                             reason="saga").pk)
        for pk in records:
            with transaction.atomic(using=master_of(src)):
                _execute(pk)

        def relay():
            try:
                with read_context(CONTROL_ALIAS):
                    shard_saga.relay_until_quiet()
            except Exception as e:  # noqa: BLE001 -- reported below
                errors.append(repr(e))
            finally:
                connections.close_all()

        threads = [threading.Thread(target=relay) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(120)
        assert not any(t.is_alive() for t in threads), f"{where}: a relay hung"
        assert errors == [] and failures == [], f"{where}: errors {errors}, failures {failures}"
        messages = _messages()
        assert messages and {m.state for _, m in messages.values()} == {ShardMessageState.DONE}, \
            f"{where}: {sorted((m.kind, m.state, m.attempts) for _, m in messages.values())}"
        assert all(m.attempts == 0 and not m.last_error for _, m in messages.values()), where
        for message_id, (_, m) in messages.items():
            got = ShardInbox._base_manager.using(master_of(m.target_tenant)).filter(message_id=message_id).count()
            assert got == 1, f"{where}: {m.kind} {message_id} in the inbox {got} times"
        assert all(DispatchRecord.all_objects.get(pk=pk).status == DispatchStatus.EXECUTED for pk in records), where
        assert {_soul().all_objects.get(pk=DispatchRecord.all_objects.get(pk=pk).soul_id).tenant_id
                for pk in records} == {tgt.pk}, where
        _ownership()
