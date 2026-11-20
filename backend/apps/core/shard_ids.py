"""Integer primary keys once a civilization's writes are cut over (stage 4, gap 4a in
docs/audit/2026-11-15-sharding/PLAN.md).

A SHARD model with an auto-incrementing integer pk (Organization -- named by bare id from control: User.organization,
the RoleDataScope.orgs through rows -- and every other one: AuditLog, TaskRun, the officer through rows...) gets ids
from each database's own sequence once its writes split. Control stays a full mirror until stage 5, so the same id
from two sequences would be two rows under one pk there, and a bare id could not say which. So each civilization's
shard issues ids from its own range:

    CHINESE [1e15, 2e15)   EUROPEAN [2e15, 3e15)   EGYPTIAN [3e15, 4e15)   GREEK [4e15, 5e15)

Control keeps [1, 1e15): its own rows (no hall, D2; civilizations not cut over) and the rows stages 2/3 copied to the
shards, whose ids do not change -- a shard may hold ids below its range, never one in another civilization's range.
The id itself names the civilization. BigAutoField's ceiling is about 9.2e18.

`manage.py assign_shard_id_ranges` moves each shard's sequences into its range (idempotent; refuses a shard that
already holds an id of another range). Before the first write routed to a cut-over shard, `ensure_ranges` checks it
was done (once per process; ImproperlyConfigured otherwise), and `reconcile_shards` reports every problem `problems`
finds. Derived, not listed: `models()` is every SHARD model with an integer auto pk, through tables included.
"""
from django.apps import apps
from django.core.exceptions import ImproperlyConfigured
from django.db import connections, models
from django.db.models.signals import post_migrate

SPAN = 10 ** 15
#: The user's numbering (PLAN gap 4a): CHINESE 1, EUROPEAN 2, EGYPTIAN 3, GREEK 4.
INDEX = {"CHINESE": 1, "EUROPEAN": 2, "EGYPTIAN": 3, "GREEK": 4}


def id_range(civ):
    return INDEX[civ] * SPAN, (INDEX[civ] + 1) * SPAN


def models_with_int_ids():
    from apps.core.sharding import SHARD, placement

    return sorted((m for m in apps.get_models(include_auto_created=True)
                   if placement(m) == SHARD and m._meta.managed and not m._meta.proxy
                   and isinstance(m._meta.pk, models.AutoField)), key=lambda m: m._meta.label)


def _table(model):
    return model._meta.db_table, model._meta.pk.column


def next_id(alias, model):
    """The id the database would give `model`'s next row."""
    conn = connections[alias]
    table, col = _table(model)
    with conn.cursor() as cur:
        if conn.vendor == "postgresql":
            cur.execute("SELECT pg_get_serial_sequence(%s, %s)", [conn.ops.quote_name(table), col])
            seq = cur.fetchone()[0]
            cur.execute(f"SELECT last_value, is_called FROM {seq}")  # noqa: S608 -- a name PostgreSQL returned
            value, called = cur.fetchone()
            return value + 1 if called else value
        cur.execute("SELECT seq FROM sqlite_sequence WHERE name = %s", [table])
        row = cur.fetchone()
        cur.execute(f"SELECT max({conn.ops.quote_name(col)}) FROM {conn.ops.quote_name(table)}")  # noqa: S608
        top = cur.fetchone()[0]
        return max(row[0] if row else 0, top or 0) + 1  # AUTOINCREMENT: past the largest ever used


def _set_next(alias, model, value):
    conn = connections[alias]
    table, col = _table(model)
    with conn.cursor() as cur:
        if conn.vendor == "postgresql":
            cur.execute("SELECT setval(pg_get_serial_sequence(%s, %s), %s, false)",
                        [conn.ops.quote_name(table), col, value])
            return
        cur.execute("UPDATE sqlite_sequence SET seq = %s WHERE name = %s", [value - 1, table])
        if not cur.rowcount:
            cur.execute("INSERT INTO sqlite_sequence (name, seq) VALUES (%s, %s)", [table, value - 1])


def _foreign(alias, model, civ):
    """How many rows on `alias` carry an id of another civilization's range (or above every range)."""
    low, high = id_range(civ) if civ else (SPAN, SPAN)
    pk = model._meta.pk.attname
    qs = model._base_manager.using(alias).order_by().filter(**{f"{pk}__gte": SPAN})
    return qs.exclude(**{f"{pk}__gte": low, f"{pk}__lt": high}).count()


def _civ(alias):
    from apps.core.shard_sync import civilization_of

    return civilization_of(alias)


def problems(alias, *, written=None):
    """What is wrong with `alias`'s integer ids. A shard: an id of another range; and when its civilization writes
    there (`written`, default every civilization while sharded), a sequence outside its range. Control: on PostgreSQL its sequences
    must stay below 1e15 (rows copied back from the shards carry explicit ids and do not move them). SQLite's
    AUTOINCREMENT does move past a copied id, so control's sequence is not checked there (tests only)."""
    from apps.core.sharding import cut_civilizations

    out = []
    civ = None if alias == "default" else _civ(alias)
    written = cut_civilizations() if written is None else written
    for model in models_with_int_ids():
        label = model._meta.label
        if civ is None:
            if connections[alias].vendor == "postgresql" and next_id(alias, model) >= SPAN:
                out.append(f"{alias} {label}: next id {next_id(alias, model)} is not below {SPAN}")
            continue
        n = _foreign(alias, model, civ)
        if n:
            out.append(f"{alias} {label}: {n} row(s) with an id of another civilization's range")
        if civ in written:
            low, high = id_range(civ)
            nxt = next_id(alias, model)
            if not low <= nxt < high:
                out.append(f"{alias} {label}: next id {nxt} is outside [{low}, {high}) -- run assign_shard_id_ranges")
    return out


def assign(alias):
    """Move every sequence of shard `alias` into its civilization's range; [(label, next id)]. Idempotent: a
    sequence already inside the range stays where it is. Refuses before changing anything when a row carries an id
    of another range."""
    civ = _civ(alias)
    bad = [p for p in problems(alias, written=()) if "another civilization" in p]
    if bad:
        raise ImproperlyConfigured("; ".join(bad))
    low, high = id_range(civ)
    out = []
    for model in models_with_int_ids():
        nxt = next_id(alias, model)
        pk = model._meta.pk.attname
        top = (model._base_manager.using(alias).order_by().filter(**{f"{pk}__gte": low, f"{pk}__lt": high})
               .aggregate(m=models.Max(pk))["m"])
        want = max(nxt if low <= nxt < high else low, (top or 0) + 1)
        if want >= high:
            raise ImproperlyConfigured(f"{alias} {model._meta.label}: the range [{low}, {high}) is used up")
        if want != nxt:
            _set_next(alias, model, want)
        out.append((model._meta.label, want))
    _verified.discard(alias)
    return out


#: Shards checked in this process since SHARDED last changed (`ensure_ranges`).
_verified = set()


def ensure_ranges(alias):
    """Before the first write routed to cut-over shard `alias`: its sequences are inside its range."""
    if alias in _verified:
        return
    found = problems(alias)
    if found:
        raise ImproperlyConfigured(f"{alias} is written to before its id range was assigned: " + "; ".join(found))
    _verified.add(alias)


def _reset(**kwargs):
    _verified.clear()


def connect():
    from django.test.signals import setting_changed

    setting_changed.connect(lambda setting, **kw: setting in ("SHARDED", "DATABASES") and _reset(),
                            weak=False, dispatch_uid="shard_ids_reset")
    post_migrate.connect(_reset, dispatch_uid="shard_ids_reset_on_migrate")
