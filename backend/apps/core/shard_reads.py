"""Sharded reads and writes: each civilization's SHARD rows live on its own shard (docs/audit/2026-11-15-sharding/
PLAN.md 阶段 3-5, D7, D8). Two forms only (2026-11-21, config/settings.py): sharded (`settings.SHARDED`: every
SHARD_DATABASE_URL_<CIV> set; control holds REFERENCE, CONTROL, the control-mastered models and the rows with no hall)
and the one database. Not sharded, every entry point returns before looking at a context, so the one database reads
and writes exactly as with no router (tests/test_sharded_reads_equal_single_db.py and
tests/test_sharded_writes_equal_single_db.py hold both forms to the same answers).

Where a read of a SHARD model goes (`route`), first answer wins:
  1. inside the code's own transaction,    -> where its writes are: the masters (`_acting_read`); a
     anywhere in a write request, or in        check-then-act reads what it wrote (`reads_control`).
     Celery (below)
     a model in CONTROL_READS                 control: its queries join a control table; listed with the reason.
  2. the queryset says FANOUT_HINT          -> fan out (crossing keys, residence reads).
  3. an instance hint of a SHARD row        -> that row's database (Django's own rule).
     an instance hint of a hall (Tenant)    -> that hall's civilization.
  4. the read context                       -> one alias, or FANOUT.
  5. none of these                          -> `NoShardContext`. Never a silent fall back to control.

The read context (`current_context`): an explicit `read_context(...)`, else the request's hall (or the tenant
contextvar a per-hall Celery task sets); else the user -- a civilization ADMIN reads its civilization, a soul account
its soul's primary hall's (`soul_read_context`), SYSTEM_ADMIN and an anonymous caller (sign-in by soul code) read
everywhere (FANOUT), a caller that reaches no hall reads control (scope_to_tenant answers it nothing anyway). A hall
of UNKNOWN civilization reads control: that is where its rows live (D2). Inside Celery -- a task's body, or a Celery
signal's receivers (worker_ready, task_postrun, beat's before_task_publish) -- and in a management command
(`read_context("default")`), reads go where the writes go (`reads_control`): the hall's master, else every master
(MASTER). A task that wants another answer says so: `read_context(FANOUT)` / `@fanout_reads` / `read_context(hall)`.
Outside a request, Celery and a command: an explicit context or the tenant contextvar, else NoShardContext.

FANOUT is not a database. A queryset evaluated under it visits every leg -- control (its rows with no hall, D2; the
halls of the four civilizations excluded), then each shard (a shard's soul copies of another civilization excluded,
D6) -- and merges: each leg fetches its first offset+limit rows in the queryset's own order, the rows are merged in
that order and the slice is taken from the merge. `count` / `exists` / `aggregate` combine per leg; `in_bulk` reads
the merge. `install()` hooks those QuerySet methods; a path it does not cover (raw SQL, explain, a combined
queryset) asks the router, which raises NoShardContext.

Writes. A civilization's MASTER is its shard (`master_alias`).
  writes      a row goes to its hall's master (`write_alias_of`: the row's hall, else the hall of the row a related
              manager hangs off), a row with no hall and every CONTROL row to control, a control-mastered model
              (the CONTROL_READS ones: their reads join control tables) to control. No row: the context's master
              (`acting_alias`). No single one (MASTER, no context): NoShardContext, except that a queryset
              update / delete is split per master (`_split`), a create / get_or_create / bulk_create asks its row
              first, and a read for a write (select_for_update) runs on the one master holding its rows (`_locate`).
  acting      the reads `reads_control` names (in a transaction, a write request, Celery, a command) read the
  reads       masters: every master (MASTER: the merge above), or -- asked about the rows of one row (a related
              manager, which Django routes itself and which cannot merge) -- that row's hall's master. So a write
              request reads its own writes and still finds another civilization's row its payload names, as the
              single database does.
  atomic      `transaction.atomic()` with no `using` is control's transaction plus the context's master shard's
              (every shard's where it has none), so a business transaction holds where its rows and its locks are;
              the shards commit first (`_install_atomic`). A write to a shard outside the open transaction is
              refused (WriteOutsideTransaction).
  control     control holds none of a hall's SHARD rows (stage 5 purged them on 115). A direct write of one there
              (`.using("default")`, loaddata) is refused (ControlMirrorWrite): nothing would ever read it.
              RULE: a data migration that writes SHARD rows reaches control only (`placed_here`; its historical
              models have no guard: `_hook` hands them Django's own QuerySet methods), which holds none of them
              while sharded. Change such rows with a command that runs on every master instead.
"""
import decimal
import functools
import operator
from contextlib import contextmanager
from contextvars import ContextVar

from django.conf import settings
from django.db import connections, models, router
from django.db.models import Count, Max, Min, Sum
from django.db.models.query import (
    FlatValuesListIterable,
    ModelIterable,
    NamedValuesListIterable,
    QuerySet,
    ValuesIterable,
    ValuesListIterable,
)

from apps.core.sharding import (
    REFERENCE,
    SHARD,
    NoShardContext,
    alias_for_civilization,
    cut_civilizations,
    placement,
    tenant_path,
)

FANOUT = "FANOUT"
#: Stage 4: every civilization's master -- control without the halls whose writes are cut over, then each such
#: shard. What a read that may act (and a write naming no row) gets with no single civilization: SYSTEM_ADMIN's
#: write request, a soul account's, a global Celery task, a management command. Not a database either.
MASTER = "MASTER"
CONTROL_ALIAS = "default"
#: A queryset hint: evaluate this queryset on every leg (crossing keys, residence reads).
FANOUT_HINT = "shard_fanout"

_context = ContextVar("shard_read_context", default=None)


#: SHARD models whose reads stay on control after their civilization is cut over, each with the reason. Their
#: queries filter through a control table (User, SoulAccount, celery-beat's PeriodicTask), which no shard has;
#: they move when that filter is rewritten (a denormalized column, or ids read from control first).
#: tests/test_sharded_reads_equal_single_db.py prints this list; it is the stage-3 debt, not a convenience.
#: Each reason names the lookups that make it one (tests/test_fanout_merge_edge_cases.py: each lookup reaches a
#: CONTROL table and the app's code still says it); the set itself is pinned there.
CONTROL_READS = {
    "social.Post": "visibility filters on author__role / author__soul_account__soul_id (User, SoulAccount)",
    "social.Comment": "the same author filters as Post (author__role / author__soul_account__soul_id)",
    "social.Reaction": "lists through post__author (User)",
    "social.PostMedia": "media checks post__author__role (User)",
    "social.SocialMute": "moderation lists filter user__soul_account / user__display_name (User, SoulAccount)",
    "scheduler.ScheduledJob": "jobs filter periodic_task__enabled (django-celery-beat's PeriodicTask, control)",
}


#: A crossing key (SHARD -> SHARD bare id) is never JOINed on a shard: the row on the other end may be in another
#: civilization's shard, and the join would drop the row (INNER) or blank it (LEFT) without a word. Such a read raises
#: CrossShardJoin; the call site reads the other side by ids (`soul_ids`, or the rows' ids then the other rows by id).
#: Until 2026-11-20 a listed key was answered from control instead -- control's copy of the write-cut civilizations'
#: rows, the mirror stage 5 deleted (PREP-stage5 M3).


def cut_over():
    """The civilizations read from their shards: all of them while sharded (`sharding.cut_civilizations`)."""
    return cut_civilizations()


#: Writes and reads are cut over together since 2026-11-21; two names because the call sites ask different questions.
write_cut = cut_over


def master_alias(civ):
    """Where a civilization's rows are written (stage 4): its shard once its writes are cut over, else control."""
    return alias_for_civilization(civ) if civ and civ in write_cut() else CONTROL_ALIAS


def control_mastered(model):
    """A SHARD model whose master stays control after its civilization's writes are cut over: the CONTROL_READS
    models (their reads join control tables). Writing them on a shard and reading them from a lagging control
    would lose a read of one's own write; they keep stage 3's shape (written to control, synced to the shard)."""
    return model._meta.label in CONTROL_READS


def alias_for_reads(civ):
    """Where a civilization's rows are read: its shard once cut over, else control (also UNKNOWN / blank)."""
    return alias_for_civilization(civ) if civ and civ in cut_over() else CONTROL_ALIAS


@contextmanager
def read_context(value):
    """`with read_context(FANOUT):` / `read_context("GREEK")` / `read_context("civ_greek")` / a hall."""
    token = _context.set(_normalize(value))
    try:
        yield
    finally:
        _context.reset(token)


