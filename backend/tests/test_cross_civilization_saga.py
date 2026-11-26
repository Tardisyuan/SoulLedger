"""Guard G4 across databases (sharding stage 4 part C; the sharding plan (not in this repo) 阶段 4 测试;
apps/tenants/shard_saga.py, apps/dispatch/transfer.py). The single-database G4 is
tests/test_cross_tenant_writes_are_all_or_nothing.py; this is its rewrite for a flow whose halls are written on two
databases, where one transaction cannot hold it and a saga does:

  every step    the paths run from one start state under an execute wrapper installed on EVERY connection; the dry
                run lists every write the path makes on any database (its steps). For each k the path runs again with
                write k failing, then the relay runs until nothing is pending. The world (a snapshot of every row on
                every alias) is then the start state or the done state -- never a half -- `check_soul_ownership
                --all` passes, and redelivering every message once more changes nothing.
  same civ      a flow whose halls share a master sends nothing and writes the same statements as with no shard.
  replica       the source row a transfer leaves behind is a copy (gap 4d): deleting it leaves control's SoulAccount.
  D6            an origin-side write to a soul residing on another master becomes a message to it.

Worlds are random (two civilizations, which of them write to their shards, a target realm or not): the fixed seeds
replay the same worlds every run, and `RUN` draws a new one each run (`SAGA_SEED=<n>` replays it); the seed is
printed and in every failure message. The routes the HTTP test drives are found in the URLconf by their view action.

    cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true DATABASE_URL=sqlite:///:memory: \\
      REDIS_URL=redis://127.0.0.1:6399/0 .venv/bin/python -m pytest --ds=config.settings_sharded -m sharded \\
      --no-cov tests/test_cross_civilization_saga.py
"""
import io
import os
import random
import re
import traceback
from contextlib import ExitStack

import pytest
from django.apps import apps
from django.conf import settings
from django.core.management import CommandError, call_command
from django.db import connections, router, transaction

from tests.shard_support import CIVS, sharded
from tests.test_sharded_writes import _assign, _halls, _in_hall, cut

_WRITE = re.compile(r'^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(\w+)"?', re.I)
#: Clocks differ between two runs that end in the same state: as objects, and as the text an audit row's `changes`
#: holds (`'executed_at': [None, '2026-11-19 16:54:29.780663+00:00']`). The audit rows are written in the step's
#: transaction since 2026-11-19, so a run that retried a step writes its row at a later instant than the dry run.
_CLOCK = re.compile(r"datetime\.(?:datetime|date)\([^)]*\)|\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?(?:[+-]\d\d:\d\d|Z)?")
#: Ids, as UUID objects or as strings (an event's payload names the disposition it made). Only the ones a run drew
#: fresh are masked (`_snapshot(known=...)`): a row naming an existing soul, record or case names it verbatim, so
#: one pointing at the wrong one does not compare equal.
_UUID = re.compile(r"UUID\('([^']*)'\)|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")
SAGA_TABLES = ("tenants.ShardOutbox", "tenants.ShardInbox")


class InjectedError(Exception):
    pass


# ---- the world ----------------------------------------------------------------------------------------------------

#: A parameter that draws a new world each run (module doc).
RUN = "run"


def seed_of(param):
    """`param`, or for RUN this run's seed: `SAGA_SEED`, else drawn (printed either way, so a failure replays)."""
    if param != RUN:
        return param
    seed = int(os.environ["SAGA_SEED"]) if os.environ.get("SAGA_SEED") else random.randrange(10**6)
    print(f"saga world seed {seed} (replay: SAGA_SEED={seed})")
    return seed


def _world(seed, cut=None):
    """Two halls of two civilizations; the write cut chosen so their masters differ -- the source's, the target's or
    both (`cut`: "src" / "tgt" / "both" forces it). Returns a dict."""
    rng = random.Random(seed)
    src_civ, tgt_civ = rng.sample(CIVS, 2)
    others = [c for c in CIVS if c not in (src_civ, tgt_civ)]
    modes = {"src": [src_civ], "tgt": [tgt_civ], "both": [src_civ, tgt_civ]}
    chosen = rng.choice(list(modes.values()))
    cut_civs = (modes[cut] if cut else chosen) + rng.sample(others, rng.randint(0, 2))
    return {"seed": seed, "src": src_civ, "tgt": tgt_civ, "cut": sorted(set(cut_civs)), "realm": rng.random() < 0.5}


