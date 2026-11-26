"""Stage 4, third review (docs/audit/2026-11-15-sharding/VERIFY-stage4-r3.md): the residence's / seat's hall acts on a
world built AFTER both civilizations are write-cut. The D6 tests build theirs before the cut and act from the home
hall; these act from the other side, where one business flow's rows are on two masters.

  H-1  the seat's hall fills its seat on a bench opened by another civilization (`submit_sentence` locked the bench
       on the seat's master: 500). Now the seat is written on its master and the bench takes it on its own, under
       `conclude`'s lock, by a message (`transfer.SENTENCE`); `conclude` waits while one is in flight, and a bench
       closed meanwhile refuses it and the seat is put back.
  H-2  the residence executes (and releases) a plan stop (`on_disposition_executed` locked the home's plan on the
       residence's master: 500). Now the residence writes its own rows and the plan's master marks the node and
       advances (`transfer.STOP_DONE`).
  N-1  a home-side return (RETURN_REQUESTED) delivered after another return deleted the residence's row: a dead
       letter on soul:<pk>. Now it is "already left", and the caller's plan still moves on.
  N-3  DISPATCH_FROZEN refuses a seat on a bench and a cross-civilization rebirth.
  MU6  a deed and a contact save delivered between a move's step 2 and step 3 wait (SoulInTransit) and land on the primary.

Two pairs (home, residence) for each: the Chinese hall with the Greek, the Egyptian with the European.

    scripts/run-gates.sh --tests --ds=config.settings_sharded -m sharded tests/test_s4_residence_hall_acts_after_the_cut.py
"""
import io

import pytest
from django.conf import settings
from django.core.management import call_command
from django.db import transaction

from tests.test_d6_home_hall_acts_on_a_soul_abroad import HALLS, _audited, _client, _read, _route, _settled
from tests.test_shard_sync import CIVS, sharded
from tests.test_sharded_writes import _assign, _in_hall, cut

PAIRS = [("CHINESE", "GREEK"), ("EGYPTIAN", "EUROPEAN")]


def _master(hall):
    from apps.tenants.shard_saga import master_of

    return master_of(hall)


def _quiet(where, mirror=None):
    """Relayed until quiet, nothing pending or FAILED, ownership clean (`_settled`). `mirror`: a hall whose shard's
    rows control's mirror then follows (what the debounced `sync_shards` does after those commits) -- a world built
    after the cut exists only on the masters until then, and the residence's reads whose join crosses masters
    (its dispositions, joined through `soul`) are answered from control. Only that shard: with both civilizations
    cut, the sync of the home's shard too inserts the residing soul into control twice (its copy there and its
    primary at the residence: IntegrityError on souls_soul.id) -- left open, VERIFY-stage4-r3 follow-up."""
    _settled(where, "both")
    if mirror is not None:
        from apps.core.shard_sync import sync

        sync([_master(mirror)])


def _halls(pair):
    """The two halls (and the residence's stop realm) -- before the cut, as halls are made: in control, synced."""
    from apps.org.ownership import tenant_root
    from apps.realms.models import Realm
    from tests import sentence_plan_support as plan
    from tests.test_shard_sync import _sync

    home, res = (plan.tenant(HALLS[c]) for c in pair)
    for hall in (home, res):
        tenant_root(hall)
    code = plan.stop_realm(res)
    Realm.objects.filter(realm_code=code).update(tenant=res)
    _sync()
    _assign(*CIVS)
    return {"home": home, "res": res, "code": code, "pair": pair, "where": f"{pair[0]} home, {pair[1]} residence"}


def _pending(kind):
    from apps.tenants import shard_saga

    return [m for a, ids in shard_saga.masters() for m in shard_saga.pending(a, ids) if m.kind == kind]


def _bench(x, tag):
    """After the cut, in the home hall: a soul, its open case, a joint bench on it with the residence's seat 2."""
    from apps.dispatch.models import ParticipantRole
    from apps.dispatch.services import CrossTenantJudgmentService
    from apps.tenants.shard_saga import relay_until_quiet
    from tests import sentence_plan_support as plan

    with _in_hall(x["home"]):
        soul, case = plan.open_case(x["home"], name=f"席魂{tag}")
        cj = CrossTenantJudgmentService.create("联审", "d", x["home"])
        cj.judgment = case
        cj.save(update_fields=["judgment"])
        seat = CrossTenantJudgmentService.add_participant(cj, x["res"], None, ParticipantRole.CO_JUDGE, node_order=2)
    relay_until_quiet()
    x.update(soul=soul, case=case, cj=cj, seat=seat)
    x["home_admin"] = _client(x["home"], f"r3h_{tag}")
    x["res_admin"] = _client(x["res"], f"r3r_{tag}")
    return x