def _normalize(value):
    if value is None or value in (FANOUT, MASTER, CONTROL_ALIAS) or str(value).startswith("civ_"):
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
        return CONTROL_ALIAS if in_celery() else None
    return context_for_user(getattr(request, "user", None))


def context_for_user(user):
    """The read context of a caller with no hall of its own (the request's and the websocket's rule alike)."""
    if user is None or not getattr(user, "is_authenticated", False):
        return FANOUT  # anonymous (sign-in by soul code, a public page) or not yet authenticated: no hall
    from apps.core.tenant import is_civilization_admin, is_tenant_exempt
    from apps.soul_accounts.authentication import SOUL_ROLE

    if getattr(user, "role", None) == SOUL_ROLE:
        return soul_read_context(user)
    if is_tenant_exempt(user):
        return FANOUT
    # An ADMIN viewing one hall (`hall_view`) never gets here: impersonation sets it only on a request whose token
    # names that hall, so `request.tenant` answered first (current_context).
    if is_civilization_admin(user):
        return alias_for_reads(getattr(user, "civilization", None))
    if getattr(user, "tenant_id", None) is not None:  # force_authenticate: request_tenant's fallback
        return alias_for_reads(user.tenant.civilization)
    return CONTROL_ALIAS  # reaches no hall: scope_to_tenant answers it nothing, from control


#: Where a soul account's own reads go, and whether it has rows abroad: cached on the user object (one per request,
#: authentication loads it; `_soul_state`).
_SOUL_CONTEXT_ATTR = "_shard_soul_read_context"
#: The attribute a soul view sets -- to the reason -- when it shows the soul's rows in another civilization's shard
#: (`soul_read_context`). tests/test_soul_reads_one_shard.py lists the views that set it.
READS_SOUL_ROWS_ABROAD = "reads_soul_rows_abroad"


def soul_read_context(user):
    """A soul account reads the shard of its soul's PRIMARY: SoulAccount -> soul -> hall -> civilization, the soul read
    from its master (`_primary_soul`). Never "any shard that has the soul": after a residence or a cross-civilization
    transfer another shard keeps a copy (D6), and the copy is not where the soul's rows are written.
    Every leg (FANOUT), as before, for:
      * a soul with no hall, or a hall of no known civilization: nothing says where its rows are;
      * a soul with rows outside its primary's civilization (a residence court's judgments, a letter in another
        hall's inbox, a DIRECT conversation in the other soul's hall), on a view that shows such rows: the view says
        so with READS_SOUL_ROWS_ABROAD. The whole request, not one queryset: what the view reads next by the
        row's ids (the confessions of a residence judgment, its appeals) is in that row's shard too."""
    primary = soul_primary_alias(user)
    if primary == FANOUT or not _view_shows_rows_abroad():
        return primary
    state = _soul_state(user)
    if state["abroad"] is None:  # asked only where a view shows such rows: it reads every write-cut shard
        state["abroad"] = _rows_abroad(state["soul"], state["civ"])
    return FANOUT if state["abroad"] else primary


def soul_primary_alias(user):
    """The alias of the soul's primary (FANOUT: no hall, no known civilization): `soul_read_context` without the view."""
    state = _soul_state(user)
    return FANOUT if state is None else state["primary"]


def _view_shows_rows_abroad():
    from apps.core.request_local import get_current_request

    match = getattr(get_current_request(), "resolver_match", None)
    func = getattr(match, "func", None)
    view = getattr(func, "view_class", None) or getattr(func, "cls", None)
    return bool(getattr(view, READS_SOUL_ROWS_ABROAD, None))


def _soul_state(user):
    """{soul, civ, primary, abroad} of a soul account, once per request (None while nothing is cut over: no query)."""
    if not settings.SHARDED:
        return None
    cached = getattr(user, _SOUL_CONTEXT_ATTR, None)
    if cached is None:
        from apps.core.civilization import Civilization

        soul = _primary_soul(user)
        civ = soul.tenant.civilization if soul is not None and soul.tenant is not None else None
        known = civ in Civilization.values
        cached = {"soul": soul, "civ": civ, "primary": alias_for_reads(civ) if known else FANOUT,
                  "abroad": None if known else True}
        setattr(user, _SOUL_CONTEXT_ATTR, cached)
    return cached


def _primary_soul(user):
    """The soul row of `user`'s account where it is written: control (D2, a civilization not write-cut) or its
    write-cut shard -- never control's mirror of a write-cut civilization's soul, which stage 5 deletes (PREP-stage5
    M1). The account names the soul (control); each master is asked by pk, narrowed as `legs` narrows a FANOUT read
    of souls (a shard's copies of souls living elsewhere), the first one found wins:
      * a soul in mid-move: the SOURCE hall's master first (control's SOUL_MOVING row, `soul_directory`). Its row there
        is the primary until step 3, which demotes it in the transaction that closes the move; the target's row is
        arriving. Not every master's outbox (`legs`' `_not_arriving`): that asked every shard on every soul request.
      * else the master of the hall its last move took it to (SOUL_LIVES_IN), else of the hall the account was opened
        in: a soul costs one shard query, its primary's.
    ponytail: one pk lookup per master the soul is not on, where neither names its master; a denormalized SoulAccount.soul_tenant_id kept by the
    saga's step 3 makes it a control read, if a moved soul's extra lookups ever show."""
    from apps.soul_accounts.models import SoulAccount
    from apps.souls.models import Soul
    from apps.tenants import soul_directory
    from apps.tenants.models import Tenant

    soul_id = (SoulAccount._base_manager.using(CONTROL_ALIAS).filter(user_id=user.pk)
               .values_list("soul_id", flat=True).first())
    if soul_id is None:
        return None
    first = CONTROL_ALIAS
    hall_id = None
    if settings.SHARDED:
        moving, lives = soul_directory.whereabouts(soul_id)
        hall_id = moving or lives or getattr(user, "tenant_id", None)
    if hall_id is not None:
        hall = Tenant._base_manager.using(CONTROL_ALIAS).filter(pk=hall_id).first()
        first = master_alias(hall.civilization) if hall is not None else CONTROL_ALIAS
    with _over(write_cut()):
        masters = legs(Soul, hide_arriving=False)
    for alias, narrow in sorted(masters, key=lambda leg: leg[0] != first):
        soul = narrow(Soul._base_manager.using(alias).filter(pk=soul_id)).select_related("tenant").first()
        if soul is not None:
            return soul
    return None


def _rows_abroad(soul, civ):
    """Does a row naming `soul` through a crossing key live outside `civ`'s halls (another civilization's shard, or
    control: a row with no hall)? Both asked of control: the other shards by what `soul_directory` noted of them
    (SOUL_ROWS_IN) -- asking each shard put every other shard in every ACROSS request of every soul --, control's own
    rows by one EXISTS per crossing key to Soul. Not control's copy of a write-cut civilization's rows: a mirror stage
    5 deleted (PREP-stage5 M2). The rows that hang off such a row (a judgment's confessions) are in its hall; the rows
    that follow the soul (`soul__tenant`) are in its primary's."""
    from apps.core.tenant import civilization_halls
    from apps.tenants import soul_directory
    from apps.tenants.models import Tenant

    if soul_directory.rows_abroad(soul.pk, civ):
        return True
    mine = civilization_halls(civ).values("pk")
    found = functools.reduce(operator.or_, [
        models.Exists(f.model._base_manager.filter(**{f.attname: soul.pk})
                      .exclude(**{f"{tenant_path(f.model)}__in": mine})) for f in _keys_to_soul()])
    # The soul's hall is on control (REFERENCE): one row to hang the EXISTS on.
    return Tenant._base_manager.using(CONTROL_ALIAS).filter(pk=soul.tenant_id).filter(found).exists()


@functools.cache
def _keys_to_soul():
    from apps.souls.models import Soul

    return tuple(f for f in crossing_keys() if f.related_model._meta.concrete_model is Soul)


def in_write_transaction():
    """A transaction opened by the code (not the test case's wrapper) is open on control (or, stage 4, on a shard
    whose writes are cut over: `transaction.atomic()` opens one there too, `_install_atomic`)."""
    aliases = [CONTROL_ALIAS, *(alias_for_civilization(c) for c in write_cut())]
    return any(not a._from_testcase for alias in aliases if alias in connections
               for a in connections[alias].atomic_blocks)


def reads_control():
    """A read that may act on what was just written reads where the writes go (`_acting_read`): inside the code's
    own transaction, anywhere in a write request (any method but GET / HEAD / OPTIONS), in a command's control
    context, and in Celery with no hall of a known civilization (module header)."""
    explicit = _context.get()
    if in_write_transaction() or explicit == CONTROL_ALIAS:  # or the code said so: read_context("default")
        return True
    from apps.core.request_local import get_current_request

    request = get_current_request()
    if request is not None:
        return getattr(request, "method", "GET") not in ("GET", "HEAD", "OPTIONS")
    if explicit is None and in_celery():
        from apps.tenants.managers import get_current_tenant

        hall = get_current_tenant()
        return hall is None or hall.civilization not in write_cut()
    return False


