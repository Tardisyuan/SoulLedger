"""
Concurrency tests — verifies pessimistic locking prevents race conditions.

Uses transaction=True so each test's DB writes are committed and visible
to threads on separate connections.

Every test here once carried `@pytest.mark.xfail(reason="SQLite does not
support concurrent writes")`, and every one of them XPASSed. That marker was
wrong twice over. A non-strict xfail reports xpassed and exits 0, so "the
locking works" and "the locking is broken" produced identical build output;
and the tests do not, in fact, expect-fail on SQLite — they mostly pass there.

Measured, 25 consecutive runs of this file on SQLite in-memory:

    test_concurrent_die_only_one_succeeds          6/25 failed
    test_concurrent_state_transition_to_disposed   4/25 failed
    test_concurrent_approve_only_one_succeeds      4/25 failed
    test_concurrent_approve_and_reject             2/25 failed
    test_concurrent_invalid_transition_rejected    0/25 failed

So four of them are flaky, not expected-failure: on SQLite the losing thread
usually loses cleanly (re-reads the row, sees the new state, declines the
transition) but sometimes trips over the whole-table write lock first and
raises OperationalError("database table is locked: souls_soul") before it can
re-read. Those four are now skipped on SQLite with that as the stated reason —
the select_for_update() row locking they actually test only exists on
PostgreSQL, which is what CI runs. The fifth races two threads through a
transition the state machine rejects outright, so no write is ever attempted,
no lock is ever contended, and it runs everywhere; its marker is simply gone.
"""
import threading

import pytest
from django.db import connection

# select_for_update() is a row lock on PostgreSQL and a no-op on SQLite, which
# serialises writers with a table lock instead. Skipping is deliberate and not
# a softer xfail: on SQLite these assertions are nondeterministic, so keeping
# them would trade a silent gate for an intermittently red one.
SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = (
    "Requires real row-level locking (select_for_update). On SQLite the "
    "losing thread intermittently raises OperationalError('database table is "
    "locked') instead of blocking and re-reading, making this assertion "
    "nondeterministic — measured flaky in 2-6 of 25 runs. Runs on PostgreSQL, "
    "which is what CI uses."
)

from apps.authentication.models import User
from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


@pytest.fixture
def cn_tenant(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU_CONC",
        defaults={"display_name": "Chinese Diyu (Concurrency Test)", "dispatch_enabled": True},
    )
    return tenant


@pytest.fixture
def eu_tenant(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="EU_HEAVEN_CONC",
        defaults={"display_name": "European Heaven (Concurrency Test)", "dispatch_enabled": True},
    )
    return tenant


@pytest.fixture
def cn_admin(db, cn_tenant):
    return User.objects.create_user(
        username="conc_cn_admin",
        password="admin123",
        role="ADMIN",
        tenant=cn_tenant,
    )


@pytest.fixture
def eu_admin(db, eu_tenant):
    return User.objects.create_user(
        username="conc_eu_admin",
        password="admin123",
        role="ADMIN",
        tenant=eu_tenant,
    )


@pytest.fixture
def cn_soul(db, cn_tenant):
    return Soul.objects.create(
        name="Concurrency Soul",
        tenant=cn_tenant,
        current_state=SoulState.ALIVE,
        birth_date="1990-01-15",
    )


# Use transaction=True so committed data is visible to threads.
@pytest.mark.django_db(transaction=True)
class TestDispatchApprovalConcurrency:
    """Two users cannot approve the same dispatch simultaneously."""

    @pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
    def test_concurrent_approve_only_one_succeeds(self, db, cn_tenant, eu_tenant, cn_soul, cn_admin, eu_admin):
        """
        Scenario:
        1. User A proposes a dispatch.
        2. Two threads both try to approve it at the same time.
        3. Exactly one approval succeeds, the other fails.
        """
        dr = DispatchService.propose(cn_tenant, eu_tenant, cn_soul, cn_admin, "Concurrency test")
        assert dr.status == DispatchStatus.PROPOSED

        results = {"a": None, "b": None}
        errors = {"a": None, "b": None}

        def approve_as(label, user):
            try:
                # Each thread re-reads from DB on its own connection
                record = DispatchRecord.objects.get(pk=dr.pk)
                record = DispatchService.approve(record, user)
                results[label] = record.status
            except Exception as e:
                errors[label] = str(e)

        thread_a = threading.Thread(target=approve_as, args=("a", eu_admin))
        thread_b = threading.Thread(target=approve_as, args=("b", eu_admin))

        thread_a.start()
        thread_b.start()
        thread_a.join(timeout=10)
        thread_b.join(timeout=10)

        success_count = sum(1 for v in results.values() if v == DispatchStatus.APPROVED)
        fail_count = sum(1 for e in errors.values() if e is not None)

        assert success_count == 1, (
            f"Expected exactly 1 successful approval, got {success_count}. "
            f"Results: {results}, Errors: {errors}"
        )
        assert fail_count == 1, (
            f"Expected exactly 1 failed approval, got {fail_count}. "
            f"Results: {results}, Errors: {errors}"
        )

        dr.refresh_from_db()
        assert dr.status == DispatchStatus.APPROVED

    @pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
    def test_concurrent_approve_and_reject(self, db, cn_tenant, eu_tenant, cn_soul, cn_admin, eu_admin):
        """
        One thread tries to approve, another tries to reject.
        Exactly one should succeed.
        """
        dr = DispatchService.propose(cn_tenant, eu_tenant, cn_soul, cn_admin, "Approve vs Reject")
        assert dr.status == DispatchStatus.PROPOSED

        results = {"approve": None, "reject": None}
        errors = {"approve": None, "reject": None}

        def try_approve():
            try:
                record = DispatchRecord.objects.get(pk=dr.pk)
                record = DispatchService.approve(record, eu_admin)
                results["approve"] = record.status
            except Exception as e:
                errors["approve"] = str(e)

        def try_reject():
            try:
                record = DispatchRecord.objects.get(pk=dr.pk)
                record = DispatchService.reject(record, eu_admin, "Rejected concurrently")
                results["reject"] = record.status
            except Exception as e:
                errors["reject"] = str(e)

        thread_approve = threading.Thread(target=try_approve)
        thread_reject = threading.Thread(target=try_reject)

        thread_approve.start()
        thread_reject.start()
        thread_approve.join(timeout=10)
        thread_reject.join(timeout=10)

        success_count = sum(
            1 for v in results.values()
            if v in (DispatchStatus.APPROVED, DispatchStatus.REJECTED)
        )
        assert success_count == 1, (
            f"Expected exactly 1 successful transition, got {success_count}. "
            f"Results: {results}, Errors: {errors}"
        )

        dr.refresh_from_db()
        assert dr.status in (DispatchStatus.APPROVED, DispatchStatus.REJECTED)