def _realm(hall, code):
    from apps.realms.models import Realm

    with _in_hall(hall):
        return Realm.objects.create(realm_code=code, civilization=hall.civilization, name_local=code,
                                    realm_type="HELL", tenant=hall)


def _approved(w, halls):
    """A soul of the source hall standing in a realm there, and an APPROVED dispatch to the target hall."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.realms.path import SoulPathService
    from apps.souls.models import Soul

    src, tgt = halls[w["src"]], halls[w["tgt"]]
    here = _realm(src, f"SAGA_{w['src'][:2]}")
    there = _realm(tgt, f"SAGA_{w['tgt'][:2]}") if w["realm"] else None
    with _in_hall(src):
        soul = Soul.objects.create(name=f"客魂{w['seed']}", tenant=src, current_state="DISPOSED")
        SoulPathService.enter(soul, here, tenant_id=src.pk)
        record = DispatchRecord.objects.create(source_tenant=src, target_tenant=tgt, soul=soul, tenant=src,
                                               status=DispatchStatus.APPROVED, reason="saga", target_realm=there)
    return soul, record


def _account(soul):
    from apps.authentication.models import User
    from apps.soul_accounts.models import AccountOrigin, SoulAccount

    user = User.objects.create_user(username=f"soul_{soul.pk.hex[:8]}", password="x", role="SOUL")
    return SoulAccount.objects.create(user=user, soul_id=soul.pk, cycle=0, origin=AccountOrigin.OFFICER)


@pytest.fixture(autouse=True)
def _reads_everywhere():
    """The test runs as a management command does (`read_context("default")`): its reads go to every master, the
    authoritative rows rather than a shadow that lags until the next sync, and its writes to each row's master. A
    path that needs one hall's master takes it itself (`_in_hall`, `shard_saga.on_master`)."""
    from apps.core.shard_reads import CONTROL_ALIAS, read_context

    with read_context(CONTROL_ALIAS):
        yield


@pytest.fixture
def world(request):
    seed = seed_of(getattr(request, "param", RUN))
    w = seed if isinstance(seed, dict) else _world(seed)
    halls = _halls()
    _assign(*CIVS)
    with cut():
        yield w, halls


# ---- observing every database ---------------------------------------------------------------------------------------

def _ids(snapshot):
    """Every id a snapshot names."""
    return {a or b for rows in snapshot.values() for row in rows for a, b in _UUID.findall(row)}


def _snapshot(tables=None, known=None):
    """Every row of every model on every alias -- or of the `tables` named (a row changes only by a write, and the
    wrapper on every connection sees every write, so the tables nobody wrote are the same rows). Clocks masked; with
    `known`, also every id not in it (drawn fresh by the run), so two runs to the same state compare equal while a
    reference to an existing row is compared as it is."""
    def mask(text):
        text = _CLOCK.sub("~", text)
        if known is None:
            return text
        return _UUID.sub(lambda m: m.group(0) if (m.group(1) or m.group(2)) in known else "~id", text)

    out = {}
    for alias in settings.DATABASES:
        for m in apps.get_models(include_auto_created=True):
            if m._meta.label in SAGA_TABLES or not router.allow_migrate_model(alias, m):
                continue
            if tables is not None and m._meta.db_table not in tables:
                continue
            rows = sorted(mask(repr(r[1:])) for r in m._base_manager.using(alias).values_list())
            if rows:
                out[(alias, m._meta.label)] = rows
    return out


def _pending():
    from apps.tenants import shard_saga

    return [m for alias, ids in shard_saga.masters() for m in shard_saga.pending(alias, ids)]


