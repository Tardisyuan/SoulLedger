"""Stage 5 (PLAN 阶段 5): what deleting control's copy of one civilization's rows would delete -- DRY RUN ONLY.

    manage.py purge_cut_over_tenant_rows --civ GREEK --dry-run --dump /backups/soulledger_manifest_<ts>.txt

No delete path is written yet: stage 5 is paused until the user says go, and a purge is a permanent deletion that
needs the user's confirmation in chat. Without --dry-run the command refuses.

Prints, for the civilization's halls on control:
  purge     every SHARD model whose master is the shard (not the control-mastered ones, CONTROL_READS), with the
            number of control rows that would go: `owned(model, "default", civ, halls, copies=False)` -- the rows
            of its halls; a soul is its hall's (`tenant`), never its home's (that soul is another master's row).
  keep      the control-mastered SHARD models (control is their master), REFERENCE (Tenant), every CONTROL model,
            and D2 rows (no hall, a hall of UNKNOWN civilization) -- by construction not in `owned`.
  blockers  rows that stay on control and hold a database-constrained key to a row that would go (a hall-less
            disposition naming a judgment of the civilization): the delete would fail, or strand them.
Preconditions, each printed PASS / FAIL: the civilization's writes are cut over; reconcile shard-to-control for it is
clean; --dump names a backup-db.sh manifest under 24 hours old that lists control and this shard, each file present
and non-empty; no blocker. Exits 1 when any fails.
"""
import time
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import router

from apps.core.shard_reads import CONTROL_ALIAS, control_mastered
from apps.core.shard_sync import SHARD_TO_CONTROL, compare, compared_models, halls_of, owned, shard_aliases
from apps.core.sharding import SHARD, alias_for_civilization, placement

DUMP_MAX_AGE = 24 * 3600


def purged_models():
    """SHARD models whose control rows of a write-cut civilization are a mirror: the purge set."""
    return [m for m in compared_models() if placement(m) == SHARD and not control_mastered(m)]


def purge_plan(civ):
    """{model: queryset on control of the rows that would go}."""
    halls = halls_of(civ)
    return {m: owned(m, CONTROL_ALIAS, civ, halls, copies=False) for m in purged_models()}


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


def dump_problem(manifest, alias, now=None):
    """None when `manifest` is a fresh backup-db.sh manifest naming control and `alias`, else why not."""
    if not manifest:
        return "no --dump given"
    path = Path(manifest)
    if not path.is_file():
        return f"{manifest} is not a file"
    age = (now or time.time()) - path.stat().st_mtime
    if age > DUMP_MAX_AGE:
        return f"{path.name} is {age / 3600:.1f} h old (limit {DUMP_MAX_AGE // 3600} h)"
    listed = dict(line.split(None, 1) for line in path.read_text().splitlines() if line.strip())
    for who in ("control", alias):
        name = listed.get(who, "").strip()
        if not name:
            return f"{path.name} does not list {who}"
        files = [path.parent / name, path.parent / f"{name}.age"]
        if not any(p.is_file() and p.stat().st_size > 0 for p in files):
            return f"{who}'s dump {name} is missing or empty next to {path.name}"
    return None


class Command(BaseCommand):
    help = "Stage 5, dry run only: count control's rows of one cut-over civilization that a purge would delete."

    def add_arguments(self, parser):
        parser.add_argument("--civ", required=True, help="One civilization, e.g. GREEK")
        parser.add_argument("--dry-run", action="store_true", help="Count, delete nothing (the only mode written)")
        parser.add_argument("--dump", help="backup-db.sh manifest (soulledger_manifest_<ts>.txt) of the last 24 h")

    def handle(self, *args, civ, dry_run, dump, **options):
        if not dry_run:
            raise CommandError("only --dry-run exists: the delete path is not written (stage 5 is paused; a purge "
                               "is a permanent deletion and needs the user's go-ahead)")
        civ = civ.upper()
        try:
            alias = alias_for_civilization(civ)
        except ValueError:
            raise CommandError(f"unknown civilization {civ!r}") from None
        checks = []
        checks.append(("writes cut over", civ in settings.SHARD_WRITE_CIVS,
                       f"SHARD_WRITE_CIVS={list(settings.SHARD_WRITE_CIVS)}"))
        configured = alias in shard_aliases()
        checks.append(("shard configured", configured, alias))
        if configured and civ in settings.SHARD_WRITE_CIVS:
            diffs = sum(len(d) for _, _, d, _ in compare(alias, SHARD_TO_CONTROL).values())
            checks.append(("reconcile shard-to-control clean", diffs == 0, f"{diffs} row(s) differ"))
        problem = dump_problem(dump, alias)
        checks.append(("dump under 24 h", problem is None, problem or dump))

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
        found = blockers(plan)
        for key, n in found:
            self.stdout.write(f"block {key} {n} row(s) staying on control name a row that would go")
        checks.append(("no blockers", not found, f"{len(found)} key(s)"))
        self.stdout.write("UNCHECKED shard-to-control sync stopped for this civilization (no switch exists yet)")
        for name, ok, detail in checks:
            self.stdout.write(f"{'PASS' if ok else 'FAIL'} {name}: {detail}")
        failed = [name for name, ok, _ in checks if not ok]
        if failed:
            raise CommandError(f"purge preconditions failed: {', '.join(failed)} (dry run, nothing deleted)")