@pytest.mark.django_db(transaction=True)
class TestSoulStateTransitionConcurrency:
    """Concurrent soul state transitions: only one should succeed."""

    @pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
    def test_concurrent_die_only_one_succeeds(self, db, cn_tenant):
        """
        Two threads both try to call soul.die() on the same ALIVE soul.
        Only the first should transition to JUDGING; the second should fail.
        """
        soul = Soul.objects.create(
            name="Race Soul",
            tenant=cn_tenant,
            current_state=SoulState.ALIVE,
            birth_date="1990-01-01",
        )

        results = {"a": None, "b": None}

        def attempt_die(label):
            s = Soul.objects.get(pk=soul.pk)
            result = s.die()
            results[label] = "JUDGING" if result is not None else "UNCHANGED"

        thread_a = threading.Thread(target=attempt_die, args=("a",))
        thread_b = threading.Thread(target=attempt_die, args=("b",))

        thread_a.start()
        thread_b.start()
        thread_a.join(timeout=10)
        thread_b.join(timeout=10)

        success_count = sum(1 for v in results.values() if v == "JUDGING")
        assert success_count == 1, (
            f"Expected exactly 1 successful die(), got {success_count}. "
            f"Results: {results}"
        )

        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING
        assert soul.death_date is not None

    @pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
    def test_concurrent_state_transition_to_disposed(self, db, cn_tenant):
        """
        Two threads try to transition the same soul from JUDGING -> DISPOSED.
        Only one should succeed via select_for_update locking.
        """
        soul = Soul.objects.create(
            name="Dispose Race Soul",
            tenant=cn_tenant,
            current_state=SoulState.JUDGING,
            birth_date="1985-06-15",
            death_date="2025-01-01",
        )

        results = {"a": None, "b": None}

        def attempt_dispose(label):
            s = Soul.objects.get(pk=soul.pk)
            ok = s.transition_to(SoulState.DISPOSED, reason=f"Concurrent dispose by {label}")
            results[label] = "DISPOSED" if ok else "UNCHANGED"

        thread_a = threading.Thread(target=attempt_dispose, args=("a",))
        thread_b = threading.Thread(target=attempt_dispose, args=("b",))

        thread_a.start()
        thread_b.start()
        thread_a.join(timeout=10)
        thread_b.join(timeout=10)

        success_count = sum(1 for v in results.values() if v == "DISPOSED")
        assert success_count == 1, (
            f"Expected exactly 1 successful transition_to(DISPOSED), got {success_count}. "
            f"Results: {results}"
        )

        soul.refresh_from_db()
        assert soul.current_state == SoulState.DISPOSED

    # No backend guard, on purpose. Both threads are rejected by
    # can_transition_to before any UPDATE is issued, so nothing ever contends
    # for a lock — the old "SQLite does not support concurrent writes" xfail
    # here was copy-paste. 25/25 green on SQLite.
    def test_concurrent_invalid_transition_rejected(self, db, cn_tenant):
        """
        Two threads try to skip states (ALIVE -> REINCARNATING).
        Both should fail because that is not a valid transition.
        """
        soul = Soul.objects.create(
            name="Skip Race Soul",
            tenant=cn_tenant,
            current_state=SoulState.ALIVE,
            birth_date="1995-03-20",
        )

        results = {"a": None, "b": None}

        def attempt_skip(label):
            s = Soul.objects.get(pk=soul.pk)
            ok = s.transition_to(SoulState.REINCARNATING, reason=f"Skip attempt by {label}")
            results[label] = "REINCARNATING" if ok else "REJECTED"

        thread_a = threading.Thread(target=attempt_skip, args=("a",))
        thread_b = threading.Thread(target=attempt_skip, args=("b",))

        thread_a.start()
        thread_b.start()
        thread_a.join(timeout=10)
        thread_b.join(timeout=10)

        assert results["a"] == "REJECTED", f"Thread A should have been rejected, got {results['a']}"
        assert results["b"] == "REJECTED", f"Thread B should have been rejected, got {results['b']}"

        soul.refresh_from_db()
        assert soul.current_state == SoulState.ALIVE


# ---------------------------------------------------------------------------
# BD-09: two decisions on *different* nodes of one workflow.
#
# `complete_node` decided the workflow's next state from the in-memory copy the
# caller loaded before the transaction, and its `self.save()` sat outside the
# atomic block. A copy loaded before somebody else's refusal passed the terminal
# check and wrote IN_PROGRESS over REJECTED.
#
# Measured on PostgreSQL 16 while writing this: the node's `select_for_update()`
# already blocked the second decision, because `ApprovalNode.Meta.ordering`
# includes `workflow__created_at` and the resulting JOIN makes `FOR UPDATE` lock
# the workflow row too. So the rows were serialised *by accident of an ordering
# clause*, and the stale copy still won once it got the lock. The workflow lock
# is now explicit and the copy is re-read under it.
# ---------------------------------------------------------------------------


