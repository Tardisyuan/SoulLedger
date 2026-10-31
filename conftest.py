"""Pytest configuration shared by the whole suite.

Isolates the cache. settings.CACHES points at the same Redis the running
application uses, and nothing overrode it for tests, so the suite read and
wrote live cache state. That is not a theoretical problem: the login rate
limiter stores `login_rate:{ip}` there with a 15-minute TTL, so exhausting it
against the dev server makes nine authentication tests fail with 429 on a
machine whose code is fine — and conversely, running the suite evicts the
permission cache the application is using.

LocMem gives each test process its own cache, and clearing it between tests
keeps counters and cached permission lookups from leaking across cases.
"""
import pytest
from django.core.cache import cache
from django.test import override_settings

TEST_CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "soulledger-tests",
    }
}


@pytest.fixture(autouse=True, scope="session")
def _isolate_cache_from_redis():
    """Point the whole session at an in-process cache instead of shared Redis."""
    with override_settings(CACHES=TEST_CACHES):
        yield


#: A fixed, test-only Fernet key (the one `scripts/run-gates.sh` used to export).
TEST_ENCRYPTION_KEY = "Y2ktdGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcyE="


@pytest.fixture(autouse=True, scope="session")
def _encryption_key_when_none_is_set():
    """The suite runs with an ENCRYPTION_KEY wherever it runs (review 2026-10-31 A1).

    It used to come from the runner: the main checkout's backend/.env, then `scripts/run-gates.sh` exporting
    one — and CI, which does neither, went red on five tests that were green everywhere else. Now the suite
    sets its own when the environment has none; tests about the no-key path override it to "" themselves.
    Settings are already loaded when this conftest is imported, hence an override and not `os.environ`.
    """
    from django.conf import settings

    if settings.ENCRYPTION_KEY:
        yield
        return
    with override_settings(ENCRYPTION_KEY=TEST_ENCRYPTION_KEY):
        yield


@pytest.fixture(autouse=True, scope="session")
def _fast_password_hasher():
    """MD5 instead of PBKDF2 (1,000,000 iterations) for every hash the suite makes.

    Measured 2026-09-16, same tree, SQLite, --no-cov: full suite 545s -> 253s,
    3767 passed both ways. Tests only; production hashing is untouched. A test
    that inspects a hash's prefix must read `get_hasher().algorithm`, not a
    literal `pbkdf2_` -- that literal can never match under this override.
    """
    with override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"]):
        yield


@pytest.fixture(autouse=True, scope="session")
def _private_permission_cache_prefix():
    """Give this process's permission-cache singleton its own Redis key prefix.

    `apps/perm/cache.py` opens its own Redis client, so LocMem above does not
    cover it, and the default prefix is "". Any other process on the same Redis
    -- a second test run, or another xdist worker -- that calls
    `invalidate_all_permissions()` then deletes this process's `perm:*` keys
    mid-test. Reproduced 2026-09-16: deleting `perm:*` in a loop from another
    process turned `test_a_warm_read_does_not_touch_the_database_per_codename`
    red 1 run in 5 ("56 not less than 46"). The singleton is built at import
    time, before any settings override could reach it, hence the attribute.
    """
    import os

    from apps.perm.cache import get_permission_cache

    get_permission_cache()._key_prefix = f"pytest-{os.getpid()}:"
    yield


@pytest.fixture(autouse=True, scope="session")
def _private_channel_layer_prefix():
    """Same collision on the channel layer: group names are `tenant.code` and
    user ids, which every test process's fresh database hands out identically.

    Measured 2026-09-16 under `pytest -n 8`: another worker's ungated event to
    the `CN` tenant group reached this worker's socket, and
    `test_refresh_after_first_frame_auth_reads_the_real_user` failed with
    "降权之后带门事件仍然送达". channels drops its cached layers when
    CHANNEL_LAYERS changes, so overriding the setting is enough.
    """
    import copy
    import os

    from django.conf import settings

    layers = copy.deepcopy(settings.CHANNEL_LAYERS)
    for layer in layers.values():
        if layer.get("BACKEND", "").startswith("channels_redis"):
            layer.setdefault("CONFIG", {})["prefix"] = f"pytest-{os.getpid()}"
    with override_settings(CHANNEL_LAYERS=layers):
        yield