def _civ_of_alias(alias):
    from apps.core.civilization import Civilization

    return next((c for c in Civilization.values if alias_for_civilization(c) == alias), None)


def acting_alias():
    """Stage 4: where this request / task writes a SHARD row that names no hall of its own, and where its reads that
    may act on those writes go: the master of its civilization (`master_alias`); MASTER where it has no single one
    (SYSTEM_ADMIN, a soul account, an anonymous caller, a global Celery task, a management command or an explicit
    FANOUT / control context); None with no context at all. Only asked while sharded. The control
    context a management command runs in (stage 3: "it writes to control") gives way to a hall the command's code
    names with the tenant contextvar (a per-hall job run by hand); with none, it is MASTER."""
    explicit = _context.get()
    if explicit is not None and explicit != CONTROL_ALIAS:
        return MASTER if explicit in (FANOUT, MASTER) else master_alias(_civ_of_alias(explicit))
    from apps.core.request_local import get_current_request
    from apps.tenants.managers import get_current_tenant

    request = get_current_request()
    hall = getattr(request, "tenant", None) if request is not None else None
    if hall is None:
        hall = get_current_tenant()
    if hall is not None:
        return master_alias(hall.civilization)
    if explicit == CONTROL_ALIAS:
        return MASTER
    if request is None:
        return MASTER if in_celery() else None
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "is_authenticated", False):
        return MASTER
    from apps.core.tenant import is_civilization_admin, is_tenant_exempt
    from apps.soul_accounts.authentication import SOUL_ROLE

    if is_tenant_exempt(user) or getattr(user, "role", None) == SOUL_ROLE:
        return MASTER
    if is_civilization_admin(user):
        return master_alias(getattr(user, "civilization", None))
    if getattr(user, "tenant_id", None) is not None:
        return master_alias(user.tenant.civilization)
    return CONTROL_ALIAS


def _acting_read(hints):
    """A read that may act on what was just written (`reads_control`). Not sharded: control, which holds every row.
    Sharded: the row's own database when it came from a master, else every master (MASTER). Not only the context's
    master: a write
    request of a Greek hall still reads the row of another civilization its payload names, to refuse it the way the
    single database does ("no such soul in this tenant", not "object does not exist";
    tests/test_sharded_writes_equal_single_db.py)."""
    if not settings.SHARDED:
        return CONTROL_ALIAS
    if hints.get(FANOUT_HINT):
        return MASTER  # a crossing key: the row it names may be in any master
    instance = hints.get("instance")
    kind = placement(type(instance)) if instance is not None else None
    if kind in (SHARD, REFERENCE):
        # The rows hanging off a row (job.runs, soul.records) are its hall's: that hall's master. One database --
        # Django asks the router itself for a related manager (`_apply_rel_filters`), which cannot merge.
        civ = instance.civilization if kind == REFERENCE else _loaded_civilization(instance)
        if civ is not None:
            return master_alias(civ) if civ else CONTROL_ALIAS
        db = instance._state.db  # a hop of its path not loaded (reading it here would ask this again): its database
        return db if db and (db == CONTROL_ALIAS or _civ_of_alias(db) in write_cut()) else (
            acting_alias() if acting_alias() not in (None, MASTER) else CONTROL_ALIAS)
    return MASTER


def _loaded_civilization(instance):
    """The civilization of `instance`'s hall from what is in memory (its loaded path, the hall id read from control):
    "" for a row with no hall, None when a hop is not loaded."""
    from django.apps import apps as django_apps

    obj = instance
    *hops, last = tenant_path(type(instance)).split("__")
    for hop in hops:
        f = obj._meta.get_field(hop)
        if getattr(obj, f.attname) is None:
            return ""
        obj = f.get_cached_value(obj, None)
        if obj is None:
            return None
    f = obj._meta.get_field(last)
    cached = f.get_cached_value(obj, None)
    if cached is not None:
        return cached.civilization
    hall_id = getattr(obj, f.attname)
    if hall_id is None:
        return ""
    hall = django_apps.get_model("tenants", "Tenant")._base_manager.using(CONTROL_ALIAS).filter(pk=hall_id).first()
    return hall.civilization if hall is not None else ""


def route(model, hints):
    """The alias a read of `model` goes to; None = Django's default answer; FANOUT / MASTER = every leg.
    Raises NoShardContext where nothing says which civilization."""
    if not settings.SHARDED or placement(model) != SHARD:
        return None
    if model._meta.label in CONTROL_READS:
        return CONTROL_ALIAS
    if reads_control():
        return _acting_read(hints)
    if hints.get(FANOUT_HINT):
        return FANOUT
    instance = hints.get("instance")
    if instance is not None:
        kind = placement(type(instance))
        if kind == SHARD and instance._state.db:
            return None  # the database the row came from (an unsaved row: the context's)
        if kind == REFERENCE:
            return alias_for_reads(instance.civilization)
    ctx = current_context()
    if ctx is None:
        raise NoShardContext(f"{model._meta.label}: a read with no shard context while {cut_over()} are cut over")
    return ctx


def _hall_of(instance):
    """The hall (a Tenant) at the end of `instance`'s tenant path, or None: a row with no hall (D2). Follows the
    in-memory objects; a hop not loaded yet is read (its own route)."""
    path = tenant_path(type(instance))
    if path is None:
        return None
    obj = instance
    for hop in path.split("__"):
        f = obj._meta.get_field(hop)
        cached = f.get_cached_value(obj, None)
        if cached is None and getattr(obj, f.attname) is None:
            return None
        obj = cached if cached is not None else getattr(obj, hop, None)  # RelatedObjectDoesNotExist: AttributeError
        if obj is None:
            return None
    return obj


def write_alias_of(instance):
    """Stage 4: the database holding the authoritative row of `instance` (and where a write of it goes): the master
    of its hall's civilization (`master_alias`); control for a row with no hall (D2), a control-mastered model,
    and every CONTROL row. A REFERENCE row (a hall) answers for its own civilization."""
    kind = placement(type(instance))
    if kind == REFERENCE:
        return master_alias(instance.civilization)
    if kind != SHARD or control_mastered(type(instance)):
        return CONTROL_ALIAS
    hall = _hall_of(instance)
    return master_alias(hall.civilization) if hall is not None else CONTROL_ALIAS


def write_route(model, hints):
    """Where a write of `model` goes. Not sharded: Django's own answer. Sharded: a SHARD row of a hall on its
    civilization's shard, any other on control (`write_alias_of`: the row's hall, or the hall of the row the write hangs off -- a related manager's
    instance); with no row to ask, the context's master (`acting_alias`). No single answer (MASTER, no context)
    raises NoShardContext: a queryset update / delete over MASTER is split per master by `install()`'s hooks,
    and create / get_or_create / bulk_create ask their row first."""
    instance = hints.get("instance")
    if not settings.SHARDED:
        return None
    if placement(model) != SHARD:
        return None
    if control_mastered(model):
        return _checked(CONTROL_ALIAS)
    if instance is not None and placement(type(instance)) in (SHARD, REFERENCE):
        return _checked(write_alias_of(instance))
    alias = acting_alias()
    if alias in (None, MASTER) and instance is not None:
        # A control row hinted (assigning it to a new row's key in Model.__init__, e.g. ChatIdentity(account=...)
        # before `soul` is set): no answer yet, not a refusal. The write itself names its database or asks with
        # the row, and `_before_shard_write` checks it there (simulator 2026-11-21: a soul's first letters 500ed).
        return None
    if alias in (None, MASTER):
        raise NoShardContext(f"{model._meta.label}: a write naming no row and no single civilization while "
                             f"{write_cut()} write to their shards")
    return _checked(alias)


def _checked(alias):
    """Where the router sends a write. Not where it is checked: Django asks `db_for_write` on a mere assignment
    of a related row too (ForwardManyToOneDescriptor.__set__); the checks run at the write (`_before_shard_write`)."""
    return alias


def soul_ids(**filters):
    """Pks of the souls matching `filters`, read on every leg (each soul's master). For a row joined to its soul
    through a crossing key on a shard -- the other row may be in another civilization's shard, and the fallback that
    answered such a join from control read a mirror stage 5 deletes, and a shard refuses it now: filter
    `soul_id__in=soul_ids(...)` instead of `soul__...`. Keep the filter narrow (deleted souls, a name searched for)."""
    from apps.souls.models import Soul

    return list(with_fanout(Soul._base_manager.filter(**filters)).values_list("pk", flat=True))


