"""A round-trip harness for reversible data migrations.

Why this exists
---------------
``realms/0012_ten_courts`` shipped a reverse that *ran without error* and still
destroyed data: ``_move_actors`` was called before the rename rollback, so the
five kings whose court had been *created* rather than renamed found no row
answering to their pre-migration ``realm_code``, were skipped, and were then
SET_NULL'd when the created rows were deleted a statement later. Nothing in the
suite could have caught it — the migration "succeeded" both ways, and the only
evidence was the data. It was found by running the round trip by hand.

So the assertion this module exists to make is not "the reverse ran" but
"the reverse restored the rows". Everything below serves that one sentence:

    forward -> reverse -> forward again, compared as *data*.

Why not ``django-test-migrations``
----------------------------------
It is the obvious third-party answer and it was considered. ``requirements.txt``
carries no test helper beyond pytest, its two plugins and factory-boy, and the
part of that package this repo would use is ``MigrationExecutor.migrate()`` plus
a fixture that puts the schema back — which is the ~40 executable lines below.
The rest of it (its own ``MigratorTestCase`` base, unittest/pytest bridging,
Django-version compatibility shims) is surface this repo would carry without
using. The data comparison, which is the entire point here, it does not provide
at all: ``MigratorTestCase`` hands you the historical ``apps`` registry and
leaves the assertions to you. So the dependency would buy the cheap half and
none of the load-bearing half.

Cost
----
Each round trip unapplies and reapplies a *slice* of the graph, not the whole
of it: ``MigrationExecutor`` plans only the target migration and whatever
depends on it. Measured on SQLite in memory the four tests in
``test_migration_roundtrip.py`` cost a few seconds in total, most of it in the
``disposition/0009`` case, whose dependents pull ``realms/0011..0013`` along
with it.

Usage
-----
The ``migration_round_trip`` fixture lives in ``tests/conftest.py`` (a fixture
imported into a test module reads as a redefinition to ruff, and the ``noqa``
that silences it has to be repeated at every use site).

    def test_round_trip(migration_round_trip):
        migration_round_trip(
            before=("realms", "0012_ten_courts"),
            after=("realms", "0013_correct_mythological_positions"),
            seed=seed_pre_0013,          # build the pre-migration world
            snapshot=snapshot_placements,  # -> {key: {field: value}}
            check_forward=assert_moved,  # optional, runs at `after`
        )

``seed`` and the callbacks all receive the *historical* ``apps`` registry for
the state they run in, so they must use ``apps.get_model(...)`` and the same
unfiltered manager the migrations use (``_base_manager`` / ``all_objects``),
never the real model classes: a tenant-scoped or soft-delete manager will hide
exactly the rows a data migration is being tested on.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from django.db import connection
from django.db.migrations.executor import MigrationExecutor

Target = tuple[str, str]
Snapshot = Mapping[str, Any]

_MISSING = object()


def migrate_to(targets: list[Target]):
    """Migrate the live test connection to `targets`; return its apps registry.

    The graph is rebuilt on every call because a preceding backward migration
    changes what the recorder says is applied.
    """
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    state = executor.migrate(targets)
    return state.apps


def migrate_to_latest():
    """Put the schema back where the rest of the session expects to find it."""
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    return migrate_to(executor.loader.graph.leaf_nodes())


def snapshot_rows(
    queryset,
    *,
    key: str | Callable[[Any], str],
    fields: Mapping[str, str | Callable[[Any], Any]],
    prefix: str = "",
) -> dict[str, dict[str, Any]]:
    """Freeze a queryset into ``{prefix+key: {name: value}}``.

    Values are read eagerly, so the result survives the migration that runs
    next. `fields` values are either an attribute name or a callable taking the
    row — the callable form is for anything that needs a join, e.g.
    ``lambda a: a.realm.realm_code if a.realm_id else None``.
    """
    out: dict[str, dict[str, Any]] = {}
    for row in queryset:
        k = f"{prefix}{key(row) if callable(key) else getattr(row, key)}"
        if k in out:
            raise AssertionError(
                f"snapshot key {k!r} is not unique — the comparison would "
                f"silently drop a row"
            )
        out[k] = {
            name: (spec(row) if callable(spec) else getattr(row, spec))
            for name, spec in fields.items()
        }
    return out


def _diff(label_a: str, a: Snapshot, label_b: str, b: Snapshot) -> list[str]:
    """Readable per-row, per-field differences. Empty list means equal."""
    lines: list[str] = []
    for k in sorted(set(a) | set(b), key=str):
        va, vb = a.get(k, _MISSING), b.get(k, _MISSING)
        if va == vb:
            continue
        if va is _MISSING:
            lines.append(f"  {k}: absent in {label_a}, present in {label_b}")
            continue
        if vb is _MISSING:
            lines.append(f"  {k}: present in {label_a}, absent in {label_b}")
            continue
        if isinstance(va, Mapping) and isinstance(vb, Mapping):
            for f in sorted(set(va) | set(vb), key=str):
                fa, fb = va.get(f, _MISSING), vb.get(f, _MISSING)
                if fa != fb:
                    lines.append(
                        f"  {k}.{f}: {label_a}={fa!r}  ->  {label_b}={fb!r}"
                    )
        else:
            lines.append(f"  {k}: {label_a}={va!r}  ->  {label_b}={vb!r}")
    return lines


def _assert_same(what: str, label_a, a, label_b, b) -> None:
    lines = _diff(label_a, a, label_b, b)
    if lines:
        raise AssertionError(
            f"{what}\n"
            f"{len(lines)} difference(s) between {label_a} and {label_b}:\n"
            + "\n".join(lines)
        )


def run_round_trip(
    *,
    before: Target,
    after: Target,
    seed: Callable[[Any], None],
    snapshot: Callable[[Any], Snapshot],
    check_forward: Callable[[Any], None] | None = None,
    check_reverse: Callable[[Any], None] | None = None,
) -> None:
    """forward -> reverse -> forward, asserted on the data at each stop.

    1. migrate to `before`, run `seed` -> this is the world the migration
       claims it can restore.
    2. migrate to `after`; `check_forward` proves the migration did something,
       so a no-op migration cannot pass this by doing nothing twice.
    3. migrate back to `before`; the snapshot here **must equal** step 1's.
       This is the assertion the realms/0012 bug would have failed.
    4. migrate to `after` again; the snapshot must equal step 2's — a forward
       that is not idempotent, or that depends on rows the reverse consumed,
       shows up here.
    """
    state = migrate_to([before])
    seed(state)
    baseline = snapshot(state)
    if not baseline:
        raise AssertionError(
            "the baseline snapshot is empty — `seed` wrote nothing the "
            "snapshot can see (wrong manager? wrong historical model?), and "
            "an empty snapshot compares equal to any other empty one"
        )

    state = migrate_to([after])
    forward_once = snapshot(state)
    if check_forward is not None:
        check_forward(state)
    if not _diff("before-forward", baseline, "after-forward", forward_once):
        raise AssertionError(
            f"applying {after[0]}/{after[1]} changed nothing the snapshot can "
            f"see, so reversing it cannot prove anything either — a reverse "
            f"that does nothing would pass. Either the seed does not build the "
            f"rows this migration looks for, or the snapshot does not read the "
            f"columns it writes."
        )

    state = migrate_to([before])
    reversed_once = snapshot(state)
    if check_reverse is not None:
        check_reverse(state)
    _assert_same(
        f"reversing {after[0]}/{after[1]} did not restore the data it "
        f"started from.",
        "baseline", baseline, "after-reverse", reversed_once,
    )

    state = migrate_to([after])
    forward_twice = snapshot(state)
    _assert_same(
        f"re-applying {after[0]}/{after[1]} after a reverse produced a "
        f"different result than the first application.",
        "after-forward", forward_once, "after-forward-again", forward_twice,
    )