def _sentence(x, years=5):
    return x["res_admin"].post(f"/api/v1/dispatch/cross-tenant-judgments/{x['cj'].pk}/sentence/", {
        "participant": str(x["seat"].pk), "realm_code": x["code"], "sentence_years": years, "notes": "席位之刑"},
        format="json")


def _bench_url(x, action):
    return f"/api/v1/dispatch/cross-tenant-judgments/{x['cj'].pk}/{action}/"


def _seat_row(x, hall):
    from apps.dispatch.models import CrossTenantJudgmentParticipant

    return CrossTenantJudgmentParticipant._base_manager.using(_master(hall)).filter(pk=x["seat"].pk).first()


def _audit_count(**filters):
    from apps.audit.models import AuditLog

    return len({r.pk for alias in settings.DATABASES for r in AuditLog._base_manager.using(alias).filter(**filters)})


# ---- H-1: the seat's hall fills its seat -------------------------------------------------------------------------------

@sharded
@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p[0]}-{p[1]}")
def test_the_seat_hall_fills_its_seat_on_a_bench_opened_after_the_cut_and_the_bench_concludes_with_it(pair):
    from apps.dispatch.models import JudgmentStatus

    x = _halls(pair)
    where = x["where"]
    with cut():
        _bench(x, f"s{pair[0][:2]}")
        assert x["home_admin"].post(_bench_url(x, "activate"), {}, format="json").status_code == 200, where
        r = _sentence(x)
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        # The seat is written on its own master, in the seat hall's transaction; the bench's master has no row of it.
        seat = _seat_row(x, x["res"])
        assert seat.sentence_realm_code == x["code"] and seat.sentence_years == 5, where
        assert _seat_row(x, x["home"]) is None, f"{where}: the seat was written on the bench's master"
        assert len(_pending("dispatch.joint_sentence")) == 1, where
        # Conclude waits while the sentence is on its way: 400, and nothing of it written (no audit row either).
        audits = _audit_count(resource="crosstenantjudgment", resource_id=str(x["cj"].pk))
        r = x["home_admin"].post(_bench_url(x, "conclude"), {"conclusion_type": "PASS", "note": "结"}, format="json")
        assert r.status_code == 400 and "on its way" in r.json()["detail"], (where, r.status_code, r.content[:500])
        assert _read(lambda: x["cj"].__class__.all_objects.get(pk=x["cj"].pk).status) == JudgmentStatus.ACTIVE
        assert _audit_count(resource="crosstenantjudgment", resource_id=str(x["cj"].pk)) == audits, where
        _quiet(where)
        r = x["home_admin"].post(_bench_url(x, "conclude"), {"conclusion_type": "PASS", "note": "结"}, format="json")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _quiet(where)
        assert _read(lambda: x["cj"].__class__.all_objects.get(pk=x["cj"].pk).status) == JudgmentStatus.CONCLUDED
        assert _seat_row(x, x["res"]).sentence_years == 5, f"{where}: the seat lost its sentence"
        _audited(where, resource="crosstenantjudgmentparticipant", resource_id=str(x["seat"].pk), action="UPDATE",
                 tenant_id=x["res"].pk)


@sharded
@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p[0]}-{p[1]}")
def test_a_bench_cancelled_before_the_seats_sentence_reaches_it_refuses_it_and_the_seat_is_put_back(pair):
    from apps.tenants.models import ShardMessageState, ShardOutbox

    x = _halls(pair)
    where = x["where"]
    with cut():
        _bench(x, f"c{pair[0][:2]}")
        assert _sentence(x).status_code == 200, where
        [msg] = _pending("dispatch.joint_sentence")
        r = x["home_admin"].post(_bench_url(x, "cancel"), {"reason": "取消"}, format="json")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _quiet(where)
        state = ShardOutbox._base_manager.using(_master(x["res"])).get(pk=msg.pk).state
        assert state == ShardMessageState.REFUSED, f"{where}: the sentence was {state}"
        seat = _seat_row(x, x["res"])
        assert seat.sentence_submitted_at is None and seat.sentence_realm_code in (None, ""), \
            f"{where}: a refused sentence stayed on the seat ({seat.sentence_realm_code})"


