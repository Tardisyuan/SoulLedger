"""Stage 4, after the third review (docs/audit/2026-11-15-sharding/VERIFY-stage4-r3.md N-2, N-4; REPORT-all-stages.md
§3 items 1 and 4): a residence that will not let the soul go, a residence without a plan, and the residence concluding
an amendment case -- on a world built AFTER both civilizations are write-cut, over HTTP, two civilization pairs.

  N-2  the home hall cancels the plan of a soul whose residence has an open case. Single-database that is 409
       `open_judgment`, nothing written; across masters it answered 200, closed the plan's stops and left the plan
       open, and the residence's refusal was one log line. Now the home's request reads the residence's master
       first: 409 `open_judgment`, nothing written, nothing sent. A case opened there after that answer (the race)
       still refuses the return when the relay comes; the refusal is now a DISPATCH_RETURN_BLOCKED event and a
       notification to the officers of both halls, and the same cancel asked again brings the soul home.
  N-4  a residence without a plan (a dispatch by hand), its disposition executed there: the soul comes home and moves
       on (REINCARNATING / SETTLED, F-DISP-07) -- across masters it stopped at "DISPOSED, no plan".
  §3.4 the residence concludes an amendment case with plan changes: the request is the home hall's row, on its master.

    scripts/run-gates.sh --tests --ds=config.settings_sharded -m sharded tests/test_s4_return_refusal_after_the_cut.py
"""
import pytest
from django.conf import settings

from tests.test_d6_home_hall_acts_on_a_soul_abroad import _plan_url, _read
from tests.test_s4_residence_hall_acts_after_the_cut import (
    PAIRS,
    _abroad_after_the_cut,
    _halls,
    _master,
    _pending,
    _quiet,
)
from tests.test_shard_sync import sharded
from tests.test_sharded_writes import _in_hall, cut


def _after_commits(capture):
    """Run the on-commit callbacks of every database (a shard's business transaction registers its own: the
    notices `record_blocked_return` sends after the commit)."""
    from contextlib import ExitStack

    stack = ExitStack()
    for alias in settings.DATABASES:
        stack.enter_context(capture(using=alias, execute=True))
    return stack


def _outbox_count():
    from apps.tenants.models import ShardOutbox

    return sum(ShardOutbox._base_manager.using(a).count() for a in settings.DATABASES)


def _open_case_at_the_residence(x):
    r = x["res_admin"].post("/api/v1/judgment/", {"soul": str(x["soul"].pk)}, format="json")
    assert r.status_code == 201, (x["where"], r.status_code, r.content[:2000])
    # Relayed, not synced: the home hall reads its own master, and control's mirror lags until the debounced sync.
    from apps.tenants.shard_saga import relay_until_quiet

    relay_until_quiet()
    return r.json()["id"]


def _withdraw_case(x, case_id):
    r = x["res_admin"].delete(f"/api/v1/judgment/{case_id}/")
    assert r.status_code in (200, 204), (x["where"], r.status_code, r.content[:2000])
    _quiet(x["where"])


def _cancel(x, tag):
    return x["home_admin"].post(_plan_url("cancel", pk=x["plan"].pk), {"reason": "赦免"}, format="json",
                                HTTP_IDEMPOTENCY_KEY=f"n2-{tag}")


def _plan_row(x):
    from apps.sentence_plan.models import SentencePlan

    return SentencePlan._base_manager.using(_master(x["home"])).get(pk=x["plan"].pk)


def _stop(x, node):
    from apps.sentence_plan.models import SentenceNode

    return SentenceNode._base_manager.using(_master(x["home"])).get(pk=node.pk)


def _blocked_events(x):
    from apps.events.models import SoulEvent

    return list({e.pk: e for a in settings.DATABASES for e in SoulEvent._base_manager.using(a).filter(
        soul_id=x["soul"].pk, payload__action="DISPATCH_RETURN_BLOCKED")}.values())


def _blocked_notices(x):
    from apps.notifications.models import UserNotification

    return list(UserNotification._base_manager.using("default").filter(  # a control table
        notification_type="DISPATCH_RETURN_BLOCKED", related_id__in=[str(x["soul"].pk), *x.get("dispatch_ids", [])]))


def _assert_home_and_done(x, where):
    from apps.ledger.services import REBIRTH_CAPABLE_CIVILIZATIONS
    from apps.sentence_plan.models import SentencePlanStatus
    from apps.souls.models import Soul, SoulState

    assert _plan_row(x).status == SentencePlanStatus.CANCELLED, f"{where}: plan {_plan_row(x).status}"
    soul = Soul._base_manager.using(_master(x["home"])).get(pk=x["soul"].pk)
    want = SoulState.REINCARNATING if x["pair"][0] in REBIRTH_CAPABLE_CIVILIZATIONS else SoulState.SETTLED
    assert (soul.tenant_id, soul.current_state) == (x["home"].pk, want), (where, soul.tenant_id, soul.current_state)
    assert not Soul._base_manager.using(_master(x["res"])).filter(pk=soul.pk).exists(), \
        f"{where}: the residence still holds the soul"