def _three_node_workflow(tenant):
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus, NodeStatus

    soul = Soul.objects.create(name="Two Benches", tenant=tenant, current_state=SoulState.JUDGING)
    wf = ApprovalWorkflow.objects.create(
        workflow_name="two benches", soul=soul, tenant=tenant, status=ApprovalWorkflowStatus.IN_PROGRESS,
    )
    nodes = [
        ApprovalNode.objects.create(workflow=wf, node_name=f"n{i}", node_order=i, node_type="TRIAL", status=NodeStatus.PENDING)
        for i in (1, 2, 3)
    ]
    wf.current_node = nodes[0]
    wf.save()
    return wf, nodes


@pytest.mark.django_db(transaction=True)
class TestWorkflowDecisionConcurrency:
    def test_a_stale_copy_cannot_undo_a_refusal(self, db, cn_tenant):
        """The serial shape of the defect, so it is checked on every engine.

        Two requests load the workflow; the first refuses node 1 (the workflow is
        now REJECTED); the second, holding the copy it loaded before that, decides
        node 2. Unfixed, the terminal check read the stale in-memory status and
        the save overwrote REJECTED with IN_PROGRESS — the refusal erased.
        """
        from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus

        wf, (n1, n2, _) = _three_node_workflow(cn_tenant)
        first = ApprovalWorkflow.objects.get(pk=wf.pk)
        second = ApprovalWorkflow.objects.get(pk=wf.pk)

        assert first.complete_node(n1.id, "FAILED", "refused") is True
        assert second.complete_node(n2.id, "PASSED", "stale copy") is False

        wf.refresh_from_db()
        assert wf.status == ApprovalWorkflowStatus.REJECTED
        assert wf.current_node_id is None

    @pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
    def test_a_decision_blocked_on_the_lock_does_not_undo_a_refusal(self, db, cn_tenant):
        """The same thing with the second decision actually waiting on the lock.

        A refuses node 1 and keeps its transaction open for a moment; B, whose
        copy predates A's commit, decides node 2 and has to wait.
        """
        import time
        from unittest.mock import patch

        from django.db import connections

        from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus

        wf, (n1, n2, _) = _three_node_workflow(cn_tenant)
        results = {}
        both_have_copies = threading.Barrier(2, timeout=10)
        a_decided = threading.Event()
        b_waited = {"seconds": None}
        real_save = ApprovalNode.save

        def save_then_linger(node, *args, **kwargs):
            real_save(node, *args, **kwargs)
            if threading.current_thread().name == "a":
                a_decided.set()
                time.sleep(1.0)  # still inside A's atomic block

        def decide(node, verdict):
            label = threading.current_thread().name
            try:
                copy = ApprovalWorkflow.objects.get(pk=wf.pk)
                both_have_copies.wait()
                if label == "b":
                    assert a_decided.wait(timeout=10), "A never reached its decision"
                    started = time.monotonic()
                results[label] = copy.complete_node(node.id, verdict, f"by {label}")
                if label == "b":
                    b_waited["seconds"] = time.monotonic() - started
            except Exception as exc:  # surfaced in the assertions below
                results[label] = repr(exc)
            finally:
                connections.close_all()

        with patch.object(ApprovalNode, "save", save_then_linger):
            threads = [
                threading.Thread(target=decide, args=(n1, "FAILED"), name="a"),
                threading.Thread(target=decide, args=(n2, "PASSED"), name="b"),
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

        assert b_waited["seconds"] is not None and b_waited["seconds"] > 0.5, (
            f"B did not wait on A's lock ({b_waited}, {results}); the harness never "
            f"produced the overlap, so a green here would prove nothing"
        )
        assert results == {"a": True, "b": False}, (
            f"{results}: B's copy predates A's refusal and must be refused once it "
            f"gets the lock, not recorded on top of it"
        )
        wf.refresh_from_db()
        assert wf.status == ApprovalWorkflowStatus.REJECTED
        assert wf.current_node_id is None


# ---------------------------------------------------------------------------
# BD-15: `POST /disposition/{id}/execute/` ran the service outside its own lock.
#
# The view locked the disposition, checked `is_executed`, and let the
# `atomic()` block end at `disposition = locked` — then called
# `DispositionService.execute` with the lock already released, under a comment
# saying the check "has to happen under the lock". Two executors could both
# pass the check; what stopped a double execution was only `transition_to`'s
# own soul-row lock, and the loser was told 409 ("soul not in a state this
# disposition can act on") instead of 400 ("Already executed").
# ---------------------------------------------------------------------------


def _executable_disposition(tenant):
    from apps.disposition.models import Disposition

    soul = Soul.objects.create(
        name="BD-15 probe", tenant=tenant, current_state=SoulState.DISPOSED
    )
    return Disposition.objects.create(soul=soul, tenant=tenant)


def _admin_client(tenant, username):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    user = User.objects.create_user(
        username=username, password="x", role="ADMIN", tenant=tenant
    )
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db(transaction=True)
class TestDispositionExecuteHoldsItsLock:
    def test_the_service_runs_inside_the_views_locked_transaction(self, db, cn_tenant):
        """Serial, so it runs on every engine.

        `transaction=True` means nothing outside the view is in a transaction,
        so `in_atomic_block` at the moment the service is entered answers
        exactly "is the view's `select_for_update` block still open".
        """
        from unittest.mock import patch

        from django.db import transaction

        from apps.disposition.services import DispositionService

        disposition = _executable_disposition(cn_tenant)
        client = _admin_client(cn_tenant, "bd15_serial")
        real_execute = DispositionService.execute
        seen = []

        def spy(d):
            seen.append(transaction.get_connection().in_atomic_block)
            return real_execute(d)

        with patch.object(DispositionService, "execute", spy):
            response = client.post(
                f"/api/v1/disposition/{disposition.id}/execute/", {}, format="json"
            )

        assert response.status_code == 200, response.data
        assert seen == [True], (
            f"DispositionService.execute ran with in_atomic_block={seen}: the "
            "disposition row lock was already released, so a second executor "
            "could pass the is_executed check before this one wrote it"
        )

    @pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
    def test_a_second_executor_waits_and_is_told_already_executed(self, db, cn_tenant):
        """The same thing with two real connections.

        A enters the service and lingers; B, arriving meanwhile, must wait on
        the disposition row lock and then see `is_executed=True` (400). With
        the lock released early B does not wait at all: it executes first and
        A gets the 409.
        """
        import time
        from unittest.mock import patch

        from django.db import connections

        from apps.disposition.services import DispositionService

        disposition = _executable_disposition(cn_tenant)
        clients = {
            "a": _admin_client(cn_tenant, "bd15_a"),
            "b": _admin_client(cn_tenant, "bd15_b"),
        }
        real_execute = DispositionService.execute
        a_inside = threading.Event()
        results = {}
        b_waited = {"seconds": None}

        def lingering_execute(d):
            if threading.current_thread().name == "a":
                a_inside.set()
                time.sleep(1.0)
            return real_execute(d)

        def post(label):
            try:
                if label == "b":
                    assert a_inside.wait(timeout=10), "A never reached the service"
                    started = time.monotonic()
                response = clients[label].post(
                    f"/api/v1/disposition/{disposition.id}/execute/", {}, format="json"
                )
                results[label] = response.status_code
                if label == "b":
                    b_waited["seconds"] = time.monotonic() - started
            except Exception as exc:  # surfaced in the assertions below
                results[label] = repr(exc)
            finally:
                connections.close_all()

        with patch.object(DispositionService, "execute", lingering_execute):
            threads = [threading.Thread(target=post, args=(n,), name=n) for n in ("a", "b")]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

        assert results == {"a": 200, "b": 400}, (
            f"{results}: the first executor should win and the second should be "
            f"told 'Already executed' after waiting for it, not race it"
        )
        assert b_waited["seconds"] is not None and b_waited["seconds"] > 0.5, (
            f"B did not wait on A's lock ({b_waited})"
        )
        disposition.refresh_from_db()
        assert disposition.is_executed is True


# ---------------------------------------------------------------------------
# The same shape one call further down: `ReincarnationService.execute`.
#
# BD-15 moved `DispositionService.execute` under the disposition lock and left
# the very next line, `ReincarnationService.execute(disposition)`, after the
# `atomic()` block. By then the soul was committed as REINCARNATING with its
# row lock released, so a rebirth could run to completion in the gap and
# `REINCARNATION_TRIGGERED` was logged *after* `REINCARNATION_COMPLETED`, for a
# soul that was already ALIVE again. The soul used is a real Chinese one
# (`CN_DIYU`): this file's `cn_tenant` resolves to no civilization, which would
# send the disposition to SETTLED and never reach the rebirth path.
# ---------------------------------------------------------------------------


def _rebirth_capable_disposition():
    from apps.disposition.models import Disposition

    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "Chinese Diyu"}
    )
    soul = Soul.objects.create(
        name="rebirth probe", tenant=tenant, current_state=SoulState.DISPOSED
    )
    return tenant, Disposition.objects.create(soul=soul, tenant=tenant)


