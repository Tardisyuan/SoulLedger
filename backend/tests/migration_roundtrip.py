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
depends on it. That was cheap when this was written (four tests, "a few
seconds in total"); it is not now. Measured 2026-09-29 on SQLite in memory,
with coverage: the 26 tests that run migrations backwards cost 2-67 s each
(call plus the fixture's re-migrate in teardown; 22 of them over 20 s),
813 s together — about 13.5 of the suite's 23 minutes — because the graph
behind every slice has grown.

So they carry the ``migration`` marker (added automatically for users of the
``migration_round_trip`` fixture — ``tests/conftest.py``), and pre-push runs
``-m "not migration"`` unless the push touches a migration, this harness, a
file holding one of these tests, ``requirements.lock`` or the pytest config.
CI and the real-PostgreSQL command in CLAUDE.md run all of them.

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


#: This process's test database as it was at the latest migration, taken before the first `migrate_to`
#: moved it (see `restore_latest_snapshot`). SQLite: an in-memory copy. PostgreSQL: the name of a database
#: cloned from the worker's (`_pg_snapshot`), only while `PG_RESTORE` is on (the `migration_round_trip`
#: fixture's session fixture turns it on and drops the clone at session end).
_LATEST = None
#: `_schema_digest()` at that moment: `restore_latest_snapshot` checks every restore against it.
_LATEST_SCHEMA = None
PG_RESTORE = False


def _schema_digest() -> str:
    import hashlib

    from config.testdb import _SCHEMA_QUERIES

    queries = (
        ("SELECT type || ':' || name, sql FROM sqlite_master WHERE name <> 'sqlite_sequence'",)
        if connection.vendor == "sqlite" else _SCHEMA_QUERIES
    )
    rows = []
    with connection.cursor() as cur:
        for query in queries:
            cur.execute(query)
            rows += cur.fetchall()
    return hashlib.sha256(repr(sorted(rows, key=repr)).encode()).hexdigest()


def _snapshot_latest(executor) -> None:
    global _LATEST, _LATEST_SCHEMA
    if _LATEST is not None or connection.vendor not in ("sqlite", "postgresql"):
        return
    if connection.vendor == "postgresql" and not PG_RESTORE:
        return
    if executor.migration_plan(executor.loader.graph.leaf_nodes()):
        return  # not at the latest schema: nothing worth keeping
    schema = _schema_digest()
    if connection.vendor == "sqlite":
        import sqlite3

        connection.ensure_connection()
        _LATEST = sqlite3.connect(":memory:", check_same_thread=False)
        connection.connection.backup(_LATEST)
    else:
        _LATEST = _pg_snapshot()
    if _LATEST is not None:
        _LATEST_SCHEMA = schema


def _restore_latest_db() -> bool:
    if _LATEST is None:
        return False
    if connection.vendor == "sqlite":
        connection.ensure_connection()
        _LATEST.backup(connection.connection)
        return True
    return _pg_restore(_LATEST)


def restore_latest_snapshot() -> bool:
    """Put back the database `_snapshot_latest` kept; False when there is none.

    Migrating back to the latest schema re-applies every migration the round trip unapplied (hundreds by
    2026-11: `executor.migrate` spends ~90% of it re-rendering model states, not in SQL), and asserts
    nothing: the round trip's own step 4 re-applies the migration under test, and the template build
    applies the whole graph forward. The rows come back too; the transactional teardown flushes them.
    SQLite: one `backup` call. PostgreSQL (2026-11-19): the worker database is replaced by a FILE_COPY
    clone of the one `_pg_snapshot` took.

    A restore that did not put the latest schema back is refused here rather than left for the next test
    to trip over: the recorder must have nothing left to apply, and the schema must equal the snapshot's.
    """
    if not _restore_latest_db():
        return False
    executor = MigrationExecutor(connection)
    left = executor.migration_plan(executor.loader.graph.leaf_nodes())
    same = _schema_digest() == _LATEST_SCHEMA
    if left or not same:
        raise AssertionError(
            f"the restored database is not at the latest migration ({len(left)} migration(s) unapplied, "
            f"schema {'same as' if same else 'differs from'} the snapshot's): the latest-schema snapshot "
            f"was not put back"
        )
    return True


# --- PostgreSQL: the latest schema as a database to clone from ---------------------------------------------
# Re-migrating to latest after a round trip costs as much on PostgreSQL as it did on SQLite (state
# rendering), and PostgreSQL has no `backup`. So the first round trip of a worker clones the worker
# database (`<name>_rtl`, CREATE DATABASE ... TEMPLATE ... STRATEGY FILE_COPY), and every teardown builds
# a fresh copy of that (`<name>_rtn`), drops the worker database and renames the copy into its place.
# Building the copy first means a failure leaves the worker database as it was, and a plain migrate
# follows. Names stay `test_soulledger_...` (config/testdb.py refuses anything else). The `_rtl` clone is
# dropped at session end (tests/conftest.py `_roundtrip_pg_latest`); a crash leaves it matching
# `test_soulledger%` like any other leftover.


def _pg_names():
    from config.testdb import is_disposable_test_db

    name = connection.settings_dict["NAME"]
    names = (name, f"{name}_rtl", f"{name}_rtn")
    if not all(is_disposable_test_db(n) and len(n) <= 63 for n in names):
        return None
    return names


def _pg_snapshot():
    from config.testdb import close_connections

    names = _pg_names()
    if names is None or connection.in_atomic_block:
        return None
    name, latest, _ = names
    close_connections()  # CREATE DATABASE ... TEMPLATE refuses while anyone is connected to the source
    try:
        with connection.creation._nodb_cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{latest}"')
            cur.execute(f'CREATE DATABASE "{latest}" TEMPLATE "{name}" STRATEGY FILE_COPY')
    except Exception:  # noqa: BLE001 -- someone else is connected: no snapshot, teardown migrates for real
        return None
    return latest


def _pg_restore(latest) -> bool:
    from config.testdb import close_connections

    name, _, fresh = _pg_names()
    if connection.in_atomic_block:
        return False
    close_connections()
    with connection.creation._nodb_cursor() as cur:
        try:
            cur.execute(f'DROP DATABASE IF EXISTS "{fresh}"')
            cur.execute(f'CREATE DATABASE "{fresh}" TEMPLATE "{latest}" STRATEGY FILE_COPY')
            cur.execute(f'DROP DATABASE "{name}" WITH (FORCE)')
        except Exception:  # noqa: BLE001 -- the worker database is untouched: migrate for real
            cur.execute(f'DROP DATABASE IF EXISTS "{fresh}"')
            return False
        cur.execute(f'ALTER DATABASE "{fresh}" RENAME TO "{name}"')
    return True


def drop_pg_latest():
    """Drop this process's `_rtl` clone (session end). Its size in bytes, or None when there was none."""
    global _LATEST, _LATEST_SCHEMA
    if connection.vendor != "postgresql" or _LATEST is None:
        return None
    latest, _LATEST, _LATEST_SCHEMA = _LATEST, None, None
    with connection.creation._nodb_cursor() as cur:
        cur.execute("SELECT pg_database_size(%s)", [latest])
        size = cur.fetchone()[0]
        cur.execute(f'DROP DATABASE IF EXISTS "{latest}" WITH (FORCE)')
    return size


# --- SQLite: cache the database at a round trip's start state (SOULLEDGER_RT_START_CACHE) ------------------
# Getting from the latest schema to a round trip's `before` unapplies a slice of the graph: 75-150 s each,
# for 71 tests with 63 distinct start states (exp/roundtrip-start-cache, 2026-11-19). The result is a pure
# function of
#   * the database at latest: its contents, datetimes masked, sqlite_sequence left out (ids still to be
#     handed out are not data). That also covers whatever post_migrate receivers seeded into the template;
#   * the code that runs on the way: every migration in the graph (the reverses that run, and the earlier
#     ones whose operations build the states they run against) and every project module those import,
#     transitively (`import_closure`). executor.migrate sends no pre/post_migrate, and every model-signal
#     receiver in apps/ is connected per live model, so a historical model fires none;
#   * requirements.lock, the settings that steer migrate, the Python / Django / SQLite versions; the targets.
# That is the key, and nothing else under apps/: a view, a serializer, a model no migration imports do not
# miss. The migration under test is in it too: editing it misses, and the round trip runs for real. A hit
# is checked before use (sqlite quick_check, and its django_migrations must be exactly the set `targets`
# leaves applied); anything wrong with an entry is a miss, never an error.
# Off unless SOULLEDGER_RT_START_CACHE names a directory (scripts/run-gates.sh sets it). Not on PostgreSQL.

CACHE_ENV = "SOULLEDGER_RT_START_CACHE"
#: Code generations kept in the cache directory. Locally every worktree shares it (the git common dir), so
#: the newest other generation is kept besides the current one; older ones are deleted.
KEEP_GENERATIONS = 2
STATS = {"hit": 0, "miss": 0}
_CODE_HASH = None
_PRUNED = False


def _module_file(root, name):
    from pathlib import Path

    base = Path(root).joinpath(*name.split("."))
    for path in (base.with_suffix(".py"), base / "__init__.py"):
        if path.is_file():
            return path
    return None


def _imported_names(tree, module, is_package):
    import ast

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            yield from (a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                parts = module.split(".") if is_package else module.split(".")[:-1]
                parts = parts[: len(parts) - node.level + 1]
                base = ".".join(parts + ([node.module] if node.module else []))
            yield base
            yield from (f"{base}.{a.name}" for a in node.names)  # `from pkg import submodule`
        elif (
            isinstance(node, ast.Call) and node.args and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
            and getattr(node.func, "attr", getattr(node.func, "id", None)) == "import_module"
        ):
            yield node.args[0].value


def import_closure(root, modules) -> list:
    """The files under `root` of `modules` and of every project module they import, transitively:
    `import x`, `from x import y` (y may be a module), relative imports, `import_module("literal")`,
    imports inside functions, and the parent packages' __init__.py. Modules not under `root` are skipped."""
    import ast

    seen, stack = {}, list(modules)
    while stack:
        parts = stack.pop().split(".")
        for i in range(1, len(parts) + 1):
            name = ".".join(parts[:i])
            if not name or name in seen:
                continue
            seen[name] = path = _module_file(root, name)
            if path is not None:
                stack.extend(_imported_names(ast.parse(path.read_bytes()), name, path.name == "__init__.py"))
    return sorted({p for p in seen.values() if p is not None})


def code_hash(root, modules, extra) -> str:
    import hashlib
    from pathlib import Path

    h = hashlib.sha256(repr(sorted(extra.items())).encode())
    for path in import_closure(root, modules) + [Path(root) / "requirements.lock"]:
        if path.is_file():
            h.update(path.relative_to(root).as_posix().encode() + b"\0" + hashlib.sha256(path.read_bytes()).digest())
    return h.hexdigest()[:16]


def _backend_dir():
    from pathlib import Path

    return Path(__file__).resolve().parents[1]


def _content_digest() -> str:
    import hashlib
    import sqlite3

    from config.sqlite_template import _table_digests

    plain = sqlite3.connect(":memory:")  # Django's own connection parses datetimes; the masking needs text
    try:
        connection.ensure_connection()
        connection.connection.backup(plain)
        digests = _table_digests(plain)
    finally:
        plain.close()
    digests.pop("rows:sqlite_sequence", None)
    return hashlib.sha256(repr(sorted(digests.items())).encode()).hexdigest()[:16]


def _start_cache(executor, targets):
    """(entry path, the migrations applied at `targets`) when this approach can be cached, else None."""
    import hashlib
    import os
    from pathlib import Path

    directory = os.environ.get(CACHE_ENV)
    if not directory or connection.vendor != "sqlite":
        return None
    graph = executor.loader.graph
    plan = executor.migration_plan(targets)
    if not plan or executor.migration_plan(graph.leaf_nodes()):
        return None  # nothing to do, or not starting at latest
    global _CODE_HASH
    if _CODE_HASH is None:
        from django.conf import settings

        from config.sqlite_template import settings_inputs

        modules = sorted({type(m).__module__ for m in graph.nodes.values()})
        _CODE_HASH = code_hash(_backend_dir(), modules, settings_inputs(settings, connection.alias))
    applied = {k for k in executor.loader.applied_migrations if k in graph.nodes}
    for migration, backwards in plan:
        (applied.discard if backwards else applied.add)((migration.app_label, migration.name))
    state = hashlib.sha256(repr((sorted(targets), _content_digest())).encode()).hexdigest()[:16]
    return Path(directory) / f"{_CODE_HASH}-{state}.sqlite3", applied


def _load_start(path, applied) -> bool:
    import contextlib
    import os
    import sqlite3

    mem = sqlite3.connect(":memory:")
    try:
        src = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            src.backup(mem)
        finally:
            src.close()
        if mem.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            return False
        nodes = MigrationExecutor(connection).loader.graph.nodes
        if {r for r in mem.execute("SELECT app, name FROM django_migrations") if r in nodes} != applied:
            return False
        connection.ensure_connection()
        mem.backup(connection.connection)
    except (sqlite3.Error, OSError):
        return False
    finally:
        mem.close()
    with contextlib.suppress(OSError):
        os.utime(path)  # pruning goes by the newest entry of a generation
    return True


def _save_start(path) -> None:
    import contextlib
    import os
    import sqlite3

    global _PRUNED
    with contextlib.suppress(OSError, sqlite3.Error):
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        dst = sqlite3.connect(tmp)
        try:
            connection.connection.backup(dst)
        finally:
            dst.close()
        os.replace(tmp, path)
        if not _PRUNED:
            _PRUNED = True
            prune(path.parent, path.name.split("-")[0])


def prune(directory, current: str, keep: int = KEEP_GENERATIONS) -> list:
    """Delete the entries of every code generation except `current` and the newest `keep - 1` others."""
    import contextlib

    newest = {}
    for path in directory.glob("*-*.sqlite3"):
        with contextlib.suppress(OSError):
            gen = path.name.split("-")[0]
            newest[gen] = max(newest.get(gen, 0), path.stat().st_mtime)
    others = sorted((g for g in newest if g != current), key=newest.get, reverse=True)
    stale = set(others[max(keep - 1, 0):])
    removed = []
    for path in directory.glob("*-*.sqlite3"):
        if path.name.split("-")[0] in stale:
            with contextlib.suppress(OSError):
                path.unlink()
                removed.append(path.name)
    return removed


def migrate_to(targets: list[Target]):
    """Migrate the live test connection to `targets`; return its apps registry.

    The graph is rebuilt on every call because a preceding backward migration
    changes what the recorder says is applied.
    """
    executor = MigrationExecutor(connection)
    _snapshot_latest(executor)
    cache = _start_cache(executor, targets)
    if cache is not None and _load_start(*cache):
        STATS["hit"] += 1
        return MigrationExecutor(connection)._create_project_state(with_applied_migrations=True).apps
    state = executor.migrate(targets)
    if cache is not None:
        STATS["miss"] += 1
        _save_start(cache[0])
    return state.apps


def migrate_to_latest():
    """Migrate forward to the latest schema for real, keeping the rows: a test that checks its rows survived
    the way back (test_explicit_through_round_trip, test_bare_ids_migrations_round_trip) calls this.

    Not the snapshot restore: that puts back the database as it was at this process's first round trip,
    without anything a later test seeded. It used to be the first thing tried here, so those tests passed
    only when they were the first round trip on their worker (red on PostgreSQL, 2026-11-19)."""
    executor = MigrationExecutor(connection)
    return migrate_to(executor.loader.graph.leaf_nodes())


def reset_to_latest():
    """Teardown: the latest schema, rows irrelevant (the transactional flush follows). The snapshot restore
    when there is one, else a real migrate."""
    if restore_latest_snapshot():
        return None
    return migrate_to_latest()


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