# ---- H-2: the residence executes and releases a plan stop ------------------------------------------------------------

def _abroad_after_the_cut(x, tag):
    """The bench's sentence becomes stop 2 of the soul's plan; stop 1 served at home; the residence approves and
    executes the stop's dispatch (HTTP) -- all after the cut. Returns the stop's node."""
    from django.urls import reverse

    from apps.dispatch.models import DispatchRecord
    from apps.dispatch.views import DispatchRecordViewSet
    from apps.judgment.models import Verdict
    from apps.sentence_plan.models import SentenceNodeStatus, SentencePlan
    from tests import sentence_plan_support as plan

    _bench(x, tag)
    assert x["home_admin"].post(_bench_url(x, "activate"), {}, format="json").status_code == 200
    assert _sentence(x).status_code == 200
    _quiet(x["where"])
    r = x["home_admin"].post(_bench_url(x, "conclude"), {"conclusion_type": "PASS", "note": "结"}, format="json")
    assert r.status_code == 200, (x["where"], r.content[:2000])
    verdict = Verdict.FAILED if x["home"].code == "CN_DIYU" else Verdict.PASSED
    with _in_hall(x["home"]):
        with transaction.atomic():
            x["case"].conclude(verdict, "")
        plan.walk_flow(x["case"])
        p = SentencePlan.all_objects.get(soul_id=x["soul"].pk, origin_judgment_id=x["case"].pk)
        with transaction.atomic():
            assert plan.serve(x["soul"], p, 1), x["where"]
    x["plan"] = p
    node = _read(lambda: plan.node(p, 2))
    assert node.status == SentenceNodeStatus.DISPATCHING, (x["where"], node.status)
    for action in ("approve", "execute"):
        r = x["res_admin"].post(reverse(_route(DispatchRecordViewSet, action), kwargs={"pk": node.dispatch_record_id}),
                                {}, format="json", HTTP_IDEMPOTENCY_KEY=f"r3-{action}-{tag}")
        assert r.status_code == 200, (x["where"], action, r.content[:2000])
    _quiet(x["where"], mirror=x["res"])
    node = _read(lambda: plan.node(p, 2))
    assert node.status == SentenceNodeStatus.ACTIVE and node.disposition_id, (x["where"], node.status)
    assert _read(lambda: DispatchRecord.all_objects.get(pk=node.dispatch_record_id).status) == "EXECUTED"
    return node