@pytest.mark.django_db(transaction=True)
class TestReincarnationTriggerHoldsTheDispositionLock:
    def test_the_rebirth_trigger_runs_inside_the_views_locked_transaction(self, db):
        """Serial, so it runs on every engine. Same probe as BD-15's."""
        from unittest.mock import patch

        from django.db import transaction

        from apps.reincarnation.services import ReincarnationService

        tenant, disposition = _rebirth_capable_disposition()
        client = _admin_client(tenant, "rt_serial")
        real_execute = ReincarnationService.execute
        seen = []

        def spy(d):
            seen.append(transaction.get_connection().in_atomic_block)
            return real_execute(d)

        with patch.object(ReincarnationService, "execute", spy):
            response = client.post(
                f"/api/v1/disposition/{disposition.id}/execute/", {}, format="json"
            )

        assert response.status_code == 200, response.data
        assert seen == [True], (
            f"ReincarnationService.execute ran with in_atomic_block={seen}: the "
            "disposition's execution had already committed and released the "
            "soul, so a rebirth could complete before the trigger was logged"
        )

    @pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
    def test_a_rebirth_cannot_complete_between_execution_and_its_trigger(self, db):
        """Two real connections.

        A executes the disposition and lingers inside the rebirth trigger; B,
        arriving meanwhile, asks `/reincarnation/reborn/` for the same soul.
        B must wait on the soul row A still holds, and the event log must say
        TRIGGERED before anything says COMPLETED. (B then gets 409: it read
        the soul as DISPOSED before waiting, and REINCARNATING -> REINCARNATING
        is not a move. A retry succeeds. That answer is incidental and not
        asserted here.) With the trigger outside the lock B does not wait: it
        completes the rebirth first and A logs TRIGGERED afterwards.
        """
        import time
        from unittest.mock import patch

        from django.db import connections

        from apps.events.models import SoulEvent
        from apps.reincarnation.services import ReincarnationService

        tenant, disposition = _rebirth_capable_disposition()
        soul_id = disposition.soul_id
        clients = {
            "a": _admin_client(tenant, "rt_a"),
            "b": _admin_client(tenant, "rt_b"),
        }
        real_execute = ReincarnationService.execute
        a_inside = threading.Event()
        results = {}
        b_waited = {"seconds": None}

        def lingering_execute(d):
            if threading.current_thread().name == "a":
                a_inside.set()
                time.sleep(1.0)
            return real_execute(d)

        def post(label):
            try:
                if label == "a":
                    response = clients["a"].post(
                        f"/api/v1/disposition/{disposition.id}/execute/", {}, format="json"
                    )
                else:
                    assert a_inside.wait(timeout=10), "A never reached the trigger"
                    started = time.monotonic()
                    response = clients["b"].post(
                        "/api/v1/reincarnation/reborn/",
                        {"soul_id": str(soul_id)},
                        format="json",
                    )
                    b_waited["seconds"] = time.monotonic() - started
                results[label] = response.status_code
            except Exception as exc:  # surfaced in the assertions below
                results[label] = repr(exc)
            finally:
                connections.close_all()

        with patch.object(ReincarnationService, "execute", lingering_execute):
            threads = [threading.Thread(target=post, args=(n,), name=n) for n in ("a", "b")]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

        order = list(
            SoulEvent.all_objects.filter(
                soul_id=soul_id, event_type__startswith="REINCARNATION_"
            )
            .order_by("create_time")
            .values_list("event_type", flat=True)
        )
        assert results.get("a") == 200, results
        assert order[:1] == ["REINCARNATION_TRIGGERED"], (
            f"events {order} (results {results}): the rebirth completed before "
            f"the execution that triggered it was logged"
        )
        assert b_waited["seconds"] is not None and b_waited["seconds"] > 0.5, (
            f"B did not wait on A's soul lock ({b_waited}, results {results})"
        )


