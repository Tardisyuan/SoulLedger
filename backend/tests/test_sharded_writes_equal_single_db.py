"""Core guard: the sharded form changes no outcome of a write
(the sharding plan (not in this repo) 阶段 4). The single database is the baseline.

The world is stage 3's (`tests/test_sharded_reads_equal_single_db.py::_build`: every civilization, crossing keys,
residences, synced to the shards), built once per module and rolled back at the end. Then for every write route of
a SHARD model the URLconf has -- a viewset's `create` (POST to its list) and `partial_update` (PATCH of one row),
one case each so xdist spreads them -- a Greek hall's ADMIN sends the same request twice, each inside its own
savepoint on every database:

  baseline   SHARDED=False      (one database)
  sharded    SHARDED=True       (every civilization on its shard)

and both must answer the same status and body and change the same rows -- the baseline on control, the sharded run on
control and civ_greek together (a REFERENCE copy on the shard is not counted twice) -- and the sharded run must leave
the other civilizations' shards exactly as they were (a write on one alias never moves another). The payload is the
detail of a row of that hall (a create sends it back as a new row; a PATCH sends it unchanged): every route gets a
request its own serializer shaped. A 400 on both sides is an equal answer.

Excluded from the comparison, by name: date and time columns and keys (each run writes its own `now`), and integer
ids of SHARD models (a shard issues ids from its own range, apps/core/shard_ids.py: 4e15 + n where control
issued n) -- the integer pk columns and the keys to them, and integer `id` keys of a response. uuid4 and `random`
are seeded the same for both runs, so every uuid pk and random code is the same on both sides.
"""
import json
import os
import random
import uuid
from contextlib import ExitStack, contextmanager
from datetime import date, datetime, time

import pytest
from django.apps import apps
from django.db import connections, models, router, transaction
from django.test import override_settings

from apps.core.sharding import SHARD, placement
from tests import endpoint_answers as shadow
from tests.shard_support import HAS_SHARDS, sharded

SEED = int(os.environ.get("SHARDED_WRITES_SEED") or random.SystemRandom().randrange(10 ** 6))
GREEK = "civ_greek"


def _write_routes():
    """{case: (url name, kwargs, view class, action)}: create / partial_update of a viewset serving a SHARD model."""
    from tests.test_tenant_scoping_contract import _model_for

    found = {}
    for ns, p in shadow._walk():
        cb = p.callback
        cls, actions = getattr(cb, "cls", None), getattr(cb, "actions", None) or {}
        kwargs = tuple(sorted(p.pattern.regex.groupindex))
        if cls is None or not p.name or "format" in kwargs:
            continue
        model = _model_for(cls)
        if model is None or placement(model) != SHARD:
            continue
        for method, action in actions.items():
            if (method, action) in (("post", "create"), ("patch", "partial_update")):
                found[f"{ns}{p.name}:{method}"] = (f"{ns}{p.name}", kwargs, cls, action)
    return found


ROUTES = _write_routes()


@pytest.fixture(scope="module")
def world(django_db_setup, django_db_blocker):
    if not HAS_SHARDS:
        pytest.skip("needs --ds=config.settings_sharded")
    from tests.test_sharded_reads_equal_single_db import _build, _outer_atomics, _rollback

    print(f"SHARDED_WRITES_SEED={SEED}")
    with django_db_blocker.unblock():
        atomics = _outer_atomics()
        try:
            built = _build(random.Random(SEED))
            greek = sorted((h for h in built["halls"] if h.civilization == "GREEK"), key=lambda h: h.code)[0]
            yield {**built, "hall": greek, "client": built["callers"][f"ADMIN@{greek.code}"]}
        finally:
            _rollback(atomics)


@pytest.fixture(autouse=True)
def _seed_in_report(request):
    request.node.add_report_section("setup", "seed", f"SHARDED_WRITES_SEED={SEED}")


@pytest.fixture(autouse=True)
def _chat_on(settings):
    from tests.test_sharded_reads_equal_single_db import WORLD_MATRIX

    settings.MATRIX_ENABLED = True
    settings.MATRIX_CLIENT = "tests.test_sharded_reads_equal_single_db.LettersMatrix"
    settings.MATRIX_SERVER_NAME = WORLD_MATRIX


# ---- the same randomness on both sides ----------------------------------------------------------------------

