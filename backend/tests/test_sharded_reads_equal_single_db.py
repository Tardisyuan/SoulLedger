"""Stage 3 core guard: cutting every civilization's reads over to its shard changes no answer
(docs/audit/2026-11-15-sharding/PLAN.md 阶段 3). The single database is the baseline.

One random world per module (seed printed, `SHARDED_READS_SEED=<n>` replays it): rows in halls of all four
civilizations, a hall of UNKNOWN civilization and no hall; every key that may cross civilizations pointed
across on some row; a soul residing abroad, a soul back from residence with the rows its residence wrote,
both with a soul account. It is synced to the shards and `reconcile_shards --all` must be clean (no row
missing, none dangling) -- the precondition for cutting a civilization over.

Then every URL pattern a GET reaches -- derived from the URLconf, one test case each so xdist spreads them --
is asked by every caller: each hall role in some hall, every hall's ADMIN, each civilization's ADMIN,
SYSTEM_ADMIN and two soul accounts. Once with `SHARD_READ_CIVS=[]` (the baseline), once with all four cut
over; status and body must be equal (every page; volatile keys dropped, lists compared as multisets -- the
order of a merge is held exactly by `test_fanout_slices_equal_the_single_database`). A case in which no
caller had data on either side is a skip, so the summary line says how many endpoints compared nothing.

The world is built once per module inside an outer transaction on every database and rolled back at the
end (Django's setUpTestData shape); each case runs in a savepoint inside it.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_sharded_reads_equal_single_db.py
"""
import json
import os
import random
import re

import pytest
from django.apps import apps
from django.core.cache import caches
from django.db import IntegrityError, connections, transaction
from django.test import override_settings
from django.urls import get_resolver, reverse
from rest_framework.pagination import PageNumberPagination

from apps.core.shard_reads import FANOUT, crossing_keys, read_context
from apps.core.sharding import SHARD, NoShardContext, alias_for_civilization, placement, tenant_path
from tests.test_shard_sync import CIVS, HAS_SHARDS, sharded

SEED = int(os.environ.get("SHARDED_READS_SEED") or random.SystemRandom().randrange(10 ** 6))
#: Response keys whose value is the moment of the request, not data: the clock, and a problem response's
#: `instance` (the request's trace id).
VOLATILE = {"as_of", "generated_at", "server_time", "now", "instance"}
#: Endpoints whose GET writes the row it answers with (each request is rolled back, so each makes a new one):
#: the keys that are new every time.
WRITES_ON_READ = {"social-profile-me": {"id"}}
PAGE_SIZE = 3


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