# ---------------------------------------------------------------------------
# 审判认领(apps/judgment/claims.py):两个官员同时认领同一件案子,只有一个赢。
#
# 规则在 `_apply_claim` 里:锁到案子这一行之后再读 `claimed_by`,非空且不是自己就
# 409 `already_claimed`。锁在前、读在后,输家读到的就是赢家刚提交的认领;锁一旦被
# 挪走(或读挪到锁前),两个人都读到空,都写下自己,后写的覆盖先写的,两个人都拿到 200。
# 串行的那一半(锁到之后读到别人的认领 → 409)在 tests/test_judgment_claim.py,
# 每个引擎都跑。
# ---------------------------------------------------------------------------


def _pending_case(tenant):
    from apps.judgment.models import Judgment

    soul = Soul.objects.create(name="claim probe", tenant=tenant, current_state=SoulState.JUDGING)
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=tenant)


@pytest.mark.django_db(transaction=True)
class TestJudgmentClaimConcurrency:
    def test_the_claim_check_runs_inside_the_row_locked_transaction(self, db, cn_tenant):
        """Serial, so it runs on every engine. Same probe as BD-15's: with
        `transaction=True` nothing outside the service is atomic, so
        `in_atomic_block` at the moment the rule is applied answers exactly
        "is the `select_for_update` block still open"."""
        from unittest.mock import patch

        from django.db import transaction

        from apps.judgment import claims

        case = _pending_case(cn_tenant)
        client = _admin_client(cn_tenant, "claim_serial")
        real_apply = claims._apply_claim
        seen = []

        def spy(judgment, user):
            seen.append(transaction.get_connection().in_atomic_block)
            return real_apply(judgment, user)

        with patch.object(claims, "_apply_claim", spy):
            response = client.post(f"/api/v1/judgment/{case.id}/claim/", {}, format="json")

        assert response.status_code == 200, response.data
        assert seen == [True], (
            f"_apply_claim ran with in_atomic_block={seen}: the row lock was already "
            "released, so a second claimer could read the case as unclaimed"
        )

    @pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
    def test_two_officers_claiming_one_case_at_once_exactly_one_wins(self, db, cn_tenant):
        """Two real connections.

        A takes the row lock and lingers inside the rule; B, arriving meanwhile,
        must wait on that lock and then read A's claim: 409 `already_claimed`.
        Without the lock B does not wait, reads the case as unclaimed, and both
        get 200 — the later write silently replacing the earlier.
        """
        import time
        from unittest.mock import patch

        from django.db import connections

        from apps.judgment import claims
        from apps.judgment.models import Judgment

        case = _pending_case(cn_tenant)
        clients = {
            "a": _admin_client(cn_tenant, "claim_a"),
            "b": _admin_client(cn_tenant, "claim_b"),
        }
        real_apply = claims._apply_claim
        a_inside = threading.Event()
        results = {}
        codes = {}
        b_waited = {"seconds": None}

        def lingering_apply(judgment, user):
            if threading.current_thread().name == "a":
                a_inside.set()
                time.sleep(1.0)
            return real_apply(judgment, user)

        def post(label):
            try:
                if label == "b":
                    assert a_inside.wait(timeout=10), "A never reached the claim rule"
                    started = time.monotonic()
                response = clients[label].post(f"/api/v1/judgment/{case.id}/claim/", {}, format="json")
                results[label] = response.status_code
                codes[label] = response.data.get("code")
                if label == "b":
                    b_waited["seconds"] = time.monotonic() - started
            except Exception as exc:  # surfaced in the assertions below
                results[label] = repr(exc)
            finally:
                connections.close_all()

        with patch.object(claims, "_apply_claim", lingering_apply):
            threads = [threading.Thread(target=post, args=(n,), name=n) for n in ("a", "b")]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

        assert results == {"a": 200, "b": 409}, (
            f"{results}: the first claimer should win and the second should be told "
            f"'already claimed' after waiting for it, not overwrite it"
        )
        assert codes.get("b") == "already_claimed", codes
        assert b_waited["seconds"] is not None and b_waited["seconds"] > 0.5, (
            f"B did not wait on A's row lock ({b_waited})"
        )
        winner = User.objects.get(username="claim_a")
        assert Judgment.all_objects.get(pk=case.pk).claimed_by_id == winner.pk


