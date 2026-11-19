"""Give a hall to the dispositions filed without one (sharding stage 5 entry, PLAN 「阶段 5 待清理」).

    manage.py backfill_disposition_halls --dry-run     # print the plan, write nothing (the default)
    manage.py backfill_disposition_halls --apply       # carry it out; a second run finds nothing to do

The rows: `Disposition.tenant IS NULL` on control. They were written while the soul had no hall
(`create_from_judgment` files under `soul.tenant`), so they stayed on control (D2) while their judgment went to
its civilization's shard. Stage 5 deletes control's copy of that judgment; the row's constrained key
(`judgment`, `destination_realm`) would then name nothing. Each row gets, in this order:
  1. its judgment's hall                         -- a disposition is filed under its judgment (same hall);
  2. no judgment: its destination realm's hall;
  3. otherwise it stays on control (D2).        -- a hall-less judgment keeps its disposition on control: the
                                                   constrained `judgment` key cannot leave the judgment behind.
BLOCKED (never moved): the realm is of another civilization than the target hall, or the target is write-cut and
the shard lacks the judgment / realm the row names (the insert would break a foreign key at commit).

Where --apply writes: a target civilization in SHARD_WRITE_CIVS has its master on its shard, so the row is
inserted there (raw, the values as on control but the hall) and then control's mirror row is given the same hall
-- shard first: a crash between the two leaves a duplicate the next --apply repairs, never a lost row. Any other
target: control is the master, the row is updated there and the next sync copies it. One AuditLog row per moved
disposition, in the master's transaction. Run it with the shard-to-control sync stopped (it would see the shard row
as missing on control for the moment between the two commits).
"""
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.shard_reads import CONTROL_ALIAS, control_mirror_writes, master_alias

MOVE, STAY, BLOCKED, DONE = "MOVE", "STAY", "BLOCKED", "DONE"


def _plan_row(d, judgments, realms, halls, souls):
    """(action, target hall or None, reason, flags) for one hall-less disposition `d` (read from control)."""
    judgment = judgments.get(d.judgment_id)
    realm = realms.get(d.destination_realm_id)
    flags = []
    if d.is_executed:
        flags.append("EXECUTED")
    if judgment is not None and not judgment.is_final:
        flags.append("JUDGMENT_NOT_FINAL")
    soul_hall = souls.get(d.soul_id)
    if d.judgment_id is not None and judgment is None:
        return BLOCKED, None, "its judgment is not on control", flags
    if judgment is not None:
        if judgment.tenant_id is None:
            flags.append("JUDGMENT_HAS_NO_HALL")
            return STAY, None, "its judgment has no hall: both stay on control (D2)", flags
        target, why = judgment.tenant_id, "its judgment's hall"
    elif realm is not None and realm.tenant_id is not None:
        target, why = realm.tenant_id, "no judgment: its destination realm's hall"
    else:
        return STAY, None, "no judgment and no hall on its destination realm (D2)", flags
    hall = halls[target]
    if soul_hall is not None and soul_hall != target:
        flags.append(f"SOUL_NOW_IN_{halls[soul_hall].code if soul_hall in halls else soul_hall}")
    if realm is not None and realm.tenant_id is not None and realm.tenant_id != target:
        other = halls[realm.tenant_id]
        if other.civilization != hall.civilization:
            return BLOCKED, target, f"destination realm is in {other.code} ({other.civilization})", flags
        flags.append(f"REALM_IN_{other.code}")
    if realm is not None and realm.tenant_id is None:
        return BLOCKED, target, "destination realm has no hall: a shard cannot hold the key (case 2)", flags
    return MOVE, target, why, flags


