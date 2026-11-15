"""Stage 2 of the civilization split: shadow shards (docs/audit/2026-11-15-sharding/PLAN.md, D2 / D4 / D6).

Reads and writes still go to the control database ("default"). Each configured shard alias (`civ_*`)
is a copy of what its civilization will own, kept up to date from control and compared with it. Sync and
reconcile are one operation: `reconcile(..., fix=True, direction=CONTROL_TO_SHARD)` is the sync.

What a shard is supposed to hold, derived from `apps.core.sharding.placement` (no list of models here):
  REFERENCE  every row (Tenant: control is the master, every shard has a copy; D4).
  SHARD      the rows whose `tenant_path` reaches a hall of this civilization, auto-created M2M through
             tables and models owned through a parent (U->S) included. Rows with no hall, and rows of a
             hall whose civilization is UNKNOWN, belong to no shard (D2).
  souls.Soul also in its home civilization's shard while it resides in another one (an executed
             cross-civilization dispatch: `tenant != home_tenant`; D6). The home shard's rows that point
             at the soul (its records, the dispatch itself) need it there. The copy keeps its keys to other
             SHARD rows empty (`copy_blanks`: `owner_org` is the residence hall's root organization).

Every row is compared whole: a digest over every concrete column, not a timestamp.

A row whose constrained foreign key names a row the shard will not hold is not copied and is reported as
"dangling", so the rest of the shard still syncs and reconcile does not exit 0 while it is there. Since
stage 2 no key of the schema does that: the edges that cross civilizations (tests/tenancy_fk_inventory.py,
"crosses by design" / "may cross") are bare ids, and `test_fk_inventory_across_tenants` holds the rule.
The check stays for the next key somebody adds with a constraint.

Writes to the target alias never go through `Model.save()` / `Model.delete()`: a raw `QuerySet._insert`
(the values as read, no `pre_save`, so `auto_now` columns keep control's value) and `QuerySet._raw_delete`,
both on an explicit alias. So no post_save receiver (audit, events) runs, and no
pre_delete receiver either -- in particular `apps.core.bare_ids`, whose delete rules run on every alias.
A changed row is deleted and inserted again in one transaction (foreign keys are deferred to commit on
PostgreSQL and SQLite), deletes first so a unique value that moved between two rows does not collide.
"""
import hashlib
import json
import time
from dataclasses import dataclass

from django.apps import apps
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.db.models.signals import m2m_changed, post_delete, post_save

from apps.core.sharding import CONTROL, REFERENCE, SHARD, alias_for_civilization, placement, tenant_path

CONTROL_TO_SHARD = "control-to-shard"
SHARD_TO_CONTROL = "shard-to-control"
CHUNK = 500  # pk__in batches: SQLite's bound-parameter limit


def shard_aliases():
    """Configured civilization aliases, sorted. Part A adds `apps.core.sharding.shard_aliases`; this is
    the same rule until it lands."""
    from apps.core import sharding

    if hasattr(sharding, "shard_aliases"):
        return sharding.shard_aliases()
    from apps.souls.models import Civilization

    return sorted(a for a in (alias_for_civilization(c) for c in Civilization.values) if a in settings.DATABASES)


def civilization_of(alias):
    from apps.souls.models import Civilization

    return next(c for c in Civilization.values if alias_for_civilization(c) == alias)


def compared_models():
    """Every model with a table on a shard (SHARD and REFERENCE), auto-created through tables included."""
    return sorted(
        (m for m in apps.get_models(include_auto_created=True)
         if not m._meta.proxy and m._meta.managed and placement(m) != CONTROL),
        key=lambda m: m._meta.label,
    )


def halls_of(civ):
    """Pks of the control database's halls of one civilization (`Tenant.civilization` is a property)."""
    Tenant = apps.get_model("tenants", "Tenant")
    return [t.pk for t in Tenant._base_manager.using("default").all() if t.civilization == civ]


def _soul():
    return apps.get_model("souls", "Soul")


def owned(model, alias, civ, halls, *, copies=True):
    """The rows of `model` on `alias` that belong to `civ`'s shard. On a shard alias every row there is
    claimed (a path through a control table cannot be followed there), except that `copies=False`
    leaves out the soul copies."""
    qs = model._base_manager.using(alias)
    is_soul = model is _soul()
    if placement(model) == REFERENCE or (alias != "default" and (copies or not is_soul)):
        return qs.all()
    q = Q(**{f"{tenant_path(model)}__in": halls})
    if is_soul and copies:
        q |= Q(home_tenant__in=halls)
    return qs.filter(q)


def _digest(row):
    return hashlib.sha256(json.dumps(row, default=str, sort_keys=True).encode()).hexdigest()