def crossing_q(model, lookup, value):
    """`Q(**{lookup: value})` on `model`, but a crossing key on the path is read by ids instead of joined (sharded;
    not sharded, the plain Q). `soul__name__icontains="x"` on a judgment -> `soul_id__in=<the souls named x, every
    leg>`; the reverse of one (`participants__participant_tenant=t` on a bench) -> `pk__in=<those seats' bench ids>`.
    A forward key from a shard model's table to a CONTROL row (`user__username` on an audit row: no shard has the
    user table) is read the same way, from control. For the filters a caller passes through such a key: `?search=` (`ShardSearchFilter`), `?soul_name=`, a data
    scope. A path that only compares the key's column (`soul`, `soul__in`, `soul__id`) is left as it is.
    ponytail: the ids go into the SQL as a list -- a filter matching a whole hall's souls (`?civilization=`, a data
    scope on a big organization) wants the column denormalized onto the row."""
    from django.core.exceptions import FieldDoesNotExist
    from django.db.models import Q

    if not settings.SHARDED:
        return Q(**{lookup: value})
    parts, m, crossing = lookup.split("__"), model, set(crossing_keys())
    on_shard = placement(model) == SHARD
    for i, name in enumerate(parts):
        try:
            f = m._meta.pk if name == "pk" else m._meta.get_field(name)
        except FieldDoesNotExist:
            break
        if not f.is_relation:
            break
        key, rest = (f if f.concrete else f.field), "__".join(parts[i + 1:])
        nxt = parts[i + 1] if i + 1 < len(parts) else None
        # A crossing key, or (on a shard model's table) a key to a CONTROL row no shard has (AuditLog.user).
        if nxt is not None and (key in crossing or (f.concrete and on_shard and f.name in _unreachable(m))):
            prefix = "__".join(parts[:i] + [""])
            other = f.related_model
            if f.concrete:  # forward: our column names the other row
                try:
                    other._meta.get_field(nxt)
                except FieldDoesNotExist:
                    break  # `soul__in` / `soul__isnull`: the column alone
                if nxt in ("pk", f.target_field.name):
                    break
                mine, theirs = f.attname, f.target_field.attname
            else:  # reverse: the other row's column names ours
                mine, theirs = key.target_field.attname, key.attname
            q = crossing_q(other, rest, value)
            ids = (with_fanout(other._base_manager.filter(q).order_by()) if placement(other) == SHARD
                   else other._base_manager.filter(q).order_by()).values_list(theirs, flat=True)
            return Q(**{f"{prefix}{mine}__in": list(set(ids))})
        m = f.related_model
    return Q(**{lookup: value})


def orders_across(model, path):
    """Whether `order_by(path)` on a shard model joins through a crossing key or to a CONTROL row (`soul__name`, and
    `soul` itself: Django orders a key by the other model's ordering). An order cannot be read by ids; the caller
    drops it (`ShardOrderingFilter`)."""
    from django.core.exceptions import FieldDoesNotExist

    if not settings.SHARDED or placement(model) != SHARD:
        return False
    parts, m, crossing = path.lstrip("-").split("__"), model, set(crossing_keys())
    for i, name in enumerate(parts):
        try:
            f = m._meta.get_field(name)
        except FieldDoesNotExist:
            return False
        if not f.is_relation:
            return False
        nxt = parts[i + 1] if i + 1 < len(parts) else None
        if f.concrete and (f in crossing or f.name in _unreachable(m)):
            return name != f.attname and nxt not in ("pk", f.target_field.name)
        if not f.concrete and f.field in crossing:
            return True
        m = f.related_model
    return False


def related_of(instance, name):
    """`instance.<name>` -- a forward key to a SHARD row -- read where that row is. A row with no hall (D2) lives on
    control while the row it names may be a hall's, written on that hall's shard once writes are cut over: Django's
    accessor reads the instance's own database, i.e. control's copy, a mirror stage 5 deletes (DoesNotExist after the
    purge; verdict-document.pdf). For such a row the target is
    read by id from every leg; any other row, and a target already loaded, as Django reads it. None for a null key or
    a row that is nowhere."""
    f = instance._meta.get_field(name)
    cached = f.get_cached_value(instance, None)
    if cached is not None or getattr(instance, f.attname) is None:
        return cached
    if (not settings.SHARDED or (instance._state.db or CONTROL_ALIAS) != CONTROL_ALIAS
            or placement(f.related_model) != SHARD or _hall_of(instance) is not None):
        return getattr(instance, name)
    found = with_fanout(f.related_model._base_manager.filter(pk=getattr(instance, f.attname))).first()
    if found is not None:
        f.set_cached_value(instance, found)
    return found


def control_m2m(instance, name):
    """`instance.<name>.all()` for a SHARD row's many-to-many to a CONTROL model through a SHARD table (CityGod.officers,
    TudiGod.officers): the through rows read on the row's own database, the targets on control by id. Django's own
    manager reads the targets' database and joins the through table there -- on control, its copy of a write-cut
    civilization's through rows: a mirror stage 5 deleted (PREP-stage5). A queryset of the targets, for filtering
    further."""
    f = instance._meta.get_field(name)
    through = f.remote_field.through
    ids = (through._base_manager.using(instance._state.db or CONTROL_ALIAS)
           .filter(**{f.m2m_field_name(): instance.pk}).values_list(f.m2m_reverse_field_name(), flat=True))
    return f.related_model._default_manager.filter(pk__in=list(ids))


def prefetch_control_m2m(instances, name):
    """`control_m2m` for a page of rows at once -- one through query per database the rows came from, one query of
    the targets -- left on each row as `control_m2m_cached(row, name)` reads it. Returns the rows as a list."""
    rows = list(instances)
    if not rows:
        return rows
    f = rows[0]._meta.get_field(name)
    through, src, tgt = f.remote_field.through, f.m2m_field_name(), f.m2m_reverse_field_name()
    pairs = []
    for db in {r._state.db or CONTROL_ALIAS for r in rows}:
        pks = [r.pk for r in rows if (r._state.db or CONTROL_ALIAS) == db]
        pairs += list(through._base_manager.using(db).filter(**{f"{src}__in": pks}).values_list(src, tgt))
    targets = f.related_model._default_manager.in_bulk({t for _, t in pairs})
    for r in rows:
        setattr(r, f"_control_m2m_{name}", [targets[t] for s, t in pairs if s == r.pk and t in targets])
    return rows


def control_m2m_cached(instance, name):
    """The targets `prefetch_control_m2m` left on `instance`, else `control_m2m`'s query."""
    cached = getattr(instance, f"_control_m2m_{name}", None)
    return cached if cached is not None else control_m2m(instance, name)