def _one_seat_two_cases(tenant_code="CN_DIYU"):
    """A CHINESE tenant, a capacity-1 hell court, and two pending cases for it."""
    from apps.judgment.models import Judgment
    from apps.realms.models import Realm

    tenant, _ = Tenant.objects.get_or_create(code=tenant_code, defaults={"display_name": tenant_code})
    realm = Realm.objects.create(
        realm_code="DY_COURT_05_YANLUO", civilization="CHINESE", name_local="第五殿",
        realm_type="HELL", capacity=1, tenant=tenant,
    )
    cases = []
    for name in ("seat_a", "seat_b"):
        soul = Soul.objects.create(name=name, tenant=tenant, current_state=SoulState.JUDGING)
        cases.append(Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=tenant))
    return tenant, realm, cases


@pytest.mark.django_db(transaction=True)
class TestConcludeDestinationCapacityHoldsTheRealmLock:
    """「戊 · 发落」: the capacity check and the seat it grants are one locked step."""

    def test_the_capacity_check_runs_inside_the_conclude_transaction(self, db):
        """Serial, so it runs on every engine. With `transaction=True` nothing
        outside the service is atomic, so `in_atomic_block` inside
        `resolve_placement` answers "is the realm's `select_for_update` held
        until the path entry is written"."""
        from unittest.mock import patch

        from django.db import transaction

        from apps.disposition import destination

        tenant, realm, (case, _) = _one_seat_two_cases()
        client = _admin_client(tenant, "seat_serial")
        real = destination.resolve_placement
        seen = []

        def spy(*args, **kwargs):
            seen.append(transaction.get_connection().in_atomic_block)
            return real(*args, **kwargs)

        with patch.object(destination, "resolve_placement", spy):
            response = client.post(
                f"/api/v1/judgment/{case.id}/conclude/",
                {"verdict": "FAILED", "destination_realm_id": str(realm.pk)}, format="json",
            )
        assert response.status_code == 200, response.data
        assert seen == [True], f"resolve_placement ran with in_atomic_block={seen}"

    @pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
    def test_two_officers_filling_the_last_seat_at_once_exactly_one_wins(self, db):
        """Two real connections, two cases, one seat left.

        A locks the realm and lingers after the check; B must wait on that lock,
        then count A's seat and be refused 409 `realm_full`. Without the lock
        both count zero and both land — a capacity-1 realm holding two.
        """
        import time
        from unittest.mock import patch

        from django.db import connections

        from apps.disposition import destination
        from apps.realms.models import SoulPathEntry

        tenant, realm, cases = _one_seat_two_cases()
        by_label = dict(zip(("a", "b"), cases, strict=True))
        clients = {n: _admin_client(tenant, f"seat_{n}") for n in ("a", "b")}
        real = destination.resolve_placement
        a_inside = threading.Event()
        results, codes = {}, {}

        def lingering(*args, **kwargs):
            placement = real(*args, **kwargs)
            if threading.current_thread().name == "a":
                a_inside.set()
                time.sleep(1.0)
            return placement

        def post(label):
            try:
                if label == "b":
                    assert a_inside.wait(timeout=10), "A never passed the capacity check"
                response = clients[label].post(
                    f"/api/v1/judgment/{by_label[label].id}/conclude/",
                    {"verdict": "FAILED", "destination_realm_id": str(realm.pk)}, format="json",
                )
                results[label] = response.status_code
                codes[label] = response.data.get("code")
            except Exception as exc:  # surfaced in the assertions below
                results[label] = repr(exc)
            finally:
                connections.close_all()

        with patch.object(destination, "resolve_placement", lingering):
            threads = [threading.Thread(target=post, args=(n,), name=n) for n in ("a", "b")]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

        assert results == {"a": 200, "b": 409}, results
        assert codes.get("b") == "realm_full", codes
        assert SoulPathEntry.all_objects.filter(realm=realm, left_at__isnull=True).count() == 1


# ---------------------------------------------------------------------------
# The guard for the skips themselves.
# ---------------------------------------------------------------------------


def _sqlite_skipped_tests(tree):
    """Qualified names of the tests in one module that SQLite skips.

    A skip counts if its condition names the engine: a module-level flag
    assigned from `connection.vendor` (`SQLITE = connection.vendor == ...`),
    or `connection.vendor` / "sqlite" written inline. The mark itself may be a
    decorator, a module-level alias of the mark (`NEEDS_ROW_LOCKS =
    pytest.mark.skipif(SQLITE, ...)`), a class decorator, or a `pytestmark`
    at module or class level (a single mark or a list of them).
    """
    import ast

    def mentions_engine(expr, flags):
        return any(
            (isinstance(n, ast.Name) and n.id in flags)
            or (isinstance(n, ast.Attribute) and n.attr == "vendor")
            or (isinstance(n, ast.Constant) and n.value == "sqlite")
            for n in ast.walk(expr)
        )

    flags, aliases = set(), set()

    def is_sqlite_skip(expr):
        if isinstance(expr, ast.Name):
            return expr.id in aliases
        if isinstance(expr, ast.List | ast.Tuple):
            return any(is_sqlite_skip(e) for e in expr.elts)
        return (
            isinstance(expr, ast.Call)
            and isinstance(expr.func, ast.Attribute)
            and expr.func.attr == "skipif"
            and bool(expr.args)
            and mentions_engine(expr.args[0], flags)
        )

    for stmt in tree.body:  # module level, in order, so aliases see flags
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1:
            target = stmt.targets[0]
            if not isinstance(target, ast.Name):
                continue
            if is_sqlite_skip(stmt.value):
                aliases.add(target.id)
            elif mentions_engine(stmt.value, flags):
                flags.add(target.id)

    def pytestmark_of(body):
        return any(
            isinstance(s, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "pytestmark" for t in s.targets)
            and is_sqlite_skip(s.value)
            for s in body
        )

    found = []

    def visit(body, prefix, inherited):
        for node in body:
            if isinstance(node, ast.ClassDef):
                marked = inherited or pytestmark_of(node.body) or any(
                    is_sqlite_skip(d) for d in node.decorator_list
                )
                visit(node.body, f"{prefix}{node.name}::", marked)
            elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                if node.name.startswith("test_") and (
                    inherited or any(is_sqlite_skip(d) for d in node.decorator_list)
                ):
                    found.append(prefix + node.name)

    visit(tree.body, "", pytestmark_of(tree.body))
    return found


