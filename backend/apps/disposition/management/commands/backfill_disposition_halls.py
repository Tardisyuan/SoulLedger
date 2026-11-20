"""Give a hall to the dispositions filed without one (sharding stage 5 entry, PLAN 「阶段 5 待清理」).

    manage.py backfill_disposition_halls --dry-run     # print the plan, write nothing (the default)
    manage.py backfill_disposition_halls --apply       # carry it out; a second run finds nothing to do
    manage.py backfill_disposition_halls --dry-run --judgment-hall <judgment id>=CN_DIYU   # and give that judgment a hall

The rows: `Disposition.tenant IS NULL` on control. They were written while the soul had no hall
(`create_from_judgment` files under `soul.tenant`), so they stayed on control (D2) while their judgment went to
its civilization's shard. Stage 5 deletes control's copy of that judgment; the row's constrained key
(`judgment`, `destination_realm`) would then name nothing. Each row gets, in this order:
  1. its judgment's hall                         -- a disposition is filed under its judgment (same hall);
  2. no judgment: its destination realm's hall;
  3. otherwise it stays on control (D2).        -- a hall-less judgment keeps its disposition on control: the
                                                   constrained `judgment` key cannot leave the judgment behind.
--judgment-hall <id>=<code> (user decision 2026-11-19, disposition #9 of SL-2026-0001): that hall-less judgment is
given the hall first -- only a judgment with no hall, only to its soul's hall or home hall, only when named (no rule
sweeps other judgments) -- and its disposition then follows rule 1 (MOVE, flagged JUDGMENT_HALL_GIVEN). On a write-cut
target the judgment, and whatever reaches its hall through it, is inserted on the shard (`_move_judgment`).
Then the rows filed under a disposition or judgment (FOLLOWS: a reincarnation under its disposition -- 115, 2026-11-20
-- and the judgment's children) that have no hall take their parent's hall, whether the parent has one already or
gets one in this run; same rules: dry run MOVE, --apply raw onto the shard with one audit row each (`_give_halls`),
idempotent, BLOCKED when a key of theirs names a row the target shard lacks. Last, every other hall-less row on
control with a constrained key into a row of a hall is printed as ORPHAN (the purge dry run's blocker shape, named
before it).
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
from django.core.management.base import BaseCommand, CommandError
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


def _plan_judgment(j, code, halls, souls):
    """(action or None, target hall pk, reason) for `--judgment-hall <j>=<code>`; None: it already has that hall
    (a rerun). Narrow on purpose: only a hall-less judgment, and only to its soul's hall or home hall."""
    by_code = {h.code: h for h in halls.values()}
    if j is None:
        return BLOCKED, None, "no such judgment on control"
    hall = by_code.get(code)
    if hall is None:
        return BLOCKED, None, f"no hall {code!r}"
    if j.tenant_id == hall.pk:
        return None, hall.pk, "already there"
    if j.tenant_id is not None:
        return BLOCKED, hall.pk, f"it has a hall already ({halls[j.tenant_id].code}): only a hall-less one is given one"
    if hall.pk not in souls.get(j.soul_id, ()):
        return BLOCKED, hall.pk, "the hall is neither its soul's hall nor its soul's home hall"
    return MOVE, hall.pk, "given by --judgment-hall (its soul's hall)"