class _Seeded:
    """uuid4 (the function and every field default that is it), `random` and `secrets` from one seed."""

    def __init__(self, monkeypatch, seed):
        self.mp, self.seed = monkeypatch, seed
        self.fields = [f for m in apps.get_models(include_auto_created=True) for f in m._meta.concrete_fields
                       if f.default is uuid.uuid4]

    def __enter__(self):
        rng = random.Random(self.seed)

        def uuid4():
            return uuid.UUID(int=rng.getrandbits(128), version=4)
        self.mp.setattr(uuid, "uuid4", uuid4)
        for f in self.fields:
            self.mp.setattr(f, "default", uuid4)
            self.mp.setitem(f.__dict__, "_get_default", uuid4)  # Field._get_default is cached on first use
        random.seed(self.seed)
        import secrets  # token_hex / token_urlsafe draw from token_bytes (an API key's prefix, a soul code)

        self.mp.setattr(secrets, "token_bytes", lambda n=32: rng.randbytes(n))
        self.mp.setattr(secrets, "choice", rng.choice)
        self.mp.setattr(secrets, "randbelow", rng.randrange)

    def __exit__(self, *exc):
        self.mp.undo()


# ---- the state compared ----------------------------------------------------------------------------------------

def _int_pk_models():
    from apps.core.shard_ids import models_with_int_ids

    return set(models_with_int_ids())


def _columns(model):
    """The columns compared: not dates / times, not an integer pk of a SHARD model, not a key to one."""
    ints = _int_pk_models()
    out = []
    for f in model._meta.concrete_fields:
        if isinstance(f, (models.DateField, models.TimeField, models.DurationField)):
            continue
        if f.primary_key and model in ints:
            continue
        if f.is_relation and f.related_model._meta.concrete_model in ints:
            continue
        out.append(f.attname)
    return out


def _state(alias):
    """{model label: sorted rows} of every table on `alias` (the compared columns, as text)."""
    out = {}
    for m in apps.get_models(include_auto_created=True):
        if not m._meta.managed or m._meta.proxy or not router.allow_migrate_model(alias, m):
            continue
        cols = _columns(m)
        rows = m._base_manager.using(alias).order_by().values_list(*cols) if cols else []
        out[m._meta.label] = sorted(json.dumps(list(r), default=str) for r in rows)
    return out


def _changes(before, after):
    """{model label: (rows gone, rows new)} between two `_state`s of one alias."""
    from collections import Counter

    out = {}
    for label in set(before) | set(after):
        x, y = Counter(before.get(label, [])), Counter(after.get(label, []))
        if x != y:
            out[label] = (sorted((x - y).elements()), sorted((y - x).elements()))
    return out


def _merged(per_alias):
    """The changes of several aliases as one database's: a REFERENCE row's copies on a shard are not counted."""
    from apps.core.sharding import REFERENCE

    out = {}
    for alias, changes in per_alias.items():
        for label, (gone, new) in changes.items():
            if alias != "default" and placement(apps.get_model(label)) == REFERENCE:
                continue
            was = out.get(label, ([], []))
            out[label] = (sorted(was[0] + gone), sorted(was[1] + new))
    return out


def _state_diff(a, b):
    out = []
    for label in sorted(set(a) | set(b)):
        x, y = a.get(label, []), b.get(label, [])
        if x != y:
            only_a, only_b = sorted(set(x) - set(y)), sorted(set(y) - set(x))
            out.append(f"{label}: {len(x)} vs {len(y)} rows; only before {only_a[:2]}; only cut over {only_b[:2]}")
    return out


def _canon_body(value):
    """A response body without its times and integer ids (module header)."""
    if isinstance(value, dict):
        return {k: _canon_body(v) for k, v in sorted(value.items())
                if not (k == "id" and isinstance(v, int)) and not _a_time(v) and not shadow._volatile(k)}
    if isinstance(value, list):
        return [_canon_body(v) for v in value]
    return value


def _a_time(v):
    if not isinstance(v, str) or len(v) < 8:
        return False
    for parse in (datetime.fromisoformat, date.fromisoformat, time.fromisoformat):
        try:
            parse(v.replace("Z", "+00:00"))
            return True
        except ValueError:
            continue
    return False


# ---- one run -------------------------------------------------------------------------------------------------

class _Savepoint:
    """One savepoint on every database, rolled back on exit (the world and the other run never see it)."""

    def __enter__(self):
        self.atomics = []
        for alias in connections:
            a = transaction.atomic(using=alias)
            a._from_testcase = True
            a.__enter__()
            self.atomics.append((alias, a))

    def __exit__(self, *exc):
        for alias, a in reversed(self.atomics):
            transaction.set_rollback(True, using=alias)
            a.__exit__(None, None, None)