def copy_blanks(model):
    """Columns a soul copy keeps empty: its nullable keys to other SHARD rows (`owner_org`). Execution
    points them at the residence hall's rows, which the home shard does not hold, so a verbatim copy
    would break the home shard's foreign keys; the copy is there to be pointed at, the primary row
    carries the real values."""
    if model is not _soul():
        return []
    return [f.attname for f in model._meta.concrete_fields
            if f.is_relation and f.null and placement(f.related_model) == SHARD]


def _is_copy(obj_tenant_id, halls):
    return obj_tenant_id not in halls


def fingerprints(qs, halls=None):
    """{str(pk): digest of every concrete column}. With `halls` (the shard's civilization), a soul whose
    hall is not among them is digested as its copy (`copy_blanks` empty)."""
    cols = [f.attname for f in qs.model._meta.concrete_fields]
    blanks = [cols.index(c) + 1 for c in copy_blanks(qs.model)] if halls is not None else []
    tenant = cols.index("tenant_id") + 1 if blanks else None
    out = {}
    # order_by(): a model ordered through a foreign key (SoulPathEntry: "soul", WorkflowSegment: "workflow")
    # is read with an INNER JOIN to the target, and on a shard a bare id that crosses civilizations names a
    # row that is not there -- the row would drop out of its own shard's digest and be "missing" forever.
    for r in qs.order_by().values_list(qs.model._meta.pk.attname, *cols).iterator(chunk_size=2000):
        if blanks and _is_copy(r[tenant], halls):
            r = tuple(None if i in blanks else v for i, v in enumerate(r))
        out[str(r[0])] = _digest(r)
    return out


def _chunks(pks):
    pks = list(pks)
    for i in range(0, len(pks), CHUNK):
        yield pks[i:i + CHUNK]


def _restrict(qs, pks, halls):
    out = {}
    for chunk in _chunks(pks):
        out.update(fingerprints(qs.filter(pk__in=chunk), halls))
    return out


@dataclass(frozen=True)
class Difference:
    alias: str   # the shard compared
    model: str   # label
    pk: str
    kind: str    # "missing" (source has it, target not), "extra" (target only), "differs", "dangling"

    def line(self, source, target):
        where = {"missing": f"missing in {target}", "extra": f"only in {target}", "differs": f"differs in {target}",
                 "dangling": f"not copied to {target}: a foreign key names a row {target} does not hold"}
        return f"  {self.model} pk={self.pk} {where[self.kind]} (shard {self.alias}, source {source})"


def _diff(src, dst):
    return ([("missing", pk) for pk in src.keys() - dst.keys()]
            + [("extra", pk) for pk in dst.keys() - src.keys()]
            + [("differs", pk) for pk in src.keys() & dst.keys() if src[pk] != dst[pk]])


def _sides(model, shard, civ, halls, direction):
    """(source queryset, target queryset) for one model and shard, or None when not compared that way."""
    if direction == CONTROL_TO_SHARD:
        return owned(model, "default", civ, halls), owned(model, shard, civ, halls)
    if placement(model) == REFERENCE:
        return None  # control stays the master of reference tables (D4)
    # The shard is the master of its own rows; its soul copies are not its rows.
    return owned(model, shard, civ, halls, copies=False), owned(model, "default", civ, halls, copies=False)


def _keys_within_shards(model):
    """Foreign keys with a database constraint to another SHARD model: on a shard the target row must be
    there too. (REFERENCE targets are on every shard; CONTROL targets are bare ids since 1B.)"""
    return [f for f in model._meta.concrete_fields
            if f.is_relation and f.db_constraint and placement(f.related_model) == SHARD]


def _dangling(sources, halls):
    """{model: {pk}} of source rows a shard cannot hold: a constrained key names a row the shard will not
    have (e.g. a row that crosses civilizations by design, DispatchRecord.target_realm). Iterated, since
    leaving one row out can strand the rows that point at it."""
    expected = {m: set(fp) for m, (_, fp) in sources.items()}
    links = []
    for model, (src, _) in sources.items():
        blanks = copy_blanks(model)
        for f in _keys_within_shards(model):
            target = f.related_model._meta.concrete_model
            if target not in expected:
                continue
            cols = ["pk", f.attname, *(["tenant_id"] if f.attname in blanks else [])]
            pairs = {str(r[0]): str(r[1]) for r in src.order_by().values_list(*cols).iterator(chunk_size=2000)
                     if r[1] is not None and not (len(r) > 2 and _is_copy(r[2], halls))}
            links.append((model, target, pairs))
    out = {}
    changed = True
    while changed:
        changed = False
        for model, target, pairs in links:
            for pk, fk in pairs.items():
                if pk in expected[model] and fk not in expected[target]:
                    expected[model].discard(pk)
                    out.setdefault(model, set()).add(pk)
                    changed = True
    return out