def _endpoints():
    """{case id: (url name, kwargs names, viewset class, action)} for every named pattern a GET reaches.
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


ENDPOINTS = _endpoints()


def _list_route_of(cls):
    return next((name for name, (_, kw, c, a) in ENDPOINTS.items() if c is cls and a == "list" and not kw), None)


# ---- the world --------------------------------------------------------------------------------------------

def _outer_atomics():
    atomics = []
    for alias in connections:
        a = transaction.atomic(using=alias)
        a._from_testcase = True  # not a transaction of the code: reads inside it are not "read your writes"
        a.__enter__()
        atomics.append((alias, a))
    return atomics


def _rollback(atomics):
    for alias, a in reversed(atomics):
        transaction.set_rollback(True, using=alias)
        a.__exit__(None, None, None)


def _rows_of(model, halls):
    return list(model._base_manager.filter(**{f"{tenant_path(model)}__in": halls}).values_list("pk", flat=True))


def _point_across(rng, f, halls_by_civ, why):
    """Point one row of one civilization at a row of another through crossing key `f`."""
    for civ in rng.sample(CIVS, len(CIVS)):
        rows = _rows_of(f.model, halls_by_civ[civ])
        targets = _rows_of(f.related_model, [h for c in CIVS if c != civ for h in halls_by_civ[c]])
        rng.shuffle(rows)
        why[f"{f.model._meta.label}.{f.name}"] = f"{civ}: {len(rows)} rows, {len(targets)} targets"
        for pk in rows[:10]:
            if not targets:
                break
            try:
                with transaction.atomic(using="default"):
                    f.model._base_manager.filter(pk=pk).update(**{f.attname: rng.choice(targets)})
                return True
            except IntegrityError as e:
                why[f"{f.model._meta.label}.{f.name}"] += f"; {e}"[:120]
                continue
    return False


def _fill_m2m(rng, models_with_rows):
    from apps.authentication.models import User

    for model in models_with_rows:
        for m2m in model._meta.many_to_many:
            for obj in model._base_manager.all()[:5]:
                target = m2m.related_model
                pool = list(target._base_manager.all()[:20]) if target is not User else list(
                    User.objects.filter(tenant__isnull=False)[:20])
                if pool:
                    getattr(obj, m2m.name).add(rng.choice(pool))


def _residence(rng, home, away, cache, counter, returned):
    """A soul of `home` dispatched to `away` (executed), the rows its residence wrote about it, and -- when
    `returned` -- the soul back home with those rows left in `away`. Its soul account is the caller."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.souls.models import Soul
    from tests.soul_account_support import move_soul, ready_soul
    from tests.test_admin_is_civilization_scoped import _make

    account, client = ready_soul(home, name=f"mover-{home.code}")
    soul = account.soul
    _make(DispatchRecord, home, cache, counter, ("tenant",), {
        "status": DispatchStatus.EXECUTED, "soul": soul, "source_tenant": home, "target_tenant": away})
    move_soul(soul, away)
    for f in crossing_keys():
        if f.related_model is Soul and f.model is not DispatchRecord:
            try:
                with transaction.atomic(using="default"):
                    _make(f.model, away, {}, counter, tuple(tenant_path(f.model).split("__")), {f.name: soul})
            except Exception:  # noqa: BLE001 -- a model the filler cannot make with a soul fixed: skip it
                continue
    if returned:
        move_soul(Soul._base_manager.get(pk=soul.pk), home)
        DispatchRecord._base_manager.filter(soul=soul).update(status=DispatchStatus.RETURNED)
    return client