def plan(judgment_halls=None):
    """([(judgment, action, target hall pk, reason)] for `judgment_halls` {judgment pk: hall code},
    [(disposition, action, target hall pk, reason, flags)] for every hall-less disposition on control by pk,
    halls by pk). A disposition whose judgment is given a hall here is planned as if it had it."""
    from apps.core.sharding import SHARD, placement
    from apps.disposition.models import Disposition
    from apps.judgment.models import Judgment
    from apps.realms.models import Realm
    from apps.souls.models import Soul
    from apps.tenants.models import Tenant

    judgment_halls = judgment_halls or {}
    rows = list(Disposition._base_manager.using(CONTROL_ALIAS).filter(tenant__isnull=True).order_by("pk"))
    judgments = Judgment._base_manager.using(CONTROL_ALIAS).in_bulk(
        [d.judgment_id for d in rows if d.judgment_id] + list(judgment_halls))
    realms = Realm._base_manager.using(CONTROL_ALIAS).in_bulk(
        [d.destination_realm_id for d in rows if d.destination_realm_id])
    soul_ids = [d.soul_id for d in rows] + [j.soul_id for j in judgments.values()]
    soul_halls = {pk: (t, h) for pk, t, h in Soul._base_manager.using(CONTROL_ALIAS).filter(pk__in=soul_ids)
                  .values_list("pk", "tenant_id", "home_tenant_id")}
    souls = {pk: t for pk, (t, _) in soul_halls.items()}
    halls = Tenant._base_manager.using(CONTROL_ALIAS).in_bulk()

    moves, given = [], {}
    for pk, code in judgment_halls.items():
        j = judgments.get(pk)
        action, target, why = _plan_judgment(j, code, halls, soul_halls)
        if action == MOVE:
            alias = master_alias(halls[target].civilization)
            missing = [f.name for f in Judgment._meta.concrete_fields
                       if alias != CONTROL_ALIAS and f.is_relation and f.db_constraint and placement(f.related_model)
                       == SHARD and getattr(j, f.attname) is not None
                       and not f.related_model._base_manager.using(alias).filter(pk=getattr(j, f.attname)).exists()]
            if missing:
                action, why = BLOCKED, f"{alias} lacks its {' and '.join(missing)}"
        if action == MOVE:
            given[pk] = target
        if action is not None:
            moves.append((j, pk, action, target, why))
    for pk, target in given.items():  # plan its dispositions as if it had the hall already
        j = judgments[pk] = Judgment._base_manager.using(CONTROL_ALIAS).get(pk=pk)
        j.tenant_id = target

    out = []
    for d in rows:
        action, target, why, flags = _plan_row(d, judgments, realms, halls, souls)
        if d.judgment_id in given:
            flags.append("JUDGMENT_HALL_GIVEN")
        if action == MOVE:
            alias = master_alias(halls[target].civilization)
            if alias != CONTROL_ALIAS:
                missing = [what for what, model, pk in (("judgment", Judgment, d.judgment_id),
                                                        ("destination realm", Realm, d.destination_realm_id))
                           if pk is not None and not (model is Judgment and pk in given)
                           and not model._base_manager.using(alias).filter(pk=pk).exists()]
                if missing:
                    action, why = BLOCKED, f"{alias} lacks its {' and '.join(missing)}"
        out.append((d, action, target, why, flags))
    return moves, out, halls


#: Hall-less rows that take their parent's hall, by the key that names the parent: a record filed under it, "same hall
#: by convention" (tests/tenancy_fk_inventory.py). The constrained-key shapes a hall-less row can hold into a row of a
#: hall, beyond the disposition's own (judgment, destination_realm): the purge dry run on 115 found
#: Reincarnation.disposition (2026-11-20); the judgment's children are the same shape under a --judgment-hall judgment.
#: Any other shape is reported, not moved (`orphans`).
FOLLOWS = {
    "reincarnation.Reincarnation": "disposition",
    **{label: "judgment" for label in (
        "judgment.NegativeConfession", "judgment.EvidenceAdmission", "judgment.CaseAttachment",
        "judgment.JudgmentComment", "judgment.JudgmentCitation", "judgment.JudgmentAppeal",
        "death_sync.DeathRegistrationRequest", "dispatch.CaptureWarrant", "dispatch.CrossTenantJudgment",
        "workflow.ApprovalWorkflow")},
}


def _shard_keys(model):
    """The constrained keys of `model` to SHARD rows: on a shard the row they name must be there too."""
    from apps.core.sharding import SHARD, placement

    return [f for f in model._meta.concrete_fields
            if f.is_relation and f.db_constraint and placement(f.related_model) == SHARD]