INJECTED_FROM_BUS = []


def _writes_during(action, fail_at=None, seen=None):
    """Run `action` with a wrapper on every connection; the writes made (alias, table), in order (into `seen` too,
    which survives a raise). Write number `fail_at` raises InjectedError instead."""
    seen = [] if seen is None else seen

    def wrapper(alias):
        def wrap(execute, sql, params, many, context):
            found = _WRITE.match(sql)
            if found:
                seen.append((alias, found.group(1)))
                if fail_at == len(seen):
                    INJECTED_FROM_BUS[:] = [any("apps/events/" in f.filename for f in traceback.extract_stack())]
                    raise InjectedError(f"write {fail_at} ({alias} {found.group(1)})")
            return execute(sql, params, many, context)
        return wrap

    with ExitStack() as stack:
        for alias in connections:
            stack.enter_context(connections[alias].execute_wrapper(wrapper(alias)))
        action()
    return seen


def _ownership():
    out = io.StringIO()
    try:
        call_command("check_soul_ownership", "--all", stdout=out)
    except CommandError:
        raise AssertionError(out.getvalue()) from None


def _savepoints():
    return {alias: transaction.savepoint(using=alias) for alias in connections}


def _rollback(points):
    for alias, sid in points.items():
        transaction.savepoint_rollback(sid, using=alias)


def _messages():
    from apps.tenants import shard_saga
    from apps.tenants.models import ShardOutbox

    return {m.message_id: (alias, m) for alias, ids in shard_saga.masters()
            for m in ShardOutbox._base_manager.using(alias).filter(tenant_id__in=ids)}


def _redeliver(since):
    """Every message the path sent delivered once more (as if the relay died after applying, before closing)."""
    from apps.tenants import shard_saga
    from apps.tenants.models import ShardMessageState, ShardOutbox

    for message_id, (alias, msg) in _messages().items():
        if message_id not in since and msg.state == ShardMessageState.DONE:
            ShardOutbox._base_manager.using(alias).filter(pk=msg.pk).update(state=ShardMessageState.PENDING)
            msg.state = ShardMessageState.PENDING
            shard_saga.deliver(msg)


def _run(action):
    """The path, then the relay until quiet; what an operator sees once the dust settles."""
    from apps.tenants.shard_saga import relay_until_quiet

    def everything():
        try:
            action()
        finally:
            relay_until_quiet()
    return everything


def _every_step(label, action, seed):
    """The G4 loop across databases (module doc). Returns nothing; asserts with the seed in every message."""
    from apps.tenants.shard_saga import relay_until_quiet

    start_points = _savepoints()
    known = _ids(_snapshot())
    before, sent_before = _snapshot(known=known), set(_messages())
    steps = _writes_during(_run(action))
    assert not _pending(), f"seed {seed} {label}: messages still pending after the dry run"
    done = _snapshot(known=known)
    assert done != before, f"seed {seed} {label}: the path wrote nothing"
    assert {a for a, _ in steps} - {"default"}, f"seed {seed} {label}: no shard was written; not a cross-db path"
    _ownership()
    snap = _savepoints()
    _redeliver(sent_before)
    assert _snapshot(known=known) == done, f"seed {seed} {label}: redelivering the messages changed the world"
    _rollback(snap)
    _rollback(start_points)
    assert _snapshot(known=known) == before
    dry_tables = {t for _, t in steps}

    def only(snapshot, tables):
        return {key: rows for key, rows in snapshot.items() if apps.get_model(key[1])._meta.db_table in tables}

    for k in range(1, len(steps) + 1):
        points = _savepoints()
        seen = []
        try:
            _writes_during(_run(action), fail_at=k, seen=seen)
        except InjectedError:
            pass
        except Exception as e:  # noqa: BLE001 -- the next query after a swallowed failure
            if not INJECTED_FROM_BUS:
                raise
            del e
        seen_after = []
        _writes_during(relay_until_quiet, seen=seen_after)
        tables = dry_tables | {t for _, t in seen + seen_after}
        now, start, end = _snapshot(tables, known), only(before, tables), only(done, tables)
        where = f"seed {seed} {label}: failing at write {k} {steps[k - 1]}"
        if now not in (start, end):
            # A write made from inside the event bus is best effort (single-database G4, `_VOLATILE`): the path may
            # complete without that one row. Anything else half-applied is a failure.
            table = steps[k - 1][1]
            assert INJECTED_FROM_BUS == [True] and _without(now, table) == _without(end, table), (
                f"{where} left neither the start nor the done state: "
                f"{sorted(set(now) ^ set(end) | {key for key in now if now.get(key) != end.get(key)})}")
        assert not _pending(), f"{where}: still pending after relaying"
        _ownership()
        _rollback(points)


