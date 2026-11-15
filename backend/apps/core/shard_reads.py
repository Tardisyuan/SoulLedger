"""Stage 3: a cut-over civilization's reads come from its shard; writes still go to control and are synced
(docs/audit/2026-11-15-sharding/PLAN.md 阶段 3, D7, D8).

Nothing here does anything while `settings.SHARD_READ_CIVS` is empty -- every entry point returns before
looking at a context -- so production with no shard env, and a sharded run with nothing cut over, read
exactly as before (tests/test_sharded_reads_equal_single_db.py holds both).

Where a read of a SHARD model goes (`route`), first answer wins:
  1. inside the code's own transaction, or -> control. The writes are there and nowhere else yet; a
     anywhere in a write request              check-then-act must not read a lagging shard (`reads_control`).
     a model in CONTROL_READS                 its queries join a control table; listed with the reason.
  2. the queryset says FANOUT_HINT          -> fan out (crossing keys, residence reads).
  3. an instance hint of a SHARD row        -> that row's database (Django's own rule).
     an instance hint of a hall (Tenant)    -> that hall's civilization.
  4. the read context                       -> one alias, or FANOUT.
  5. none of these                          -> `NoShardContext`. Never a silent fall back to control.

The read context (`current_context`): an explicit `read_context(...)` (a management command runs in FANOUT),
else the request's hall (or the tenant contextvar a per-hall Celery task sets); else the user -- a
civilization ADMIN reads its civilization, SYSTEM_ADMIN, a soul account and an anonymous caller (sign-in by
soul code) read everywhere (FANOUT), a caller that reaches no hall reads control (scope_to_tenant answers it
nothing anyway). A hall of UNKNOWN civilization, and a civilization not cut over, read control: that is where
their rows live (D2). Outside a request: the hall a task set, else FANOUT inside a Celery task (a global sweep,
a task handed a soul id), else none -- NoShardContext.

FANOUT is not a database. A queryset evaluated under it visits every leg -- control with the cut-over
civilizations' halls excluded, then each cut-over shard (a shard's soul copies of another civilization
excluded, D6) -- and merges: each leg fetches its first offset+limit rows in the queryset's own order, the
rows are merged in that order and the slice is taken from the merge. `count` / `exists` / `aggregate`
combine per leg. `install()` hooks those QuerySet methods; a path it does not cover (raw SQL, explain, a
combined queryset) asks the router, which raises NoShardContext.
"""
import functools
from contextlib import contextmanager
from contextvars import ContextVar

from django.conf import settings
from django.db import connections, models
from django.db.models import Count, Max, Min, Sum
from django.db.models.query import (
    FlatValuesListIterable,
    ModelIterable,
    NamedValuesListIterable,
    QuerySet,
    ValuesIterable,
    ValuesListIterable,
)

from apps.core.sharding import REFERENCE, SHARD, NoShardContext, alias_for_civilization, placement, tenant_path

FANOUT = "FANOUT"
CONTROL_ALIAS = "default"
#: A queryset hint: evaluate this queryset on every leg (crossing keys, residence reads).
FANOUT_HINT = "shard_fanout"

_context = ContextVar("shard_read_context", default=None)


#: SHARD models whose reads stay on control after their civilization is cut over, each with the reason. Their
#: queries filter through a control table (User, SoulAccount, celery-beat's PeriodicTask), which no shard has;
#: they move when that filter is rewritten (a denormalized column, or ids read from control first).
#: tests/test_sharded_reads_equal_single_db.py prints this list; it is the stage-3 debt, not a convenience.
CONTROL_READS = {
    "social.Post": "visibility filters on author__role / author__soul_account__soul__tenant (User, SoulAccount)",
    "social.Comment": "the same author filters as Post, and joins its post's author",
    "social.Reaction": "lists through post__author (User)",
    "social.PostMedia": "media checks post__author__role (User)",
    "social.SocialMute": "moderation lists filter user__soul_account / user__display_name (User, SoulAccount)",
    "scheduler.ScheduledJob": "jobs filter periodic_task__enabled (django-celery-beat's PeriodicTask, control)",
}


_SOUL_GONE = ("a row outlives its soul's stay: a residence court's rows stay in that shard after the soul goes home "
              "(D6), and a join through `soul` there would drop them")