def _build(rng):
    from apps.authentication.models import User, UserRole
    from apps.souls.models import Soul, SoulState
    from apps.tenants.models import Tenant
    from tests.test_admin_is_civilization_scoped import EXTRA_ROWS, _client, _list_routes, _make
    from tests.test_shard_sync import _reconcile, _sync
    from tests.test_tenant_scoping_contract import _model_for
    from tests.test_tenant_scoping_contract import _tenant_path as scoping_path

    halls_by_civ = {}
    for civ in CIVS:
        halls_by_civ[civ] = [Tenant.objects.create(code=f"{civ[:2]}_W{i}", display_name=f"{civ} {i}",
                                                   declared_civilization=civ) for i in range(rng.randint(1, 2))]
    unknown = Tenant.objects.create(code="UNKNOWN_W", display_name="unknown", declared_civilization="")
    halls = [h for hs in halls_by_civ.values() for h in hs] + [unknown]
    counter, unmade = [0], set()
    served = sorted({_model_for(cls) for _n, cls in _list_routes()} - {Tenant}, key=lambda m: m.__name__)
    for hall in halls:
        cache = {}
        for i in range(rng.randint(2, 4)):
            Soul.objects.create(name=f"s-{hall.code}-{i}", tenant=hall, current_state=SoulState.JUDGING,
                                merit_score=rng.randint(0, 50))
        for model in served:
            path = tuple(scoping_path(model).split("__"))
            for _ in range(rng.randint(1, 2)):
                try:
                    with transaction.atomic(using="default"):
                        _make(model, hall, cache, counter, path)
                except Exception as e:  # noqa: BLE001 -- one row per hall (a root organization), a beat schedule...
                    unmade.add(f"{model.__name__}: {type(e).__name__}")
            for values in EXTRA_ROWS.get(model.__name__, []):
                _make(model, hall, cache, counter, path, values)
    with_rows = [m for m in apps.get_models() if placement(m) == SHARD and m._base_manager.exists()]
    _fill_m2m(rng, with_rows)
    from apps.audit.models import AuditAction, AuditLog

    AuditLog.objects.create(tenant=None, action=AuditAction.READ, resource="soul", resource_id="hall-less")
    why = {}
    for f in crossing_keys():  # a row to point across in every hall, where the filler did not make one
        for hall in [h for hs in halls_by_civ.values() for h in hs]:
            if not _rows_of(f.model, [hall]):
                try:
                    with transaction.atomic(using="default"):
                        _make(f.model, hall, {}, counter, tuple(tenant_path(f.model).split("__")))
                except Exception:  # noqa: BLE001,S110 -- the filler cannot make this one: the next hall may
                    pass
    crossed = [f for f in crossing_keys() if _point_across(rng, f, halls_by_civ, why)]
    cache, known = {}, [h for hs in halls_by_civ.values() for h in hs]
    home, away, home2, away2 = _pairs(rng, halls_by_civ)
    souls = [_residence(rng, home, away, cache, counter, returned=False),
             _residence(rng, home2, away2, cache, counter, returned=True)]

    def user(name, role, hall=None, **kw):
        u = User.objects.create_user(username=name, password="x", role=role, tenant=hall, **kw)
        return _client(u, hall)

    callers = {f"ADMIN@{h.code}": user(f"adm-{h.code}", UserRole.ADMIN, h) for h in halls}
    for i, role in enumerate([UserRole.JUDGE, UserRole.MODERATOR, UserRole.GUARDIAN, UserRole.VIEWER]):
        h = known[(i + rng.randrange(len(known))) % len(known)]
        callers[f"{role}@{h.code}"] = user(f"{role.lower()}-{h.code}", role, h)
    for civ in CIVS:
        callers[f"ADMIN@{civ}"] = user(f"civ-{civ}", UserRole.ADMIN, civilization=civ)
    callers["SYSTEM_ADMIN"] = user("sys", UserRole.SYSTEM_ADMIN)
    callers["soul abroad"], callers["soul back home"] = souls
    _sync()
    code, out = _reconcile("--all")
    assert code == 0 and "not copied" not in out and "dangling" not in out, out
    print(f"models the filler could not make in some hall: {sorted(unmade)}")
    return {"callers": callers, "crossed": crossed, "halls": halls, "why_not_crossed": why}


def _pairs(rng, halls_by_civ):
    a, b, c, d = rng.sample(CIVS, 4)
    return (rng.choice(halls_by_civ[a]), rng.choice(halls_by_civ[b]), rng.choice(halls_by_civ[c]),
            rng.choice(halls_by_civ[d]))


@pytest.fixture(scope="module")
def world(django_db_setup, django_db_blocker):
    if not HAS_SHARDS:
        pytest.skip("needs --ds=config.settings_sharded")
    print(f"SHARDED_READS_SEED={SEED}")
    with django_db_blocker.unblock():
        atomics = _outer_atomics()
        try:
            yield _build(random.Random(SEED))
        finally:
            _rollback(atomics)


@pytest.fixture(autouse=True)
def _small_pages(monkeypatch):
    """Every list has several pages, so a merge that slices before merging shows."""
    monkeypatch.setattr(PageNumberPagination, "page_size", PAGE_SIZE)


# ---- comparing ---------------------------------------------------------------------------------------------

def _volatile(key):
    return key in VOLATILE or key.endswith("_remaining_seconds")  # seconds left until a deadline, at the request


def _canon(value):
    if isinstance(value, dict):
        return {k: _canon(v) for k, v in sorted(value.items()) if not _volatile(k)}
    if isinstance(value, list):
        return sorted((_canon(v) for v in value), key=lambda v: json.dumps(v, sort_keys=True, default=str))
    return value


def _fetch(client, url):
    """(status, body) -- every page of a paginated list joined; an exception is an answer too. What the request
    writes (an audit row for an export, a stamp) is rolled back, so the next request reads the same world -- in
    a savepoint marked as the test case's own, which `reads_control` does not take for the code's transaction."""
    sp = transaction.atomic(using="default")
    sp._from_testcase = True
    sp.__enter__()
    try:
        return _fetch_pages(client, url)
    finally:
        transaction.set_rollback(True, using="default")
        sp.__exit__(None, None, None)