def _without(snapshot, table):
    return {key: rows for key, rows in snapshot.items() if apps.get_model(key[1])._meta.db_table != table}


# ---- the paths ------------------------------------------------------------------------------------------------------

SEEDS = [RUN, 11, 23, 57, 91, 404, 777]


@sharded
@pytest.mark.parametrize("world", SEEDS, indirect=True)
def test_executing_a_dispatch_across_civilizations_ends_at_the_start_or_the_end(world):
    from apps.dispatch.models import DispatchRecord
    from apps.dispatch.services import DispatchService

    w, halls = world
    soul, record = _approved(w, halls)
    _account(soul)
    _every_step("execute", lambda: DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor"),
                w["seed"])


@sharded
@pytest.mark.parametrize("world", SEEDS[:4], indirect=True)
def test_ending_a_residence_across_civilizations_ends_at_the_start_or_the_end(world):
    from apps.dispatch.models import DispatchRecord
    from apps.dispatch.services import DispatchService
    from apps.souls.models import Soul
    from apps.tenants.shard_saga import relay_until_quiet

    w, halls = world
    soul, record = _approved(w, halls)
    DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor")
    relay_until_quiet()
    with _in_hall(halls[w["src"]]):
        _every_step("return", lambda: DispatchService.end_residence(
            Soul.all_objects.get(pk=soul.pk), actor=None, trigger=DispatchService.RETURN_MANUAL, reason="saga"),
            w["seed"])


@sharded
@pytest.mark.parametrize("world", SEEDS[:3], indirect=True)
def test_seating_another_civilization_on_a_joint_bench_ends_at_the_start_or_the_end(world):
    from apps.dispatch.models import CrossTenantJudgmentParticipant, ParticipantRole
    from apps.dispatch.services import CrossTenantJudgmentService

    w, halls = world
    src, tgt = halls[w["src"]], halls[w["tgt"]]
    with _in_hall(src):
        bench = CrossTenantJudgmentService.create("联审", "d", src)
        _every_step("joint_seat", lambda: CrossTenantJudgmentService.add_participant(
            bench, tgt, None, ParticipantRole.ADVISOR), w["seed"])
        seat = CrossTenantJudgmentService.add_participant(bench, tgt, None, ParticipantRole.ADVISOR)
    from apps.tenants.shard_saga import relay_until_quiet

    relay_until_quiet()
    from apps.tenants.shard_saga import master_of

    assert CrossTenantJudgmentParticipant._base_manager.using(master_of(tgt)).filter(pk=seat.pk).exists()


