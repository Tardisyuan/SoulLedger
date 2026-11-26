"""D6 over HTTP: the home hall acts on its soul while the soul resides in another civilization (sharding stage 4;
the second stage-4 review (not in this repo) H-A; apps/dispatch/transfer.py, apps/sentence_plan/requests.py).

The home hall's transaction holds the home's master (and control); the soul's row is the residence's, on another
master once that civilization writes to its shard. Every action that ends the residence from there -- cancelling the
plan, an appeal amendment withdrawing the stop the soul is at, an accepted or withdrawn request releasing a stop
already served -- used to run the return's step 1 as a transaction of its own on the residence's master, committed
before (and whatever became of) the home's: 409 with one civilization cut, and with both a soul sent home by a
cancellation that rolled back. Now step 1 waits for the home's commit (a RETURN_REQUESTED message), and the plan
moves on at home once the soul is there.

Each action runs in the four write cuts of the two civilizations (none, the home's, the residence's, both), over the
URLconf's routes, signed in as production does. After the relay: where the soul is (and as what), the plan, the stop
and the residence's disposition, the request / appeal, no message pending or FAILED, `check_soul_ownership` clean,
the audit rows there. Also: a soul in transit refuses writes from the target hall, the home hall and SYSTEM_ADMIN, not
only the source (the first review covered the source alone); `shard_saga.on_master` refuses to commit inside another
master's transaction; a contact save queued for the residence lands on the soul's primary wherever it is by then
(M-A); DISPATCH_FROZEN.

Worlds are random -- which civilization the soul resides in, which third one files requests, whether the stop's
sentence is executed (serving) or not yet, and which other civilizations are cut -- with the seed printed and in
every message (`D6_SEED=<n>` replays it). Home is the Chinese hall: the plan fixtures (`sentence_plan_support`) are
built on its verdict routing.

    scripts/run-gates.sh --tests --ds=config.settings_sharded -m sharded tests/test_d6_home_hall_acts_on_a_soul_abroad.py
"""
import io
import os
import random

import pytest
from django.conf import settings
from django.core.management import call_command
from django.db import transaction

from tests.shard_support import CIVS, sharded
from tests.test_cross_civilization_saga import _ownership, _walk
from tests.test_sharded_writes import _assign, _in_hall, cut

CUTS = ("both",)  # sharded: every civilization on its shard (the partial cut-overs are gone, 2026-11-21)
#: Halls by civilization; the fixtures' realms are keyed by these codes (`sentence_plan_support.REALM_OF`).
HALLS = {"CHINESE": "CN_DIYU", "EGYPTIAN": "EG_DUAT", "EUROPEAN": "EU_HEAVEN_HELL", "GREEK": "GR_HADES"}


def _seed(fixed):
    if fixed is not None:
        return fixed
    seed = int(os.environ["D6_SEED"]) if os.environ.get("D6_SEED") else random.randrange(10**6)
    print(f"d6 world seed {seed} (replay: D6_SEED={seed})")
    return seed


@pytest.fixture(params=[None, 5, 23])  # one new world per run, two fixed
def world(request):
    seed = _seed(request.param)
    rng = random.Random(seed)
    residence, third = rng.sample([c for c in CIVS if c != "CHINESE"], 2)
    return {"seed": seed, "home": "CHINESE", "residence": residence, "third": third,
            "executed": rng.random() < 0.5, "third_cut": rng.random() < 0.5}


def _civs(w, mode):
    which = {"none": [], "home": [w["home"]], "residence": [w["residence"]],
             "both": [w["home"], w["residence"]]}[mode]
    if which and w["third_cut"]:
        which.append(w["third"])
    return which


def _where(w, mode):
    return f"seed {w['seed']} cut {mode} {_civs(w, mode)} (residence {w['residence']}, third {w['third']}, " \
           f"stop {'executed' if w['executed'] else 'not executed'})"


# ---- the world ------------------------------------------------------------------------------------------------------

