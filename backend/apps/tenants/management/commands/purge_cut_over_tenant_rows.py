"""Stage 5 (PLAN 阶段 5): delete control's copy of one write-cut civilization's rows -- a permanent deletion.

    manage.py purge_cut_over_tenant_rows --civ GREEK --dry-run       --dump /backups/soulledger_manifest_<ts>.txt
    manage.py purge_cut_over_tenant_rows --civ GREEK --confirm GREEK --dump /backups/soulledger_manifest_<ts>.txt
    manage.py purge_cut_over_tenant_rows --civ GREEK --record-purged

--confirm deletes, only after the user has seen the dry run's counts and said yes in chat (PREP-stage5 §4 step 7);
its value must repeat the civilization exactly (upper case, as printed). It runs every check of the dry run again
and deletes nothing unless all pass.

Prints, for the civilization's halls on control:
  purge     every SHARD model whose master is the shard (`shard_sync.purge_plan`: not the control-mastered ones,
            CONTROL_READS), with the number of control rows that go: the rows of its halls; a soul is its hall's
            (`tenant`), never its home's (that soul is another master's row).
  keep      the control-mastered SHARD models (control is their master), REFERENCE (Tenant), every CONTROL model,
            and D2 rows (no hall, a hall of UNKNOWN civilization) -- by construction not in the plan.
  block     rows that stay on control and hold a database-constrained key to a row that goes (a hall-less
            disposition naming a judgment of the civilization): the delete would fail at commit, or strand them.
Checks, each printed PASS / FAIL (exit 1 when any fails):
  writes cut over        the civilization is in SHARD_WRITE_CIVS, and its shard is configured;
  sync stopped           it is in SHARD_PURGED_CIVS here, and a sync has run since with it there (the stamp
                         `shard_sync.SYNC_STOPPED`: the worker restarted too);
  reconcile ... clean    every row that goes has an identical row on the shard (shard-to-control, as if not purged:
                         no row only on control, none that differs; rows only on the shard are not lost by a purge);
  dump                   --dump names a backup-db.sh manifest under 24 h old listing control and this shard, each
                         file present and non-empty, the manifest and every listed file written after the stamp;
  no blockers.
UNCHECKED: the restore drill (scripts/restore-drill.sh leaves no record; run it on the manifest's dumps first).

The delete (G6): one transaction on control for the civilization, foreign keys deferred to its commit, inside
`control_mirror_writes()`; per model the pks read first (a row reached through its parent stops matching once the
parent is gone), then `_raw_delete` by pk -- no collector, no pre_delete receiver (`apps.core.bare_ids` would apply
a soul's CASCADE to control's SoulAccount). A model whose master is control is refused, never deleted. A rerun
finds nothing and deletes nothing. The same transaction writes the record `GlobalCode(kind=shard_sync.PURGED,
value=<CIV>)`: from then on the civilization must stay in SHARD_WRITE_CIVS and SHARD_PURGED_CIVS (every sync checks,
`shard_sync.check_purge_records`), and no control-to-shard sync touches its shard-mastered rows (VERIFY-stage5 H1).

--record-purged writes that record for a civilization purged before the record existed (115, 2026-11-20), only when
`reconcile_shards --civ <CIV> --assert-control-empty` passes: control holds none of its purge plan.
"""
import time
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, router, transaction

from apps.core.shard_reads import CONTROL_ALIAS, control_mastered, control_mirror_writes
from apps.core.shard_sync import (
    PURGED,
    SHARD_TO_CONTROL,
    _chunks,
    compare,
    compared_models,
    halls_of,
    purge_plan,
    purged_civs,
    purged_models,
    shard_aliases,
    sync_stopped_at,
)
from apps.core.sharding import SHARD, alias_for_civilization, placement

__all__ = ["purge_plan", "purged_models", "blockers", "dump_problem", "purge"]

DUMP_MAX_AGE = 24 * 3600