def _fetch_pages(client, url):
    for c in caches.all():
        c.clear()
    rows, body, status = [], None, None
    while url:
        try:
            res = client.get(url)
        except Exception as e:  # noqa: BLE001 -- the other side must raise the same
            if os.environ.get("SHARDED_READS_TRACE"):
                import traceback

                where = [f"{f.filename.split('backend/')[-1]}:{f.lineno} {f.name}" for f in traceback.extract_tb(e.__traceback__)
                         if "/apps/" in f.filename and "shard_reads" not in f.filename]
                return "raised", f"{type(e).__name__}: {str(e)[:200]} AT {where[-3:]}"
            return "raised", f"{type(e).__name__}: {str(e)[:300]}"
        status = res.status_code
        ctype = res.get("Content-Type", "")
        if "json" not in ctype:  # CSV, YAML, a PDF: the bytes, but the trace id a problem body carries
            body = getattr(res, "content", b"") if not getattr(res, "streaming", False) else b"".join(res.streaming_content)
            text = body.decode(errors="replace") if b"\x00" not in body[:1024] else str(len(body))
            text = re.sub(r'nonce="[^"]*"|"X-CSRFTOKEN"] = "[^"]*"', "", text)  # a page's nonce and CSRF token are new on every request
            return status, (ctype, "\n".join(ln for ln in text.splitlines() if not ln.startswith("instance:")))
        try:
            body = res.json()
        except ValueError:  # a JSON-ish content type that is not one document (a stream of lines, YAML)
            text = res.content.decode(errors="replace")
            return status, "\n".join(ln for ln in text.splitlines() if not ln.startswith("instance:"))
        if isinstance(body, dict) and "results" in body and "count" in body:
            rows.extend(body["results"])
            url = body.get("next")
            if url:
                url = url.split("testserver", 1)[-1]
            continue
        return status, _canon(body)
    return status, {"count": body["count"], "results": _canon(rows)}


def _diff(base, cut):
    """What differs, short: the status, the rows only one side has, or the first differing key / line."""
    if base[0] == cut[0] and isinstance(base[1], tuple) and isinstance(cut[1], tuple):
        a, b = str(base[1][1]).splitlines(), str(cut[1][1]).splitlines()
        first = next((i for i, (x, y) in enumerate(zip(a, b, strict=False)) if x != y), min(len(a), len(b)))
        return f"line {first}: {a[first:first + 1]} | {b[first:first + 1]}"[:900]
    if base[0] != cut[0] or not (isinstance(base[1], dict) and isinstance(cut[1], dict)):
        return f"single db {str(base)[:300]} | cut over {str(cut)[:300]}"
    a, b = base[1], cut[1]
    if "results" in a and "results" in b:
        da = {json.dumps(r, sort_keys=True, default=str) for r in a["results"]}
        db = {json.dumps(r, sort_keys=True, default=str) for r in b["results"]}
        return (f"count {a.get('count')} vs {b.get('count')}; only single db: {sorted(da - db)[:2]}; "
                f"only cut over: {sorted(db - da)[:2]}")[:900]
    keys = [k for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)]
    return f"keys {keys[:5]}: {str(a.get(keys[0]))[:250]} | {str(b.get(keys[0]))[:250]}" if keys else "?"


def _drop(answer, keys):
    status, body = answer
    return (status, {k: v for k, v in body.items() if k not in keys}) if keys and isinstance(body, dict) else answer


def _has_data(answer):
    status, body = answer
    if status != 200:
        return False
    if isinstance(body, dict) and "results" in body:
        return bool(body["results"])
    return bool(body)