@sharded
@pytest.mark.parametrize("cut_civs", [("CHINESE", "EGYPTIAN"), ("EGYPTIAN",), ("CHINESE",)])
def test_executing_a_sentence_plan_stop_across_civilizations_ends_at_the_start_or_the_end(cut_civs):
    """The stop's dispatch: the soul, its station, the stop's disposition and event on the target's master; the plan
    node (the home hall's row) activated there by its own message."""
    from apps.dispatch.models import DispatchRecord
    from apps.dispatch.services import DispatchService
    from apps.org.ownership import tenant_root
    from apps.sentence_plan.models import SentenceNodeStatus
    from apps.tenants.shard_saga import master_of, relay_until_quiet
    from tests import sentence_plan_support as plan
    from tests.shard_support import _sync

    cn, eg = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT")
    for hall in (cn, eg):
        tenant_root(hall)
    from apps.realms.models import Realm

    stop = plan.stop_realm(eg)
    Realm.objects.filter(realm_code=stop).update(tenant=eg)  # the stop's realm is the Egyptian hall's (its shard)
    soul, p = plan.planned(cn, [(eg, stop, 5)])
    plan.serve(soul, p, 1)
    record = DispatchRecord.all_objects.get(pk=plan.node(p, 2).dispatch_record_id)
    DispatchService.approve(record, "approver")
    _sync()
    _assign(*CIVS)
    with cut():
        _every_step("execute_plan", lambda: DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk),
                                                                     "executor"), f"plan {cut_civs}")
        DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor")
        relay_until_quiet()
        node = plan.node(p, 2)
        assert node.status == SentenceNodeStatus.ACTIVE and node.disposition_id, cut_civs
        from apps.disposition.models import Disposition

        assert Disposition._base_manager.using(master_of(eg)).filter(pk=node.disposition_id).exists()


# ---- the transfer's own rules ---------------------------------------------------------------------------------------

@sharded
@pytest.mark.parametrize("world", [5], indirect=True)
def test_a_transfer_is_executing_until_the_relay_closes_it_and_nobody_else_moves_the_record(world):
    from apps.dispatch import transfer
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService
    from apps.tenants.shard_saga import master_of, relay_until_quiet

    w, halls = world
    soul, record = _approved(w, halls)
    DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor")
    fresh = DispatchRecord.all_objects.get(pk=record.pk)
    assert fresh.status == DispatchStatus.APPROVED and transfer.executing(fresh), w
    assert not fresh.transition_to(DispatchStatus.CANCELLED), "a record in flight was cancelled"
    with pytest.raises(ValueError):
        DispatchService.execute(fresh, "executor")
    relay_until_quiet()
    fresh = DispatchRecord.all_objects.get(pk=record.pk)
    assert fresh.status == DispatchStatus.EXECUTED and not transfer.executing(fresh)
    tgt = halls[w["tgt"]]
    primary = type(soul)._base_manager.using(master_of(tgt)).get(pk=soul.pk)
    assert primary.tenant_id == tgt.pk and primary.owner_org_id is not None
    _ownership()