def fanout_reads(fn):
    """A management command / global sweep with no request or hall: its reads visit every leg."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with read_context(FANOUT):
            return fn(*args, **kwargs)
    return wrapper


def with_fanout(qs):
    """`qs`, evaluated on every leg (no-op while nothing is cut over)."""
    if not settings.SHARDED:
        return qs
    qs = qs._chain()
    qs._hints = {**qs._hints, FANOUT_HINT: True}
    return qs


# ---- legs -------------------------------------------------------------------------------------------------

def _halls(civs):
    from apps.core.tenant import civilization_halls

    return [pk for civ in civs for pk in civilization_halls(civ).using(CONTROL_ALIAS).values_list("pk", flat=True)]


#: The civilizations a merge visits (`_wanted`): every one while sharded, for a FANOUT read and for MASTER alike.
_merging = ContextVar("shard_merge_civs", default=None)


@contextmanager
def _over(civs):
    token = _merging.set(list(civs))
    try:
        yield
    finally:
        _merging.reset(token)


def legs(model, *, hide_arriving=True):
    """[(alias, narrow)] covering every row of `model` exactly once: control without the cut-over
    civilizations' halls (hall-less rows stay, D2), then each cut-over shard (`_merging`: read-cut for FANOUT,
    write-cut for MASTER) -- for Soul only its own
    civilization's souls, not the copies of souls residing elsewhere (D6), and not a soul arriving in a move still
    open (`_not_arriving`: every master's outbox, asked once per merge). `hide_arriving=False` leaves that to the
    caller (`_primary_soul`, which knows the soul's open move from control)."""
    from apps.souls.models import Soul

    path = tenant_path(model)
    cut = _merging.get()
    cut = cut_over() if cut is None else cut
    out = [(CONTROL_ALIAS, lambda qs: qs.exclude(**{f"{path}__in": _halls(cut)}))]
    for civ in cut:
        narrow = functools.partial(_own_souls, civ=civ) if model._meta.concrete_model is Soul else (lambda qs: qs)
        out.append((alias_for_civilization(civ), narrow))
    if hide_arriving and model._meta.concrete_model is Soul:
        out = _not_arriving(out)
    return out


def _not_arriving(out):
    """The dedupe point of a soul in mid-move (stage 4 part C): while its move is PENDING the target's row is not
    visible on any leg -- the source's is the primary until step 3 closes the move (`shard_saga.arriving`)."""
    from django.db.models import Q

    from apps.tenants.shard_saga import arriving

    rows = arriving()
    if not rows:
        return out
    hidden = functools.reduce(operator.or_, (Q(pk=pk, tenant_id=hall) for pk, hall in rows))
    return [(alias, lambda qs, narrow=narrow: narrow(qs).exclude(hidden)) for alias, narrow in out]


def _own_souls(qs, civ):
    return qs.filter(tenant__in=_halls([civ]))


def _leg(qs, alias, narrow, high):
    base = qs._chain()
    base.query.clear_limits()
    base._hints = {k: v for k, v in qs._hints.items() if k != FANOUT_HINT}
    leg = narrow(base.using(alias))
    guard(leg, alias)
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
        if f.is_relation and (f.many_to_one or f.one_to_one):  # a one-to-one (ChatIdentity.account) joins the same
            target = f.related_model
            if placement(target) not in (SHARD, REFERENCE) or (is_bare(f) and placement(target) == SHARD):
                out.add(f.name)
    return frozenset(out)


@functools.cache
def _crossing_names(model):
    """The forward crossing keys of `model` (SHARD -> SHARD bare ids): what control cannot join through either once
    writes are cut over -- a row there (no hall, D2) may name a row its master shard holds, and control's copy of it
    is a mirror stage 5 deletes."""
    return frozenset(f.name for f in crossing_keys() if f.model._meta.concrete_model is model._meta.concrete_model)


def _strip(model, tree, unreachable=_unreachable):
    keep = {}
    for name, sub in tree.items():
        if name in unreachable(model):
            continue
        try:
            f = model._meta.get_field(name)
        except Exception:
            keep[name] = sub  # a reverse one-to-one: same database, left alone
            continue
        keep[name] = _strip(f.related_model, sub, unreachable) if f.is_relation and f.related_model else sub
    return keep


def strip_unreachable_joins(qs, alias):
    """Drop select_related paths the database cannot join: on a shard alias `_unreachable`; on control, once writes
    are cut over, the crossing keys (`_crossing_names`: an INNER JOIN to a row only its shard has drops the row).
    The accessor reads the other row where it is."""
    if not qs.query.select_related:
        return
    on_shard = alias.startswith("civ_")
    if not on_shard and not (alias == CONTROL_ALIAS and settings.SHARDED):
        return
    if qs.query.select_related is True:
        qs.query.select_related = False
        return
    qs.query.select_related = _strip(qs.model, qs.query.select_related,
                                     _unreachable if on_shard else _crossing_names)


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


def _crossing_subquery(query):
    """A correlated subquery that matches the outer row through a crossing key is the same hazard as a join
    (Exists(Reincarnation.filter(soul=OuterRef("soul")))): the rows it looks for may be in another shard. The
    label of the first crossing key such a subquery (any level down) filters on, or None."""
    from django.db.models.expressions import Col

    by_field = {(f.model._meta.concrete_model, f.column): f"{f.model._meta.label}.{f.name}" for f in crossing_keys()}
    for node in _subqueries(query):
        inner = node.model._meta.concrete_model if node.model else None
        for expr in _nodes(node.where):
            lhs = getattr(expr, "lhs", None)
            if isinstance(lhs, Col) and (inner, lhs.target.column) in by_field and _outer_ref(expr, node):
                return by_field[(inner, lhs.target.column)]
    return None


def _subqueries(query, depth=0):
    """Every subquery (a Query) in `query`'s annotations and WHERE, outermost first, down to three levels:
    `pk__in=<queryset>`, Exists(...), Subquery(...)."""
    from django.db.models.sql import Query

    def walk(node):
        if isinstance(node, Query):
            yield node
            if depth < 3:
                yield from _subqueries(node, depth + 1)
            return
        for child in node.get_source_expressions() if hasattr(node, "get_source_expressions") else ():
            if child is not None:
                yield from walk(child)
        inner_query = getattr(node, "query", None)
        if isinstance(inner_query, Query):
            yield from walk(inner_query)

    for expr in [*query.annotations.values(), *_nodes(query.where)]:
        yield from walk(expr)


class CrossDatabaseSubquery(CrossShardJoin):
    """A subquery whose model lives on the other side of the control / shard line from the query it sits in
    (User.objects.filter(pk__in=Follow.objects.values("following_id")), or an Exists over Follow on a User query):
    Django compiles the whole statement on the outer query's database, which does not hold the inner rows, so the
    answer is empty or false without a word (apps/social/soul_views.py until 184793e22). Loud instead; the call
    site reads the inner ids from their own database into a list, then filters or annotates with that."""


def _side(model, alias):
    """"control" or "shard": where `model`'s rows are read under sharding. A CONTROL model and a control-mastered
    SHARD model (CONTROL_READS) are control's; any other SHARD model is its civilization's shard's; a REFERENCE
    model (a hall) is on both, so it sides with the database the statement runs on (`alias`)."""
    kind = placement(model)
    if kind == REFERENCE:
        return "shard" if alias.startswith("civ_") else "control"
    return "shard" if kind == SHARD and not control_mastered(model) else "control"


def _other_database_subquery(query, alias):
    """The label of the first subquery model in `query` (run on `alias`) whose rows live on the other side, or
    None. A REFERENCE subquery is on both sides and never counts."""
    if query.model is None:
        return None
    outer = _side(query.model, alias)
    for node in _subqueries(query):
        if (node.model is not None and placement(node.model) != REFERENCE
                and _side(node.model, alias) != outer):
            return node.model._meta.label
    return None


def refuse_other_database_subquery(qs, alias):
    """Raise CrossDatabaseSubquery when `qs`, compiled on `alias`, holds a subquery of a model the other side
    holds. A no-op unsharded."""
    if not settings.SHARDED:
        return
    label = _other_database_subquery(qs.query, alias)
    if label:
        raise CrossDatabaseSubquery(
            f"{qs.model._meta.label} on {alias} has a subquery over {label}, whose rows are on the other side of "
            f"the control / shard line; read its ids first (a list), then filter or annotate with them")


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
    """Make a read on shard `alias` one a shard can answer: strip unreachable select_related; refuse a join through
    a crossing key (CrossShardJoin)."""
    strip_unreachable_joins(qs, alias)
    if not alias.startswith("civ_"):
        return None
    refuse_other_database_subquery(qs, alias)
    key = _crossing_join(qs.query, alias)
    if key:
        raise CrossShardJoin(f"{qs.model._meta.label} on {alias} joins through the crossing key {key}")
    return None


def _strip_for_write(qs):
    """A read for a write (select_for_update, get_or_create's get) goes where `db_for_write` says, so `_guard_routed`
    never strips its select_related: on a shard a JOIN through a CONTROL row (a conversation's SoulAccount) raised
    "no such table", through a bare id it dropped the row. Strip them the same way; the accessor reads the row."""
    if settings.SHARDED and qs.query.select_related and placement(qs.model) == SHARD:
        strip_unreachable_joins(qs, qs.db)


def _guard_routed(qs, aggregates=None):
    """A read the router sends to one shard (not a FANOUT merge, not an explicit `.using`). `aggregates`: the
    expressions an aggregate() is about to add (their filters may join too)."""
    if qs._db is not None or qs._for_write:
        return  # `.using(alias)` says where on purpose: control's own rows with no hall (`_rows_abroad`)
    probe = qs.alias(**aggregates) if aggregates else qs
    if placement(qs.model) == SHARD:
        guard(probe, qs.db)
    refuse_other_database_subquery(probe, qs.db)


# ---- the merge ---------------------------------------------------------------------------------------------

def _wanted(qs):
    """The civilizations a merge of `qs` visits, or None: read where the router sends it."""
    if qs._db is not None or qs._for_write or not settings.SHARDED:
        return None
    if placement(qs.model) != SHARD or qs.model._meta.label in CONTROL_READS:
        return None
    if reads_control():
        return write_cut() if settings.SHARDED and _acting_read(qs._hints) == MASTER else None
    if qs._hints.get(FANOUT_HINT):
        return cut_over()
    instance = qs._hints.get("instance")
    if instance is not None and placement(type(instance)) in (SHARD, REFERENCE):
        return None
    return cut_over() if current_context() == FANOUT else None


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
    if not q.standard_ordering:  # reverse(), and so last() / latest(): the compiler flips every key, nulls too
        out = [(name, not desc, None if nulls is None else not nulls) for name, desc, nulls in out]
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
    for alias, narrow in legs(qs.model):
        leg = _leg(qs, alias, narrow, None)
        if grouped and _avgs(qs):
            leg = leg.annotate(**{f"_shard_{k}_{n}": fn(*a.source_expressions, filter=a.filter)
                                  for n, a in _avgs(qs).items() for k, fn in (("s", Sum), ("n", Count))})
        if order and (iterable is ModelIterable or extra):
            leg = leg.annotate(**{f"_shard_k{i}": models.F(name) if isinstance(name, str) else name
                                  for i, (name, _, _) in enumerate(order)})
            if iterable is FlatValuesListIterable:
                leg._iterable_class = ValuesListIterable  # keep the keys; flattened again below
            guard(leg, leg.db)  # an order through a crossing key
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


def _total(values):
    """The legs' sums added in their own type (a duration, a Decimal), not from the int 0; None when no leg had one."""
    present = [v for v in values if v is not None]
    return functools.reduce(operator.add, present) if present else None


def _average(name, total, many, default):
    """An Avg from the legs' Sum and Count: a number or a duration divided here."""
    if isinstance(total, decimal.Decimal):  # Python's division does not round the way avg(numeric) does
        raise NotImplementedError(f"{name}: Avg over a DecimalField cannot be combined across shards exactly")
    return total / many if many else default


_COMBINE = {Count: lambda vs: sum(v or 0 for v in vs), Sum: _total,
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
                out[n] = _average(n, total, many, a.default)
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
        # The database counts these without their ORDER BY unless sliced (Query.get_aggregation), so an order
        # key -- Meta.ordering's too -- never joins what DISTINCT / GROUP BY is taken over.
        return len(merged(qs if q.is_sliced else qs.order_by()))
    total = sum(_leg(qs, alias, narrow, None).count() for alias, narrow in legs(qs.model))
    total = max(0, total - q.low_mark)
    return min(total, q.high_mark - q.low_mark) if q.high_mark is not None else total


def exists(qs):
    if qs.query.low_mark:  # qs[n:].exists(): whether a row is left after the first n of the merge
        return count(qs) > 0
    return any(_leg(qs, alias, narrow, qs.query.high_mark).exists() for alias, narrow in legs(qs.model))


def in_bulk(qs, id_list=None, *, field_name="pk"):
    """Django's in_bulk over the merge (Django's own reads `connections[qs.db]`, which FANOUT is not)."""
    if qs.query.is_sliced:
        raise TypeError("Cannot use 'limit' or 'offset' with in_bulk().")
    if field_name != "pk" and not qs.model._meta.get_field(field_name).unique:
        raise ValueError(f"in_bulk()'s field_name must be a unique field but {field_name!r} isn't.")
    if id_list is not None:
        id_list = tuple(id_list)
        if not id_list:
            return {}
        qs = qs.filter(**{f"{field_name}__in": id_list})
    return {getattr(obj, field_name): obj for obj in qs}


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
    for alias, narrow in legs(qs.model):
        leg = _leg(qs, alias, narrow, None)
        probe = leg.alias(**per_leg, **{f"_shard_d_{n}": e.source_expressions[0] for n, (h, e) in asked.items()
                                        if h == "distinct"})
        guard(probe, leg.db)  # an aggregate through a crossing key
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
            s = _total(p[f"{name}__s"] for p in parts)
            n = sum(p[f"{name}__n"] or 0 for p in parts)
            out[name] = _average(name, s, n, expr.default)
        elif isinstance(how, tuple):  # Coalesce(aggregate, constants...)
            value = how[1]([p[name] for p in parts])
            out[name] = value if value is not None else next((v for v in how[2] if v is not None), None)
        else:
            value = how([p[name] for p in parts])
            out[name] = expr.default if value is None and getattr(expr, "default", None) is not None else value
    return out


# ---- hooks -------------------------------------------------------------------------------------------------

_celery_signal = ContextVar("shard_read_celery_signal", default=False)


def in_celery():
    """Inside a Celery task's body (a worker, or an eager call), or a Celery signal's receivers (module header:
    with no hall of its own, it reads control)."""
    from celery import current_task

    if _celery_signal.get():
        return True
    return bool(current_task) and getattr(current_task.request, "id", None) is not None


def _install_celery_signals():
    """Mark the receivers of every Celery signal as "inside Celery" (worker_ready has no task and no request)."""
    from celery.utils.dispatch import Signal

    original = Signal.send
    if getattr(original, "_shard_reads", False):
        return

    def send(self, *args, **kwargs):
        token = _celery_signal.set(True)
        try:
            return original(self, *args, **kwargs)
        finally:
            _celery_signal.reset(token)
    send._shard_reads = True
    functools.update_wrapper(send, original)
    Signal.send = send


def _hook(name, make):
    """Patch QuerySet.`name` with `make(original)`. A migration's historical model (module "__fake__") gets
    Django's own method: a data migration names its database (`.using(alias)`), and the routing and guards here
    read the *current* models -- `_halls` asks the current Tenant for a column a half-migrated database does not
    have yet, so an empty database migrated with every civilization cut over failed at disposition/0009
    (tests/test_migrate_under_full_cut_over.py)."""
    original = getattr(QuerySet, name)
    if getattr(original, "_shard_reads", False):
        return
    routed = make(original)

    def wrapped(self, *args, **kwargs):
        if getattr(self.model, "__module__", None) == "__fake__":
            return original(self, *args, **kwargs)
        return routed(self, *args, **kwargs)
    wrapped._shard_reads = True
    functools.update_wrapper(wrapped, original)
    setattr(QuerySet, name, wrapped)


def install():
    """Route the evaluation of a FANOUT read through `merged` / `count` / `exists` / `aggregate`, and keep
    every shard-routed read off joins a shard cannot make. No-ops while nothing is cut over."""

    def fetch_all(original):
        def _fetch_all(self):
            if self._result_cache is None and self._for_write:
                _locate(self)
                _strip_for_write(self)
            if self._result_cache is None and settings.SHARDED:
                civs = _wanted(self)
                if civs is not None:
                    with _over(civs):
                        self._result_cache = merged(self)
                    self._prefetch_done = True
                else:
                    _guard_routed(self)
            return original(self)
        return _fetch_all

    def iterator(original):
        def _iterator(self, chunk_size=None):
            if self._for_write:
                _locate(self)
                _strip_for_write(self)
            if settings.SHARDED:
                civs = _wanted(self)
                if civs is not None:
                    with _over(civs):
                        return iter(merged(self))
                _guard_routed(self)
            return original(self, chunk_size) if chunk_size is not None else original(self)
        return _iterator

    def evaluating(fanned):
        def make(original):
            def method(self, *args, **kwargs):
                if self._result_cache is None and settings.SHARDED:
                    civs = _wanted(self)
                    if civs is not None:
                        with _over(civs):
                            return fanned(self, *args, **kwargs)
                    _guard_routed(self)
                return original(self, *args, **kwargs)
            return method
        return make

    def aggregating(original):
        def _aggregate(self, *args, **kwargs):
            if settings.SHARDED:
                civs = _wanted(self)
                if civs is not None:
                    with _over(civs):
                        return aggregate(self, args, dict(kwargs))
                _guard_routed(self, {**{a.default_alias: a for a in args}, **kwargs})
            return original(self, *args, **kwargs)
        return _aggregate

    counting, existing, bulk = evaluating(count), evaluating(exists), evaluating(in_bulk)

    from django.core.management.base import BaseCommand

    original_execute = BaseCommand.execute
    if not getattr(original_execute, "_shard_reads", False):
        def execute(self, *args, **options):
            if _context.get() is not None:
                return original_execute(self, *args, **options)
            # An operator command reads where it writes (header): control; from stage 4 every master
            # (`acting_alias` reads an explicit control context as MASTER once writes are cut over).
            with read_context(CONTROL_ALIAS):
                return original_execute(self, *args, **options)
        execute._shard_reads = True
        functools.update_wrapper(execute, original_execute)
        BaseCommand.execute = execute

    _hook("_fetch_all", fetch_all)
    _hook("iterator", iterator)
    _hook("count", counting)
    _hook("exists", existing)
    _hook("aggregate", aggregating)
    _hook("in_bulk", bulk)
    _install_writes()
    _install_atomic()
    _install_crossing_accessors()
    _install_celery_signals()


# ---- stage 4: writes ---------------------------------------------------------------------------------------

def _split(qs):
    """A queryset update / delete with no row and no single civilization (MASTER), once writes are cut over: one
    queryset per master, each holding the rows that master owns (`legs`); None when the
    router can answer it alone. A filter a shard cannot join (a crossing key) is refused: control's copy of the
    other side lags, and a write must not act on it."""
    if (not settings.SHARDED or qs._db is not None or placement(qs.model) != SHARD
            or control_mastered(qs.model) or qs._hints.get("instance") is not None or acting_alias() != MASTER):
        return None
    out = []
    with _over(write_cut()):
        for alias, narrow in legs(qs.model):
            leg = narrow(qs._chain().using(alias))
            if alias != CONTROL_ALIAS:
                _checked(alias)
                guard(leg, alias)
            out.append(leg)
    return out


def per_master(qs):
    """`qs` as one queryset per master holding its rows, for a bulk write the QuerySet hooks do not split: a
    `_raw_delete` asks `qs.db`, which in a context of no single civilization (MASTER: a global job) has no answer
    and raises NoShardContext. `_split`'s parts where it splits; else `[qs]`, which the router answers alone."""
    return _split(qs) or [qs]


def _locate(qs):
    """A read for a write (select_for_update, get_or_create's get) with no row and no single civilization (MASTER):
    it runs on the one master holding its rows -- control's (D2, civilizations not cut over) or a write-cut
    shard's -- found by asking each master first. Rows in two masters cannot be locked in one statement:
    NoShardContext. No-op until writes are cut over, or where the router can answer alone."""
    if (not settings.SHARDED or qs._db is not None or placement(qs.model) != SHARD
            or control_mastered(qs.model) or qs._hints.get("instance") is not None
            or acting_alias() not in (None, MASTER)):
        return
    plain = qs._chain()
    plain.query.clear_limits()  # which master holds the rows, not which of them (get's LIMIT 21 cannot be filtered)
    plain.query.select_for_update = False
    plain._for_write = False
    homes = []
    with _over(write_cut()):
        for alias, narrow in legs(qs.model):
            leg = narrow(plain._chain().using(alias))
            if alias != CONTROL_ALIAS:
                guard(leg, alias)
            if leg.exists():
                homes.append(alias)
    if len(homes) > 1:
        raise NoShardContext(f"{qs.model._meta.label}: a read for a write finds rows in {homes}; name the hall")
    qs._db = _checked(homes[0]) if homes else CONTROL_ALIAS


def _hall_from_values(model, values):
    """The hall a get_or_create's values name through `model`'s tenant path, or None. Read from the values (the
    first hop as a row or an id), never by building the row: that would draw its defaults (a uuid4) once more."""
    from django.apps import apps as django_apps

    first, *rest = tenant_path(model).split("__")
    f = model._meta.get_field(first)
    value = values.get(first, values.get(f.attname))
    if value is None or callable(value):
        return None
    if isinstance(value, models.Model):  # the hall itself, or the row the path goes through (its hall is the same)
        return value if not rest else _hall_of(value)
    hall_id = value if not rest else (f.related_model._base_manager.filter(pk=value)
                                      .values_list("__".join(rest), flat=True).first())
    tenant = django_apps.get_model("tenants", "Tenant")
    return tenant._base_manager.using(CONTROL_ALIAS).filter(pk=hall_id).first() if hall_id is not None else None


def _probe_alias(qs, values):
    """Where a get_or_create on `qs` goes when its values name a hall; None: ask the router."""
    if not settings.SHARDED or qs._db is not None or placement(qs.model) != SHARD:
        return None
    if qs._hints.get("instance") is not None or control_mastered(qs.model):
        return None
    hall = _hall_from_values(qs.model, values)
    return _checked(master_alias(hall.civilization)) if hall is not None else None


def _install_writes():
    def _guard_bulk(qs, parts):
        if not settings.SHARDED or placement(qs.model) != SHARD:
            return
        for p in parts if parts is not None else [qs]:
            db = p._db or router.db_for_write(p.model, **p._hints)  # where the write goes, not a read's route
            if db == CONTROL_ALIAS:
                _refuse_on_control(p.model, p.using(db))
            elif p.using(db).exists():  # a write that touches nothing writes nothing (a bare-id sweep elsewhere)
                _refuse_outside(db)

    def updating(original):
        def update(self, **kwargs):
            parts = _split(self)
            _guard_bulk(self, parts)
            if parts is None:
                return original(self, **kwargs)
            return sum(original(p, **kwargs) for p in parts)
        return update

    def deleting(original):
        def delete(self):
            parts = _split(self)
            _guard_bulk(self, parts)
            if parts is None:
                return original(self)
            total, per_model = 0, {}
            for p in parts:
                n, each = original(p)
                total += n
                for name, k in each.items():
                    per_model[name] = per_model.get(name, 0) + k
            return total, per_model
        return delete

    def creating(original):
        def create(self, **kwargs):
            if (not settings.SHARDED or self._db is not None or placement(self.model) != SHARD
                    or self._hints.get("instance") is not None
                    or frozenset(kwargs) & self.model._meta._reverse_one_to_one_field_names):
                return original(self, **kwargs)
            # Django's create saves with `using=self.db`, which asks the router with no row; saving with no
            # `using` lets the router read the row itself, after the model's own save() filled in its hall.
            obj = self.model(**kwargs)
            self._for_write = True
            obj.save(force_insert=True)
            return obj
        return create

    def or_creating(original):
        def method(self, defaults=None, **kwargs):
            alias = _probe_alias(self, {**(defaults or {}), **kwargs})
            return original(self.using(alias) if alias else self, defaults=defaults, **kwargs)
        return method

    def bulk_creating(original):
        def bulk_create(self, objs, *args, **kwargs):
            if not settings.SHARDED or placement(self.model) != SHARD:
                return original(self, objs, *args, **kwargs)
            objs = list(objs)
            if self._db is not None:  # an explicit database: guarded, not regrouped
                if self._db == CONTROL_ALIAS:
                    _refuse_on_control(self.model, objs)
                else:
                    _before_shard_write(self.model, self._db)
                return original(self, objs, *args, **kwargs)
            groups = {}
            for obj in objs:  # no save(): the row is as given, a row with no hall is control's (D2)
                groups.setdefault(write_alias_of(obj), []).append(obj)
            for alias, group in groups.items():
                if alias == CONTROL_ALIAS:
                    _refuse_on_control(self.model, group)
                else:
                    _before_shard_write(self.model, alias)
                original(self.using(_checked(alias)), group, *args, **kwargs)
            return objs
        return bulk_create

    def getting(original):
        def get(self, *args, **kwargs):
            # Django's get() asks `connections[clone.db]` before it evaluates a select_for_update: locate first.
            if self._for_write and settings.SHARDED and self._db is None:
                probe = self.filter(*args, **kwargs) if args or kwargs else self._chain()
                _locate(probe)
                if probe._db is not None:
                    return original(self.using(probe._db), *args, **kwargs)
            return original(self, *args, **kwargs)
        return get

    _hook("get", getting)
    _hook("update", updating)
    _hook("delete", deleting)
    _hook("create", creating)
    _hook("get_or_create", or_creating)
    _hook("update_or_create", or_creating)
    _hook("bulk_create", bulk_creating)


_atomic_extra = ContextVar("shard_atomic_extra", default=())


def _single_master():
    """The one write-cut shard this context writes to, or None (control, MASTER, no context, nothing cut)."""
    if not settings.SHARDED:
        return None
    alias = acting_alias()
    return alias if alias not in (None, MASTER, CONTROL_ALIAS) else None


def _transaction_aliases():
    """The write-cut shards an `atomic()` with no `using` opens beside control's, in a context with no single
    civilization (MASTER, or none): every one of them, so a lock or a write on any of them is inside it."""
    return [a for a in (alias_for_civilization(c) for c in write_cut()) if a in connections]


def _install_atomic():
    """Stage 4: the code's `transaction.atomic()` names no database and means "this business transaction": control's
    transaction plus one on each shard the context writes to (PLAN 阶段 4; VERIFY-stage4 must-fix 2). A business
    transaction holds on every database its rows and its locks are on, control included.

      one civilization   (a hall's request or task whose civilization writes to its shard) control's and that
                         shard's; `on_commit` / `set_rollback` / `get_connection()` with no `using` mean the shard.
                         So a control row lock (`User.objects.select_for_update()`) works inside it, and a control
                         write (a user, a soul account, a notification) rolls back with the shard.
      no single one      (MASTER: SYSTEM_ADMIN, a soul account, a global task, a command; or no context) control's
                         plus one on every write-cut shard.
      nothing cut        exactly Django's: the patched paths return before doing anything else.

    Commit order: the shards first, then control. A shard whose commit fails rolls control back; a `set_rollback`
    on any of them rolls back all of them. A failure BETWEEN the two commits -- the shard committed, then control's
    commit fails (its connection lost at that instant) -- leaves the shard's rows without control's: a user / account
    / notification write lost, and a code claim or WF number drawn inside the block lost while the shard row that
    holds it stands; `check_global_codes` reports that row as unregistered and fails. The other order would keep
    control's writes whenever the shard's commit fails, the common failure (a constraint checked at commit, a
    serialization error), so the shards go first. Claims and numbers taken with control in autocommit (no business
    transaction open) still commit at once, before the shard row: a gap, never a reuse (apps/tenants/global_codes.py).

    A write to a shard while the code holds a transaction that is not open there is refused (`_refuse_outside`): it
    would autocommit outside the business transaction (a third database). Decided once at the enter and kept to the
    exit, so a hall set inside the block does not move the transaction."""
    from django.db import transaction as tx
    from django.db.transaction import Atomic

    if getattr(Atomic.__enter__, "_shard_reads", False):
        return
    enter, leave, get_connection = Atomic.__enter__, Atomic.__exit__, tx.get_connection

    def routed_connection(using=None):
        if using is None and settings.SHARDED:
            for kind, held in reversed(_atomic_extra.get()):
                if kind == "one":
                    return get_connection(held[-1].using)
            using = _single_master()
        return get_connection(using)

    def close(held, exc_type, exc, tb):
        """Exit `held` (control's first in it) innermost first: the shards commit before control."""
        if exc_type is None and any(connections[a.using].needs_rollback for a in held):
            for a in held:  # set_rollback on one of them: all of them
                connections[a.using].needs_rollback = True
        failed = None
        for a in reversed(held):
            try:
                a.__exit__(exc_type, exc, tb)
            except BaseException as e:  # a shard's commit failed: control rolls back with it
                if exc_type is None:
                    failed, exc_type, exc, tb = e, type(e), e, e.__traceback__
        if failed is not None:
            raise failed

    def entering(self):
        if self.using is not None or not settings.SHARDED:
            enter(self)
            _atomic_extra.set((*_atomic_extra.get(), ("django", ())))
            return
        shard = _single_master()
        aliases = [shard] if shard is not None else _transaction_aliases()
        held = []
        try:
            for i, alias in enumerate([CONTROL_ALIAS, *aliases]):
                a = Atomic(alias, self.savepoint, self.durable and (i == 0 or shard is not None))
                a.__enter__()
                held.append(a)
        except BaseException as e:
            close(held, type(e), e, e.__traceback__)
            raise
        _atomic_extra.set((*_atomic_extra.get(), ("one" if shard is not None else "all", tuple(held))))

    def leaving(self, exc_type, exc, tb):
        stack = _atomic_extra.get()  # empty only if this context did not see the enter: Django's own
        kind, held = stack[-1] if stack else ("django", ())
        _atomic_extra.set(stack[:-1])
        if kind == "django":
            return leave(self, exc_type, exc, tb)
        close(held, exc_type, exc, tb)
        return False

    entering._shard_reads = leaving._shard_reads = routed_connection._shard_reads = True
    Atomic.__enter__, Atomic.__exit__ = entering, leaving
    tx.get_connection = routed_connection


class WriteOutsideTransaction(Exception):  # noqa: N818
    """A write to a shard the code's open transaction does not hold: it would autocommit there, outside the business
    transaction, and survive its rollback (a residence row of another civilization: the saga's, part C)."""


class ControlMirrorWrite(Exception):  # noqa: N818
    """A direct write on control of a SHARD row of a hall, sharded. Control holds none of those rows (stage 5 purged
    them): nothing would ever read the write."""


_mirror_writes = ContextVar("shard_control_mirror_writes", default=False)


@contextmanager
def control_mirror_writes():
    """Writes on control's mirror of write-cut rows allowed in this block: a bare-id delete keeps the mirror in step
    (the sync would delete those rows anyway); a test that builds a stale mirror on purpose."""
    token = _mirror_writes.set(True)
    try:
        yield
    finally:
        _mirror_writes.reset(token)


def _code_transaction_open():
    aliases = [CONTROL_ALIAS, *(alias_for_civilization(c) for c in write_cut())]
    return any(not a._from_testcase for alias in aliases if alias in connections
               for a in connections[alias].atomic_blocks)


def _refuse_outside(alias):
    """Refuse a write to shard `alias` while the code holds a transaction that is not open there."""
    if (alias and alias != CONTROL_ALIAS and str(alias).startswith("civ_") and _code_transaction_open()
            and not any(not a._from_testcase for a in connections[alias].atomic_blocks)):
        raise WriteOutsideTransaction(f"a write to {alias} inside a transaction that is not open there")


def _before_shard_write(model, alias, inserting=True):
    """A row of `model` about to be written to shard `alias`: inside the open transaction, and -- an insert of an
    integer-pk model -- with the shard's id range assigned first (gap 4a, apps/core/shard_ids.py)."""
    _refuse_outside(alias)
    if inserting and str(alias).startswith("civ_") and isinstance(model._meta.pk, models.AutoField):
        from apps.core.shard_ids import ensure_ranges

        ensure_ranges(alias)


def _refuse_on_control(model, rows):
    """`rows` (instances, or a queryset on control) of `model` include one of a write-cut civilization: refuse."""
    if _mirror_writes.get() or placement(model) != SHARD or control_mastered(model):
        return
    if isinstance(rows, QuerySet):
        hit = rows.filter(**{f"{tenant_path(model)}__in": _halls(write_cut())}).exists()
    else:
        hit = any(write_alias_of(r) != CONTROL_ALIAS for r in rows)
    if hit:
        raise ControlMirrorWrite(f"{model._meta.label}: a direct write on control of a row of {write_cut()}, whose "
                                 "writes go to their shards; nothing reads such a row on control")


def pre_save_signal():
    from django.db.models.signals import pre_save

    return pre_save


def _guard_signal(sender, instance, using=None, **kwargs):
    if not settings.SHARDED or placement(sender) != SHARD:
        return
    if using == CONTROL_ALIAS:
        _refuse_on_control(sender, [instance])
    else:
        _before_shard_write(sender, using, inserting=kwargs.get("signal") is pre_save_signal())


def connect_write_guards():
    """pre_save / pre_delete on every SHARD model (through tables included): the two refusals above. A data
    migration's historical models have no receivers: no SHARD data migration while a civilization is write-cut
    (module header)."""
    from django.apps import apps as django_apps
    from django.db.models.signals import pre_delete, pre_save

    for m in django_apps.get_models(include_auto_created=True):
        if placement(m) == SHARD:
            pre_save.connect(_guard_signal, sender=m, dispatch_uid=f"shard_write_guard_save:{m._meta.label}")
            pre_delete.connect(_guard_signal, sender=m, dispatch_uid=f"shard_write_guard_delete:{m._meta.label}")


def crossing_keys():
    """SHARD -> SHARD bare ids: the two rows may be in different civilizations' shards. One-to-one keys too
    (RebirthApplication.workflow: the application follows its soul home, the workflow stays in the hall that
    opened it)."""
    from django.apps import apps

    from apps.core.bare_ids import is_bare

    return [f for m in apps.get_models() for f in m._meta.concrete_fields
            if (f.many_to_one or f.one_to_one) and is_bare(f) and f.model is m and placement(m) == SHARD
            and placement(f.related_model) == SHARD and f.name != tenant_path(m).split("__")[0]]


def _install_crossing_accessors():
    """A crossing key's accessor, both ways, reads every leg: the row it names may be in another shard
    (a soul back from residence is not in the residence's shard any more; its residence judgments are not in
    its home's)."""
    from django.db.models.fields.related_descriptors import (
        ForwardManyToOneDescriptor,
        ForwardOneToOneDescriptor,
        ReverseManyToOneDescriptor,
        ReverseOneToOneDescriptor,
    )

    class CrossingForward(ForwardManyToOneDescriptor):
        def get_queryset(self, **hints):
            return with_fanout(super().get_queryset(**hints))

    class CrossingForwardOne(ForwardOneToOneDescriptor):
        def get_queryset(self, **hints):
            return with_fanout(super().get_queryset(**hints))

    class CrossingReverseOne(ReverseOneToOneDescriptor):
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
        forward, reverse = (CrossingForwardOne, CrossingReverseOne) if f.one_to_one else (CrossingForward,
                                                                                          CrossingReverse)
        if not isinstance(f.model.__dict__.get(f.name), forward):
            setattr(f.model, f.name, forward(f))
        accessor = f.remote_field.get_accessor_name()
        if accessor and not f.remote_field.hidden and not isinstance(f.related_model.__dict__.get(accessor), reverse):
            setattr(f.related_model, accessor, reverse(f.remote_field))