@pytest.fixture(autouse=True)
def _clear_cache_between_tests(_isolate_cache_from_redis):
    """LocMem persists for the life of the process, so reset it per test.

    Rate-limit counters and the permission cache are both keyed in a way that
    would otherwise carry state from one test into the next.

    The permission cache is not in `cache` -- it is its own Redis client -- so
    it is cleared separately. Without that, a test that creates a Permission
    row but grants it to nobody caches `(VIEWER, soul.read) = False` for 300s;
    the database rolls back, Redis does not, and the next test that relies on
    the ROLE_PERMISSIONS fallback gets 403. Reproduced 2026-09-16:
    `test_perm_prefix_discloses_only_the_catalogue.py` followed by
    `test_viewer_can_read_souls` fails every time.
    """
    from apps.perm.cache import get_permission_cache
    from apps.tenants.middleware import clear_tenant_cache

    # The cache itself, not `invalidate_all_permissions`: that one also broadcasts a permission refresh to every
    # open socket (decision 10), and a housekeeping flush is not a grant change. Broadcasting it between tests
    # leaves a send on a throwaway event loop racing the next test's sockets on the shared channel layer.
    def invalidate_all_permissions():
        get_permission_cache().invalidate_all()

    # `TenantMiddleware`'s per-worker hall copies: a rolled-back test leaves no signal behind to drop them.
    cache.clear()
    invalidate_all_permissions()
    clear_tenant_cache()
    yield
    cache.clear()
    invalidate_all_permissions()
    clear_tenant_cache()


@pytest.fixture(autouse=True)
def _no_request_context_across_tests():
    """Start and end every test with no current request / user in the context-vars.

    The middleware clears them at the end of a real request, but a test that sets them by hand
    (`set_current_request(...)`) and does not clear them hands the next test on the worker a "current
    request" — and since 2026-10-30 the permission cache memoizes per request (`apps/perm/cache.py`),
    so that test then reads a permission answer from a database state that no longer exists
    (`test_can_end_goes_by_workflow_update_in_the_initiating_hall`, 10-30 gate).
    """
    from apps.core.request_local import clear_current_user

    clear_current_user()
    yield
    clear_current_user()


@pytest.fixture(autouse=True)
def _restore_event_handlers():
    """Put the process-wide handler registry back as each test found it.

    `EventBus()` is a new object but `handler_registry` is the module singleton,
    so `EventBus().reset()` (test_event_bus.py) emptied it for the rest of the
    worker: no UserNotification, no SoulEvent. Serially a later
    `configure_default_handlers()` call happened to refill it; under
    `--dist worksteal` (2026-10-28, unRAID, two runs) the same six notification
    and appeal tests failed on whichever worker ran test_reset last.
    """
    from apps.events.handlers.registry import handler_registry as reg

    saved = (
        {k: list(v) for k, v in reg._handlers.items()},
        {k: list(v) for k, v in reg._domain_handlers.items()},
        list(reg._global_handlers),
    )
    yield
    reg.reset()
    reg._handlers.update(saved[0])
    reg._domain_handlers.update(saved[1])
    reg._global_handlers.extend(saved[2])


@pytest.fixture(autouse=True)
def _fresh_channel_layer_per_test():
    """A new channel-layer instance for every test (2026-10-29).

    `RedisChannelLayer` keeps `receive_count` / `receive_lock` on the instance, bound to the event loop of the
    first receiver. Each async test runs its own loop; a consumer still reading when that loop is torn down
    leaves the count above zero and the lock held, and the next test's socket fails with "Lock ... is bound to
    a different event loop". More traffic on the layer (the permission-refresh broadcast, decision 10) made that
    window common: 17 WebSocket tests red in one full run. Production runs one loop per process.
    """
    yield
    from channels.layers import channel_layers

    channel_layers.backends = {}


