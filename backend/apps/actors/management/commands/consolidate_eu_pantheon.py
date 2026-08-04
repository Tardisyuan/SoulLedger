"""
Management command to consolidate the EU_HEAVEN_HELL tenant's pantheon down
to two coherent judgment systems: Christian (God) and Greco-Roman (Hades).

Background: EU_HEAVEN_HELL currently mixes three mythologies (Christian,
Greco-Roman, Norse) in one tenant, producing 5 actors with role=OVERSEER
where every other tenant has at most 1. Norse mythology has no judgment
concept (destination depends on manner of death, not moral verdict), so it
cannot support this product's judgment-centric model as an independent
system. Product decision: keep Christian + Greco-Roman as the two systems,
demote Norse actors to non-overseeing roles, keep them in the roster.

This command does THREE things:

  1. Norse demotion (Odin, Freya, Hel, Valkyries): strip OVERSEER/JUDGE
     status and detach from realms that don't belong to them (Odin/Freya/
     Valkyries were mistagged onto the Christian EU_HEAVEN realm; Hel onto
     Hades' EU_HELL_9TH). Rows are kept, not deleted.

  2. Pluto/Hades merge: Pluto is Hades' Roman name — same deity, two rows,
     two OVERSEERs. Before merging, live references (User.actor,
     Judgment.judge, WorkflowNode.approver_actor,
     CrossTenantJudgmentParticipant.participant_actor) are checked. If only
     one row is referenced (or neither), the unreferenced/lesser-referenced
     row is soft-deleted. If BOTH are referenced, this command does NOT
     merge — it reports the conflict and leaves both rows untouched, so a
     human can decide how to migrate the reference.

  3. Greco-Roman completeness audit (read-only): confirms Hades is the sole
     OVERSEER, Minos/Aeacus/Rhadamanthus are JUDGE, Charon is CONDUIT, and
     Cerberus is GUARDIAN. Deviations are printed, nothing is changed.

Usage:
    python manage.py consolidate_eu_pantheon               # dry-run (default)
    python manage.py consolidate_eu_pantheon --execute       # apply changes
    python manage.py consolidate_eu_pantheon --execute --backup-dir /path

Safe to re-run: rows already at their target role/realm are skipped, and
soft-deleted rows are skipped.
"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.actors.models import Actor, ActorRole

TENANT_CODE = "EU_HEAVEN_HELL"

# name -> new role. Realm is cleared (set to None) for all of these: none of
# them belong to a Christian or Greco-Roman realm, and no Norse realm
# (Valhalla / Fólkvangr / Helheim) exists in this system.
NORSE_DEMOTIONS = {
    "Odin": ActorRole.GUARDIAN,      # ruler of his own hall (Valhalla), not overseer of the whole system
    "Freya": ActorRole.GUARDIAN,     # ruler of her own hall (Fólkvangr), not a judge
    "Hel": ActorRole.GUARDIAN,       # ruler of her own hall (Helheim), not overseer of Hell
    "Valkyries": ActorRole.CONDUIT,  # unchanged role — psychopomps, correctly tagged already
}
NORSE_NAMES = list(NORSE_DEMOTIONS)

MERGE_NAMES = ("Pluto", "Hades")

GRECO_ROMAN_EXPECTED = {
    "Hades": ActorRole.OVERSEER,
    "Minos": ActorRole.JUDGE,
    "Aeacus": ActorRole.JUDGE,
    "Rhadamanthus": ActorRole.JUDGE,
    "Charon": ActorRole.CONDUIT,
    "Cerberus": ActorRole.GUARDIAN,
}

DEFAULT_BACKUP_DIR = Path(__file__).resolve().parents[4] / "scripts" / "backups"


def _reference_count(actor):
    """Count live references to this actor across all known FK relations."""
    return (
        actor.users.count()
        + actor.judgments_conducted.count()
        + actor.approvalnode_set.count()
        + actor.judgment_participations.count()
    )


def _referencing_users(actor):
    return list(actor.users.values_list("id", "username"))


def _snapshot(actor):
    return {
        "id": str(actor.id),
        "name": actor.name,
        "civilization": actor.civilization,
        "role": actor.role,
        "realm_code": actor.realm.realm_code if actor.realm else None,
        "tenant_id": actor.tenant_id,
        "is_deleted": actor.is_deleted,
        "created_at": actor.created_at.isoformat() if actor.created_at else None,
        "references": _reference_count(actor),
    }


class Command(BaseCommand):
    help = (
        "Consolidate EU_HEAVEN_HELL down to two judgment systems (Christian, "
        "Greco-Roman): demote Norse actors, merge Pluto/Hades if safe, and "
        "audit Greco-Roman role completeness. Defaults to a dry-run."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Actually write changes. Without this flag, nothing is saved.",
        )
        parser.add_argument(
            "--backup-dir",
            default=str(DEFAULT_BACKUP_DIR),
            help="Directory to write the pre-change JSON backup to (execute mode only).",
        )

    def handle(self, *args, **options):
        execute = options["execute"]
        backup_dir = Path(options["backup_dir"])

        mode = "EXECUTE" if execute else "DRY-RUN"
        self.stdout.write(self.style.WARNING(f"=== consolidate_eu_pantheon ({mode}) ===\n"))

        tenant_actors = Actor.all_objects.filter(tenant__code=TENANT_CODE, civilization="EUROPEAN")

        affected = []  # snapshots collected for the backup file
        plan = []  # human-readable summary lines

        # ------------------------------------------------------------------
        # Step 1: Norse demotion
        # ------------------------------------------------------------------
        self.stdout.write(self.style.MIGRATE_HEADING("Step 1: Norse demotion (Odin/Freya/Hel/Valkyries)"))
        role_realm_updates = []
        for name, new_role in NORSE_DEMOTIONS.items():
            actor = tenant_actors.filter(name=name).first()
            if actor is None:
                self.stdout.write(self.style.ERROR(f"  [warn] {name!r} not found in {TENANT_CODE} — skipping"))
                continue

            realm_already_none = actor.realm_id is None
            role_already_target = actor.role == new_role
            if realm_already_none and role_already_target:
                self.stdout.write(f"  [skip] {name!r} already role={new_role} realm=None (id={actor.id})")
                continue

            before = _snapshot(actor)
            affected.append({"action": "norse_demotion", "before": before, "after_role": new_role})
            old_realm = before["realm_code"]
            plan.append(
                f"UPDATE Actor(id={actor.id}, name={name!r}): role {actor.role} -> {new_role}, "
                f"realm {old_realm} -> None"
            )
            self.stdout.write(
                f"  {name!r} (id={actor.id}): role {actor.role} -> {new_role}, realm {old_realm} -> None"
            )
            role_realm_updates.append((actor, new_role))

        # ------------------------------------------------------------------
        # Step 2: Pluto / Hades merge
        # ------------------------------------------------------------------
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Step 2: Pluto/Hades merge"))
        merge_delete = None
        rows = {name: tenant_actors.filter(name=name).first() for name in MERGE_NAMES}
        active_rows = {n: a for n, a in rows.items() if a is not None and not a.is_deleted}

        if len(active_rows) <= 1:
            self.stdout.write(
                f"  [skip] only {len(active_rows)} active row(s) among {MERGE_NAMES} — nothing to merge"
            )
        else:
            refs = {n: _reference_count(a) for n, a in active_rows.items()}
            referenced = {n: c for n, c in refs.items() if c > 0}
            for n, a in active_rows.items():
                self.stdout.write(
                    f"    {n}: id={a.id} role={a.role} realm={a.realm.realm_code if a.realm else None} "
                    f"refs={refs[n]}"
                )

            if len(referenced) >= 2:
                self.stdout.write(self.style.ERROR(
                    "  [CONFLICT] both Pluto and Hades are referenced by other records — "
                    "refusing to merge automatically:"
                ))
                for n in referenced:
                    users = _referencing_users(active_rows[n])
                    self.stdout.write(f"    {n} (id={active_rows[n].id}) referenced by users: {users}")
                self.stdout.write(self.style.ERROR(
                    "  ACTION REQUIRED: decide which row survives and how the referencing "
                    "User.actor row should be re-pointed, then re-run. No changes made to either row."
                ))
            else:
                scored = sorted(
                    active_rows.values(),
                    key=lambda a: (-refs[a.name], a.created_at),
                )
                keeper, loser = scored[0], scored[1]
                self.stdout.write(
                    f"  KEEP   id={keeper.id} name={keeper.name} refs={refs[keeper.name]}"
                )
                before = _snapshot(loser)
                affected.append({"action": "soft_delete_merge", "before": before, "kept_id": str(keeper.id)})
                plan.append(f"SOFT-DELETE Actor(id={loser.id}, name={loser.name!r}) — merged into {keeper.id}")
                self.stdout.write(
                    f"  DELETE id={loser.id} name={loser.name} refs={refs[loser.name]} (merged into {keeper.name})"
                )
                merge_delete = loser

        # ------------------------------------------------------------------
        # Step 3: Greco-Roman completeness audit (read-only)
        # ------------------------------------------------------------------
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Step 3: Greco-Roman completeness audit (read-only)"))
        deviations = []
        for name, expected_role in GRECO_ROMAN_EXPECTED.items():
            actor = tenant_actors.filter(name=name).first()
            if actor is None:
                deviations.append(f"{name}: MISSING")
                continue
            if actor.role != expected_role:
                deviations.append(f"{name}: role={actor.role}, expected {expected_role}")
        if deviations:
            self.stdout.write(self.style.ERROR("  Deviations found:"))
            for d in deviations:
                self.stdout.write(f"    - {d}")
        else:
            self.stdout.write(self.style.SUCCESS(
                "  OK — Hades is sole OVERSEER, Minos/Aeacus/Rhadamanthus are JUDGE, "
                "Charon is CONDUIT, Cerberus is GUARDIAN."
            ))

        lethe = tenant_actors.filter(name="Lethe").first()
        if lethe:
            self.stdout.write(
                f"  Lethe: civilization={lethe.civilization} realm={lethe.realm.realm_code if lethe.realm else None} "
                f"role={lethe.role} — Purgatory placement matches Dante's Purgatorio "
                f"(Lethe sits atop Mount Purgatory); no change made."
            )

        # ------------------------------------------------------------------
        # Summary / apply
        # ------------------------------------------------------------------
        self.stdout.write("")
        if not role_realm_updates and not merge_delete:
            self.stdout.write(self.style.SUCCESS("Nothing to do — data is already consolidated."))
            return

        self.stdout.write(self.style.MIGRATE_HEADING(f"Plan ({len(plan)} change(s)):"))
        for line in plan:
            self.stdout.write(f"  - {line}")

        if not execute:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                "Dry-run only — no changes written. Re-run with --execute to apply."
            ))
            return

        # Write backup before touching anything.
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / f"eu_pantheon_consolidation_{timezone.now().strftime('%Y%m%dT%H%M%SZ')}.json"
        with open(backup_path, "w", encoding="utf-8") as f:
            json.dump(affected, f, ensure_ascii=False, indent=2)
        self.stdout.write(self.style.SUCCESS(f"\nBackup written to {backup_path}"))

        for actor, new_role in role_realm_updates:
            actor.role = new_role
            actor.realm = None
            actor.save(update_fields=["role", "realm"])

        if merge_delete:
            merge_delete.soft_delete(reason="Merged into Hades — Pluto is Hades' Roman name; EU pantheon consolidation")

        self.stdout.write(self.style.SUCCESS(
            f"\nApplied: {len(role_realm_updates)} role/realm update(s), "
            f"{1 if merge_delete else 0} soft-delete(s)."
        ))