def compare(shard, direction=CONTROL_TO_SHARD, retry_window=0):
    """{model: (source qs, target qs, [(kind, pk)], halls)} between control and one shard. Differences still
    there after `retry_window` seconds of re-checking (in-flight writes settle) are the ones returned."""
    civ = civilization_of(shard)
    halls = halls_of(civ)
    sides = {m: s for m in compared_models() if (s := _sides(m, shard, civ, halls, direction)) is not None}
    sources = {m: (src, fingerprints(src, halls)) for m, (src, _) in sides.items()}
    dangling = _dangling(sources, halls) if direction == CONTROL_TO_SHARD else {}
    found = {}
    for model, (src, dst) in sides.items():
        left_out = dangling.get(model, set())
        src_fp = {pk: d for pk, d in sources[model][1].items() if pk not in left_out}
        diffs = _diff(src_fp, fingerprints(dst, halls))
        deadline = time.monotonic() + retry_window
        while diffs and time.monotonic() < deadline:
            time.sleep(min(1.0, max(0.0, deadline - time.monotonic())))
            pks = [pk for _, pk in diffs]
            again = {pk: d for pk, d in _restrict(src, pks, halls).items() if pk not in left_out}
            diffs = _diff(again, _restrict(dst, pks, halls))
        diffs += [("dangling", pk) for pk in left_out]
        if diffs:
            found[model] = (src, dst, diffs, halls)
    return found


def apply_fix(found, direction):
    """Make the target side equal the source side for the rows in `found` (from `compare`)."""
    if not found:
        return
    target = next(iter(found.values()))[1].db
    with transaction.atomic(using=target):
        for _model, (_src, dst, diffs, _halls) in found.items():
            gone = [pk for kind, pk in diffs if kind in ("extra", "differs")]
            for chunk in _chunks(gone):
                # _raw_delete: no collector, no pre_delete -- bare-id rules never fire from here.
                dst.model._base_manager.using(target).filter(pk__in=chunk)._raw_delete(target)
        for model, (src, _dst, diffs, halls) in found.items():
            new = [pk for kind, pk in diffs if kind in ("missing", "differs")]
            fields = model._meta.concrete_fields
            blanks = copy_blanks(model)
            for chunk in _chunks(new):
                rows = list(src.filter(pk__in=chunk).order_by())  # no JOIN through a bare id: see fingerprints
                for obj in rows:
                    if blanks and _is_copy(obj.tenant_id, halls):
                        for attname in blanks:
                            setattr(obj, attname, None)
                step = max(1, 30000 // len(fields))  # bound parameters per statement
                for i in range(0, len(rows), step):
                    # raw: the values as read, no pre_save -- bulk_create would stamp auto_now columns anew.
                    model._base_manager.using(target)._insert(rows[i:i + step], fields=fields, raw=True, using=target)


def reconcile(shards, *, fix=False, direction=CONTROL_TO_SHARD, retry_window=0):
    """{shard alias: [Difference]} before any fix. With `fix`, each shard's differences are repaired in
    one transaction on the target database."""
    report = {}
    for shard in shards:
        found = compare(shard, direction, retry_window)
        report[shard] = [Difference(shard, m._meta.label, pk, kind)
                         for m, (_, _, diffs, _) in found.items() for kind, pk in sorted(diffs, key=lambda d: d[1])]
        if fix:
            apply_fix(found, direction)
    return report


# ---- debounced sync on commit ------------------------------------------------------------------------

DEBOUNCE_KEY = "sharding:sync_shards:pending"
DEBOUNCE_SECONDS = 30


def _enqueue():
    """One sync per burst: the first commit in a window enqueues it, the rest find the key taken."""
    if cache.add(DEBOUNCE_KEY, 1, timeout=DEBOUNCE_SECONDS):
        from apps.tenants.tasks import sync_shards

        sync_shards.apply_async(countdown=DEBOUNCE_SECONDS)


def _on_write(sender, using="default", **kwargs):
    if using != "default" or not shard_aliases():
        return
    conn = transaction.get_connection(using)
    if conn.in_atomic_block and any(func is _enqueue for _, func, _ in conn.run_on_commit):
        return  # already queued for this transaction
    transaction.on_commit(_enqueue, using=using)


def connect():
    for model in compared_models():
        uid = f"shard_sync:{model._meta.label}"
        post_save.connect(_on_write, sender=model, dispatch_uid=uid)
        post_delete.connect(_on_write, sender=model, dispatch_uid=uid)
        if model._meta.auto_created:
            m2m_changed.connect(_on_write, sender=model, dispatch_uid=uid)