def test_the_pg_only_scanner_sees_every_spelling():
    """The scanner's own positive control, one spelling per case.

    Without it, a scanner that silently stopped recognising a form would make
    the set assertion below agree with itself by omission.
    """
    import ast
    import textwrap

    src = textwrap.dedent('''
        import pytest
        from django.db import connection
        SQLITE = connection.vendor == "sqlite"
        REASON = "not a mark"
        ALIAS = pytest.mark.skipif(SQLITE, reason=REASON)

        @pytest.mark.skipif(SQLITE, reason=REASON)
        def test_literal(): pass

        @ALIAS
        def test_alias(): pass

        @pytest.mark.skipif(connection.vendor == "sqlite", reason="x")
        def test_inline(): pass

        @pytest.mark.skipif(True, reason="unrelated")
        def test_unrelated_skip(): pass

        def test_plain(): pass

        class TestClassMark:
            pytestmark = [pytest.mark.django_db, ALIAS]
            def test_in_marked_class(self): pass

        @ALIAS
        class TestDecoratedClass:
            def test_in_decorated_class(self): pass

        class TestPlain:
            def test_method(self): pass
    ''')
    assert sorted(_sqlite_skipped_tests(ast.parse(src))) == sorted([
        "test_literal",
        "test_alias",
        "test_inline",
        "TestClassMark::test_in_marked_class",
        "TestDecoratedClass::test_in_decorated_class",
    ])
    module_mark = "import pytest\nS = 'sqlite'\npytestmark = pytest.mark.skipif(S == 'sqlite', reason='x')\ndef test_a(): pass\n"
    assert _sqlite_skipped_tests(ast.parse(module_mark)) == ["test_a"]