def _payload(world, case):
    """(url, body) for `case`, from the detail of one row of the Greek hall; None when none is reachable."""
    from django.urls import reverse

    name, kwargs, cls, action = ROUTES[case]
    reads = shadow.endpoints()
    detail = next((n for n, (_, kw, c, a) in reads.items() if c is cls and a == "retrieve"), None)
    lst = shadow.list_route_of(reads, cls)
    if detail is None or lst is None:
        return None
    with override_settings(SHARDED=False):
        rows = shadow.fetch(world["client"], reverse(lst), max_pages=1)
        urls = shadow.urls_for(reads, detail, rows, random.Random(f"{SEED}:{case}"), n=1)
        if not urls:
            return None
        status, body = shadow.fetch(world["client"], urls[0])
    if status != 200 or not isinstance(body, dict):
        return None
    if action == "create":
        if kwargs:
            return None
        body = {k: v for k, v in body.items() if k not in ("id", "pk")}
        return reverse(name), body
    return urls[0], body


@contextmanager
def _audit_rows_of_the_commit():
    """The audit rows the request's commit writes. This module never commits (savepoints in an outer block), and an
    audit row routed to a database neither the request's transaction nor its business row is on waits for that
    transaction's commit (`apps/audit/signals.py::_write_row`; a Greek reaction under `add_reaction`'s
    `@transaction.atomic`, which holds control only). Those -- and only those, not notifications or relay kicks --
    are run here, as the commit would."""
    from django.test import TestCase

    with ExitStack() as stack:
        captured = [stack.enter_context(TestCase.captureOnCommitCallbacks(using=a)) for a in connections]
        yield
    for callbacks in captured:
        for callback in callbacks:
            if getattr(callback, "__module__", "") == "apps.audit.signals":
                callback()


def _run(world, case, payload, sharded_, monkeypatch):
    url, body = payload
    method = case.rsplit(":", 1)[1]
    with _Savepoint(), override_settings(SHARDED=sharded_):
        watched = {a: _state(a) for a in (("default", GREEK) if sharded_ else ("default",))}
        others = {a: _state(a) for a in ("civ_chinese", "civ_european", "civ_egyptian")} if sharded_ else {}
        with _Seeded(monkeypatch, f"{SEED}:{case}"), _audit_rows_of_the_commit():
            res = getattr(world["client"], method)(url, body, format="json")
        changed = _merged({a: _changes(before, _state(a)) for a, before in watched.items()})
        moved = [f"{a}: {_state_diff(before, _state(a))[:3]}" for a, before in others.items() if _state(a) != before]
        answer = (res.status_code, _canon_body(res.json()) if res.content else None)
        return answer, changed, moved


@sharded
@pytest.mark.parametrize("case", sorted(ROUTES))
def test_a_sharded_write_changes_what_the_single_database_does(world, case, monkeypatch):
    payload = _payload(world, case)
    if payload is None:
        pytest.skip(f"{case}: no row of the Greek hall to shape a request from")
    base, base_changed, _ = _run(world, case, payload, False, monkeypatch)
    cut, cut_changed, moved = _run(world, case, payload, True, monkeypatch)
    assert base == cut, f"SHARDED_WRITES_SEED={SEED} {case}: {shadow.diff(base, cut)}"
    assert not moved, f"{case}: a Greek write changed another shard: {moved}"
    differ = [f"{label}: one database {base_changed.get(label)} | sharded {cut_changed.get(label)}"
              for label in sorted(set(base_changed) | set(cut_changed)) if base_changed.get(label) != cut_changed.get(label)]
    assert not differ, f"SHARDED_WRITES_SEED={SEED} {case}:\n" + "\n".join(differ[:8])
    if base[0] >= 400:
        pytest.skip(f"{case}: refused alike on both sides ({base[0]})")


@sharded
def test_the_write_routes_are_the_ones_the_urlconf_has(world):
    """Not vacuous: the derivation found the routes of the models a hall ADMIN writes, both kinds."""
    names = {n.rsplit(":", 1)[0] for n in ROUTES}
    assert len(ROUTES) >= 20, sorted(ROUTES)
    assert {"soul-list", "judgment-list"} <= names, sorted(names)
    assert any(c.endswith(":patch") for c in ROUTES) and any(c.endswith(":post") for c in ROUTES)