#: Crossing keys (SHARD -> SHARD bare ids) a query may still JOIN through: on a shard such a query is answered
#: from control -- the rows of that leg's civilization, or the routed query's own filters -- because the row on
#: the other end may be in another shard. Stage 3 debt with its reason; it ends when the call sites read the
#: other side by ids, or when shards keep a copy of every soul their rows name (a change to D6 and to
#: tests/test_shard_sync.py (b)). Any other crossing join on a shard raises CrossShardJoin.
CROSSING_JOINS_ON_CONTROL = {
    **{label: _SOUL_GONE for label in (
        "souls.SoulRecord.soul", "judgment.Judgment.soul", "judgment.JudgmentAppeal.soul",
        "disposition.Disposition.soul", "reincarnation.Reincarnation.soul", "workflow.ApprovalWorkflow.soul",
        "realms.SoulPathEntry.soul", "events.SoulEvent.soul", "dispatch.DispatchRecord.soul",
        "death_sync.DeathRegistrationRequest.soul", "chat.Conversation.soul_a", "chat.Conversation.soul_b",
        "chat.Conversation.initiator", "sentence_plan.SentencePlan.soul")},
    "workflow.WorkflowSegment.workflow": "a segment run by another civilization's realm lives in that shard, its "
                                         "workflow in the home hall's",
    "workflow.ApprovalNode.segment": "the stations of a foreign segment, joined to the segment in the other shard",
    "dispatch.CrossTenantJudgmentParticipant.judgment": "a seat lives with its hall, the bench with the "
                                                        "initiating hall",
}


def cut_over():
    return list(settings.SHARD_READ_CIVS)


def alias_for_reads(civ):
    """Where a civilization's rows are read: its shard once cut over, else control (also UNKNOWN / blank)."""
    return alias_for_civilization(civ) if civ and civ in settings.SHARD_READ_CIVS else CONTROL_ALIAS


@contextmanager
def read_context(value):
    """`with read_context(FANOUT):` / `read_context("GREEK")` / `read_context("civ_greek")` / a hall."""
    token = _context.set(_normalize(value))
    try:
        yield
    finally:
        _context.reset(token)


def _normalize(value):
    if value is None or value in (FANOUT, CONTROL_ALIAS) or str(value).startswith("civ_"):
        return value
    if hasattr(value, "civilization"):  # a hall
        return alias_for_reads(value.civilization)
    return alias_for_reads(value)


def current_context():
    """The read context of this request / task: an alias, FANOUT, or None (no context)."""
    explicit = _context.get()
    if explicit is not None:
        return explicit
    from apps.core.request_local import get_current_request
    from apps.tenants.managers import get_current_tenant

    request = get_current_request()
    hall = getattr(request, "tenant", None) if request is not None else None
    if hall is None:
        hall = get_current_tenant()
    if hall is not None:
        return alias_for_reads(hall.civilization)
    if request is None:
        return FANOUT if _in_celery_task() else None
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "is_authenticated", False):
        return FANOUT  # anonymous (sign-in by soul code, a public page) or not yet authenticated: no hall
    from apps.core.tenant import is_civilization_admin, is_tenant_exempt
    from apps.soul_accounts.authentication import SOUL_ROLE

    if is_tenant_exempt(user) or getattr(user, "role", None) == SOUL_ROLE:
        return FANOUT
    hall_view = getattr(user, "hall_view", None)
    if hall_view is not None:
        from apps.tenants.models import Tenant

        return alias_for_reads(Tenant._base_manager.get(pk=hall_view).civilization)
    if is_civilization_admin(user):
        return alias_for_reads(getattr(user, "civilization", None))
    if getattr(user, "tenant_id", None) is not None:  # force_authenticate: request_tenant's fallback
        return alias_for_reads(user.tenant.civilization)
    return CONTROL_ALIAS  # reaches no hall: scope_to_tenant answers it nothing, from control


def in_write_transaction():
    """A transaction opened by the code (not the test case's wrapper) is open on control."""
    return any(not a._from_testcase for a in connections[CONTROL_ALIAS].atomic_blocks)


def reads_control():
    """Stage 3 writes go to control, so a read that may act on what was just written reads control too: inside
    the code's own transaction, and anywhere in a write request (any method but GET / HEAD / OPTIONS)."""
    if in_write_transaction() or _context.get() == CONTROL_ALIAS:  # or the code said so: read_context("default")
        return True
    from apps.core.request_local import get_current_request

    request = get_current_request()
    return request is not None and getattr(request, "method", "GET") not in ("GET", "HEAD", "OPTIONS")


def route(model, hints):
    """The alias a read of `model` goes to; None = Django's default answer; FANOUT = every leg.
    Raises NoShardContext where nothing says which civilization."""
    if not settings.SHARD_READ_CIVS or placement(model) != SHARD:
        return None
    if reads_control() or model._meta.label in CONTROL_READS:
        return CONTROL_ALIAS
    if hints.get(FANOUT_HINT):
        return FANOUT
    instance = hints.get("instance")
    if instance is not None:
        kind = placement(type(instance))
        if kind == SHARD:
            return None  # the database the row came from
        if kind == REFERENCE:
            return alias_for_reads(instance.civilization)
    ctx = current_context()
    if ctx is None:
        raise NoShardContext(f"{model._meta.label}: a read with no shard context while {cut_over()} are cut over")
    return ctx


def write_route(model, hints):
    """Stage 3: writes still go to control. A row read from a shard and saved (or deleted, or given an m2m
    row) is written to control, not to the shard it came from -- the next sync would overwrite it there.
    Stage 4 replaces this with SHARD_WRITE_CIVS."""
    instance = hints.get("instance")
    if (settings.SHARD_READ_CIVS and not settings.SHARD_WRITE_CIVS and instance is not None
            and str(instance._state.db or "").startswith("civ_") and placement(model) == SHARD):
        return CONTROL_ALIAS
    return None


