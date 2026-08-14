"""
Management command to consolidate the EU_HEAVEN_HELL tenant's pantheon down
to two coherent judgment systems: Christian (God) and Greco-Roman (Hades).

Background: EU_HEAVEN_HELL used to mix three mythologies (Christian,
Greco-Roman, Norse) in one tenant, producing 5 actors with role=OVERSEER
where every other tenant has at most 1. Norse mythology has no judgment
concept — destination depends on manner of death, not on a moral verdict —
so it cannot support this product's judgment-centric model.

NORSE HAS BEEN REMOVED FROM THIS SYSTEM.
----------------------------------------
An earlier version of this command demoted Odin/Freya/Hel/Valkyries to
non-overseeing roles and kept them in the roster. That is no longer the
decision: Norse is out entirely, not downgraded. A pantheon with no
judgment step has nothing to do in a ledger whose every workflow is a
judgment, and keeping the rows around as GUARDIANs meant they kept showing
up in actor pickers for judgments they can never take part in.

What that means in practice:

  * No seed path creates Odin, Freya, Hel or Valkyries. Neither
    `seed_mythology` nor scripts/seed_chinese_data.py has ever listed them,
    so a fresh database has no Norse actors at all and nothing here has to
    run.
  * Databases that predate the decision may still hold those rows. They are
    NOT touched by default. Pass --purge-norse to soft-delete them, and only
    after the live-reference check below clears each one.
  * The two Norse leftovers this note used to point at are gone: the 北欧冥界
    (HADES_NORSE) Organization node in apps/org's init_organizations and the
    北欧分流流程 template in frontend/src/config/workflow-templates.ts were
    both removed once a reference check showed nothing pointed at them.

This command does TWO things by default, plus one on request:

  1. Pluto/Hades merge: Pluto is Hades' Roman name — same deity, two rows,
     two OVERSEERs. Before merging, live references (User.actor,
     Judgment.judge, WorkflowNode.approver_actor,
     CrossTenantJudgmentParticipant.participant_actor) are checked. If only
     one row is referenced (or neither), the unreferenced/lesser-referenced
     row is soft-deleted, and on a tie Hades is the survivor by name — the
     Greek name is the canonical one, so the outcome does not depend on
     which row happened to be inserted first. If BOTH are referenced, this
     command does NOT merge — it reports the conflict and leaves both rows
     untouched, so a human can decide how to migrate the reference.

  2. Greco-Roman completeness audit (read-only): confirms Hades is the sole
     OVERSEER, Minos/Aeacus/Rhadamanthus are JUDGE, Charon is CONDUIT, and
     Cerberus is GUARDIAN. Deviations are printed, nothing is changed.
     `seed_mythology` seeds exactly this cast, so a freshly seeded database
     passes this audit clean.

  3. Norse purge (--purge-norse only): soft-delete leftover Odin/Freya/Hel/
     Valkyries rows. Each row is reference-checked first with the same
     helper the merge uses; a row that is still referenced is reported as a
     conflict and left alone rather than deleted out from under whatever
     points at it.

Usage:
    python manage.py consolidate_eu_pantheon               # dry-run (default)
    python manage.py consolidate_eu_pantheon --execute       # apply changes
    python manage.py consolidate_eu_pantheon --purge-norse    # plan the purge
    python manage.py consolidate_eu_pantheon --execute --purge-norse
    python manage.py consolidate_eu_pantheon --execute --backup-dir /path

Safe to re-run: rows already merged or already soft-deleted are skipped.
"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.actors.models import Actor, ActorRole

TENANT_CODE = "EU_HEAVEN_HELL"

# Norse actors that historical databases may still hold. No seed path creates
# them; --purge-norse soft-deletes whichever of them are found, after the
# live-reference check. No Norse realm (Valhalla / Fólkvangr / Helheim) has
# ever existed in this system, so these rows are typically mistagged onto the
# Christian EU_HEAVEN realm or onto Hades' EU_HELL_9TH.
NORSE_NAMES = ["Odin", "Freya", "Hel", "Valkyries"]

MERGE_NAMES = ("Pluto", "Hades")
# On a reference-count tie the Greek name wins. Without this the survivor was
# decided by created_at, i.e. by seed insertion order, while the soft-delete
# reason written to the database claimed unconditionally that the row was
# "merged into Hades".
MERGE_SURVIVOR = "Hades"

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
        "Greco-Roman): merge Pluto/Hades if safe and audit Greco-Roman role "
        "completeness. Pass --purge-norse to also soft-delete leftover Norse "
        "actors. Defaults to a dry-run."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Actually write changes. Without this flag, nothing is saved.",
        )
        parser.add_argument(
            "--purge-norse",
            action="store_true",
            help=(
                "Soft-delete leftover Odin/Freya/Hel/Valkyries rows. Norse is no "
                "longer part of this system and no seed path creates them, so this "
                "only matters for databases that predate that decision. Rows with "
                "live references are reported and left alone."
            ),
        )
        parser.add_argument(
            "--backup-dir",
            default=str(DEFAULT_BACKUP_DIR),
            help="Directory to write the pre-change JSON backup to (execute mode only).",
        )

    def handle(self, *args, **options):
        execute = options["execute"]
        purge_norse = options["purge_norse"]
        backup_dir = Path(options["backup_dir"])

        mode = "EXECUTE" if execute else "DRY-RUN"
        self.stdout.write(self.style.WARNING(f"=== consolidate_eu_pantheon ({mode}) ===\n"))

        tenant_actors = Actor.all_objects.filter(tenant__code=TENANT_CODE, civilization="EUROPEAN")

        affected = []  # snapshots collected for the backup file
        plan = []  # human-readable summary lines

        # ------------------------------------------------------------------
        # Step 1: Pluto / Hades merge
        # ------------------------------------------------------------------
        self.stdout.write(self.style.MIGRATE_HEADING("Step 1: Pluto/Hades merge"))
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
                # Most-referenced row wins; on a tie (usually 0 refs on both)
                # the Greek name wins outright. Falling through to created_at
                # would let seed insertion order decide, which could soft-delete
                # Hades and leave a row named Pluto carrying a delete reason
                # that says "merged into Hades".
                scored = sorted(
                    active_rows.values(),
                    key=lambda a: (-refs[a.name], a.name != MERGE_SURVIVOR, a.created_at),
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
        # Step 2: Greco-Roman completeness audit (read-only)
        # ------------------------------------------------------------------
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Step 2: Greco-Roman completeness audit (read-only)"))
        deviations = []
        for name, expected_role in GRECO_ROMAN_EXPECTED.items():
            # Live rows only. A soft-deleted Hades is not a present Hades, and
            # reporting it as one would make this audit pass over exactly the
            # damage it exists to catch. `tenant_actors` is built from
            # all_objects so the merge step above can see deleted rows.
            actor = tenant_actors.filter(name=name, is_deleted=False).first()
            if actor is None:
                soft_deleted = tenant_actors.filter(name=name, is_deleted=True).exists()
                deviations.append(
                    f"{name}: MISSING (soft-deleted row exists)" if soft_deleted
                    else f"{name}: MISSING"
                )
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
        # Step 3: Norse purge (opt-in)
        # ------------------------------------------------------------------
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Step 3: Norse purge (Odin/Freya/Hel/Valkyries)"))
        norse_deletes = []
        if not purge_norse:
            present = sorted(
                tenant_actors.filter(name__in=NORSE_NAMES, is_deleted=False)
                .values_list("name", flat=True)
            )
            if present:
                self.stdout.write(self.style.ERROR(
                    f"  {len(present)} Norse row(s) still present: {present}. Norse has been "
                    f"removed from this system — re-run with --purge-norse to plan their removal."
                ))
            else:
                self.stdout.write(
                    "  [skip] no Norse rows present. No seed path creates them, so this is the "
                    "expected state for any database seeded by `manage.py seed_mythology`."
                )
        else:
            for name in NORSE_NAMES:
                actor = tenant_actors.filter(name=name, is_deleted=False).first()
                if actor is None:
                    self.stdout.write(f"  [skip] {name!r} not present in {TENANT_CODE} — nothing to purge")
                    continue

                # Same reference check the merge uses. A row something still
                # points at is reported, not deleted: soft-deleting it would
                # leave Judgment.judge / User.actor aimed at a row the app
                # filters out, which reads as data loss rather than cleanup.
                refs = _reference_count(actor)
                if refs:
                    self.stdout.write(self.style.ERROR(
                        f"  [CONFLICT] {name!r} (id={actor.id}) has {refs} live reference(s) — "
                        f"NOT deleting."
                    ))
                    self.stdout.write(
                        f"    users={_referencing_users(actor)} "
                        f"judgments={actor.judgments_conducted.count()} "
                        f"workflow_nodes={actor.approvalnode_set.count()} "
                        f"cross_tenant_participations={actor.judgment_participations.count()}"
                    )
                    self.stdout.write(self.style.ERROR(
                        "    ACTION REQUIRED: re-point those references at a non-Norse actor "
                        "first, then re-run."
                    ))
                    continue

                before = _snapshot(actor)
                affected.append({"action": "norse_purge", "before": before})
                plan.append(
                    f"SOFT-DELETE Actor(id={actor.id}, name={name!r}) — Norse removed from this system"
                )
                self.stdout.write(
                    f"  DELETE id={actor.id} name={name} role={actor.role} "
                    f"realm={before['realm_code']} refs=0"
                )
                norse_deletes.append(actor)

        # ------------------------------------------------------------------
        # Summary / apply
        # ------------------------------------------------------------------
        self.stdout.write("")
        if not merge_delete and not norse_deletes:
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

        if merge_delete:
            merge_delete.soft_delete(reason="Merged into Hades — Pluto is Hades' Roman name; EU pantheon consolidation")

        for actor in norse_deletes:
            actor.soft_delete(
                reason="Norse removed from this system — no judgment concept; EU pantheon consolidation"
            )

        self.stdout.write(self.style.SUCCESS(
            f"\nApplied: {1 if merge_delete else 0} merge soft-delete(s), "
            f"{len(norse_deletes)} Norse soft-delete(s)."
        ))