@sharded
@pytest.mark.parametrize("world", [5], indirect=True)
def test_executing_a_copy_read_before_a_cancel_sends_nothing(world):
    """Step 1 asks the record's status under its row lock (state-machine audit 2026-11-20). `DispatchService.execute`
    checked the caller's copy, read before the lock; a cancel committed in between left an APPROVED copy, and the
    EXECUTE message went out for a CANCELLED record -- step 2 upserted the soul as primary on the target's master,
    step 3 saw CANCELLED and returned before retiring the source's row: two primaries, the message DONE."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService

    w, halls = world
    soul, record = _approved(w, halls)
    stale = DispatchRecord.all_objects.get(pk=record.pk)
    assert DispatchRecord.all_objects.get(pk=record.pk).transition_to(DispatchStatus.CANCELLED)
    with pytest.raises(ValueError):
        DispatchService.execute(stale, "executor")
    assert _pending() == [], "an EXECUTE message went out for a cancelled record"
    assert DispatchRecord.all_objects.get(pk=record.pk).status == DispatchStatus.CANCELLED
    _ownership()


@sharded
@pytest.mark.parametrize("world", [5, 6], indirect=True)
def test_a_refusing_target_compensates_back_to_approved_and_the_start_state(world):
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService
    from apps.tenants.models import ShardMessageState, ShardOutbox, Tenant
    from apps.tenants.shard_saga import master_of, relay_until_quiet

    w, halls = world
    soul, record = _approved(w, halls)
    before = _snapshot()
    DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor")
    for alias in settings.DATABASES:
        Tenant._base_manager.using(alias).filter(pk=halls[w["tgt"]].pk).update(dispatch_enabled=False)
    relay_until_quiet()
    for alias in settings.DATABASES:
        Tenant._base_manager.using(alias).filter(pk=halls[w["tgt"]].pk).update(dispatch_enabled=True)
    assert _snapshot() == before, f"seed {w['seed']}: the compensation did not restore the start state"
    assert DispatchRecord.all_objects.get(pk=record.pk).status == DispatchStatus.APPROVED
    msg = ShardOutbox._base_manager.using(master_of(halls[w["src"]])).get(subject=f"dispatch:{record.pk}")
    assert msg.state == ShardMessageState.REFUSED
    _ownership()


@sharded
@pytest.mark.parametrize("world", [{"seed": "greek-to-egypt", "src": "GREEK", "tgt": "EGYPTIAN",
                                    "cut": ["EGYPTIAN", "GREEK"], "realm": False}], indirect=True)
def test_deleting_the_source_side_replica_leaves_the_control_soul_account(world):
    """Gap 4d: the copy step 3 leaves behind names the new hall, so deleting it there is a copy's delete -- the
    bare-id cleanup that runs for a primary row's delete (clearing control's SoulAccount.soul) does not run."""
    from apps.dispatch.models import DispatchRecord
    from apps.dispatch.services import DispatchService
    from apps.soul_accounts.models import SoulAccount
    from apps.souls.models import Soul
    from apps.tenants.shard_saga import master_of, relay_until_quiet

    w, halls = world
    soul, record = _approved(w, halls)
    account = _account(soul)
    DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor")
    relay_until_quiet()
    src_alias = master_of(halls[w["src"]])
    copy = Soul._base_manager.using(src_alias).get(pk=soul.pk)
    assert copy.tenant_id == halls[w["tgt"]].pk, "the source row still names the source hall: not decidable"
    with transaction.atomic(using=src_alias):
        Soul._base_manager.using(src_alias).filter(pk=soul.pk).delete()
    assert SoulAccount.objects.get(pk=account.pk).soul_id == soul.pk


@sharded
def test_a_same_civilization_dispatch_sends_nothing_and_writes_what_one_database_writes():
    """Two halls of one civilization share a master: no saga, and the same write statements (tables, in order) as
    with no civilization cut over."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService
    from apps.souls.models import Soul
    from apps.tenants.models import ShardOutbox, Tenant
    from tests.shard_support import _sync

    halls = _halls()
    other = Tenant.objects.create(code="W4_GR2", display_name="GR2", declared_civilization="GREEK")
    from apps.org.ownership import tenant_root

    tenant_root(other)
    soul = Soul.objects.create(name="同文明", tenant=halls["GREEK"], current_state="DISPOSED")
    record = DispatchRecord.objects.create(source_tenant=halls["GREEK"], target_tenant=other, soul=soul,
                                           tenant=halls["GREEK"], status=DispatchStatus.APPROVED, reason="x")
    _sync()
    _assign(*CIVS)
    runs = {}
    from django.test import override_settings

    for civs in ([], ["GREEK"]):
        points = _savepoints()
        with override_settings(SHARDED=bool(civs)):
            writes = _writes_during(lambda: DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk),
                                                                     "executor"))
            runs[tuple(civs)] = [t for _, t in writes]
            assert {a for a, _ in writes} == {"default" if not civs else "civ_greek"}, writes
            assert not any(ShardOutbox._base_manager.using(a).exists() for a in settings.DATABASES)
        _rollback(points)
    assert runs[()] == runs[("GREEK",)]


@sharded
@pytest.mark.parametrize("world", [5], indirect=True)
def test_an_origin_side_write_to_a_residing_soul_is_a_message_to_its_master(world):
    """D6: the home hall's transaction writes a soul that resides on another master (contact e-mail here)."""
    from apps.dispatch.models import DispatchRecord
    from apps.dispatch.services import DispatchService
    from apps.soul_accounts.services import apply_contacts
    from apps.souls.models import Soul
    from apps.tenants.shard_saga import master_of, relay_until_quiet

    w, halls = world
    soul, record = _approved(w, halls)
    DispatchService.execute(DispatchRecord.all_objects.get(pk=record.pk), "executor")
    relay_until_quiet()
    home = halls[w["src"]]
    with _in_hall(home), transaction.atomic(using=master_of(home)):
        apply_contacts(Soul.all_objects.get(pk=soul.pk), contact_email="saga@example.com")
    relay_until_quiet()
    assert Soul._base_manager.using(master_of(halls[w["tgt"]])).get(pk=soul.pk).contact_email == "saga@example.com"