@pytest.fixture(scope="session")
def django_db_modify_db_settings(django_db_modify_db_settings, request):
    """Give each run its own PostgreSQL test database (`test_soulledger_<hex>`),
    so two concurrent `--create-db` runs on 115 no longer collide. Requests
    pytest-django's fixture first, so the xdist `_gwN` suffix is already on the
    name. SQLite untouched. See backend/config/testdb.py.

    Under xdist the controller hands every worker the run suffix and the
    template databases it built (`_build_pg_templates` below); the worker then
    clones its database from the template instead of migrating from scratch.
    """
    from django.conf import settings

    from config.testdb import run_suffix, suffix_postgres_test_databases, use_templates

    workerinput = getattr(request.config, "workerinput", {})
    suffix_postgres_test_databases(settings.DATABASES, workerinput.get(_SUFFIX_KEY) or run_suffix())
    use_templates(settings.DATABASES, workerinput.get(_TEMPLATES_KEY) or {})
    _use_sqlite_template(request)


def _use_sqlite_template(request):
    """SQLite only: load a cached migrated database instead of migrating (backend/config/sqlite_template.py).

    Migration round-trip tests in the run switch it to 'verify' (migrate for real
    and check the cached template) rather than trust a clone with them.
    """
    import os
    from pathlib import Path

    from config import sqlite_template

    config = request.config
    run_mode = sqlite_template.mode(
        os.environ,
        reuse_db=bool(config.getoption("reuse_db", False)),
        nomigrations=bool(config.getoption("nomigrations", False)),
        has_migration_tests=any(item.get_closest_marker("migration") for item in request.session.items),
    )
    backend_dir = Path(sqlite_template.__file__).resolve().parent.parent
    directory = sqlite_template.template_dir(backend_dir) if run_mode != "off" else None
    if directory is None:
        return
    request.addfinalizer(sqlite_template.install(run_mode=run_mode, directory=directory, backend_dir=backend_dir))


_SUFFIX_KEY = "soulledger_db_suffix"
_TEMPLATES_KEY = "soulledger_db_templates"
_templates_key = pytest.StashKey[dict]()  # what the workers clone
_drop_key = pytest.StashKey[dict]()  # what this run built and drops at the end (not a kept template)
_SUFFIX_KEY_STASH = pytest.StashKey[str]()


def _drop_pg_templates(config):
    """DROP every per-run template this process built (a kept one, GATES_IN_REMOTE=1, stays). WITH (FORCE):
    nothing should be connected to it, but a leftover on 115 is the one outcome this must not have."""
    templates = config.stash.get(_drop_key, {})
    if not templates:
        return
    from django.db import connections
    from pytest_django.plugin import blocking_manager_key

    with config.stash[blocking_manager_key].unblock():
        for alias, name in templates.items():
            creation = connections[alias].creation
            with creation._nodb_cursor() as cursor:
                cursor.execute(f"DROP DATABASE IF EXISTS {creation._quote_name(name)} WITH (FORCE)")
    config.stash[_drop_key] = {}