def _abroad(w, *, third_stop=False, pending_from_third=None):
    """A Chinese soul at its plan's stop 2 in the residence (executed or not), set up before any cut and synced.
    `third_stop`: a stop 3 in the third civilization, PENDING. `pending_from_third`: the third hall files that
    request ("AMEND" adds a stop of its own, "REOPEN") and stop 2 is then served -- the soul waits there for the
    decision (§4.2). Returns a dict of the halls, soul, plan."""
    from apps.org.ownership import tenant_root
    from apps.realms.models import Realm
    from apps.sentence_plan import requests
    from tests import sentence_plan_support as plan
    from tests.shard_support import _sync
    from tests.test_judgment_appeals import _realm_for

    home, res, third = (plan.tenant(HALLS[w[k]]) for k in ("home", "residence", "third"))
    for hall in (home, res, third):
        tenant_root(hall)
    codes = {}
    for hall in (res, third):
        codes[hall.pk] = plan.stop_realm(hall)
        Realm.objects.filter(realm_code=codes[hall.pk]).update(tenant=hall)
    stops = [(res, codes[res.pk], 10)] + ([(third, codes[third.pk], 10)] if third_stop else [])
    soul, p = plan.planned(home, stops, name=f"客魂{w['seed']}")
    for verdict in ("FAILED", "PASSED"):
        _realm_for(soul, verdict)  # the appeal's reroute
    plan.serve(soul, p, 1)
    plan.arrive(soul, p, 2)
    if w["executed"] and not pending_from_third:
        assert plan.execute_only(soul, p, 2)
    if pending_from_third:
        changes = {"add": [{"realm_code": codes[third.pk], "sentence_years": 3, "reason": "加一站"}]} \
            if pending_from_third == "AMEND" else {}
        requests.file_request(p, third, kind=pending_from_third, changes=changes, reason="第三文明的请求",
                              user=None)
        assert plan.serve(soul, p, 2)  # served; the pending request keeps the soul there
    soul.refresh_from_db()
    assert soul.tenant_id == res.pk and soul.home_tenant_id == home.pk, "the soul is not residing abroad"
    _sync()
    _assign(*CIVS)
    return {"home": home, "res": res, "third": third, "soul": soul, "plan": p}


def _client(hall, name, role="ADMIN"):
    from rest_framework.test import APIClient

    from apps.authentication.models import User
    from tests.conftest import sign_in

    return sign_in(APIClient(), User.objects.create_user(username=name, password="x", role=role, tenant=hall))


def _route(viewset, action):
    from django.urls import get_resolver

    for callback, name in _walk(get_resolver().url_patterns):
        if getattr(callback, "cls", None) is viewset and (callback.actions or {}).get("post") == action:
            return name
    raise AssertionError(f"no POST route for {viewset.__name__}.{action}")


def _plan_url(action, **kwargs):
    from django.urls import reverse

    from apps.sentence_plan.views import SentencePlanViewSet

    return reverse(_route(SentencePlanViewSet, action), kwargs=kwargs)


# ---- what is true afterwards ----------------------------------------------------------------------------------------

def _read(fn):
    """Read where a command reads (every master): the authoritative rows."""
    from apps.core.shard_reads import CONTROL_ALIAS, read_context

    with read_context(CONTROL_ALIAS):
        return fn()


def _settled(where, mode):
    """Relay until quiet; nothing pending, nothing FAILED, ownership clean."""
    from apps.tenants import shard_saga

    shard_saga.relay_until_quiet()
    left = [(a, m.kind) for a, ids in shard_saga.masters() for m in shard_saga.pending(a, ids)]
    dead = [(a, m.kind, m.last_error[:300]) for a, m in shard_saga.failed()]
    assert not left and not dead, f"{where}: messages pending {left}, FAILED {dead}"
    if mode != "none":
        from tests.shard_support import _sync

        _sync()  # what beat does: the shadows of the civilizations not cut follow control, then ownership
        _ownership()


def _primary(soul_pk, hall):
    from apps.souls.models import Soul
    from apps.tenants.shard_saga import master_of

    return Soul._base_manager.using(master_of(hall)).get(pk=soul_pk)


def _soul_home(x, where, state=None):
    soul = _primary(x["soul"].pk, x["home"])
    assert soul.tenant_id == x["home"].pk, f"{where}: the soul is not home (tenant {soul.tenant_id})"
    if state is not None:
        assert soul.current_state == state, f"{where}: the soul is {soul.current_state}, not {state}"
    from apps.dispatch.models import DispatchRecord, DispatchStatus

    record = _read(lambda: DispatchRecord.all_objects.get(pk=x["stop2"].dispatch_record_id))
    assert record.status == DispatchStatus.RETURNED, f"{where}: the stop's dispatch is {record.status}"
    return soul


def _soul_abroad(x, where):
    soul = _primary(x["soul"].pk, x["res"])
    assert soul.tenant_id == x["res"].pk, f"{where}: the soul left the residence"


def _audited(where, **filters):
    from apps.audit.models import AuditLog

    # Once per row: a hall not cut keeps a read copy of control's rows on its shard (the beat's sync).
    rows = list({r.pk: r for alias in settings.DATABASES
                 for r in AuditLog._base_manager.using(alias).filter(**filters)}.values())
    assert rows, f"{where}: no audit row {filters}"
    return rows


def _residence_disposition(x):
    from apps.disposition.models import Disposition

    return _read(lambda: Disposition.all_objects.filter(pk=x["stop2"].disposition_id).first())


def _node(x, order):
    from apps.sentence_plan.models import SentenceNode

    return _read(lambda: SentenceNode.all_objects.filter(plan_id=x["plan"].pk, order=order)
                 .order_by("-create_time").first())