def plan_followers(halls, planned):
    """[(row, action, target hall pk, reason)] for the hall-less rows of FOLLOWS, by model label and pk. `planned`:
    {(model, pk): hall pk} of the judgments and dispositions given a hall in this run. A row follows its parent's hall
    (on control, or planned); BLOCKED when another constrained key names a row the target shard lacks and that no move
    of this run brings there; STAY when the parent has no hall."""
    from django.apps import apps

    rows = {}
    for label, key in FOLLOWS.items():
        model = apps.get_model(label)
        f = model._meta.get_field(key)
        parent = f.related_model._meta.concrete_model
        for row in model._base_manager.using(CONTROL_ALIAS).filter(
                tenant__isnull=True, **{f"{f.attname}__isnull": False}).order_by("pk"):
            pid = getattr(row, f.attname)
            hall = planned.get((parent, pid)) or parent._base_manager.using(CONTROL_ALIAS).filter(pk=pid).values_list(
                "tenant_id", flat=True).first()
            rows[(model, row.pk)] = [row, MOVE if hall else STAY, hall,
                                     f"its {key}'s hall" if hall else f"its {key} has no hall (D2)"]
    changed = True
    while changed:  # a row blocked can strand another row of this run that names it
        changed = False
        moving = {**planned, **{k: v[2] for k, v in rows.items() if v[1] == MOVE}}
        for (model, _pk), entry in rows.items():
            row, action, hall, _ = entry
            if action != MOVE:
                continue
            alias = master_alias(halls[hall].civilization)
            if alias == CONTROL_ALIAS:
                continue  # control is the master: it holds every row the keys name
            missing = [f.name for f in _shard_keys(model) if (value := getattr(row, f.attname)) is not None
                       and moving.get((f.related_model._meta.concrete_model, value)) != hall
                       and not f.related_model._base_manager.using(alias).filter(pk=value).exists()]
            if missing:
                entry[1], entry[3] = BLOCKED, f"{alias} lacks its {' and '.join(missing)}"
                changed = True
    return [tuple(v) for v in rows.values()]


def orphans(planned):
    """[(key label, n)]: hall-less rows of any SHARD model (not moved by this run) holding a constrained key to a row
    that has a hall, or gets one in this run -- the shape the purge's blockers catch, named before the purge."""
    from django.apps import apps
    from django.db.models import Q

    from apps.core.sharding import SHARD, placement, tenant_path

    by_model = {}
    for (model, pk) in planned:
        by_model.setdefault(model, set()).add(pk)
    out = []
    for model in apps.get_models(include_auto_created=True):
        if placement(model) != SHARD or model._meta.proxy or not model._meta.managed:
            continue
        hall_less = model._base_manager.using(CONTROL_ALIAS).filter(**{f"{tenant_path(model)}__isnull": True}).exclude(
            pk__in=by_model.get(model, ()))
        for f in _shard_keys(model):
            target = f.related_model._meta.concrete_model
            n = hall_less.filter(Q(**{f"{f.name}__{tenant_path(target)}__isnull": False})
                                 | Q(**{f"{f.attname}__in": by_model.get(target, ())})).count()
            if n:
                out.append((f"{model._meta.label}.{f.name}", n))
    return out


def _give_halls(rows, hall, why):
    """Give the hall-less rows `rows` [(model, pk)] the hall `hall`: on control (their master until now) and, when
    `hall`'s civilization is write-cut, the rows that change hands with them -- these, and any row whose hall is
    reached through one -- inserted raw on the shard, one audit row each there. The rows are found as control's rows of
    the civilization that the shard lacks after the update and did not lack before it (shard-to-control `compare`, with
    the purge switch off), so a row the shard deleted and control still has is not resurrected. Shard first: a crash
    between the two commits leaves the shard's rows and hall-less control rows, which a rerun completes (no audit)."""
    from apps.audit.models import AuditAction
    from apps.audit.signals import write_audit_row
    from apps.core.shard_sync import CONTROL_TO_SHARD, SHARD_TO_CONTROL, apply_fix, compare

    alias = master_alias(hall.civilization)

    def only_on_control():
        return {(m, pk): (src, dst, halls) for m, (src, dst, diffs, halls) in compare(alias, SHARD_TO_CONTROL, purged=())
                .items() for kind, pk in diffs if kind == "extra"}

    with control_mirror_writes(), transaction.atomic(using=CONTROL_ALIAS):
        before = only_on_control() if alias != CONTROL_ALIAS else {}
        given = [(model, pk) for model, pk in rows if model._base_manager.using(CONTROL_ALIAS).filter(
            pk=pk, tenant__isnull=True).update(tenant_id=hall.pk)]
        if not given:
            return
        audit_on = CONTROL_ALIAS
        if alias != CONTROL_ALIAS:
            moved = {k: v for k, v in only_on_control().items() if k not in before}
            found = {}
            for (m, row), (shard_qs, control_qs, halls) in moved.items():
                found.setdefault(m, (control_qs, shard_qs, [], halls))[2].append(("missing", row))
            if not found:
                return  # a rerun after a crash: the shard has them already
            audit_on = alias
        with transaction.atomic(using=audit_on):
            if audit_on != CONTROL_ALIAS:
                apply_fix(found, CONTROL_TO_SHARD)  # control's rows as read, onto the shard (its target)
            for model, pk in given:
                write_audit_row(
                    using=audit_on, tenant=hall, action=AuditAction.UPDATE, resource=model._meta.model_name, resource_id=str(pk),
                    changes={"tenant": [None, hall.code]},
                    description=f"backfill_disposition_halls: hall-less {model._meta.model_name} given {why}")