def blockers(plan):
    """[(label of the key, rows that stay and name a row that goes)]: every constrained foreign key into the purge
    set from a row on control that is not itself purged."""
    out = []
    for m in apps.get_models(include_auto_created=True):
        if m._meta.proxy or not m._meta.managed or not router.allow_migrate_model(CONTROL_ALIAS, m):
            continue
        for f in m._meta.concrete_fields:
            target = f.related_model._meta.concrete_model if f.is_relation and f.related_model else None
            if not (f.many_to_one or f.one_to_one) or not f.db_constraint or target not in plan:
                continue
            staying = m._base_manager.using(CONTROL_ALIAS).filter(
                **{f"{f.attname}__in": plan[target].values(f.target_field.attname)})
            if m in plan:
                staying = staying.exclude(pk__in=plan[m].values("pk"))
            n = staying.count()
            if n:
                out.append((f"{m._meta.label}.{f.name}", n))
    return out


def dump_problem(manifest, alias, now=None, since=None):
    """None when `manifest` is a fresh backup-db.sh manifest naming control and `alias` (manifest and dumps written
    after `since`, an aware datetime, when given), else why not."""
    if not manifest:
        return "no --dump given"
    path = Path(manifest)
    if not path.is_file():
        return f"{manifest} is not a file"
    age = (now or time.time()) - path.stat().st_mtime
    if age > DUMP_MAX_AGE:
        return f"{path.name} is {age / 3600:.1f} h old (limit {DUMP_MAX_AGE // 3600} h)"
    listed = dict(line.split(None, 1) for line in path.read_text().splitlines() if line.strip())
    # ponytail: file mtimes, i.e. when each was finished; a dump begun before the stamp and finished after it
    # passes. backup-db.sh's <ts> (local time, the start) would be stricter, at the cost of trusting the TZ.
    written = [path]
    for who in ("control", alias):
        name = listed.get(who, "").strip()
        if not name:
            return f"{path.name} does not list {who}"
        files = [p for p in (path.parent / name, path.parent / f"{name}.age") if p.is_file() and p.stat().st_size > 0]
        if not files:
            return f"{who}'s dump {name} is missing or empty next to {path.name}"
        written += files
    if since is not None:
        old = [p.name for p in written if p.stat().st_mtime <= since.timestamp()]
        if old:
            return f"{', '.join(old)} written before the sync stopped ({since.isoformat()}): dump again"
    return None


def checks(civ, alias, dump):
    """[(name, ok, detail)]: the purge's preconditions but the blockers (module docstring)."""
    out = [("writes cut over", civ in settings.SHARD_WRITE_CIVS, f"SHARD_WRITE_CIVS={list(settings.SHARD_WRITE_CIVS)}")]
    configured = alias in shard_aliases()
    out.append(("shard configured", configured, alias))
    purged = civ in purged_civs()
    stopped = sync_stopped_at(civ) if purged else None
    out.append(("sync stopped", stopped is not None,
                f"since {stopped.isoformat()}" if stopped else f"SHARD_PURGED_CIVS={sorted(purged_civs())}"
                + ("; no sync has run with it yet: wait for the beat's sync_shards" if purged else "")))
    if configured and civ in settings.SHARD_WRITE_CIVS:
        kinds = {}
        for _, _, diffs, _ in compare(alias, SHARD_TO_CONTROL, purged=()).values():
            for kind, _ in diffs:
                kinds[kind] = kinds.get(kind, 0) + 1
        out.append(("reconcile shard-to-control clean", not (kinds.get("extra") or kinds.get("differs")),
                    f"{kinds.get('extra', 0)} only on control, {kinds.get('differs', 0)} differ, "
                    f"{kinds.get('missing', 0)} only on the shard (not lost by a purge)"))
    problem = dump_problem(dump, alias, since=stopped)
    out.append(("dump under 24 h, after the sync stopped", problem is None, problem or dump))
    return out