def _plan_status(x):
    from apps.sentence_plan.models import SentencePlan

    return _read(lambda: SentencePlan.all_objects.get(pk=x["plan"].pk).status)


def _prepare(x):
    from tests import sentence_plan_support as plan

    node = plan.node(x["plan"], 2)
    x["stop2"] = node
    return x


def _refresh(x):
    from apps.sentence_plan.models import SentenceNode

    x["stop2"] = _read(lambda: SentenceNode.all_objects.get(pk=x["stop2"].pk))


# ---- cancel ---------------------------------------------------------------------------------------------------------

@sharded
@pytest.mark.parametrize("mode", CUTS)
def test_the_home_hall_cancels_the_plan_of_a_soul_serving_abroad(world, mode):
    from apps.sentence_plan.models import SentenceNodeStatus, SentencePlanStatus
    from apps.souls.models import SoulState

    w, where = world, _where(world, mode)
    x = _prepare(_abroad(w))
    disposition_before = _residence_disposition(x)
    client = _client(x["home"], f"d6c_{mode}")
    with cut():
        r = client.post(_plan_url("cancel", pk=x["plan"].pk), {"reason": "赦免剩余刑期"}, format="json",
                        HTTP_IDEMPOTENCY_KEY=f"d6c-{mode}-{w['seed']}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _settled(where, mode)
        _refresh(x)
        assert _plan_status(x) == SentencePlanStatus.CANCELLED, f"{where}: plan {_plan_status(x)}"
        assert x["stop2"].status == SentenceNodeStatus.ABORTED, f"{where}: stop 2 {x['stop2'].status}"
        _soul_home(x, where, SoulState.REINCARNATING)
        after = _residence_disposition(x)
        assert after is not None and not after.is_deleted, f"{where}: the stop's disposition was voided"
        if disposition_before.is_executed:  # pardoned: the term ends now, rebirth is not held by it
            assert after.expired_at is not None, f"{where}: the served term was not pardoned"
        else:
            assert after.expired_at is None and not after.is_executed, f"{where}: {after.expired_at}"
        _audited(where, resource="sentence_plan", resource_id=str(x["plan"].pk))
        _return_audited(x, where, "PLAN_CANCELLED")


def _return_audited(x, where, trigger):
    """`DispatchService.audit_return`'s row: in the home hall, naming the stop's dispatch and why it ended."""
    rows = _audited(where, resource="dispatch_record", resource_id=str(x["stop2"].dispatch_record_id),
                    tenant_id=x["home"].pk)
    assert [r.changes.get("trigger") for r in rows] == [trigger], f"{where}: return audited as {rows}"


# ---- an appeal amendment that withdraws the stop the soul is at ------------------------------------------------------

@sharded
@pytest.mark.parametrize("mode", CUTS)
def test_an_appeal_amendment_withdrawing_the_current_foreign_stop_brings_the_soul_home(world, mode):
    from apps.judgment.appeal_views import JudgmentAppealViewSet
    from apps.judgment.models import Judgment, JudgmentAppeal
    from apps.sentence_plan.models import SentenceNodeStatus, SentencePlanStatus
    from apps.souls.models import SoulState
    from tests import sentence_plan_support as plan

    w, where = world, _where(world, mode)
    x = _prepare(_abroad(w))
    judgment = Judgment.all_objects.get(pk=x["plan"].origin_judgment_id)
    reviewer = plan.officer(f"d6a_rev_{mode}", "JUDGE", x["home"])
    appeal = JudgmentAppeal.objects.create(judgment=judgment, soul=x["soul"], tenant=x["home"], round=1, reason="冤",
                                           original_verdict=judgment.verdict, status="IN_REVIEW", reviewer=reviewer)
    from tests.shard_support import _sync

    _sync()  # the appeal is the home hall's row: on its shard before the cut, as every other row of the world
    from django.urls import reverse
    from rest_framework.test import APIClient

    from tests.conftest import sign_in

    client = sign_in(APIClient(), reviewer)
    executed = _residence_disposition(x).is_executed
    with cut():
        r = client.post(reverse(_route(JudgmentAppealViewSet, "decide"), kwargs={"pk": appeal.pk}),
                        {"outcome": "AMENDED", "verdict": "PASSED", "note": "改判", "keep_foreign_stops": False},
                        format="json")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _settled(where, mode)
        _refresh(x)
        want = SentenceNodeStatus.COMPLETED if executed else SentenceNodeStatus.REMOVED
        assert x["stop2"].status == want, f"{where}: stop 2 {x['stop2'].status}, want {want}"
        after = _residence_disposition(x)
        if executed:  # served until now: its term ends here
            assert after is not None and after.expired_at is not None and not after.is_deleted, where
        else:  # never executed: withdrawn with the stop
            assert after is None or after.is_deleted, f"{where}: the withdrawn stop's disposition stands"
        # 地府判无罪 (`acquitted_to_rebirth`): no new home stop; the plan completes once the soul is home.
        assert _plan_status(x) == SentencePlanStatus.COMPLETED, f"{where}: plan {_plan_status(x)}"
        _soul_home(x, where, SoulState.REINCARNATING)
        assert _read(lambda: JudgmentAppeal.all_objects.get(pk=appeal.pk).status) == "AMENDED", where
        from apps.events.models import SoulEvent

        events = [e for alias in settings.DATABASES for e in SoulEvent._base_manager.using(alias)
                  .filter(soul_id=x["soul"].pk, event_type="JUDGMENT_APPEAL_DECIDED")]
        assert events, f"{where}: no JUDGMENT_APPEAL_DECIDED event"
        _return_audited(x, where, "DISPOSITION_EXECUTED" if executed else "JUDGMENT_CLOSED")


# ---- a request releases a stop already served: decided (ACCEPT) / withdrawn ---------------------------------------------

@sharded
@pytest.mark.parametrize("mode", CUTS)
def test_the_home_hall_accepts_a_third_civilizations_request_and_the_soul_comes_home_and_moves_on(world, mode):
    from apps.sentence_plan.models import SentenceNodeStatus, SentencePlanRequest
    from apps.souls.models import SoulState

    w, where = world, _where(world, mode)
    x = _prepare(_abroad(w, pending_from_third="AMEND"))
    req = SentencePlanRequest.all_objects.get(plan_id=x["plan"].pk, status="PENDING")
    client = _client(x["home"], f"d6d_{mode}")
    with cut():
        r = client.post(_plan_url("decide", pk=x["plan"].pk, request_id=req.pk),
                        {"decision": "ACCEPT", "reason": "准"}, format="json", HTTP_IDEMPOTENCY_KEY=f"d6d-{req.pk}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _settled(where, mode)
        _refresh(x)
        assert _read(lambda: SentencePlanRequest.all_objects.get(pk=req.pk).status) == "ACCEPTED", where
        assert x["stop2"].status == SentenceNodeStatus.COMPLETED, f"{where}: stop 2 {x['stop2'].status}"
        soul = _soul_home(x, where, SoulState.DISPOSED)
        _return_audited(x, where, "DISPOSITION_EXECUTED")
        added = _node(x, 3)
        # Home, then on to the added stop: the dispatch to the third hall proposed (what `advance` does at home).
        assert added is not None and added.tenant_code == x["third"].code, f"{where}: no stop 3"
        assert added.status == SentenceNodeStatus.DISPATCHING, f"{where}: stop 3 {added.status}"
        assert soul.current_state == SoulState.DISPOSED, where


@sharded
@pytest.mark.parametrize("mode", CUTS)
def test_the_third_civilization_withdraws_its_request_and_the_served_soul_comes_home(world, mode):
    from apps.sentence_plan.models import SentenceNodeStatus, SentencePlanRequest, SentencePlanStatus
    from apps.souls.models import SoulState

    w, where = world, _where(world, mode)
    x = _prepare(_abroad(w, third_stop=True, pending_from_third="REOPEN"))  # its own stop 3: it sees the plan
    req = SentencePlanRequest.all_objects.get(plan_id=x["plan"].pk, status="PENDING")
    client = _client(x["third"], f"d6w_{mode}")
    with cut():
        r = client.post(_plan_url("withdraw", pk=x["plan"].pk, request_id=req.pk), {}, format="json",
                        HTTP_IDEMPOTENCY_KEY=f"d6w-{req.pk}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _settled(where, mode)
        assert _read(lambda: SentencePlanRequest.all_objects.get(pk=req.pk).status) == "WITHDRAWN", where
        _soul_home(x, where, SoulState.DISPOSED)
        _return_audited(x, where, "DISPOSITION_EXECUTED")
        # Home, then on to stop 3 in the third civilization (what `advance` does once the soul is home).
        assert _node(x, 3).status == SentenceNodeStatus.DISPATCHING, f"{where}: stop 3 {_node(x, 3).status}"
        assert _plan_status(x) == SentencePlanStatus.ACTIVE, f"{where}: plan {_plan_status(x)}"


@sharded
@pytest.mark.parametrize("mode", CUTS)
def test_a_third_civilization_files_and_the_home_hall_rejects_while_the_soul_serves_abroad(world, mode):
    from apps.sentence_plan.models import SentencePlanRequest

    w, where = world, _where(world, mode)
    x = _prepare(_abroad(w, third_stop=True))  # the third hall sees the plan through its own stop 3
    third, home = _client(x["third"], f"d6f3_{mode}"), _client(x["home"], f"d6fh_{mode}")
    with cut():
        r = third.post(_plan_url("file_request", pk=x["plan"].pk), {"kind": "REOPEN", "reason": "新证据"},
                       format="json", HTTP_IDEMPOTENCY_KEY=f"d6f-{x['plan'].pk}")
        assert r.status_code == 201, (where, r.status_code, r.content[:2000])
        rid = r.json()["id"]
        r = home.post(_plan_url("decide", pk=x["plan"].pk, request_id=rid), {"decision": "REJECT", "reason": "否"},
                      format="json", HTTP_IDEMPOTENCY_KEY=f"d6r-{rid}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _settled(where, mode)
        assert _read(lambda: SentencePlanRequest.all_objects.get(pk=rid).status) == "REJECTED", where
        _soul_abroad(x, where)


# ---- retry-dispatch while the soul is abroad: refused, nothing written ---------------------------------------------------

@sharded
@pytest.mark.parametrize("mode", CUTS)
def test_retrying_the_next_stop_while_the_soul_is_abroad_is_refused_and_writes_nothing(world, mode):
    from apps.sentence_plan.services import SentencePlanService
    from apps.tenants.models import ShardOutbox
    from tests import sentence_plan_support as plan

    w, where = world, _where(world, mode)
    x = _abroad(w, third_stop=True)
    node3 = plan.node(x["plan"], 3)
    SentencePlanService._dispatch_not_started(x["soul"], x["plan"], node3)  # a refusal on record: retryable
    from tests.shard_support import _sync

    _sync()
    client = _client(x["home"], f"d6rt_{mode}")
    with cut():
        r = client.post(_plan_url("retry_dispatch", pk=x["plan"].pk, node_id=node3.pk), {}, format="json",
                        HTTP_IDEMPOTENCY_KEY=f"d6rt-{node3.pk}")
        assert r.status_code == 409 and r.json()["code"] == "soul_away", (where, r.status_code, r.content[:2000])
        assert not any(ShardOutbox._base_manager.using(a).exists() for a in settings.DATABASES), where
        _soul_abroad(x, where)
        assert _node(x, 3).status == "PENDING", where


# ---- weighing: a refused flow reheard while the soul resides abroad -------------------------------------------------------

@sharded
@pytest.mark.parametrize("mode", CUTS)
def test_a_refused_flow_is_not_reheard_in_the_home_hall_while_its_soul_resides_on_another_master(world, mode):
    """`weighing.reweigh_after_rejection` writes the soul back to JUDGING in the home hall's transaction. Not reachable
    over HTTP today (a soul with a plan in progress cannot be dispatched by hand), so the state is made directly: the
    case concluded, its flow running, the soul dispatched abroad. Where the home's transaction holds the soul's master
    it rehears the case as on one database; where it does not, 409 `soul_residing` before anything is written."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService
    from apps.judgment.models import Judgment
    from apps.judgment.weighing import WeighingRefusedError, reweigh_after_rejection
    from apps.org.ownership import tenant_root
    from apps.souls.models import SoulState
    from apps.tenants.shard_saga import relay_until_quiet
    from apps.workflow.models import ApprovalWorkflow
    from tests import sentence_plan_support as plan
    from tests.shard_support import _sync

    w, where = world, _where(world, mode)
    home, res = plan.tenant(HALLS[w["home"]]), plan.tenant(HALLS[w["residence"]])
    for hall in (home, res):
        tenant_root(hall)
    soul, case = plan.open_case(home, name=f"重审{w['seed']}")
    case.conclude("FAILED", "")
    flow = ApprovalWorkflow.all_objects.get(judgment_id=case.pk)
    record = DispatchRecord.objects.create(source_tenant=home, target_tenant=res, soul=soul, tenant=home,
                                           status=DispatchStatus.APPROVED, reason="流程走着时调走")
    DispatchService.execute(record, "executor")
    soul.refresh_from_db()
    assert soul.tenant_id == res.pk and soul.current_state == SoulState.DISPOSED, where
    _sync()
    _assign(*CIVS)
    civs = _civs(w, mode)
    with cut():
        flow = _read(lambda: ApprovalWorkflow.all_objects.select_related("judgment").get(pk=flow.pk))
        crossing = w["home"] in civs and w["residence"] in civs
        try:
            with _in_hall(home), transaction.atomic():
                retrial = reweigh_after_rejection(flow)
        except WeighingRefusedError as e:
            assert crossing and e.code == "soul_residing" and e.status == 409, (where, e.code)
            retrial = None
        else:
            assert not crossing, f"{where}: reheard though the home's transaction does not hold the soul's master"
        relay_until_quiet()
        primary = _primary(soul.pk, res)
        if retrial is None:
            assert primary.current_state == SoulState.DISPOSED, f"{where}: {primary.current_state}"
            assert not _read(lambda: Judgment.all_objects.filter(retrial_of_id=case.pk).exists()), where
        else:
            assert primary.current_state == SoulState.JUDGING, f"{where}: {primary.current_state}"


# ---- a soul in transit: refused from every hall that may write it, not only the source --------------------------------------

@sharded
@pytest.mark.parametrize("who", ["target", "home", "system_admin"])
@pytest.mark.parametrize("move", ["execute", "return"])
def test_a_soul_in_transit_refuses_writes_from_the_target_the_home_hall_and_system_admin(who, move, monkeypatch):
    """The first review's in-transit test wrote from the source hall only. The same writes (`_writes`: an officer's
    PATCH over HTTP, a service save, a contact save, a ledger recalculation, a bulk update, a soul code) from the
    target hall, the home hall and SYSTEM_ADMIN: each refused 423 `soul_in_transit` with every row unchanged, or kept on the
    primary -- never lost."""
    from apps.authentication.models import User
    from apps.core.shard_reads import CONTROL_ALIAS, read_context
    from apps.soul_accounts.services import apply_contacts
    from apps.tenants.shard_saga import master_of
    from tests import test_cross_civilization_saga_hardening as hardening
    from tests.test_cross_civilization_saga import RUN, _world, seed_of
    from tests.test_sharded_writes import _halls

    w = _world(seed_of(RUN))
    halls = _halls()
    _assign(*CIVS)
    with cut(), read_context(CONTROL_ALIAS):
        writes = hardening._writes()
        route = hardening._patch_route()

        def officer_edit(pk, hall, mark):
            """The officer's PATCH. 404 too is a write not made: a hall the soul is not (or not yet) a soul of has
            no such soul to edit (the target before the arrival, the home hall of a soul still abroad)."""
            from rest_framework.test import APIClient

            from apps.tenants.shard_saga import SoulInTransit
            from tests.conftest import sign_in

            r = sign_in(APIClient(), hardening._officer(hall)).patch(route(pk), {"name": mark}, format="json")
            if r.status_code == 423:
                assert r.json()["code"] == "soul_in_transit", r.content
            if r.status_code in (404, 423):
                raise SoulInTransit([pk])
            assert r.status_code == 200, (r.status_code, r.content)
            return mark
        writes["officer_edit"] = ("name", officer_edit)

        def not_its_soul(do):
            """Writes not made, like a refusal: a hall the soul is not a soul of (yet) finds no such soul; a hall's
            transaction that does not hold the soul's master is refused the write before it is made (D6,
            `WriteOutsideTransaction` -- not a 423, but nothing lost). The rows are checked unchanged below."""
            def attempt(pk, hall, mark):
                from apps.core.shard_reads import WriteOutsideTransaction
                from apps.souls.models import Soul
                from apps.tenants.shard_saga import SoulInTransit

                try:
                    return do(pk, hall, mark)
                except (Soul.DoesNotExist, WriteOutsideTransaction):
                    raise SoulInTransit([pk]) from None
            return attempt
        writes = {name: (col, not_its_soul(do)) for name, (col, do) in writes.items()}
        pk, source, target, kind = hardening._begin(move, w, halls)
        home = halls[w["src"]]
        hall = {"target": target, "home": home, "system_admin": None}[who]
        where = f"seed {w['seed']} {w['cut']} {move} by {who}"
        if hall is None:
            admin = User.objects.create_user(username=f"d6_sysadmin_{move}", password="x", role="SYSTEM_ADMIN",
                                             tenant=None)
            monkeypatch.setattr(hardening, "_officer", lambda h: admin)

            def contact_email(pk, hall, mark):  # SYSTEM_ADMIN: no hall, every master in its transaction
                value = f"{mark}@transit.test"
                with transaction.atomic():
                    apply_contacts(hardening._soul().all_objects.get(pk=pk), contact_email=value)
                return value
            writes["contact_email"] = ("contact_email", contact_email)
        before = {name: getattr(hardening._soul().all_objects.get(pk=pk), col) for name, (col, _) in writes.items()}
        outcomes = hardening._attempt(writes, pk, hall, 1)
        hardening._relay()
        primary = hardening._soul()._base_manager.using(master_of(target)).get(pk=pk)
        assert primary.tenant_id == target.pk, f"{where}: the move did not complete"
        for name, (outcome, value) in outcomes.items():
            col = writes[name][0]
            if outcome == "written":
                assert getattr(primary, col) == value, f"{where}: {name} wrote {value!r}, primary has " \
                                                       f"{getattr(primary, col)!r} -- a write lost"
            else:
                rows = {getattr(r, col) for alias in settings.DATABASES
                        for r in hardening._soul()._base_manager.using(alias).filter(pk=pk)}
                assert rows == {before[name]}, f"{where}: {name} refused, yet the rows hold {rows}"
        assert any(o == "refused" for o, _ in outcomes.values()), f"{where}: nothing was refused: {outcomes}"
        _ownership()


# ---- the guard: no saga step commits inside another master's transaction -------------------------------------------------

@sharded
def test_a_saga_step_inside_a_transaction_not_open_on_its_master_is_refused_and_commits_nothing():
    from apps.souls.models import Soul
    from apps.tenants.models import ShardOutbox
    from apps.tenants.shard_saga import StepOutsideTransaction, master_of, on_master
    from tests.test_sharded_writes import _halls

    halls = _halls()
    _assign(*CIVS)
    home, there = halls["CHINESE"], halls["EGYPTIAN"]
    with cut():
        with _in_hall(there):
            soul = Soul.objects.create(name="守卫", tenant=there, current_state="DISPOSED")
        with pytest.raises(StepOutsideTransaction), _in_hall(home), transaction.atomic(), on_master(there):
            Soul._base_manager.using(master_of(there)).filter(pk=soul.pk).update(description="half")
        assert Soul._base_manager.using(master_of(there)).get(pk=soul.pk).description == "", "a step committed"
        assert not ShardOutbox._base_manager.using(master_of(there)).exists()
        # Where the transaction is open on that master, or none is open, the step is part of it / its own.
        with _in_hall(there), transaction.atomic(), on_master(there):
            Soul._base_manager.using(master_of(there)).filter(pk=soul.pk).update(description="whole")
        with on_master(there):
            pass
        assert Soul._base_manager.using(master_of(there)).get(pk=soul.pk).description == "whole"


# ---- M-A: a contact save queued for the residence lands wherever the soul's primary is when it is delivered ----------------

def _contact_world(seed, forced):
    from apps.core.shard_reads import CONTROL_ALIAS, read_context
    from tests.test_cross_civilization_saga import _approved, _world, seed_of
    from tests.test_cross_civilization_saga_limits import _execute, _relay
    from tests.test_sharded_writes import _halls

    w = _world(seed_of(seed), forced)
    halls = _halls()
    _assign(*CIVS)
    return w, halls, read_context(CONTROL_ALIAS), _approved, _execute, _relay


@sharded
@pytest.mark.parametrize("seed,forced", [("run", None), (7, "tgt"), (31, "src"), (88, "both")])
def test_a_contact_save_queued_for_the_residence_lands_on_the_primary_after_the_soul_came_home(seed, forced):
    from apps.dispatch.services import DispatchService
    from apps.tenants import shard_saga
    from tests.test_cross_civilization_saga_hardening import _contacts, _soul

    w, halls, ctx, approved, execute, relay = _contact_world(seed, forced)
    with cut(), ctx:
        home, _residence = halls[w["src"]], halls[w["tgt"]]
        where = f"seed {w['seed']} cut {w['cut']}"
        soul, record = approved(w, halls)
        execute(record.pk)
        relay()
        _contacts(soul.pk, home, "queued@d6.test")  # a row.save home -> residence, not relayed yet
        with _in_hall(home):
            DispatchService.end_residence(_soul().all_objects.get(pk=soul.pk), actor=None,
                                          trigger=DispatchService.RETURN_MANUAL, reason="d6")
        for _ in range(shard_saga.MAX_ATTEMPTS + 2):
            shard_saga.relay()
        primary = _soul()._base_manager.using(shard_saga.master_of(home)).get(pk=soul.pk)
        dead = [(a, m.kind, m.last_error[:200]) for a, m in shard_saga.failed()]
        assert primary.tenant_id == home.pk, f"{where}: not home"
        assert primary.contact_email == "queued@d6.test" and not dead, \
            f"{where}: primary has {primary.contact_email!r}; dead letters {dead}"
        _ownership()


@sharded
@pytest.mark.parametrize("seed,forced", [("run", None), (88, "both")])
def test_retry_failed_delivers_a_dead_contact_save_addressed_to_a_hall_the_soul_has_left(seed, forced):
    """A dead letter of the old kind (sent to the residence, FAILED after the soul came home -- 115 may hold some):
    `relay_outbox --retry-failed` delivers it to the soul's primary and exits 0."""
    from apps.tenants import shard_saga
    from apps.tenants.models import ShardMessageState, ShardOutbox
    from tests.test_cross_civilization_saga_hardening import _soul

    w, halls, ctx, approved, execute, relay = _contact_world(seed, forced)
    with cut(), ctx:
        home, residence = halls[w["src"]], halls[w["tgt"]]
        where = f"seed {w['seed']} cut {w['cut']}"
        soul, record = approved(w, halls)
        alias = shard_saga.master_of(home)
        with _in_hall(home), transaction.atomic(using=alias):
            ShardOutbox._base_manager.using(alias).create(
                message_id=__import__("uuid").uuid4(), tenant=home, target_tenant=residence, kind="row.save",
                subject=f"row:souls.Soul:{soul.pk}", state=ShardMessageState.FAILED, attempts=shard_saga.MAX_ATTEMPTS,
                last_error="DoesNotExist: Soul matching query does not exist.",
                payload={"model": "souls.Soul", "pk": str(soul.pk), "values": {"contact_email": "dead@d6.test"}})
        out = io.StringIO()
        call_command("relay_outbox", "--retry-failed", stdout=out)  # CommandError (exit 1) while anything is left
        primary = _soul()._base_manager.using(alias).get(pk=soul.pk)
        assert primary.tenant_id == home.pk and primary.contact_email == "dead@d6.test", (where, out.getvalue())
        assert not shard_saga.failed(), where


# ---- DISPATCH_FROZEN ---------------------------------------------------------------------------------------------------

@sharded
@pytest.mark.parametrize("mode", CUTS)
def test_dispatch_frozen_refuses_propose_approve_execute_and_a_new_joint_bench_writing_nothing(mode):
    from django.test import override_settings
    from django.urls import reverse

    from apps.dispatch.models import CrossTenantJudgment, DispatchRecord, DispatchStatus
    from apps.tenants.models import ShardOutbox
    from tests import test_cross_civilization_dispatch_over_http as over_http
    from tests.test_sharded_writes import _halls

    seed = over_http._seed()
    rng = random.Random(seed)
    src, tgt = rng.sample(CIVS, 2)
    w = {"seed": seed, "cut": mode, "src": src, "tgt": tgt, "realm": rng.random() < 0.5}
    halls = _halls()
    _assign(*CIVS)
    where = f"seed {seed} cut {mode} {src}->{tgt}"
    routes = over_http._routes()
    with cut():
        home, there = over_http._officers(halls, w)
        _, approved_pk = over_http._proposal(w, halls, home, routes, n=1)
        assert there.post(reverse(routes["approve"], kwargs={"pk": approved_pk}), {}, format="json").status_code == 200
        soul_pk_before = _read(DispatchRecord.all_objects.count)
        with override_settings(DISPATCH_FROZEN=True):
            frozen = {}
            from apps.realms.path import SoulPathService
            from apps.souls.models import Soul

            with _in_hall(halls[src]):
                soul = Soul.objects.create(name=f"冻{seed}", tenant=halls[src], current_state="DISPOSED")
                SoulPathService.enter(soul, over_http._realm(halls[src], f"FRZ_{src[:2]}"), tenant_id=halls[src].pk)
            frozen["propose"] = home.post(reverse(routes["create"]), {
                "source_tenant": str(halls[src].pk), "target_tenant": str(halls[tgt].pk), "soul": str(soul.pk),
                "reason": "冻结期间提出的跨文明调拨:该灵魂须往目标文明之界域受审,依律应当拒绝"}, format="json", HTTP_IDEMPOTENCY_KEY=f"frz-{seed}")
            frozen["execute"] = there.post(reverse(routes["execute"], kwargs={"pk": approved_pk}), {}, format="json",
                                           HTTP_IDEMPOTENCY_KEY=f"frz-x-{seed}")
            frozen["bench"] = home.post("/api/v1/dispatch/cross-tenant-judgments/",
                                        {"title": "联审", "description": "冻结"}, format="json")
        for name, r in frozen.items():
            assert r.status_code == 423 and r.json()["code"] == "dispatch_frozen", (where, name, r.status_code,
                                                                                    r.content[:500])
        assert _read(DispatchRecord.all_objects.count) == soul_pk_before, f"{where}: a dispatch was written"
        assert _status(approved_pk) == DispatchStatus.APPROVED, where
        assert not _read(CrossTenantJudgment.all_objects.exists), f"{where}: a bench was written"
        assert not any(ShardOutbox._base_manager.using(a).exists() for a in settings.DATABASES), where
        # Approve: a second proposal, approved while frozen.
        _, second = over_http._proposal(w, halls, home, routes, n=2)
        with override_settings(DISPATCH_FROZEN=True):
            r = there.post(reverse(routes["approve"], kwargs={"pk": second}), {}, format="json")
        assert r.status_code == 423 and r.json()["code"] == "dispatch_frozen", (where, "approve", r.content[:500])
        assert _status(second) == DispatchStatus.PROPOSED, where
        # Resumed: the same calls go through.
        assert there.post(reverse(routes["approve"], kwargs={"pk": second}), {}, format="json").status_code == 200
        r = there.post(reverse(routes["execute"], kwargs={"pk": approved_pk}), {}, format="json",
                       HTTP_IDEMPOTENCY_KEY=f"frz-x2-{seed}")
        assert r.status_code == 200, (where, r.content[:500])


def _status(pk):
    from apps.dispatch.models import DispatchRecord

    return _read(lambda: DispatchRecord.all_objects.get(pk=pk).status)