def test_the_postgres_only_set_is_the_set_we_think_it_is():
    """哪些测试只在 PostgreSQL 上跑,写成一条会红的断言。

    这四条是这个仓库里**唯一**真正检验 `select_for_update` 的东西,而 CLAUDE.md 的
    一行命令强制 `DATABASE_URL="sqlite:///:memory:"` —— 本地全量跑时它们一条都不
    执行。`ci.yml` 确实起 postgres:16(所以不是「永远不会触发」),但同一文件里
    workflow 只剩 `workflow_dispatch`。**唯一验证行锁的东西,实践上没被跑过。**

    这条守卫不能让它们跑起来 —— 那是运行环境的事,记在下面的运行方法里。它能做的
    是让这个集合**停止无声地增长**:再有一条测试被标成 PostgreSQL-only,这里就红,
    加它的人得在这份名单上写下名字。一个可以随手扩大的豁免集合,和没有豁免是两回事。

    HOW TO RUN THEM(2026-08-31 实跑,5 passed / 0 skipped):

        cd backend && python -m pytest tests/test_concurrency.py -q --no-cov --create-db

    不设 `DATABASE_URL`,让 Django 读 `.env` 指向真 PostgreSQL;pytest-django 会
    自建 `test_soulledger` 再删掉,不碰真库。`--create-db` 是必需的:一个陈旧的
    `test_soulledger` 会造成上千条「环境错误」,而那正是当初把这条路径判成不可用的
    原因(见记忆里那条 0/3 的命中率)。
    """
    import ast
    from pathlib import Path

    # AST,不是字符串搜索。第一版用「在这个 def 之前 400 个字符里找 skipif」
    # 这类启发式,返回**空集** —— 而空集会让 `assert pg_only == expected` 报出
    # 一个看起来像「集合变了」的失败,掩盖掉真正的原因是扫描器坏了。
    # 这个仓库栽在「扫描器看的不是它以为在看的东西」上,这是第六次。
    #
    # 第二版(2026-09-14,BT-06)仍只扫本文件、只认装饰器里字面写着
    # `skipif(SQLITE…)` 的写法。`test_two_judges_cannot_both_decide_one_node.py`
    # 用的正是别名 `NEEDS_ROW_LOCKS = pytest.mark.skipif(SQLITE, …)`,于是那条
    # PostgreSQL-only 测试从来不在下面的名单里。现在:扫整个 backend 的测试文件,
    # 并认得别名、类装饰器、模块级与类级 `pytestmark`。
    backend = Path(__file__).resolve().parents[1]
    pg_only = []
    scanned = 0
    for path in sorted(backend.rglob("*.py")):
        if not (path.name.startswith("test_") or path.name == "tests.py"):
            continue
        scanned += 1
        pg_only.extend(
            f"{path.relative_to(backend).as_posix()}::{name}"
            for name in _sqlite_skipped_tests(ast.parse(path.read_text(encoding="utf-8")))
        )
    assert scanned > 100, f"只扫到 {scanned} 个测试文件 —— 扫描器坏了,不是集合变了"
    pg_only = sorted(pg_only)

    #: 实测得来,不是按审计文字抄的 —— 第一版这份名单是我按账本描述猜的,
    #: 里面两个名字在这个文件里根本不存在。
    here = "tests/test_concurrency.py::"
    expected = sorted([
        # BD-09 (2026-09-13): a decision that waits on the workflow row lock
        # and must re-read the workflow once it has it. SQLite has no row
        # lock to wait on. Its serial counterpart,
        # test_a_stale_copy_cannot_undo_a_refusal, runs on every engine.
        here + "TestWorkflowDecisionConcurrency::test_a_decision_blocked_on_the_lock_does_not_undo_a_refusal",
        # 2026-09-13, the BD-15 shape one call further down: a rebirth
        # requested while the disposition's execution is still logging its
        # rebirth trigger must WAIT on the soul row lock. SQLite has no row
        # lock to wait on. Its serial counterpart,
        # test_the_rebirth_trigger_runs_inside_the_views_locked_transaction,
        # runs on every engine.
        here + "TestReincarnationTriggerHoldsTheDispositionLock::test_a_rebirth_cannot_complete_between_execution_and_its_trigger",
        # BD-15 (2026-09-13): a second disposition executor must WAIT on the
        # disposition row lock the first still holds. SQLite has no row lock
        # to wait on. Its serial counterpart,
        # test_the_service_runs_inside_the_views_locked_transaction, runs on
        # every engine.
        here + "TestDispositionExecuteHoldsItsLock::test_a_second_executor_waits_and_is_told_already_executed",
        here + "TestDispatchApprovalConcurrency::test_concurrent_approve_and_reject",
        here + "TestDispatchApprovalConcurrency::test_concurrent_approve_only_one_succeeds",
        here + "TestSoulStateTransitionConcurrency::test_concurrent_die_only_one_succeeds",
        here + "TestSoulStateTransitionConcurrency::test_concurrent_state_transition_to_disposed",
        # Two judges racing complete_node on one node. Marked through the alias
        # NEEDS_ROW_LOCKS, which the file-local, literal-decorator scanner
        # before 2026-09-14 could not see -- it was PostgreSQL-only all along.
        "tests/test_two_judges_cannot_both_decide_one_node.py::"
        "test_only_one_of_two_simultaneous_decisions_is_recorded",
        # 2026-09-17 灵魂端:两次并发死亡同步必须在灵魂行锁上排队,第二个看见第一个
        # 开的账号而不是再开一个、再发一份密码。SQLite 没有行锁可等。串行版本
        # test_death_sync_opens_the_account_and_mails_the_password_once 每个引擎都跑。
        "tests/test_concurrent_death_sync_opens_one_account.py::"
        "test_two_simultaneous_death_syncs_open_one_account_and_issue_one_password",
        # 2026-09-17 灵魂端推送:at-least-once 队列把同一批 id 交给两个 worker,认领必须在
        # 投递行锁上排队,只有一个真正发出。SQLite 没有行锁可等。串行版本
        # test_soul_push_delivery.py::test_the_same_event_twice_is_pushed_once 每个引擎都跑。
        "tests/test_two_workers_cannot_both_send_one_push.py::"
        "test_two_workers_given_the_same_ids_send_once",
        # 2026-09-19 受刑计划阶段 2(docs/ARCHITECTURE-sentence-plan.md §8 清单 1、2、5):
        # 推进在灵魂行锁上串行、开审在同一把锁下再问一次(G7)。SQLite 没有行锁可等;
        # 三条各有一条串行版本在 tests/test_sentence_plan_concurrency.py,每个引擎都跑。
        "tests/test_sentence_plan_concurrency.py::"
        "test_two_officers_executing_the_home_disposition_at_once_dispatch_once",
        "tests/test_sentence_plan_concurrency.py::"
        "test_serving_a_stop_and_opening_a_case_there_at_once_never_strands_the_case",
        "tests/test_sentence_plan_concurrency.py::"
        "test_two_officers_executing_a_stop_at_once_complete_and_return_once",
        # 阶段 3(§8 清单 3、4、6、7):批准、转生申请、撤销、开审都在灵魂行锁下读计划;串行版本同文件。
        "tests/test_sentence_plan_concurrency.py::"
        "test_two_judges_accepting_one_request_at_once_add_once",
        "tests/test_sentence_plan_concurrency.py::"
        "test_completing_a_plan_and_applying_for_rebirth_at_once_never_applies_early",
        "tests/test_sentence_plan_concurrency.py::"
        "test_cancelling_a_plan_while_it_advances_leaves_nothing_dispatching",
        "tests/test_sentence_plan_concurrency.py::"
        "test_two_tenants_opening_a_case_on_one_soul_at_once_open_exactly_one",
        # G7 锁下两项复查(2026-09-19):开审停在 perform_create 入口、对方提交后才进锁,
        # 窗口被钉开而不靠调度。线程版只在 PG 上跑;串行版
        # test_a_case_whose_{open,tenant}_check_went_stale_before_the_lock_is_refused 每个引擎都跑。
        "tests/test_sentence_plan_concurrency.py::"
        "test_two_cases_past_the_unlocked_check_at_once_open_exactly_one",
        "tests/test_sentence_plan_concurrency.py::"
        "test_a_soul_going_home_while_a_case_waits_for_the_lock_strands_no_case",
        # 2026-09-24 审判认领:第二个认领人必须在案子的行锁上等,拿到锁后读到第一个的
        # 认领并得到 409。SQLite 没有行锁可等。串行版本
        # test_the_claim_check_runs_inside_the_row_locked_transaction 与
        # tests/test_judgment_claim.py 的 409 测试每个引擎都跑。
        here + "TestJudgmentClaimConcurrency::test_two_officers_claiming_one_case_at_once_exactly_one_wins",
        # 2026-09-25 审判台「戊 · 发落」:结案选门时锁住那扇门的行再数人头;第二个结案人
        # 必须等,拿到锁后数到第一个占的位子并得到 409 realm_full。SQLite 没有行锁可等。
        # 串行版本 test_the_capacity_check_runs_inside_the_conclude_transaction 与
        # tests/test_conclude_destination.py 的 realm_full 测试每个引擎都跑。
        here + "TestConcludeDestinationCapacityHoldsTheRealmLock::"
        "test_two_officers_filling_the_last_seat_at_once_exactly_one_wins",
    ])
    assert pg_only == expected, (
        f"PostgreSQL-only 的集合变了:{pg_only}\n"
        f"期望:{expected}\n"
        f"加一条 skipif(SQLITE) 意味着又一条断言在本地永不执行 —— "
        f"把它写进这份名单,并说明为什么它非 PostgreSQL 不可。"
    )