@pytest.hookimpl(tryfirst=True)
def pytest_sessionstart(session):
    """xdist controller only: build and migrate one template per PostgreSQL alias
    (on the remote gate box, GATES_IN_REMOTE=1: reuse the kept one for this input hash).

    `tryfirst` so this finishes before xdist's own sessionstart (`trylast`)
    spawns the workers. The controller collects no tests, so it builds every
    PostgreSQL alias, used or not.
    """
    config = session.config
    if hasattr(config, "workerinput"):
        return
    from django.conf import settings

    from config.testdb import run_suffix, template_names, wants_template

    if not wants_template(
        settings.DATABASES,
        distributing=config.pluginmanager.hasplugin("dsession"),
        reuse_db=bool(config.getoption("reuse_db", False)),
        nomigrations=bool(config.getoption("nomigrations", False)),
    ):
        return
    import os

    from django.db import connections
    from django.test.utils import setup_databases
    from pytest_django.plugin import blocking_manager_key

    from config.testdb import keeps_templates

    suffix = run_suffix()
    fresh = template_names(settings.DATABASES, suffix)
    config.stash[_SUFFIX_KEY_STASH] = suffix
    try:
        with config.stash[blocking_manager_key].unblock():
            if keeps_templates(os.environ):
                # Remote gate runs only: clone the kept template of this input hash (config/testdb.py).
                config.stash[_templates_key] = _kept_or_fresh_templates(config, fresh)
                return
            for alias, name in fresh.items():
                settings.DATABASES[alias].setdefault("TEST", {})["NAME"] = name
            config.stash[_templates_key] = fresh
            config.stash[_drop_key] = dict(fresh)
            setup_databases(verbosity=0, interactive=False, aliases=set(fresh), serialized_aliases=set())
            # CREATE DATABASE ... TEMPLATE refuses while anyone is connected to the template.
            connections.close_all()
    except BaseException:
        # sessionfinish never runs when sessionstart raises, so clean up here.
        _drop_pg_templates(config)
        raise


def _kept_or_fresh_templates(config, fresh):
    """GATES_IN_REMOTE=1: {alias: template the workers clone}. A kept template of this input hash is reused;
    a missing one is built and kept; a verifying run builds fresh, compares, and fails on any difference."""
    import os
    import sys
    import time
    from pathlib import Path

    import psycopg2
    from django.conf import settings
    from django.db import connections
    from django.test.utils import setup_databases

    from config import sqlite_template
    from config.testdb import (
        database_digests,
        database_exists,
        kept_template_names,
        objects_that_differ,
        prune_templates,
        touch_template,
    )

    def server_version(alias):
        with connections[alias].creation._nodb_cursor() as cursor:
            cursor.execute("SHOW server_version_num")
            return cursor.fetchone()[0]

    backend_dir = Path(sqlite_template.__file__).resolve().parent.parent
    hashes = {
        alias: sqlite_template.input_hash(
            backend_dir, {**sqlite_template.settings_inputs(settings, alias), "server": server_version(alias)}
        )
        for alias in fresh
    }
    kept = kept_template_names(settings.DATABASES, hashes)
    verify = sqlite_template.mode(os.environ, reuse_db=False, nomigrations=False, has_migration_tests=False) == "verify"
    existing = set()
    for alias, name in kept.items():
        with connections[alias].creation._nodb_cursor() as cursor:
            if database_exists(cursor, name):
                existing.add(alias)
    build = {alias: fresh[alias] for alias in fresh if verify or alias not in existing}
    use = {alias: kept[alias] for alias in fresh if alias not in build}
    if build:
        for alias, name in build.items():
            settings.DATABASES[alias].setdefault("TEST", {})["NAME"] = name
        config.stash[_drop_key] = dict(build)
        setup_databases(verbosity=0, interactive=False, aliases=set(build), serialized_aliases=set())
    connections.close_all()

    def digests(alias, name):
        d = connections[alias].settings_dict
        conn = psycopg2.connect(dbname=name, user=d["USER"], password=d["PASSWORD"], host=d["HOST"],
                                port=d["PORT"] or 5432)
        try:
            with conn.cursor() as cursor:
                return database_digests(cursor)
        finally:
            conn.close()

    for alias, name in build.items():
        with connections[alias].creation._nodb_cursor() as cursor:
            if alias in existing:
                diff = objects_that_differ(digests(alias, name), digests(alias, kept[alias]))
                if diff:
                    cursor.execute(f'DROP DATABASE IF EXISTS "{kept[alias]}" WITH (FORCE)')
                    raise sqlite_template.TemplateDriftError(
                        f"PostgreSQL test template {kept[alias]}: same input hash, but a real migrate produced "
                        f"different contents -> the hash in config/sqlite_template.py is missing an input. "
                        f"Template dropped. Differing objects: {', '.join(diff[:40])}"
                    )
                print(f"\nPostgreSQL test template {kept[alias]} verified against a real migrate.", file=sys.stderr)
                use[alias] = name  # this run tests what it just migrated; dropped at the end
                continue
            try:
                cursor.execute(f'ALTER DATABASE "{name}" RENAME TO "{kept[alias]}"')
            except Exception:  # noqa: BLE001 -- a concurrent run kept one first: run on ours, drop it after
                use[alias] = name
                continue
            config.stash[_drop_key].pop(alias, None)
            use[alias] = kept[alias]
    for alias in kept:
        with connections[alias].creation._nodb_cursor() as cursor:
            if database_exists(cursor, kept[alias]):
                touch_template(cursor, kept[alias], time.time())
                prune_templates(cursor, kept[alias])
    connections.close_all()
    print(f"\nPostgreSQL test templates: {', '.join(f'{a}={n}' for a, n in sorted(use.items()))} "
          f"({'built' if build else 'kept, no migrate'})", file=sys.stderr)
    return use



