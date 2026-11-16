"""Shadow reads: ask every GET endpoint the same question twice -- with a civilization's reads where they are
and with them cut over to its shard -- and compare the answers (stage 3, docs/audit/2026-11-15-sharding/PLAN.md).

Shared by the in-repo guard (tests/test_sharded_reads_equal_single_db.py, a random world) and the 115 exit
check (`manage.py shadow_read_diff`, the live database). Endpoints come from the URLconf, never a list here.

Every request runs inside a transaction on every database that is always rolled back, so nothing a GET writes
(an audit row for an export, a profile made on first read) survives. The transaction is marked the way a test
case marks its own (`_from_testcase`): `shard_reads.reads_control` takes only the code's own transactions for
"read your writes", so the reads inside still go where the cut-over sends them.
"""
import json
import re
import time
from contextlib import ExitStack, contextmanager
from unittest import mock
from urllib.parse import urlsplit

from django.conf import settings
from django.core.cache import caches
from django.db import connections, transaction
from django.test import override_settings
from django.urls import get_resolver, reverse

#: Response keys whose value is the moment of the request, not data: the clock, and a problem response's
#: `instance` (the request's trace id).
VOLATILE = {"as_of", "generated_at", "server_time", "now", "instance"}
#: Endpoints whose GET writes the row it answers with (each request is rolled back, so each makes a new one):
#: the keys that are new every time.
WRITES_ON_READ = {"social-profile-me": {"id"}}


# ---- endpoints, from the URLconf ------------------------------------------------------------------------

def _walk(resolver=None, ns="", out=None):
    out = [] if out is None else out
    for p in (resolver or get_resolver()).url_patterns:
        if hasattr(p, "url_patterns"):
            if p.namespace == "admin":
                continue
            _walk(p, f"{ns}{p.namespace}:" if p.namespace else ns, out)
            continue
        out.append((ns, p))
    return out


def endpoints():
    """{case id: (url name, kwargs names, view class, action)} for every named pattern a GET reaches.
    Format-suffix duplicates are left out (same view)."""
    found = {}
    for ns, p in _walk():
        cb, name = p.callback, p.name
        cls = getattr(cb, "cls", None)
        if cls is None or not name:
            continue
        kwargs = tuple(sorted(p.pattern.regex.groupindex))
        if "format" in kwargs:
            continue
        actions = getattr(cb, "actions", None)
        if actions is not None:
            if "get" not in actions:
                continue
            action = actions["get"]
        elif hasattr(cls, "get") and "get" in getattr(cls, "http_method_names", ()):
            action = "get"
        else:
            continue
        found[f"{ns}{name}"] = (f"{ns}{name}", kwargs, cls, action)
    return found


def list_route_of(found, cls):
    return next((name for name, (_, kw, c, a) in found.items() if c is cls and a == "list" and not kw), None)


def urls_for(found, case, list_answer, rng, n=4):
    """The URLs to ask for `case`: itself, or -- a detail route -- up to `n` ids from `list_answer`, the
    (status, body) its viewset's list gave. [] when the route needs kwargs no list gives."""
    name, kwargs, cls, _action = found[case]
    if not kwargs:
        return [reverse(name)]
    lookup = getattr(cls, "lookup_url_kwarg", None) or getattr(cls, "lookup_field", "pk")
    if kwargs != (lookup,) or list_answer is None:
        return []
    status, body = list_answer
    field = getattr(cls, "lookup_field", "pk")
    rows = body if isinstance(body, list) else body.get("results", []) if isinstance(body, dict) else []
    ids = [r.get(field, r.get("id")) for r in (rows if status == 200 else []) if isinstance(r, dict)]
    ids = [i for i in ids if i is not None]
    return [reverse(name, kwargs={lookup: i}) for i in rng.sample(ids, min(n, len(ids)))]


# ---- nothing leaves the process -----------------------------------------------------------------------------

class UnreachableMatrix:
    """The Matrix client of a shadow run: Synapse unreachable, on both sides alike (a real client would make
    users and rooms there, which no rollback undoes)."""

    def __getattr__(self, name):
        from apps.chat.matrix import MatrixError

        def unreachable(*args, **kwargs):
            raise MatrixError("shadow_read_diff: Synapse is not asked")
        return unreachable


_running = []  # the dispatch record of the `isolated()` this process is inside, if any