@sharded
@pytest.mark.parametrize("world", [5], indirect=True)
def test_a_cross_civilization_rebirth_moves_the_primary_and_retires_the_origin_row(world):
    from apps.dispatch import transfer
    from apps.souls.models import Soul
    from apps.tenants.shard_saga import master_of, relay_until_quiet

    w, halls = world
    src, tgt = halls[w["src"]], halls[w["tgt"]]
    with _in_hall(src):
        soul = Soul.objects.create(name="迁籍", tenant=src, current_state="REINCARNATING")
        with transaction.atomic():
            transfer.migrate(Soul.lock(soul.pk), tgt)
    relay_until_quiet()
    moved = Soul._base_manager.using(master_of(tgt)).get(pk=soul.pk)
    assert (moved.tenant_id, moved.home_tenant_id) == (tgt.pk, tgt.pk)
    if master_of(src) != "default":
        assert not Soul._base_manager.using(master_of(src)).filter(pk=soul.pk).exists()
    _ownership()


@sharded
@pytest.mark.parametrize("world", [5], indirect=True)
def test_the_routes_that_move_a_soul_across_civilizations_run_the_saga_over_http(world):
    """Through the URLconf's own dispatch routes (found by their view action, not typed here), signed in the way
    production does (a JWT naming the officer's hall, so the request's hall is not the master step 1 acts on):
    execute by the target hall's ADMIN, the relay, return-home by the home hall's ADMIN, the relay."""
    from django.urls import get_resolver, reverse
    from rest_framework.test import APIClient

    from apps.authentication.models import User
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.views import DispatchRecordViewSet
    from apps.tenants.shard_saga import relay_until_quiet

    w, halls = world
    soul, record = _approved(w, halls)
    routes = {}
    for callback, name in _walk(get_resolver().url_patterns):
        if getattr(callback, "cls", None) is DispatchRecordViewSet and "post" in (getattr(callback, "actions", None) or {}):
            routes[callback.actions["post"]] = name
    assert {"execute", "return_home"} <= set(routes), routes

    def url(action, pk):
        return reverse(routes[action], kwargs={"pk": pk})

    from tests.conftest import sign_in

    there = User.objects.create_user(username="saga_there", password="x", role="ADMIN", tenant=halls[w["tgt"]])
    home = User.objects.create_user(username="saga_home", password="x", role="ADMIN", tenant=halls[w["src"]])
    client = sign_in(APIClient(), there)
    r = client.post(url("execute", record.pk), {}, format="json", HTTP_IDEMPOTENCY_KEY="saga-exec")
    assert r.status_code == 200, (w, r.content)
    relay_until_quiet()
    assert DispatchRecord.all_objects.get(pk=record.pk).status == DispatchStatus.EXECUTED
    r = sign_in(APIClient(), home).post(url("return_home", record.pk), {"reason": "saga"}, format="json")
    assert r.status_code == 200, (w, r.content)
    relay_until_quiet()
    assert DispatchRecord.all_objects.get(pk=record.pk).status == DispatchStatus.RETURNED
    _ownership()


def _walk(patterns, namespace=""):
    """(callback, reversible name) of every route in the URLconf."""
    from django.urls import URLPattern, URLResolver

    for p in patterns:
        if isinstance(p, URLResolver):
            ns = f"{namespace}{p.namespace}:" if p.namespace else namespace
            yield from _walk(p.url_patterns, ns)
        elif isinstance(p, URLPattern) and p.name:
            yield p.callback, namespace + p.name