@pytest.hookimpl(optionalhook=True)
def pytest_configure_node(node):
    """xdist controller: tell each worker the run suffix and the templates."""
    templates = node.config.stash.get(_templates_key, {})
    if templates:
        node.workerinput[_SUFFIX_KEY] = node.config.stash[_SUFFIX_KEY_STASH]
        node.workerinput[_TEMPLATES_KEY] = dict(templates)


@pytest.hookimpl(trylast=True)
def pytest_sessionfinish(session):
    """Controller: drop the templates after xdist has shut the workers down
    (its sessionfinish is a plain impl, so `trylast` here runs after it)."""
    if not hasattr(session.config, "workerinput"):
        _drop_pg_templates(session.config)


@pytest.fixture(scope="session")
def django_db_setup(django_db_setup, django_db_blocker):
    """Close the database connection that `database_sync_to_async` left open,
    before pytest-django drops the test database.

    Async tests call `database_sync_to_async` with no outer `async_to_sync`, so
    asgiref runs the ORM in `SyncToAsync.single_thread_executor` -- one thread
    that lives as long as the process. `CONN_MAX_AGE=600` (settings.py) makes
    `close_old_connections()` keep that thread's connection open, and
    `destroy_test_db()` only closes the main thread's. So `DROP DATABASE` met
    "is being accessed by other users", pytest-django turned that into a
    PytestWarning, the run exited 0, and `test_soulledger` stayed on the
    PostgreSQL box. Reproduced 2026-09-26 with one test,
    `tests/test_workflow_events.py::TestWorkflowEventService::test_log_workflow_created`.
    This teardown runs before pytest-django's, because it overrides that fixture.

    Then, on PostgreSQL, terminate any other session still on this run's test
    database: pytest-django's DROP has no FORCE, and after the 2026-10-19 drop
    the server held the dead client's session as idle, so the worker database
    stayed on 115. Only `test_soulledger_...` names are touched (config/testdb.py).
    """
    yield
    from asgiref.sync import SyncToAsync
    from django.db import connections

    from config.testdb import is_disposable_test_db, postgres_aliases, terminate_other_sessions

    SyncToAsync.single_thread_executor.submit(connections.close_all).result()
    connections.close_all()
    with django_db_blocker.unblock():
        for alias in postgres_aliases({a: connections[a].settings_dict for a in connections}):
            creation = connections[alias].creation
            name = connections[alias].settings_dict["NAME"]
            if is_disposable_test_db(name):
                with creation._nodb_cursor() as cursor:
                    terminate_other_sessions(cursor, name)