def _real_matrix():
    from django.utils.module_loading import import_string

    from apps.chat.matrix import SynapseClient

    try:
        return issubclass(import_string(settings.MATRIX_CLIENT), SynapseClient)
    except ImportError:
        return False


@contextmanager
def isolated():
    """Run the block with no effect outside this process (module header). Yields the list of Celery dispatches
    it held back, as (task name, args, kwargs). Re-entrant: inside another `isolated()` it is that one."""
    if _running:
        yield _running[-1]
        return
    from celery import Celery
    from celery.app.task import Task
    from celery.result import AsyncResult

    from apps.perm import cache as perm_cache

    sent = []

    def task_apply_async(task, args=None, kwargs=None, *rest, **options):
        sent.append((task.name, tuple(args or ()), dict(kwargs or {})))
        return AsyncResult(options.get("task_id") or f"shadow-{len(sent)}")

    def app_send_task(app, name, args=None, kwargs=None, *rest, **options):
        sent.append((name, tuple(args or ()), dict(kwargs or {})))
        return AsyncResult(options.get("task_id") or f"shadow-{len(sent)}")

    memory_perms = perm_cache.PermissionCache.__new__(perm_cache.PermissionCache)
    memory_perms._redis_client, memory_perms._fallback_cache = None, {}
    memory_perms._retry_cooldown = float("inf")  # never (re)connects
    memory_perms._last_connect_failure = 0.0
    overrides = {
        "CACHES": {alias: {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": f"shadow-{alias}"}
                   for alias in settings.CACHES},
        "EMAIL_BACKEND": "django.core.mail.backends.locmem.EmailBackend",
        "CHANNEL_LAYERS": {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
    }
    if _real_matrix():
        overrides["MATRIX_CLIENT"] = f"{__name__}.UnreachableMatrix"
    with ExitStack() as stack:
        stack.enter_context(override_settings(**overrides))
        stack.enter_context(mock.patch.object(Task, "apply_async", task_apply_async))
        stack.enter_context(mock.patch.object(Celery, "send_task", app_send_task))
        stack.enter_context(mock.patch.object(perm_cache, "_permission_cache", memory_perms))
        _running.append(sent)
        try:
            yield sent
        finally:
            _running.pop()


# ---- asking -----------------------------------------------------------------------------------------------

@contextmanager
def rolled_back():
    """A transaction on every database, always rolled back; not a transaction "of the code" (module header)."""
    atomics = []
    for alias in connections:
        a = transaction.atomic(using=alias)
        a._from_testcase = True
        a.__enter__()
        atomics.append((alias, a))
    try:
        yield
    finally:
        for alias, a in reversed(atomics):
            transaction.set_rollback(True, using=alias)
            a.__exit__(None, None, None)


@contextmanager
def measured():
    """{"queries": n, "ms": t} of the block: statements on every database, and wall time. The cost columns of
    `shadow_read_diff` (review 2026-11-16 2.0); not part of any answer that is compared."""
    out = {"queries": 0, "ms": 0.0}

    def count(execute, sql, params, many, context):
        out["queries"] += 1
        return execute(sql, params, many, context)

    started = time.perf_counter()
    try:
        with ExitStack() as stack:
            for alias in connections:
                stack.enter_context(connections[alias].execute_wrapper(count))
            yield out
    finally:
        out["ms"] = (time.perf_counter() - started) * 1000


def fetch(client, url, max_pages=None, trace=False, **extra):
    """(status, body) -- every page of a paginated list joined (at most `max_pages`); an exception is an answer
    too. Rolled back on every database; nothing leaves the process (`isolated`)."""
    with isolated(), rolled_back():
        return _fetch_pages(client, url, max_pages, trace, extra)


def _fetch_pages(client, url, max_pages, trace, extra):
    for c in caches.all():  # this run's LocMem (`isolated`): each request starts from an empty cache
        c.clear()
    rows, body, status, pages = [], None, None, 0
    while url:
        try:
            res = client.get(url, **extra)
        except Exception as e:  # noqa: BLE001 -- the other side must raise the same
            if trace:
                import traceback

                where = [f"{f.filename.split('backend/')[-1]}:{f.lineno} {f.name}"
                         for f in traceback.extract_tb(e.__traceback__)
                         if "/apps/" in f.filename and "shard_reads" not in f.filename]
                return "raised", f"{type(e).__name__}: {str(e)[:200]} AT {where[-3:]}"
            return "raised", f"{type(e).__name__}: {str(e)[:300]}"
        status = res.status_code
        ctype = res.get("Content-Type", "")
        if "json" not in ctype:  # CSV, YAML, a PDF: the bytes, but what is new on every request
            data = b"".join(res.streaming_content) if getattr(res, "streaming", False) else getattr(res, "content", b"")
            text = data.decode(errors="replace") if b"\x00" not in data[:1024] else str(len(data))
            text = re.sub(r'nonce="[^"]*"|"X-CSRFTOKEN"] = "[^"]*"', "", text)
            return status, (ctype, "\n".join(ln for ln in text.splitlines() if not ln.startswith("instance:")))
        try:
            body = res.json()
        except ValueError:  # a JSON-ish content type that is not one document (a stream of lines, YAML)
            text = res.content.decode(errors="replace")
            return status, "\n".join(ln for ln in text.splitlines() if not ln.startswith("instance:"))
        if isinstance(body, dict) and "results" in body and "count" in body:
            rows.extend(body["results"])
            pages += 1
            nxt = body.get("next")
            url = None if not nxt or (max_pages and pages >= max_pages) else _path(nxt)
            continue
        return status, canon(body)
    return status, {"count": body["count"], "results": canon(rows)}


def _path(url):
    parts = urlsplit(url)
    return f"{parts.path}?{parts.query}" if parts.query else parts.path


# ---- comparing --------------------------------------------------------------------------------------------

def _volatile(key):
    return key in VOLATILE or key.endswith("_remaining_seconds")  # seconds left until a deadline, at the request


def canon(value):
    if isinstance(value, dict):
        return {k: canon(v) for k, v in sorted(value.items()) if not _volatile(k)}
    if isinstance(value, list):
        return sorted((canon(v) for v in value), key=lambda v: json.dumps(v, sort_keys=True, default=str))
    return value


def drop(answer, keys):
    status, body = answer
    return (status, {k: v for k, v in body.items() if k not in keys}) if keys and isinstance(body, dict) else answer


def has_data(answer):
    status, body = answer
    if status != 200:
        return False
    if isinstance(body, dict) and "results" in body:
        return bool(body["results"])
    return bool(body)


def diff(base, cut):
    """What differs, short: the status, the rows only one side has, or the first differing key / line."""
    if base[0] == cut[0] and isinstance(base[1], tuple) and isinstance(cut[1], tuple):
        a, b = str(base[1][1]).splitlines(), str(cut[1][1]).splitlines()
        first = next((i for i, (x, y) in enumerate(zip(a, b, strict=False)) if x != y), min(len(a), len(b)))
        return f"line {first}: {a[first:first + 1]} | {b[first:first + 1]}"[:900]
    if base[0] == cut[0] and isinstance(base[1], list) and isinstance(cut[1], list):  # an unpaginated list
        return diff((base[0], {"results": base[1]}), (cut[0], {"results": cut[1]}))
    if base[0] != cut[0] or not (isinstance(base[1], dict) and isinstance(cut[1], dict)):
        return f"before {str(base)[:300]} | cut over {str(cut)[:300]}"
    a, b = base[1], cut[1]
    if "results" in a and "results" in b:
        da = {json.dumps(r, sort_keys=True, default=str) for r in a["results"]}
        db = {json.dumps(r, sort_keys=True, default=str) for r in b["results"]}
        by_id = {r.get("id"): r for r in b["results"] if isinstance(r, dict)}
        for row in a["results"]:
            other = by_id.get(row.get("id")) if isinstance(row, dict) else None
            if other is not None and other != row:  # the same row, answered differently: which keys
                keys = sorted(k for k in set(row) | set(other) if row.get(k) != other.get(k))
                return f"row {row.get('id')}: " + "; ".join(f"{k}: {row.get(k)!r} | {other.get(k)!r}" for k in keys)[:900]
        return (f"count {a.get('count')} vs {b.get('count')}; only before: {sorted(da - db)[:2]}; "
                f"only cut over: {sorted(db - da)[:2]}")[:900]
    keys = [k for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)]
    return f"keys {keys[:5]}: {str(a.get(keys[0]))[:250]} | {str(b.get(keys[0]))[:250]}" if keys else "?"