def plan():
    """[(disposition, action, target hall pk, reason, flags, halls by pk)] for every hall-less disposition on
    control, by pk."""
    from apps.disposition.models import Disposition
    from apps.judgment.models import Judgment
    from apps.realms.models import Realm
    from apps.souls.models import Soul
    from apps.tenants.models import Tenant

    rows = list(Disposition._base_manager.using(CONTROL_ALIAS).filter(tenant__isnull=True).order_by("pk"))
    judgments = Judgment._base_manager.using(CONTROL_ALIAS).in_bulk([d.judgment_id for d in rows if d.judgment_id])
    realms = Realm._base_manager.using(CONTROL_ALIAS).in_bulk(
        [d.destination_realm_id for d in rows if d.destination_realm_id])
    souls = dict(Soul._base_manager.using(CONTROL_ALIAS).filter(pk__in=[d.soul_id for d in rows])
                 .values_list("pk", "tenant_id"))
    halls = Tenant._base_manager.using(CONTROL_ALIAS).in_bulk()
    out = []
    for d in rows:
        action, target, why, flags = _plan_row(d, judgments, realms, halls, souls)
        if action == MOVE:
            alias = master_alias(halls[target].civilization)
            if alias != CONTROL_ALIAS:
                missing = [what for what, model, pk in (("judgment", Judgment, d.judgment_id),
                                                        ("destination realm", Realm, d.destination_realm_id))
                           if pk is not None and not model._base_manager.using(alias).filter(pk=pk).exists()]
                if missing:
                    action, why = BLOCKED, f"{alias} lacks its {' and '.join(missing)}"
        out.append((d, action, target, why, flags, halls))
    return out


def _move(d, hall):
    """Give `d` (control's row) the hall `hall` on its master, and control's mirror the same; audited once (a rerun
    after a crash between the two commits only finishes control's side)."""
    from apps.audit.models import AuditAction, AuditLog
    from apps.disposition.models import Disposition

    alias = master_alias(hall.civilization)
    with transaction.atomic(using=alias):
        if alias == CONTROL_ALIAS:
            moved = Disposition._base_manager.using(alias).filter(pk=d.pk, tenant__isnull=True).update(tenant_id=hall.pk)
        elif not Disposition._base_manager.using(alias).filter(pk=d.pk).exists():
            d.tenant_id = hall.pk
            Disposition._base_manager.using(alias)._insert(
                [d], fields=Disposition._meta.concrete_fields, raw=True, using=alias)
            moved = 1
        else:
            moved = 0
        if moved:
            AuditLog.objects.using(alias).create(
                tenant=hall, action=AuditAction.UPDATE, resource="disposition", resource_id=str(d.pk),
                changes={"tenant": [None, hall.code]},
                description="backfill_disposition_halls: hall-less disposition filed under its judgment's hall")
    if alias != CONTROL_ALIAS:
        with control_mirror_writes(), transaction.atomic(using=CONTROL_ALIAS):
            Disposition._base_manager.using(CONTROL_ALIAS).filter(pk=d.pk, tenant__isnull=True).update(
                tenant_id=hall.pk)


class Command(BaseCommand):
    help = "Give hall-less dispositions their judgment's hall (dry run unless --apply)."

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--dry-run", action="store_true", help="Print the plan, write nothing (default)")
        mode.add_argument("--apply", action="store_true", help="Carry the plan out")

    def handle(self, *args, apply=False, **options):
        rows = plan()
        counts = {}
        for d, action, target, why, flags, halls in rows:
            hall = halls.get(target)
            to = f"{hall.code} ({hall.civilization}, master {master_alias(hall.civilization)})" if hall else "control"
            self.stdout.write(f"{action:7} disposition {d.pk} judgment {d.judgment_id} -> {to}: {why}"
                              + (f" [{', '.join(flags)}]" if flags else ""))
            if action == MOVE and apply:
                _move(d, hall)
                action = DONE
            counts[action] = counts.get(action, 0) + 1
        mode = "applied" if apply else "dry run, nothing written"
        self.stdout.write(f"{len(rows)} hall-less disposition(s): "
                          + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) + f" ({mode}; "
                          f"SHARD_WRITE_CIVS={list(settings.SHARD_WRITE_CIVS)})")