@sharded
@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p[0]}-{p[1]}")
def test_the_residence_executes_and_then_releases_a_stop_of_a_plan_made_after_the_cut(pair):
    from django.utils import timezone

    from apps.disposition.models import Disposition
    from apps.ledger.services import REBIRTH_CAPABLE_CIVILIZATIONS
    from apps.sentence_plan.models import SentenceNode, SentenceNodeStatus, SentencePlan, SentencePlanStatus
    from apps.souls.models import Soul, SoulState

    x = _halls(pair)
    where = x["where"]
    with cut():
        node = _abroad_after_the_cut(x, f"e{pair[0][:2]}")
        disposition = node.disposition_id
        r = x["res_admin"].post(f"/api/v1/disposition/{disposition}/execute/", {}, format="json",
                                HTTP_IDEMPOTENCY_KEY=f"r3-exec-{pair[0]}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        assert len(_pending("sentence_plan.stop_done")) == 1, where
        _quiet(where, mirror=x["res"])
        row = Disposition._base_manager.using(_master(x["res"])).get(pk=disposition)
        assert row.is_executed, f"{where}: the stop's disposition is not executed"
        assert not Disposition._base_manager.using(_master(x["home"])).filter(pk=disposition).exists(), where
        # Serving (a 5-year term): the stop stays ACTIVE, the soul stays.
        stop = SentenceNode._base_manager.using(_master(x["home"])).get(pk=node.pk)
        assert stop.status == SentenceNodeStatus.ACTIVE, f"{where}: stop 2 {stop.status}"
        assert Soul._base_manager.using(_master(x["res"])).get(pk=x["soul"].pk).tenant_id == x["res"].pk, where
        _audited(where, resource="disposition", resource_id=str(disposition), action="UPDATE", tenant_id=x["res"].pk)
        # The term ends (its start recorded as historical, in the residence's own transaction); the residence releases.
        with _in_hall(x["res"]), transaction.atomic():
            Disposition.objects.filter(pk=disposition).update(
                term_start_year=timezone.localdate().year - 10, term_start_month=1, term_start_day=1)
        r = x["res_admin"].post(f"/api/v1/disposition/{disposition}/release/", {}, format="json",
                                HTTP_IDEMPOTENCY_KEY=f"r3-rel-{pair[0]}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _quiet(where)
        stop = SentenceNode._base_manager.using(_master(x["home"])).get(pk=node.pk)
        assert stop.status == SentenceNodeStatus.COMPLETED, f"{where}: stop 2 {stop.status}"
        plan = SentencePlan._base_manager.using(_master(x["home"])).get(pk=x["plan"].pk)
        assert plan.status == SentencePlanStatus.COMPLETED, f"{where}: plan {plan.status}"
        soul = Soul._base_manager.using(_master(x["home"])).get(pk=x["soul"].pk)
        want = SoulState.REINCARNATING if pair[0] in REBIRTH_CAPABLE_CIVILIZATIONS else SoulState.SETTLED
        assert (soul.tenant_id, soul.current_state) == (x["home"].pk, want), (where, soul.tenant_id, soul.current_state)
        assert not Soul._base_manager.using(_master(x["res"])).filter(pk=soul.pk).exists(), \
            f"{where}: the residence still holds the soul"
        _audited(where, resource="sentencenode", resource_id=str(node.pk), action="UPDATE")


# ---- N-1: a home-side return after the soul came home another way -----------------------------------------------------

@sharded
@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p[0]}-{p[1]}")
def test_a_return_requested_by_the_home_after_the_residence_sent_the_soul_home_is_no_dead_letter(pair):
    from apps.dispatch import transfer
    from apps.dispatch.services import DispatchService
    from apps.ledger.services import REBIRTH_CAPABLE_CIVILIZATIONS
    from apps.sentence_plan.models import SentencePlan, SentencePlanStatus
    from apps.souls.models import Soul, SoulState
    from apps.tenants import shard_saga
    from apps.tenants.models import ShardMessageState, ShardOutbox
    from tests.test_d6_home_hall_acts_on_a_soul_abroad import _plan_url

    x = _halls(pair)
    where = x["where"]
    with cut():
        _abroad_after_the_cut(x, f"n{pair[0][:2]}")
        # The home hall cancels: step 1 waits for the relay (RETURN_REQUESTED on the home's master).
        r = x["home_admin"].post(_plan_url("cancel", pk=x["plan"].pk), {"reason": "赦免"}, format="json",
                                 HTTP_IDEMPOTENCY_KEY=f"r3-n1-{pair[0]}")
        assert r.status_code == 200, (where, r.content[:2000])
        [requested] = _pending(transfer.RETURN_REQUESTED)
        # Before that relay, the residence ends the residence itself, and its return completes first: on a shard its
        # step 3 deletes the residence's row the request is addressed to.
        with _in_hall(x["res"]):
            here = Soul._base_manager.using(_master(x["res"])).get(pk=x["soul"].pk)
            DispatchService.end_residence(here, actor="system", trigger=DispatchService.RETURN_ON_DISPOSITION,
                                          reason="暂居地先结束")
        res_alias = _master(x["res"])
        for _ in range(5):
            for msg in shard_saga.pending(res_alias, [x["res"].pk]):
                shard_saga.deliver(msg)
        assert not Soul._base_manager.using(res_alias).filter(pk=x["soul"].pk).exists(), \
            f"{where}: the residence's row is not gone yet -- the interleaving was not built"
        assert ShardOutbox._base_manager.using(_master(x["home"])).get(pk=requested.pk).state == \
            ShardMessageState.PENDING, where
        _quiet(where)  # no FAILED, nothing pending, ownership clean
        plan = SentencePlan._base_manager.using(_master(x["home"])).get(pk=x["plan"].pk)
        assert plan.status == SentencePlanStatus.CANCELLED, f"{where}: plan {plan.status} (the cancel's advance lost)"
        soul = Soul._base_manager.using(_master(x["home"])).get(pk=x["soul"].pk)
        want = SoulState.REINCARNATING if pair[0] in REBIRTH_CAPABLE_CIVILIZATIONS else SoulState.SETTLED
        assert (soul.tenant_id, soul.current_state) == (x["home"].pk, want), (where, soul.current_state)
        # A dead letter of this kind from before the fix (no home_id in it) goes out with --retry-failed.
        with _in_hall(x["home"]), transaction.atomic():
            ShardOutbox._base_manager.using(_master(x["home"])).create(
                message_id=__import__("uuid").uuid4(), tenant=x["home"], target_tenant=x["res"],
                kind=transfer.RETURN_REQUESTED, subject=f"soul:{soul.pk}", state=ShardMessageState.FAILED,
                attempts=shard_saga.MAX_ATTEMPTS, last_error="DoesNotExist: Soul matching query does not exist.",
                payload={"soul_id": str(soul.pk), "trigger": "PLAN_CANCELLED", "reason": "", "actor": None,
                         "actor_id": None, "then_advance": True})
        out = io.StringIO()
        call_command("relay_outbox", "--retry-failed", stdout=out)  # CommandError (exit 1) while anything is left
        _quiet(where)
        assert not shard_saga.failed(), (where, out.getvalue())


# ---- N-3: DISPATCH_FROZEN ----------------------------------------------------------------------------------------------

@sharded
@pytest.mark.parametrize("pair", [("CHINESE", "GREEK"), ("GREEK", "EUROPEAN")],  # a home with a next life
                         ids=lambda p: f"{p[0]}-{p[1]}")
def test_dispatch_frozen_refuses_a_seat_and_a_cross_civilization_rebirth_writing_nothing(pair, monkeypatch):
    from django.test import override_settings

    from apps.core.problems import Problem
    from apps.dispatch.models import CrossTenantJudgment, CrossTenantJudgmentParticipant
    from apps.dispatch.services import CrossTenantJudgmentService
    from apps.reincarnation.models import Reincarnation
    from apps.reincarnation.services import ReincarnationService
    from apps.souls.models import Soul, SoulState
    from apps.tenants.models import ShardOutbox

    x = _halls(pair)
    where = x["where"]
    with cut():
        with _in_hall(x["home"]):
            cj = CrossTenantJudgmentService.create("联审", "d", x["home"])
            soul = Soul.objects.create(name="迁籍", tenant=x["home"], current_state=SoulState.REINCARNATING)
        home_admin = _client(x["home"], f"r3f_{pair[0][:2]}")
        outboxes = sum(ShardOutbox._base_manager.using(a).count() for a in settings.DATABASES)
        with override_settings(DISPATCH_FROZEN=True):
            r = home_admin.post(f"/api/v1/dispatch/cross-tenant-judgments/{cj.pk}/participate/",
                                {"participant_tenant_code": x["res"].code, "role": "ADVISOR"}, format="json")
            assert r.status_code == 423 and r.json()["code"] == "dispatch_frozen", (where, r.status_code, r.content)
            monkeypatch.setattr("apps.soul_accounts.rebirth.approved_rebirth_target", lambda s: x["res"])
            with _in_hall(x["home"]), pytest.raises(Problem) as refused:
                ReincarnationService.complete_rebirth(soul=soul, new_identity="下一世")
            assert (refused.value.status_code, refused.value.problem_code) == (423, "dispatch_frozen"), where
        assert not _read(lambda: CrossTenantJudgmentParticipant.all_objects.filter(judgment_id=cj.pk).exists()), where
        assert not _read(lambda: Reincarnation.all_objects.filter(soul_id=soul.pk).exists()), where
        assert sum(ShardOutbox._base_manager.using(a).count() for a in settings.DATABASES) == outboxes, where
        moved = Soul._base_manager.using(_master(x["home"])).get(pk=soul.pk)
        assert (moved.tenant_id, moved.current_state) == (x["home"].pk, SoulState.REINCARNATING), where
        assert _read(lambda: CrossTenantJudgment.all_objects.filter(pk=cj.pk).exists()), where
        # Resumed: the seat goes through.
        r = home_admin.post(f"/api/v1/dispatch/cross-tenant-judgments/{cj.pk}/participate/",
                            {"participant_tenant_code": x["res"].code, "role": "ADVISOR"}, format="json")
        assert r.status_code == 200, (where, r.content[:2000])
        _quiet(where)


# ---- MU6: a row.create / row.save delivered between a move's step 2 and step 3 -----------------------------------------------------

#: (home, residence) with the residence's master sorting BEFORE the home's: a save that does not wait finds the
#: residence's row first -- the one step 3 deletes.
MOVE_PAIRS = [("GREEK", "CHINESE"), ("EUROPEAN", "EGYPTIAN")]


@sharded
@pytest.mark.parametrize("pair", MOVE_PAIRS, ids=lambda p: f"{p[0]}-{p[1]}")
def test_a_deed_and_a_contact_save_between_a_returns_step_2_and_step_3_wait_and_land_on_the_soul_at_home(pair, monkeypatch):
    from apps.core.shard_reads import CONTROL_ALIAS, read_context
    from apps.dispatch import transfer
    from apps.dispatch.services import DispatchService
    from apps.souls.models import Soul
    from apps.tenants import shard_saga
    from apps.tenants.models import ShardMessageState, ShardOutbox
    from tests.test_cross_civilization_saga import _approved
    from tests.test_sharded_writes import _halls as _one_hall_each

    halls = _one_hall_each()
    _assign(*CIVS)
    home, res = halls[pair[0]], halls[pair[1]]
    where = f"{pair[0]} home, {pair[1]} residence"
    with cut():
        assert _master(res) < _master(home), (_master(res), _master(home))
        soul, record = _approved({"seed": f"mu6{pair[0][:2]}", "src": pair[0], "tgt": pair[1], "realm": False},
                                 halls)
        with read_context(CONTROL_ALIAS):
            DispatchService.execute(record, "executor")
        shard_saga.relay_until_quiet()
        with _in_hall(res):
            DispatchService.end_residence(Soul._base_manager.using(_master(res)).get(pk=soul.pk), actor="system",
                                          trigger=DispatchService.RETURN_ON_DISPOSITION, reason="mu6")
        apply, done, refused = shard_saga._HANDLERS[transfer.RETURN]

        def step_3_not_yet(payload):
            raise RuntimeError("step 3 not reached yet")

        monkeypatch.setitem(shard_saga._HANDLERS, transfer.RETURN, (apply, step_3_not_yet, refused))
        shard_saga.relay()  # step 2: the soul's primary-looking row on the home's master; step 3 fails
        assert Soul._base_manager.using(_master(home)).get(pk=soul.pk).tenant_id == home.pk, where
        assert Soul._base_manager.using(_master(res)).get(pk=soul.pk).tenant_id == res.pk, where
        # A deed filed for the soul (an appeal's compensation, `shard_saga.create_rows`), then a contact save: both
        # addressed at delivery (`_row_primary`), one subject. The save alone would also be stopped by the soul's
        # own pre-save transit guard on the residence's master; the deed is a SoulRecord, which nothing else stops
        # -- without the wait it is created on the residence's row of the soul, which step 3 retires.
        from apps.souls.record_models import EvidenceSource, RecordCategory, RecordType, SoulRecord

        deed = __import__("uuid").uuid4()
        with _in_hall(home), transaction.atomic():
            create = shard_saga.create_rows(SoulRecord, [dict(
                id=deed, record_type=RecordType.MERIT, category=RecordCategory.COMPENSATION, description="mu6",
                weight=1, evidence_source=EvidenceSource.REGISTRY, evidence_json={})],
                soul=Soul._base_manager.using(_master(res)).get(pk=soul.pk), source=home)
            save = ShardOutbox._base_manager.using(_master(home)).create(
                message_id=__import__("uuid").uuid4(), tenant=home, target_tenant=res, kind="row.save",
                subject=f"row:souls.Soul:{soul.pk}",
                payload={"model": "souls.Soul", "pk": str(soul.pk), "values": {"contact_email": "mu6@r3.test"}})
        shard_saga.relay()
        for msg in (create, save):
            waiting = ShardOutbox._base_manager.using(_master(home)).get(pk=msg.pk)
            assert (waiting.state, waiting.attempts) == (ShardMessageState.PENDING, 0), \
                f"{where}: {msg.kind} between step 2 and step 3 did not wait ({waiting.state}, {waiting.last_error})"
        assert not SoulRecord._base_manager.using(_master(res)).filter(pk=deed).exists(), \
            f"{where}: the deed was filed on the residence's row of the soul, which step 3 retires"
        monkeypatch.setitem(shard_saga._HANDLERS, transfer.RETURN, (apply, done, refused))
        shard_saga.retry_failed()
        shard_saga.relay_until_quiet()
        primary = Soul._base_manager.using(_master(home)).get(pk=soul.pk)
        assert (primary.tenant_id, primary.contact_email) == (home.pk, "mu6@r3.test"), (where, primary.contact_email)
        assert SoulRecord._base_manager.using(_master(home)).filter(pk=deed, soul_id=soul.pk).exists(), \
            f"{where}: the deed is not on the soul at home"
        assert not SoulRecord._base_manager.using(_master(res)).filter(pk=deed).exists(), where
        assert not shard_saga.failed(), where