def purge(civ):
    """Delete `civ`'s plan on control in one transaction: {model: rows deleted}."""
    conn = connections[CONTROL_ALIAS]
    deleted = {}
    with control_mirror_writes(), transaction.atomic(using=CONTROL_ALIAS):
        if conn.vendor == "postgresql":  # Django's keys are DEFERRABLE INITIALLY DEFERRED already; say so anyway
            with conn.cursor() as cur:
                cur.execute("SET CONSTRAINTS ALL DEFERRED")
        pks = {m: list(qs.order_by().values_list("pk", flat=True)) for m, qs in purge_plan(civ).items()}
        for model, ids in pks.items():
            if placement(model) != SHARD or control_mastered(model):
                raise CommandError(f"{model._meta.label}: control is its master; a purge never deletes it")
            n = 0
            for chunk in _chunks(ids):
                n += model._base_manager.using(CONTROL_ALIAS).filter(pk__in=chunk)._raw_delete(CONTROL_ALIAS)
            if n:
                deleted[model] = n
        _record(civ)
    from apps.core.versioned import bump_for  # raw deletes send no signal (as in shard_sync.apply_fix)

    for model in deleted:
        bump_for(model, using=CONTROL_ALIAS)
    return deleted


def _record(civ):
    apps.get_model("tenants", "GlobalCode").objects.using(CONTROL_ALIAS).get_or_create(kind=PURGED, value=civ)


class Command(BaseCommand):
    help = "Stage 5: count (--dry-run) or delete (--confirm <CIV>) control's rows of one write-cut civilization."

    def add_arguments(self, parser):
        parser.add_argument("--civ", required=True, help="One civilization, e.g. GREEK")
        mode = parser.add_mutually_exclusive_group(required=True)
        mode.add_argument("--dry-run", action="store_true", help="Count and check, delete nothing")
        mode.add_argument("--confirm", metavar="CIV", help="Delete; repeat the civilization exactly, e.g. GREEK")
        mode.add_argument("--record-purged", action="store_true",
                          help="Only write the purge record of a civilization already purged without one")
        parser.add_argument("--dump", help="backup-db.sh manifest (soulledger_manifest_<ts>.txt) of the last 24 h")

    def handle(self, *args, civ, dry_run, confirm, dump, record_purged=False, **options):
        civ = civ.upper()
        try:
            alias = alias_for_civilization(civ)
        except ValueError:
            raise CommandError(f"unknown civilization {civ!r}") from None
        if record_purged:
            from django.core.management import call_command

            try:
                call_command("reconcile_shards", "--civ", civ, "--assert-control-empty", stdout=self.stdout)
            except CommandError as e:
                raise CommandError(f"reconcile_shards --assert-control-empty fails for {civ} ({e}): not recorded") from None
            _record(civ)
            self.stdout.write(f"recorded {civ} as purged ({PURGED}); keep it in SHARD_WRITE_CIVS and SHARD_PURGED_CIVS")
            return
        if confirm is not None and confirm != civ:
            raise CommandError(f"--confirm {confirm!r} does not repeat the civilization {civ!r}: nothing deleted")
        found = checks(civ, alias, dump)

        plan = purge_plan(civ)
        total = 0
        for model, qs in sorted(plan.items(), key=lambda kv: kv[0]._meta.label):
            n = qs.count()
            total += n
            if n:
                self.stdout.write(f"purge {model._meta.label} {n}")
        self.stdout.write(f"purge total {total} row(s) on control for {civ} ({len(halls_of(civ))} hall(s))")
        for model in compared_models():
            if placement(model) == SHARD and control_mastered(model):
                self.stdout.write(f"keep  {model._meta.label} (control-mastered)")
        blocked = blockers(plan)
        for key, n in blocked:
            self.stdout.write(f"block {key} {n} row(s) staying on control name a row that would go")
        found.append(("no blockers", not blocked, f"{len(blocked)} key(s)"))
        for name, ok, detail in found:
            self.stdout.write(f"{'PASS' if ok else 'FAIL'} {name}: {detail}")
        self.stdout.write(f"UNCHECKED restore drill: restore-drill.sh leaves no record; restore the manifest's control "
                          f"and {alias} dumps on a scratch server before --confirm")
        failed = [name for name, ok, _ in found if not ok]
        if failed:
            raise CommandError(f"purge preconditions failed: {', '.join(failed)} (nothing deleted)")
        if dry_run:
            self.stdout.write("dry run: nothing deleted")
            return
        deleted = purge(civ)
        for model, n in sorted(deleted.items(), key=lambda kv: kv[0]._meta.label):
            self.stdout.write(f"deleted {model._meta.label} {n}")
        self.stdout.write(f"deleted total {sum(deleted.values())} row(s) on control for {civ}")
