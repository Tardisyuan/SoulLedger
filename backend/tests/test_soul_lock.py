"""`Soul.lock` / `Soul.lock_many`: one way to row-lock a soul (cq-backend 第 6 条,2026-10-30).

The three sites that used to lock through `Soul.objects` (soft-delete filtered, no `of=`) go through it now:
`Soul.correct_settlement`, `WorkflowService.start_workflow(exclusive=True)`, `region_update.apply`.
SQLite emits no FOR UPDATE, so the lock's shape is read off the queryset call, not the SQL.
"""
import ast
from pathlib import Path
from unittest import mock

import pytest
from django.db.models.query import QuerySet

from apps.souls import region_update
from apps.souls.models import Soul, SoulState
from apps.workflow.models import CaseType
from apps.workflow.services import WorkflowService


def _soul(tenant, **kw):
    kw.setdefault("current_state", SoulState.JUDGING)
    return Soul.objects.create(name="锁之魂", tenant=tenant, **kw)


@pytest.fixture
def sfu_calls():
    calls = []
    original = QuerySet.select_for_update

    def spy(self, *args, **kwargs):
        calls.append((self.model, kwargs))
        return original(self, *args, **kwargs)

    with mock.patch.object(QuerySet, "select_for_update", spy):
        yield calls


@pytest.mark.django_db
def test_lock_is_unfiltered_and_locks_only_the_soul_row(cn_tenant, sfu_calls):
    soul = _soul(cn_tenant, is_deleted=True)
    assert Soul.lock(soul.pk).pk == soul.pk  # soft-deleted rows are locked too; the caller decides
    assert sfu_calls == [(Soul, {"of": ("self",)})]


@pytest.mark.django_db
def test_lock_many_returns_rows_in_pk_order(cn_tenant, sfu_calls):
    souls = [_soul(cn_tenant) for _ in range(3)]
    locked = Soul.lock_many([s.pk for s in reversed(souls)])
    assert [s.pk for s in locked] == sorted(s.pk for s in souls)
    assert sfu_calls == [(Soul, {"of": ("self",)})]


@pytest.mark.django_db
def test_correct_settlement_locks_through_soul_lock(cn_tenant):
    soul = _soul(cn_tenant, current_state=SoulState.SETTLED)
    with mock.patch.object(Soul, "lock", wraps=Soul.lock) as lock:
        soul.correct_settlement(user=None, reason="录错了")
    lock.assert_called_once_with(soul.pk)


@pytest.mark.django_db
def test_correct_settlement_still_refuses_a_soft_deleted_soul(cn_tenant):
    soul = _soul(cn_tenant, current_state=SoulState.SETTLED)
    Soul.all_objects.filter(pk=soul.pk).update(is_deleted=True)
    with pytest.raises(Soul.DoesNotExist):
        soul.correct_settlement(user=None, reason="录错了")
    assert Soul.all_objects.get(pk=soul.pk).current_state == SoulState.SETTLED


@pytest.mark.django_db
def test_exclusive_start_workflow_locks_through_soul_lock(cn_tenant):
    soul = _soul(cn_tenant)
    with mock.patch.object(Soul, "lock", wraps=Soul.lock) as lock:
        WorkflowService.start_workflow(soul, case_type=CaseType.ROUTINE, tenant=cn_tenant, exclusive=True)
    lock.assert_called_once_with(soul.pk)


@pytest.mark.django_db
def test_exclusive_start_workflow_still_refuses_a_soft_deleted_soul(cn_tenant):
    soul = _soul(cn_tenant)
    Soul.all_objects.filter(pk=soul.pk).update(is_deleted=True)
    with pytest.raises(Soul.DoesNotExist):
        WorkflowService.start_workflow(soul, case_type=CaseType.ROUTINE, tenant=cn_tenant, exclusive=True)


@pytest.mark.django_db
def test_region_apply_locks_through_soul_lock_many(cn_tenant):
    soul = _soul(cn_tenant)
    data = f"soul_id,origin_region\n{soul.pk},europe\n".encode()
    with mock.patch.object(Soul, "lock_many", wraps=Soul.lock_many) as lock_many:
        rows = region_update.apply(data, Soul.objects.filter(tenant=cn_tenant))
    lock_many.assert_called_once_with([soul.pk])
    assert [r.status for r in rows] == [region_update.OK]
    soul.refresh_from_db()
    assert soul.origin_region == Soul.OriginRegion.EUROPE


# ── guard: nothing else row-locks a soul (cq-backend 第 6 条 rest, 2026-10-30) ─────────────────────

BACKEND = Path(__file__).resolve().parents[1]
HELPERS = {("Soul", "lock"), ("Soul", "lock_many")}


def _root(node):
    """The name at the bottom of `X.a(...).b` — `Soul`, `cls`, … — or None."""
    while isinstance(node, (ast.Call, ast.Attribute)):
        node = node.func if isinstance(node, ast.Call) else node.value
    return node.id if isinstance(node, ast.Name) else None


def soul_row_locks_outside_the_helpers(backend=BACKEND):
    """`file:line Class.function` of every `select_for_update` on Soul outside `Soul.lock` / `Soul.lock_many`.
    An AST walk of non-test, non-migration code, so comments and strings never match."""
    found = []
    for path in sorted([*(backend / "apps").rglob("*.py"), *(backend / "config").rglob("*.py")]):
        rel = path.relative_to(backend).as_posix()
        if "/tests/" in rel or "/migrations/" in rel or path.name.startswith("test_") or path.name == "tests.py":
            continue
        stack: list[str] = []

        def visit(node, rel=rel, stack=stack):
            pushed = isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
            if pushed:
                stack.append(node.name)
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "select_for_update"):
                root = _root(node.func.value)
                on_soul = root == "Soul" or (root in ("cls", "self") and stack[:1] == ["Soul"])
                if on_soul and tuple(stack[:2]) not in HELPERS:
                    found.append(f"{rel}:{node.lineno} {'.'.join(stack)}")
            for child in ast.iter_child_nodes(node):
                visit(child)
            if pushed:
                stack.pop()

        visit(ast.parse(path.read_text()))
    return found


def test_souls_are_row_locked_only_through_soul_lock():
    """One way to lock a soul: `all_objects` (the caller decides what a soft-deleted soul means), `of=("self",)`
    (no tenant rows dragged in), pk order for several. Hand-written `Soul.….select_for_update(…)` drifted on exactly
    those points — 2026-10-30 there were about thirty, some with `of=` and some without."""
    assert soul_row_locks_outside_the_helpers() == []


def test_the_guard_sees_a_soul_lock_written_by_hand(tmp_path):
    (tmp_path / "apps" / "x").mkdir(parents=True)
    (tmp_path / "config").mkdir()
    (tmp_path / "apps" / "x" / "services.py").write_text(
        "def f(pk):\n"
        "    return Soul.all_objects.select_for_update().filter(pk=pk).first()\n"
        "class Soul:\n"
        "    @classmethod\n"
        "    def lock(cls, pk):\n"
        "        return cls.all_objects.select_for_update(of=('self',)).get(pk=pk)\n"
        "    @classmethod\n"
        "    def other(cls, pk):\n"
        "        return cls.all_objects.select_for_update().get(pk=pk)\n"
        "def g():\n"
        "    return Judgment.all_objects.select_for_update()  # another model: not ours\n"
    )
    assert soul_row_locks_outside_the_helpers(tmp_path) == ["apps/x/services.py:2 f", "apps/x/services.py:9 Soul.other"]