def _move_judgment(pk, hall):
    from apps.judgment.models import Judgment

    _give_halls([(Judgment, pk)], hall, "its soul's hall (--judgment-hall)")


def _move(d, hall):
    """Give `d` (control's row) the hall `hall` on its master, and control's mirror the same; audited once (a rerun
    after a crash between the two commits only finishes control's side)."""
    from apps.audit.models import AuditAction
    from apps.audit.signals import write_audit_row
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
            write_audit_row(
                using=alias, tenant=hall, action=AuditAction.UPDATE, resource="disposition", resource_id=str(d.pk),
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
        parser.add_argument("--judgment-hall", action="append", default=[], metavar="JUDGMENT_ID=HALL_CODE",
                            help="Give this hall-less judgment this hall (its soul's hall or home hall only) first, so "
                                 "its disposition follows it; repeatable")

    def handle(self, *args, apply=False, judgment_hall=(), **options):
        import uuid

        given = {}
        for item in judgment_hall:
            pk, sep, code = item.partition("=")
            try:
                given[uuid.UUID(pk.strip())] = code.strip()
            except ValueError:
                sep = ""
            if not sep or not code.strip():
                raise CommandError(f"--judgment-hall {item!r}: expected <judgment id>=<hall code>")
        moves, rows, halls = plan(given)
        counts = {}
        for j, pk, action, target, why in moves:
            hall = halls.get(target)
            to = f"{hall.code} ({hall.civilization}, master {master_alias(hall.civilization)})" if hall else "?"
            self.stdout.write(f"{action:7} judgment {pk} soul {j.soul_id if j else None} -> {to}: {why}")
            if action == MOVE and apply:
                _move_judgment(pk, hall)
                action = DONE
            counts[f"judgment {action}"] = counts.get(f"judgment {action}", 0) + 1
        for d, action, target, why, flags in rows:
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

        from apps.disposition.models import Disposition
        from apps.judgment.models import Judgment

        planned = {**{(Judgment, pk): t for _j, pk, a, t, _w in moves if a == MOVE},
                   **{(Disposition, d.pk): t for d, a, t, _w, _f in rows if a == MOVE}}
        followers = plan_followers(halls, planned)
        counts, batches = {}, {}
        for row, action, target, why in followers:
            label = type(row)._meta.label
            hall = halls.get(target)
            to = f"{hall.code} ({hall.civilization}, master {master_alias(hall.civilization)})" if hall else "control"
            self.stdout.write(f"{action:7} {label} {row.pk} -> {to}: {why}")
            if action == MOVE:
                planned[(type(row), row.pk)] = target
                batches.setdefault(target, []).append((type(row), row.pk))
                if apply:
                    action = DONE
            counts[action] = counts.get(action, 0) + 1
        if apply:
            for target, batch in batches.items():
                _give_halls(batch, halls[target], "its parent's hall")
        self.stdout.write(f"{len(followers)} hall-less row(s) under a disposition or judgment: "
                          + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) + f" ({mode})")
        for key, n in orphans(planned):
            self.stdout.write(f"ORPHAN  {key} {n} hall-less row(s) name a row of a hall: not moved here, the purge "
                              "will block on them")