def _urls(case, world):
    name, kwargs, cls, action = ENDPOINTS[case]
    if not kwargs:
        return [reverse(name)]
    lookup = getattr(cls, "lookup_url_kwarg", None) or getattr(cls, "lookup_field", "pk")
    lst = _list_route_of(cls)
    if kwargs != (lookup,) or lst is None:
        return []
    with override_settings(SHARD_READ_CIVS=[]):
        status, body = _fetch(world["callers"]["SYSTEM_ADMIN"], reverse(lst))
    field = getattr(cls, "lookup_field", "pk")
    rows = body if isinstance(body, list) else body.get("results", []) if isinstance(body, dict) else []
    ids = [r.get(field, r.get("id")) for r in (rows if status == 200 else []) if isinstance(r, dict)]
    ids = [i for i in ids if i is not None]
    rng = random.Random(f"{SEED}:{case}")
    return [reverse(name, kwargs={lookup: i}) for i in rng.sample(ids, min(4, len(ids)))]


@sharded
@pytest.mark.parametrize("case", sorted(ENDPOINTS))
def test_cut_over_reads_answer_like_the_single_database(world, case):
    urls = _urls(case, world)
    if not urls:
        pytest.skip(f"{case}: needs URL kwargs ({ENDPOINTS[case][1]}) no list here gives")
    mismatches, with_data = [], 0
    for who, client in world["callers"].items():
        for url in urls:
            with override_settings(SHARD_READ_CIVS=[]):
                base = _drop(_fetch(client, url), WRITES_ON_READ.get(case, ()))
            with override_settings(SHARD_READ_CIVS=list(CIVS)):
                cut = _drop(_fetch(client, url), WRITES_ON_READ.get(case, ()))
            if base != cut:
                mismatches.append(f"{who} GET {url}: {_diff(base, cut)}")
            elif _has_data(base):
                with_data += 1
    assert not mismatches, f"SHARDED_READS_SEED={SEED}\n" + "\n".join(mismatches[:6])
    if not with_data:
        pytest.skip(f"{case}: no caller had data here (both sides equal)")


# ---- the merge itself, row order included -------------------------------------------------------------------

@sharded
def test_fanout_slices_equal_the_single_database(world):
    """Every SHARD model with rows, in its own order with the pk as the last key: random slices read across every
    shard (FANOUT) equal the same slices of the single database, order included."""
    rng = random.Random(f"{SEED}:slices")
    checked = 0
    for model in apps.get_models():
        if placement(model) != SHARD or not model._base_manager.exists():
            continue
        ordering = [o for o in (model._meta.ordering or []) if isinstance(o, str)] + ["pk"]
        n = model._base_manager.count()
        for _ in range(3):
            low = rng.randrange(n)
            high = low + rng.randint(1, PAGE_SIZE)
            with override_settings(SHARD_READ_CIVS=[]):
                base = list(model._base_manager.order_by(*ordering).values_list("pk", flat=True)[low:high])
                total = model._base_manager.count()
            with override_settings(SHARD_READ_CIVS=list(CIVS)), read_context(FANOUT):
                cut = [o.pk for o in model._base_manager.order_by(*ordering)[low:high]]
                merged_total = model._base_manager.count()
            assert cut == base, (model._meta.label, ordering, low, high, f"SHARDED_READS_SEED={SEED}")
            assert merged_total == total, model._meta.label
        checked += 1
    assert checked >= 40, checked


@sharded
def test_each_shard_leg_holds_rows(world):
    """Not vacuous: after the sync every shard, and control, answer rows of the models the endpoints serve."""
    from apps.souls.models import Soul

    for civ in CIVS:
        assert Soul._base_manager.using(alias_for_civilization(civ)).exists(), civ
    with override_settings(SHARD_READ_CIVS=list(CIVS)), read_context(FANOUT):
        from apps.audit.models import AuditLog

        assert AuditLog._base_manager.filter(tenant__isnull=True).exists(), "the control leg lost hall-less rows"
    missed = sorted(set(map(str, crossing_keys())) - set(map(str, world["crossed"])))
    assert len(world["crossed"]) >= len(crossing_keys()) - 3, [(m, world["why_not_crossed"].get(m)) for m in missed]


# ---- fail closed ------------------------------------------------------------------------------------------