@pytest.fixture(autouse=True)
def _block_embedding_service(monkeypatch):
    """No test reaches the Ollama embedding host (docs/ARCHITECTURE-soul-assist.md §7.7).

    `apps/soul_assist/vectors.py::_post` is the only place the assistant's
    retrieval goes on the network, and its default URL is a real LAN machine
    (192.168.2.2). Every test gets a `_post` that fails like a dead host, so an
    unfaked call takes the fallback path instead of silently embedding against
    whatever is listening there. Tests that want vectors install their own fake
    over this one (`tests/test_assist_rag.py`).
    """
    from apps.soul_assist import vectors

    def blocked(url, payload, timeout):
        raise vectors.EmbeddingError("connection", f"network blocked in tests: {url}")

    monkeypatch.setattr(vectors, "_post", blocked)

    # Same for the provider block's two outbound calls (`apps/soul_assist/platforms.py::_get`):
    # listing a platform's models and fetching the LiteLLM price table. Unfaked, a test fails like a
    # dead host (list → `connection`, price → not found) instead of reaching a vendor or GitHub.
    import requests

    from apps.soul_assist import platforms

    def blocked_get(url, headers, timeout):
        raise requests.ConnectionError(f"network blocked in tests: {url}")

    monkeypatch.setattr(platforms, "_get", blocked_get)


def _db_kind(item):
    """'tx' for a transactional test, 'db' for a plain one, None for no database — pytest-django's own rule."""
    marker = item.get_closest_marker("django_db")
    if marker is not None and marker.kwargs.get("transaction"):
        return "tx"
    names = getattr(item, "fixturenames", ())
    if "transactional_db" in names or "live_server" in names:
        return "tx"
    if marker is not None or "db" in names:
        return "db"
    return None


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(config, items):
    """Refuse a run in which a plain database test comes after a transactional one.

    A ``transaction=True`` test truncates every table when it ends, including
    the rows data migrations seed (roles, permissions, menus), and nothing puts
    them back. About twenty-five plain ``db`` tests read those rows and passed
    only because pytest-django sorts transactional tests last; a plugin that
    reordered tests after that (testmon, random ordering) broke them with a
    ``DoesNotExist`` that points at the test, not at the order. 2026-09-30,
    with transactional tests moved first: 25 failures in 8 files. Fifteen of them
    were then made to create their own rows (``tests/perm_support.py``) and the
    whole suite passed in that order (5699 passed). The guard stays for tests
    written since: stop the run at collection instead, naming the first test
    out of place. ``trylast`` so
    this sees the final order; under xdist every worker collects the same list
    and receives items in increasing index order, so the check holds there too.
    """
    seen_tx = None
    for item in items:
        kind = _db_kind(item)
        if kind == "tx":
            seen_tx = seen_tx or item.nodeid
        elif kind == "db" and seen_tx:
            raise pytest.UsageError(
                f"{item.nodeid} (plain database test) is ordered after {seen_tx} (transactional). "
                "A transactional test truncates the rows data migrations seed, so later plain tests "
                "lose them. Something reordered tests after pytest-django; see conftest.py."
            )



@pytest.fixture(autouse=True)
def _soup_not_required_by_default(settings):
    """孟婆汤(2026-10-25)只在专门的测试里打开(`settings.MENGPO_SOUP_REQUIRED = True`);其余转世测试不必先饮汤。"""
    settings.MENGPO_SOUP_REQUIRED = False


@pytest.fixture(autouse=True)
def _mfa_setup_not_enforced_by_default(settings):
    """必需角色未开两步验证即受限(2026-10-29)只在专门的测试里打开(`settings.MFA_SETUP_ENFORCED = True`,
    `tests/test_mfa_setup_is_enforced.py`);其余测试里的管理员不必先绑验证器。生产恒为真(config/settings.py)。"""
    settings.MFA_SETUP_ENFORCED = False
