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
# The guard for the skips themselves.
# ---------------------------------------------------------------------------


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
    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    pg_only = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef) or not node.name.startswith("test_"):
            continue
        for dec in node.decorator_list:
            src = ast.dump(dec)
            if "skipif" in src and "SQLITE" in src:
                pg_only.append(node.name)
                break
    pg_only = sorted(pg_only)

    #: 实测得来,不是按审计文字抄的 —— 第一版这份名单是我按账本描述猜的,
    #: 里面两个名字在这个文件里根本不存在。
    expected = [
        # BD-09 (2026-09-13): a decision that waits on the workflow row lock
        # and must re-read the workflow once it has it. SQLite has no row
        # lock to wait on. Its serial counterpart,
        # test_a_stale_copy_cannot_undo_a_refusal, runs on every engine.
        "test_a_decision_blocked_on_the_lock_does_not_undo_a_refusal",
        # BD-15 (2026-09-13): a second disposition executor must WAIT on the
        # disposition row lock the first still holds. SQLite has no row lock
        # to wait on. Its serial counterpart,
        # test_the_service_runs_inside_the_views_locked_transaction, runs on
        # every engine.
        "test_a_second_executor_waits_and_is_told_already_executed",
        "test_concurrent_approve_and_reject",
        "test_concurrent_approve_only_one_succeeds",
        "test_concurrent_die_only_one_succeeds",
        "test_concurrent_state_transition_to_disposed",
    ]
    assert pg_only == expected, (
        f"PostgreSQL-only 的集合变了:{pg_only}\n"
        f"期望:{expected}\n"
        f"加一条 skipif(SQLITE) 意味着又一条断言在本地永不执行 —— "
        f"把它写进这份名单,并说明为什么它非 PostgreSQL 不可。"
    )