def fanout_reads(fn):
    """A management command / global sweep with no request or hall: its reads visit every leg."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with read_context(FANOUT):
            return fn(*args, **kwargs)
    return wrapper


def with_fanout(qs):
    """`qs`, evaluated on every leg (no-op while nothing is cut over)."""
    if not settings.SHARD_READ_CIVS:
        return qs
    qs = qs._chain()
    qs._hints = {**qs._hints, FANOUT_HINT: True}
    return qs


# ---- legs -------------------------------------------------------------------------------------------------

def _halls(civs):
    from apps.core.tenant import civilization_halls

    return [pk for civ in civs for pk in civilization_halls(civ).using(CONTROL_ALIAS).values_list("pk", flat=True)]


def legs(model):
    """[(alias, narrow, on_control)] covering every row of `model` exactly once: control without the cut-over
    civilizations' halls (hall-less rows stay, D2), then each cut-over shard -- for Soul only its own
    civilization's souls, not the copies of souls residing elsewhere (D6). `on_control` reads the same rows of
    that leg from control, for a query a shard cannot answer (CROSSING_JOINS_ON_CONTROL)."""
    from apps.souls.models import Soul

    path = tenant_path(model)
    cut = cut_over()
    out = [(CONTROL_ALIAS, lambda qs: qs.exclude(**{f"{path}__in": _halls(cut)}), None)]
    for civ in cut:
        narrow = functools.partial(_own_souls, civ=civ) if model._meta.concrete_model is Soul else (lambda qs: qs)
        out.append((alias_for_civilization(civ), narrow, functools.partial(_civ_rows, path=path, civ=civ)))
    return out


def _own_souls(qs, civ):
    return qs.filter(tenant__in=_halls([civ]))


def _civ_rows(qs, path, civ):
    return qs.using(CONTROL_ALIAS).filter(**{f"{path}__in": _halls([civ])})


def _leg(qs, alias, narrow, high, on_control=None):
    base = qs._chain()
    base.query.clear_limits()
    base._hints = {k: v for k, v in qs._hints.items() if k != FANOUT_HINT}
    leg = narrow(base.using(alias))
    if guard(leg, alias) == CONTROL_ALIAS:
        leg = on_control(base)
    if high is not None:
        leg.query.set_limits(0, high)
    return leg


@functools.cache
def _unreachable(model):
    """Forward keys of `model` a shard cannot join through: to a CONTROL model (its table is not there) or a
    SHARD -> SHARD bare id (the target may be in another civilization's shard). select_related through one
    of them on a shard drops the row (INNER JOIN) or fails; the accessor reads it instead."""
    from apps.core.bare_ids import is_bare

    out = set()
    for f in model._meta.concrete_fields:
        if f.is_relation and f.many_to_one:
            target = f.related_model
            if placement(target) not in (SHARD, REFERENCE) or (is_bare(f) and placement(target) == SHARD):
                out.add(f.name)
    return frozenset(out)


def _strip(model, tree):
    keep = {}
    for name, sub in tree.items():
        if name in _unreachable(model):
            continue
        try:
            f = model._meta.get_field(name)
        except Exception:
            keep[name] = sub  # a reverse one-to-one: same database, left alone
            continue
        keep[name] = _strip(f.related_model, sub) if f.is_relation and f.related_model else sub
    return keep


def strip_unreachable_joins(qs, alias):
    """On a shard alias, drop select_related paths a shard cannot join (`_unreachable`)."""
    if not alias.startswith("civ_") or not qs.query.select_related:
        return
    if qs.query.select_related is True:
        qs.query.select_related = False
        return
    qs.query.select_related = _strip(qs.model, qs.query.select_related)


class CrossShardJoin(Exception):  # noqa: N818
    """A read routed to a shard joins through a crossing key (a filter, an order or an annotation through
    `soul__...` on a judgment, say): on a shard the other row may be in another civilization's database, and
    the join would drop the row (INNER) or blank it (LEFT) without a word. Loud instead; the call site reads
    the other side separately (by ids) or reads across shards."""


@functools.cache
def _crossing_columns():
    """{(table, column, table, column): crossing key label}, the join read both ways."""
    out = {}
    for f in crossing_keys():
        here, there = (f.model._meta.db_table, f.column), (f.related_model._meta.db_table, f.target_field.column)
        out[(*here, *there)] = out[(*there, *here)] = f"{f.model._meta.label}.{f.name}"
    return out


def _crossing_join(query, alias):
    """The label of the first crossing key `query` (compiled for `alias`) joins through, or None."""
    from django.core.exceptions import EmptyResultSet, FullResultSet

    q = query.chain()
    try:
        q.get_compiler(using=alias).as_sql()
    except (EmptyResultSet, FullResultSet):
        pass  # the joins are set up all the same
    keys = _crossing_columns()
    tables = {a: j.table_name for a, j in q.alias_map.items()}
    for name, join in q.alias_map.items():
        if not q.alias_refcount.get(name):
            continue  # set up and trimmed again (F("soul_id") resolves through `soul`, then reads the column)
        parent = tables.get(getattr(join, "parent_alias", None))
        for left, right in getattr(join, "join_cols", ()):
            label = keys.get((parent, left, join.table_name, right))
            if label:
                return label
    return _crossing_subquery(q)


def _crossing_subquery(query, depth=0):
    """A correlated subquery that matches the outer row through a crossing key is the same hazard as a join
    (Exists(Reincarnation.filter(soul=OuterRef("soul")))): the rows it looks for may be in another shard. The
    label of the first crossing key such a subquery (any level down) filters on, or None."""
    from django.db.models.expressions import Col
    from django.db.models.sql import Query

    by_field = {(f.model._meta.concrete_model, f.column): f"{f.model._meta.label}.{f.name}" for f in crossing_keys()}

    def walk(node):
        if isinstance(node, Query):
            inner = node.model._meta.concrete_model if node.model else None
            for expr in _nodes(node.where):
                lhs = getattr(expr, "lhs", None)
                if isinstance(lhs, Col) and (inner, lhs.target.column) in by_field and _outer_ref(expr, node):
                    return by_field[(inner, lhs.target.column)]
            if depth < 3:
                found = _crossing_subquery(node, depth + 1)
                if found:
                    return found
            return None
        for child in node.get_source_expressions() if hasattr(node, "get_source_expressions") else ():
            if child is not None:
                found = walk(child)
                if found:
                    return found
        inner_query = getattr(node, "query", None)
        return walk(inner_query) if isinstance(inner_query, Query) else None

    for expr in [*query.annotations.values(), *_nodes(query.where)]:
        found = walk(expr)
        if found:
            return found
    return None


def _nodes(where):
    """Every leaf of a WHERE tree."""
    for child in getattr(where, "children", ()):
        if hasattr(child, "children"):
            yield from _nodes(child)
        else:
            yield child


def _outer_ref(lookup, inner):
    """The lookup compares with the outer query's row: an OuterRef, or (once resolved) a column of a table the
    subquery itself does not have."""
    from django.db.models.expressions import Col, OuterRef, ResolvedOuterRef

    rhs = getattr(lookup, "rhs", None)
    parts = [rhs, *getattr(rhs, "get_source_expressions", list)()]
    return any(isinstance(e, (OuterRef, ResolvedOuterRef)) or (isinstance(e, Col) and e.alias not in inner.alias_map)
               for e in parts)


def guard(qs, alias):
    """Make a read on shard `alias` one a shard can answer: strip unreachable select_related; a join through a
    crossing key is answered from control when the key is in CROSSING_JOINS_ON_CONTROL (returns CONTROL_ALIAS:
    read it there instead), refused otherwise. None: read it where it is."""
    if not alias.startswith("civ_"):
        return None
    strip_unreachable_joins(qs, alias)
    key = _crossing_join(qs.query, alias)
    if key in CROSSING_JOINS_ON_CONTROL:
        return CONTROL_ALIAS
    if key:
        raise CrossShardJoin(f"{qs.model._meta.label} on {alias} joins through the crossing key {key}")
    return None


def _guard_routed(qs, aggregates=None):
    """A read the router sends to one shard (not a FANOUT merge, not an explicit `.using`). `aggregates`: the
    expressions an aggregate() is about to add (their filters may join too)."""
    if qs._db is None and not qs._for_write and placement(qs.model) == SHARD:
        if guard(qs.alias(**aggregates) if aggregates else qs, qs.db) == CONTROL_ALIAS:
            qs._db = CONTROL_ALIAS  # this queryset's own filters already say which rows; control has them all


# ---- the merge ---------------------------------------------------------------------------------------------

def _wanted(qs):
    if qs._db is not None or qs._for_write or not settings.SHARD_READ_CIVS:
        return False
    if placement(qs.model) != SHARD or reads_control() or qs.model._meta.label in CONTROL_READS:
        return False
    if qs._hints.get(FANOUT_HINT):
        return True
    instance = qs._hints.get("instance")
    if instance is not None and placement(type(instance)) in (SHARD, REFERENCE):
        return False
    return current_context() == FANOUT


def _ordering(qs):
    """[(lookup, descending, nulls_first or None)] the queryset is ordered by; [] when unordered."""
    q = qs.query
    names = list(q.order_by) or list(q.extra_order_by) or (list(qs.model._meta.ordering) if q.default_ordering else [])
    out = []
    for item in names:
        if isinstance(item, str):
            if item == "?":
                raise NotImplementedError(f"{qs.model._meta.label}: a random order cannot be merged across shards")
            desc = item.startswith("-")
            out.extend(_expand(qs.model, item.lstrip("-"), desc))
        elif isinstance(item, models.OrderBy):
            nulls = True if item.nulls_first else False if item.nulls_last else None
            expr = item.expression
            out.append((expr.name if isinstance(expr, models.F) else expr, item.descending, nulls))
        elif isinstance(item, models.F):
            out.append((item.name, False, None))
        else:  # an expression (Case(...), Lower(...)): annotated per leg as it is
            out.append((item, False, None))
    return out


def _expand(model, lookup, desc, depth=0):
    """Django's own expansion of an order by a relation: the related model's ordering, else its pk."""
    if lookup == "pk":
        return [("pk", desc, None)]
    *hops, last = lookup.split("__")
    m = model
    for hop in hops:
        try:
            m = m._meta.get_field(hop).related_model or m
        except Exception:
            return [(lookup, desc, None)]
    try:
        f = m._meta.get_field(last)
    except Exception:
        return [(lookup, desc, None)]  # an annotation
    if not (f.is_relation and f.many_to_one) or last == f.attname != f.name or depth > 3:
        return [(lookup, desc, None)]
    target = f.related_model
    if not target._meta.ordering:
        return [(f"{lookup}__pk", desc, None)]
    out = []
    for o in target._meta.ordering:
        if not isinstance(o, str):
            raise NotImplementedError(f"{model._meta.label}: cannot merge an ordering through {lookup}")
        out.extend(_expand(model, f"{lookup}__{o.lstrip('-')}", desc != o.startswith("-"), depth + 1))
    return out


def _null_first(desc, nulls, alias):
    if nulls is not None:
        return nulls
    largest = connections[alias].features.nulls_order_largest
    return desc if largest else not desc


def _collation_rank(strings):
    """{string: rank} in the control database's own collation (PostgreSQL's locale order is not Python's)."""
    conn = connections[CONTROL_ALIAS]
    if conn.vendor != "postgresql" or not strings:
        return None
    with conn.cursor() as cur:
        cur.execute("SELECT s FROM unnest(%s::text[]) AS t(s) ORDER BY s", [sorted(strings)])
        return {row[0]: i for i, row in enumerate(cur.fetchall())}


def _sort(rows, keys_of, order):
    """Stable merge of rows (each leg already in order) by their order keys."""
    strings = {k for r in rows for k in keys_of(r) if isinstance(k, str)}
    rank = _collation_rank(strings)
    flags = [(desc, _null_first(desc, nulls, CONTROL_ALIAS)) for _, desc, nulls in order]

    def cmp(a, b):
        for x, y, (desc, nulls_first) in zip(keys_of(a), keys_of(b), flags, strict=True):
            if x == y:
                continue
            if x is None or y is None:
                return (-1 if x is None else 1) * (1 if nulls_first else -1)
            if rank is not None and isinstance(x, str):
                x, y = rank[x], rank[y]
            c = -1 if x < y else 1
            return -c if desc else c
        return 0

    return sorted(rows, key=functools.cmp_to_key(cmp))


def _sliced(rows, low, high):
    return rows[low:high] if high is not None else rows[low:]


def merged(qs):
    """The rows `qs` answers, from every leg."""
    if qs.query.combinator:
        raise NotImplementedError(f"{qs.model._meta.label}: a combined queryset cannot be read across shards")
    if qs.query.is_empty():
        return []
    q = qs.query
    low, high = q.low_mark, q.high_mark
    order = _ordering(qs) if qs.ordered else []
    iterable = qs._iterable_class
    # values(...).annotate(Count(...)): one row per group on each leg, combined here. A model queryset's own
    # annotate(Count(...)) is per row (group_by True): its rows are disjoint across legs and stay as they are.
    grouped = isinstance(q.group_by, tuple) and any(a.contains_aggregate for a in q.annotation_select.values())
    # values() / values_list() ordered by what they do not select: the keys ride along as annotations
    # (`_shard_k<i>`, the way the database adds them to a SELECT DISTINCT) and are dropped after the merge.
    extra = bool(order) and iterable is not ModelIterable and not grouped and not _selects_keys(qs, order)
    rows = []
    for alias, narrow, on_control in legs(qs.model):
        leg = _leg(qs, alias, narrow, None, on_control)
        if grouped and _avgs(qs):
            leg = leg.annotate(**{f"_shard_{k}_{n}": fn(*a.source_expressions, filter=a.filter)
                                  for n, a in _avgs(qs).items() for k, fn in (("s", Sum), ("n", Count))})
        if order and (iterable is ModelIterable or extra):
            leg = leg.annotate(**{f"_shard_k{i}": models.F(name) if isinstance(name, str) else name
                                  for i, (name, _, _) in enumerate(order)})
            if iterable is FlatValuesListIterable:
                leg._iterable_class = ValuesListIterable  # keep the keys; flattened again below
            if guard(leg, leg.db) == CONTROL_ALIAS:  # an order through a crossing key
                leg = on_control(leg)
        if high is not None and not grouped:
            leg.query.set_limits(0, high)
        rows.extend(list(leg))
    if grouped:
        rows = _combine_groups(qs, rows)
    elif q.distinct and iterable is not ModelIterable:
        rows = list(dict.fromkeys(rows)) if iterable is not ValuesIterable else _dedupe_dicts(rows)
    if order and len(rows) > 1:
        rows = _sort(rows, _extra_keys(iterable, len(order)) if extra else _key_reader(qs, order), order)
    if iterable is ModelIterable and order:
        for r in rows:
            for i in range(len(order)):
                r.__dict__.pop(f"_shard_k{i}", None)
    elif extra:
        rows = [_without_keys(r, iterable, len(order)) for r in rows]
    return _sliced(rows, low, high)


def _output_names(qs):
    fields = list(qs._fields or ())
    return fields + [a for a in qs.query.annotation_select if a not in fields]


def _selects_keys(qs, order):
    names = _output_names(qs)
    if qs._iterable_class is ValuesIterable and not qs._fields:
        return all(isinstance(n, str) and n in [f.attname for f in qs.model._meta.concrete_fields] + names
                   for n, _, _ in order)
    if qs._iterable_class is FlatValuesListIterable:
        return all(n == names[0] for n, _, _ in order)
    return all(isinstance(n, str) and n in names for n, _, _ in order)


def _extra_keys(iterable, n):
    if iterable is ValuesIterable:
        return lambda r: tuple(r[f"_shard_k{i}"] for i in range(n))
    return lambda r: tuple(r[-n:])


def _without_keys(row, iterable, n):
    if iterable is ValuesIterable:
        return {k: v for k, v in row.items() if not k.startswith("_shard_k")}
    if iterable is FlatValuesListIterable:
        return row[0]
    return row[:-n]


def _dedupe_dicts(rows):
    seen, out = set(), []
    for r in rows:
        key = tuple(sorted(r.items()))
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def _key_reader(qs, order):
    iterable = qs._iterable_class
    if iterable is ModelIterable:
        return lambda r: tuple(getattr(r, f"_shard_k{i}") for i in range(len(order)))
    names = [n for n, _, _ in order]
    if not all(isinstance(n, str) for n in names):
        raise NotImplementedError(f"{qs.model._meta.label}: values() ordered by an expression across shards")
    if iterable is ValuesIterable:
        missing = [n for n in names if n not in (qs._fields or ()) and n not in qs.query.annotation_select]
        if qs._fields and missing:
            raise NotImplementedError(f"{qs.model._meta.label}: values() ordered by {missing} not selected")
        return lambda r: tuple(r[n] for n in names)
    fields = list(qs._fields or ()) + [a for a in qs.query.annotation_select if a not in (qs._fields or ())]
    if iterable is FlatValuesListIterable:
        if names != fields[:1] * len(names):
            raise NotImplementedError(f"{qs.model._meta.label}: flat values_list ordered by {names}")
        return lambda r: (r,) * len(names)
    if iterable in (ValuesListIterable, NamedValuesListIterable):
        try:
            pos = [fields.index(n) for n in names]
        except ValueError:
            raise NotImplementedError(f"{qs.model._meta.label}: values_list ordered by {names} not selected") from None
        return lambda r: tuple(r[p] for p in pos)
    raise NotImplementedError(f"{qs.model._meta.label}: {iterable.__name__} across shards")


_COMBINE = {Count: lambda vs: sum(v or 0 for v in vs), Sum: lambda vs: sum(v for v in vs if v is not None)
            if any(v is not None for v in vs) else None,
            Min: lambda vs: min((v for v in vs if v is not None), default=None),
            Max: lambda vs: max((v for v in vs if v is not None), default=None)}


def _combiner(name, expr):
    if isinstance(expr, Count) and expr.distinct:
        raise NotImplementedError(f"{name}: Count(distinct=True) cannot be combined across shards")
    for kind, fn in _COMBINE.items():
        if type(expr) is kind:
            return fn
    from django.db.models.functions import Coalesce

    if isinstance(expr, Coalesce) and expr.source_expressions[0].contains_aggregate:
        inner, *rest = expr.source_expressions
        if all(isinstance(r, models.Value) for r in rest):
            combine = _combiner(name, inner)

            def coalesced(values):
                value = combine(values)
                return value if value is not None else next((r.value for r in rest if r.value is not None), None)
            return coalesced
    raise NotImplementedError(f"{name}: {type(expr).__name__} cannot be combined across shards")


def _avgs(qs):
    return {n: a for n, a in qs.query.annotation_select.items() if type(a) is models.Avg}


def _combine_groups(qs, rows):
    """values(...).annotate(Count/Sum/Min/Max/Avg) per leg -> one row per group. An Avg is combined from the
    Sum and Count each leg added beside it (`merged`)."""
    avgs = _avgs(qs)
    aggs = {n: _combiner(n, a) for n, a in qs.query.annotation_select.items() if a.contains_aggregate and n not in avgs}
    helpers = {f"_shard_{k}_{n}" for n in avgs for k in "sn"}
    iterable = qs._iterable_class
    if avgs and iterable is not ValuesIterable:
        raise NotImplementedError(f"{qs.model._meta.label}: Avg in a grouped {iterable.__name__} across shards")
    if iterable is ValuesIterable:
        def split(r):
            key = tuple((k, v) for k, v in r.items() if k not in aggs and k not in avgs and k not in helpers)
            return key, {k: r[k] for k in (*aggs, *helpers)}

        def build(key, agg):
            out = {**dict(key), **{n: agg[n] for n in aggs}}
            for n, a in avgs.items():
                total, many = agg[f"_shard_s_{n}"], agg[f"_shard_n_{n}"]
                out[n] = total / many if many else a.default
            return out
    elif iterable is ValuesListIterable:
        fields = list(qs._fields or ()) + [a for a in qs.query.annotation_select if a not in (qs._fields or ())]
        pos = {fields.index(n): n for n in aggs}

        def split(r):
            return tuple(v for i, v in enumerate(r) if i not in pos), {n: r[i] for i, n in pos.items()}

        def build(key, agg):
            rest = iter(key)
            return tuple(agg[pos[i]] if i in pos else next(rest) for i in range(len(fields)))
    else:
        raise NotImplementedError(f"{qs.model._meta.label}: a grouped {iterable.__name__} across shards")
    groups = {}
    for r in rows:
        key, agg = split(r)
        groups.setdefault(key, []).append(agg)
    combine = {**aggs, **{h: _COMBINE[Sum] if h.startswith("_shard_s_") else _COMBINE[Count] for h in helpers}}
    return [build(key, {n: combine[n]([a[n] for a in parts]) for n in combine}) for key, parts in groups.items()]


def count(qs):
    q = qs.query
    if q.distinct or isinstance(q.group_by, tuple) or q.combinator:
        return len(merged(qs))
    total = sum(_leg(qs, alias, narrow, None, on).count() for alias, narrow, on in legs(qs.model))
    total = max(0, total - q.low_mark)
    return min(total, q.high_mark - q.low_mark) if q.high_mark is not None else total


def exists(qs):
    return any(_leg(qs, alias, narrow, qs.query.high_mark, on).exists() for alias, narrow, on in legs(qs.model))


def _part(expr, name):
    """(how to combine the legs' values, the expression each leg aggregates) for one aggregate()."""
    from django.db.models.functions import Coalesce

    if type(expr) is models.Avg:
        src, flt = expr.source_expressions, expr.filter
        return "avg", {f"{name}__s": Sum(*src, filter=flt), f"{name}__n": Count(*src, filter=flt)}
    if type(expr) is Count and expr.distinct:
        return "distinct", {}
    if isinstance(expr, Coalesce) and expr.source_expressions[0].contains_aggregate:
        inner, *rest = expr.source_expressions
        if not all(isinstance(r, models.Value) for r in rest):
            raise NotImplementedError(f"{name}: Coalesce over a non-constant fallback across shards")
        return ("coalesce", _combiner(name, inner), [r.value for r in rest]), {name: inner}
    return _combiner(name, expr), {name: expr}


def aggregate(qs, args, kwargs):
    q = qs.query
    if q.is_sliced or q.distinct or isinstance(q.group_by, tuple) or q.combinator:
        raise NotImplementedError(f"{qs.model._meta.label}: aggregate() over this queryset across shards")
    for arg in args:
        kwargs[arg.default_alias] = arg
    asked, per_leg = {}, {}
    for name, expr in kwargs.items():
        how, exprs = _part(expr, name)
        asked[name] = (how, expr)
        per_leg.update(exprs)
    parts, seen = [], {}
    for alias, narrow, on in legs(qs.model):
        leg = _leg(qs, alias, narrow, None, on)
        probe = leg.alias(**per_leg, **{f"_shard_d_{n}": e.source_expressions[0] for n, (h, e) in asked.items()
                                        if h == "distinct"})
        if guard(probe, leg.db) == CONTROL_ALIAS:  # an aggregate through a crossing key
            leg = on(leg)
        parts.append(leg.aggregate(**per_leg) if per_leg else {})
        for name, (how, expr) in asked.items():  # Count(distinct): the values themselves, unioned below
            if how == "distinct":
                values = leg.filter(expr.filter) if expr.filter is not None else leg
                values = values.annotate(_shard_v=expr.source_expressions[0]).order_by()
                seen.setdefault(name, set()).update(values.values_list("_shard_v", flat=True).distinct())
    out = {}
    for name, (how, expr) in asked.items():
        if how == "distinct":
            out[name] = len(seen.get(name, set()) - {None})
        elif how == "avg":
            s = sum(p[f"{name}__s"] or 0 for p in parts)
            n = sum(p[f"{name}__n"] or 0 for p in parts)
            out[name] = s / n if n else expr.default
        elif isinstance(how, tuple):  # Coalesce(aggregate, constants...)
            value = how[1]([p[name] for p in parts])
            out[name] = value if value is not None else next((v for v in how[2] if v is not None), None)
        else:
            value = how([p[name] for p in parts])
            out[name] = expr.default if value is None and getattr(expr, "default", None) is not None else value
    return out


# ---- hooks -------------------------------------------------------------------------------------------------

def _in_celery_task():
    """Inside a Celery task's body (a worker, or an eager call). A task's hall comes from the tenant contextvar
    it sets itself (the per-hall jobs); one that sets none -- a global sweep, a task handed a soul id -- reads
    every leg rather than no context."""
    from celery import current_task

    return bool(current_task) and getattr(current_task.request, "id", None) is not None


def _hook(name, make):
    original = getattr(QuerySet, name)
    if getattr(original, "_shard_reads", False):
        return
    wrapped = make(original)
    wrapped._shard_reads = True
    functools.update_wrapper(wrapped, original)
    setattr(QuerySet, name, wrapped)


def install():
    """Route the evaluation of a FANOUT read through `merged` / `count` / `exists` / `aggregate`, and keep
    every shard-routed read off joins a shard cannot make. No-ops while nothing is cut over."""

    def fetch_all(original):
        def _fetch_all(self):
            if self._result_cache is None and settings.SHARD_READ_CIVS:
                if _wanted(self):
                    self._result_cache = merged(self)
                    self._prefetch_done = True
                else:
                    _guard_routed(self)
            return original(self)
        return _fetch_all

    def iterator(original):
        def _iterator(self, chunk_size=None):
            if settings.SHARD_READ_CIVS:
                if _wanted(self):
                    return iter(merged(self))
                _guard_routed(self)
            return original(self, chunk_size) if chunk_size is not None else original(self)
        return _iterator

    def evaluating(fanned):
        def make(original):
            def method(self, *args, **kwargs):
                if self._result_cache is None and settings.SHARD_READ_CIVS:
                    if _wanted(self):
                        return fanned(self, *args, **kwargs)
                    _guard_routed(self)
                return original(self, *args, **kwargs)
            return method
        return make

    def aggregating(original):
        def _aggregate(self, *args, **kwargs):
            if settings.SHARD_READ_CIVS:
                if _wanted(self):
                    return aggregate(self, args, dict(kwargs))
                _guard_routed(self, {**{a.default_alias: a for a in args}, **kwargs})
            return original(self, *args, **kwargs)
        return _aggregate

    counting, existing = evaluating(count), evaluating(exists)

    from django.core.management.base import BaseCommand

    original_execute = BaseCommand.execute
    if not getattr(original_execute, "_shard_reads", False):
        def execute(self, *args, **options):
            if _context.get() is not None:
                return original_execute(self, *args, **options)
            with read_context(FANOUT):  # an operator command has no request and no hall
                return original_execute(self, *args, **options)
        execute._shard_reads = True
        functools.update_wrapper(execute, original_execute)
        BaseCommand.execute = execute

    _hook("_fetch_all", fetch_all)
    _hook("iterator", iterator)
    _hook("count", counting)
    _hook("exists", existing)
    _hook("aggregate", aggregating)
    _install_crossing_accessors()


def crossing_keys():
    """SHARD -> SHARD bare ids: the two rows may be in different civilizations' shards."""
    from django.apps import apps

    from apps.core.bare_ids import is_bare

    return [f for m in apps.get_models() for f in m._meta.concrete_fields
            if f.many_to_one and is_bare(f) and f.model is m and placement(m) == SHARD
            and placement(f.related_model) == SHARD]


def _install_crossing_accessors():
    """A crossing key's accessor, both ways, reads every leg: the row it names may be in another shard
    (a soul back from residence is not in the residence's shard any more; its residence judgments are not in
    its home's)."""
    from django.db.models.fields.related_descriptors import (
        ForwardManyToOneDescriptor,
        ReverseManyToOneDescriptor,
    )

    class CrossingForward(ForwardManyToOneDescriptor):
        def get_queryset(self, **hints):
            return with_fanout(super().get_queryset(**hints))

    class CrossingReverse(ReverseManyToOneDescriptor):
        @functools.cached_property
        def related_manager_cls(self):
            base = super().related_manager_cls

            class Manager(base):
                def get_queryset(self):
                    return with_fanout(super().get_queryset())

                def get_prefetch_querysets(self, instances, querysets=None):
                    qs, *rest = super().get_prefetch_querysets(instances, querysets)
                    return (with_fanout(qs), *rest)

            return Manager

    for f in crossing_keys():
        if not isinstance(f.model.__dict__.get(f.name), CrossingForward):
            setattr(f.model, f.name, CrossingForward(f))
        accessor = f.remote_field.get_accessor_name()
        if accessor and not f.remote_field.hidden and not isinstance(
                f.related_model.__dict__.get(accessor), CrossingReverse):
            setattr(f.related_model, accessor, CrossingReverse(f.remote_field))