@sharded
def test_a_read_with_no_context_is_refused_once_a_civilization_is_cut_over(world):
    """No instance hint, no request, no hall contextvar, no explicit context: every SHARD model's read raises
    NoShardContext once any civilization is cut over -- never a quiet answer from control -- and reads as
    before while none is."""
    from apps.core.request_local import get_current_request
    from apps.core.shard_reads import _context, _in_celery_task, current_context
    from apps.tenants.managers import get_current_tenant

    assert get_current_request() is None and get_current_tenant() is None
    assert current_context() is None, (_context.get(), _in_celery_task())
    from apps.core.shard_reads import CONTROL_READS

    shard_models = [m for m in apps.get_models() if placement(m) == SHARD and m._meta.label not in CONTROL_READS]
    for civ in CIVS:
        with override_settings(SHARD_READ_CIVS=[civ]):
            for model in shard_models:
                for read in (lambda m: list(m._base_manager.all()[:1]), lambda m: m._base_manager.count(),
                             lambda m: m._base_manager.exists()):
                    with pytest.raises(NoShardContext):
                        read(model)
    with override_settings(SHARD_READ_CIVS=[]):
        for model in shard_models:
            model._base_manager.count()


#: Services a per-hall Celery job runs (apps/scheduler/registry.py, TENANT jobs): the job sets the hall's
#: tenant contextvar first; called without it, the service must refuse, not read control.
HALL_JOB_SERVICES = (("apps.disposition.expiry", "expire_for_tenant"), ("apps.workflow.segments", "remind_due"))


@sharded
@pytest.mark.parametrize("service", HALL_JOB_SERVICES, ids=lambda s: s[1])
def test_a_hall_job_service_refuses_without_its_hall_and_reads_its_shard_with_it(world, service):
    import importlib

    from apps.tenants.managers import clear_current_tenant, set_current_tenant
    from apps.tenants.models import Tenant

    fn = getattr(importlib.import_module(service[0]), service[1], None)
    assert fn is not None, f"{service} is gone; name another per-hall job's service"
    hall = Tenant.objects.filter(declared_civilization="GREEK").first()
    with override_settings(SHARD_READ_CIVS=["GREEK"]):
        with pytest.raises(NoShardContext):
            fn(hall)
        set_current_tenant(hall)
        try:
            fn(hall)
        finally:
            clear_current_tenant()


@sharded
def test_a_transaction_on_control_reads_its_own_writes(world):
    """Writes still go to control (stage 3): inside a transaction of the code, a read sees the row it just wrote,
    which no shard has yet."""
    from apps.souls.models import Soul, SoulState
    from apps.tenants.models import Tenant

    hall = Tenant.objects.filter(declared_civilization="GREEK").first()
    with override_settings(SHARD_READ_CIVS=list(CIVS)), read_context("GREEK"):
        with transaction.atomic():
            soul = Soul.objects.create(name="fresh", tenant=hall, current_state=SoulState.JUDGING)
            assert Soul.objects.filter(pk=soul.pk).exists()
        assert not Soul.objects.filter(pk=soul.pk).exists(), "a cut-over read outside the transaction is the shard's"


@sharded
def test_a_write_request_reads_control_and_a_read_request_its_shard(world):
    """A POST reads where it writes (control), so it sees a row written a moment ago that no shard has yet; a GET
    of the same hall reads the hall's shard."""
    from django.test import RequestFactory

    from apps.core.request_local import set_current_request
    from apps.souls.models import Soul, SoulState
    from apps.tenants.models import Tenant

    hall = Tenant.objects.filter(declared_civilization="EGYPTIAN").first()
    soul = Soul.objects.create(name="unsynced", tenant=hall, current_state=SoulState.JUDGING)
    with override_settings(SHARD_READ_CIVS=list(CIVS)):
        for method, seen in (("post", True), ("get", False)):
            request = getattr(RequestFactory(), method)("/")
            request.tenant = hall
            set_current_request(request)
            try:
                assert Soul.objects.filter(pk=soul.pk).exists() is seen, method
            finally:
                set_current_request(None)