def _assert_abroad(x, where):
    from apps.souls.models import Soul

    assert Soul._base_manager.using(_master(x["res"])).get(pk=x["soul"].pk).tenant_id == x["res"].pk, \
        f"{where}: the soul left the residence"


# ---- N-2: the residence has an open case when the home hall cancels -----------------------------------------------------

@sharded
@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p[0]}-{p[1]}")
def test_the_home_hall_cancelling_while_the_residence_has_an_open_case_is_409_and_writes_nothing(pair):
    from apps.sentence_plan.models import SentenceNodeStatus, SentencePlanStatus

    x = _halls(pair)
    where = x["where"]
    with cut(*pair):
        node = _abroad_after_the_cut(x, f"p{pair[0][:2]}")
        case = _open_case_at_the_residence(x)
        sent = _outbox_count()
        r = _cancel(x, f"p1{pair[0]}")
        assert r.status_code == 409, (where, r.status_code, r.content[:2000])
        assert r.json()["code"] == "open_judgment" and r.json()["open_judgment_ids"] == [case], (where, r.json())
        # Nothing written, nothing sent: the plan and its stop as they were, no cancel_reason, the soul abroad.
        assert _outbox_count() == sent, f"{where}: the refused cancel sent a message"
        plan = _plan_row(x)
        assert (plan.status, plan.cancel_reason) == (SentencePlanStatus.ACTIVE, ""), (where, plan.status,
                                                                                     plan.cancel_reason)
        assert _stop(x, node).status == SentenceNodeStatus.ACTIVE, f"{where}: stop 2 {_stop(x, node).status}"
        _assert_abroad(x, where)
        assert not _blocked_events(x), where
        # The case withdrawn, the same cancel goes through.
        _withdraw_case(x, case)
        r = _cancel(x, f"p2{pair[0]}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _quiet(where)
        _assert_home_and_done(x, where)
        assert not _blocked_events(x), f"{where}: a return blocked recorded for a cancel that was refused up front"


@sharded
@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p[0]}-{p[1]}")
def test_a_case_opened_at_the_residence_after_the_cancel_answered_is_recorded_and_the_cancel_asked_again_brings_it_home(
        pair, django_capture_on_commit_callbacks):
    from apps.dispatch import transfer
    from apps.sentence_plan.models import SentenceNodeStatus, SentencePlanStatus
    from apps.tenants.models import ShardMessageState, ShardOutbox

    x = _halls(pair)
    where = x["where"]
    with cut(*pair):
        node = _abroad_after_the_cut(x, f"r{pair[0][:2]}")
        x["dispatch_ids"] = [str(node.dispatch_record_id)]
        r = _cancel(x, f"r1{pair[0]}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        [requested] = _pending(transfer.RETURN_REQUESTED)
        # Before the relay delivers the return, the residence opens a case on the soul (it is not moving yet).
        r = x["res_admin"].post("/api/v1/judgment/", {"soul": str(x["soul"].pk)}, format="json")
        assert r.status_code == 201, (where, r.status_code, r.content[:2000])
        case = r.json()["id"]
        with _after_commits(django_capture_on_commit_callbacks):  # the notices go out after the relay's commit
            _quiet(where)
        # The residence would not let it go: the soul stays, and the refusal is on the soul's timeline and in the
        # officers' notifications -- not a log line.
        _assert_abroad(x, where)
        state = ShardOutbox._base_manager.using(_master(x["home"])).get(pk=requested.pk).state
        assert state == ShardMessageState.DONE, f"{where}: the return request is {state}"
        [event] = _blocked_events(x)
        assert event.tenant_id == x["res"].pk, where
        assert event.payload["open_judgment_ids"] == [case] and event.payload["code"] == "open_judgment", \
            (where, event.payload)
        notices = _blocked_notices(x)
        tenants = {n.user.tenant_id for n in notices}
        assert x["home"].pk in tenants, f"{where}: the home hall's officers were not told ({tenants})"
        plan = _plan_row(x)
        assert plan.status == SentencePlanStatus.ACTIVE and plan.cancel_reason == "赦免", (where, plan.status)
        assert _stop(x, node).status == SentenceNodeStatus.ABORTED, where
        # The case withdrawn, the cancel asked again: home, the plan CANCELLED; no second notice.
        _withdraw_case(x, case)
        r = _cancel(x, f"r2{pair[0]}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        with _after_commits(django_capture_on_commit_callbacks):
            _quiet(where)
        _assert_home_and_done(x, where)
        assert len(_blocked_events(x)) == 1 and len(_blocked_notices(x)) == len(notices), where


# ---- N-4: a residence without a plan ------------------------------------------------------------------------------------

@sharded
@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p[0]}-{p[1]}")
def test_a_residence_without_a_plan_ended_by_its_disposition_moves_the_soul_on_at_home(pair):
    from django.urls import reverse

    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.views import DispatchRecordViewSet
    from apps.disposition.models import Disposition
    from apps.ledger.services import REBIRTH_CAPABLE_CIVILIZATIONS
    from apps.souls.models import Soul, SoulState
    from tests.test_cross_civilization_saga import _approved
    from tests.test_d6_home_hall_acts_on_a_soul_abroad import _client, _route

    x = _halls(pair)
    where = x["where"]
    with cut(*pair):
        soul, record = _approved({"seed": f"n4{pair[0][:2]}", "src": pair[0], "tgt": pair[1], "realm": False},
                                 {pair[0]: x["home"], pair[1]: x["res"]})
        res_admin = _client(x["res"], f"n4r_{pair[0][:2]}")
        r = res_admin.post(reverse(_route(DispatchRecordViewSet, "execute"), kwargs={"pk": record.pk}), {},
                           format="json", HTTP_IDEMPOTENCY_KEY=f"n4-exec-{pair[0]}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _quiet(where, mirror=x["res"])
        assert Soul._base_manager.using(_master(x["res"])).get(pk=soul.pk).tenant_id == x["res"].pk, where
        with _in_hall(x["res"]):
            disposition = Disposition.objects.create(
                soul=Soul._base_manager.using(_master(x["res"])).get(pk=soul.pk), tenant=x["res"])
        _quiet(where, mirror=x["res"])
        r = res_admin.post(f"/api/v1/disposition/{disposition.pk}/execute/", {}, format="json",
                           HTTP_IDEMPOTENCY_KEY=f"n4-disp-{pair[0]}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _quiet(where)
        home = Soul._base_manager.using(_master(x["home"])).get(pk=soul.pk)
        want = SoulState.REINCARNATING if pair[0] in REBIRTH_CAPABLE_CIVILIZATIONS else SoulState.SETTLED
        assert (home.tenant_id, home.current_state) == (x["home"].pk, want), (where, home.tenant_id,
                                                                             home.current_state)
        assert not Soul._base_manager.using(_master(x["res"])).filter(pk=soul.pk).exists(), where
        assert _read(lambda: DispatchRecord.all_objects.get(pk=record.pk).status) == DispatchStatus.RETURNED, where
        assert Disposition._base_manager.using(_master(x["res"])).get(pk=disposition.pk).is_executed, where


# ---- §3.4: the residence concludes an amendment case --------------------------------------------------------------------

@sharded
@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p[0]}-{p[1]}")
def test_the_residence_concluding_an_amendment_files_the_request_on_the_home_halls_master(pair):
    from apps.judgment.models import Judgment
    from apps.sentence_plan.models import SentencePlanRequest, SentenceRequestStatus

    x = _halls(pair)
    where = x["where"]
    with cut(*pair):
        _abroad_after_the_cut(x, f"a{pair[0][:2]}")
        case = _open_case_at_the_residence(x)
        assert _read(lambda: Judgment.all_objects.get(pk=case).kind) == "AMENDMENT", where
        r = x["res_admin"].post(f"/api/v1/judgment/{case}/conclude/", {
            "verdict": "FAILED", "notes": "当地加刑",
            "plan_changes": {"add": [{"realm_code": x["code"], "sentence_years": 3}]}}, format="json")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _quiet(where)
        [req] = SentencePlanRequest._base_manager.using(_master(x["home"])).filter(plan_id=x["plan"].pk)
        assert (req.status, req.from_tenant_code, str(req.requested_by_judgment_id)) == (
            SentenceRequestStatus.PENDING, x["res"].code, case), (where, req.status, req.from_tenant_code)
        assert not SentencePlanRequest._base_manager.using(_master(x["res"])).filter(plan_id=x["plan"].pk).exists(), \
            f"{where}: the request was written on the residence's master"
        assert Judgment._base_manager.using(_master(x["res"])).get(pk=case).is_final, where
        _assert_abroad(x, where)
        # The home's judge decides it, as on one database.
        r = x["home_admin"].post(_plan_url("decide", pk=x["plan"].pk, request_id=req.pk), {"decision": "REJECT"},
                                 format="json")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        _quiet(where)
