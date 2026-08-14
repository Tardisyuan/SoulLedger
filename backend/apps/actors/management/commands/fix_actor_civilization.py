"""
Management command to correct actor civilization mis-tagging and clean up
duplicate actor records left behind by it.

Root cause (see scripts/seed_chinese_data.py::_infer_civilization): seed_actors()
infers an actor's civilization from its bare *name* rather than from the
realm_code it is actually attached to. Names with no matching keyword fall
through to CHINESE. Because the wrong civilization is also used as part of
the update_or_create() lookup key, a wrong guess doesn't just mis-tag a row —
it can also miss an already-existing correctly-tagged row and insert a
second, orphaned one.

This command:
  1. Fixes the 3 known mis-tagged actors (civilization only — role/realm/
     tenant are left untouched).
  2. Resolves the known duplicate name-groups by keeping whichever row is
     actually referenced elsewhere (Judgment.judge, WorkflowNode.approver_actor,
     CrossTenantJudgmentParticipant.participant_actor, User.actor) and
     soft-deleting the rest.
  3. Merges same-entity-different-spelling pairs that step 2 cannot see
     because it matches on an exact name — currently "Maat" into "Ma'at".
     If only the non-canonical spelling exists, the row is renamed (which
     carries its references along); if both exist, the non-canonical row is
     soft-deleted only when nothing references it, and reported as a conflict
     otherwise.

Usage:
    python manage.py fix_actor_civilization              # dry-run (default)
    python manage.py fix_actor_civilization --execute     # apply changes
    python manage.py fix_actor_civilization --execute --backup-dir /path

Safe to re-run: rows already at the target civilization, or already
soft-deleted, are skipped.
"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.actors.models import Actor

# (name, wrong_civilization, correct_civilization)
MISTAG_FIXES = [
    ("Ma'at", "CHINESE", "EGYPTIAN"),
    ("Pluto", "CHINESE", "EUROPEAN"),
    ("Lethe", "CHINESE", "EUROPEAN"),
]

# Names with confirmed duplicate active rows (same name, same civilization
# after the fix above, two separate rows created by two different seed paths)
DUPLICATE_NAMES = ["Isis", "Nephthys", "Ammit", "Charon", "Gabriel", "Ra"]

# Same entity, two spellings, so the same-name dedupe above cannot see them.
# (duplicate_spelling, canonical_spelling, civilization)
#
# Ma'at: seed_mythology, scripts/seed_chinese_data.py, MISTAG_FIXES above,
# tests/test_seed_mythology.py and frontend/messages/*.json all spell the
# goddess "Ma'at" with the apostrophe; "Maat" appears only as a bare
# transliteration — in the Actor.name_egy column, and as one entry in
# scripts/populate_egyptian_actors.py's "42 Judges" roster, which is where the
# second row came from. The apostrophe spelling is therefore canonical and the
# "Maat" row is the one that gets merged away.
SPELLING_MERGES = [("Maat", "Ma'at", "EGYPTIAN")]

DEFAULT_BACKUP_DIR = Path(__file__).resolve().parents[4] / "scripts" / "backups"


def _reference_count(actor):
    """Count live references to this actor across all known FK relations."""
    return (
        actor.users.count()
        + actor.judgments_conducted.count()
        + actor.approvalnode_set.count()
        + actor.judgment_participations.count()
    )


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
        "Fix mis-tagged actor civilizations and soft-delete the duplicate "
        "rows the mis-tagging left behind. Defaults to a dry-run."
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
        self.stdout.write(self.style.WARNING(f"=== fix_actor_civilization ({mode}) ===\n"))

        affected = []  # snapshots collected for the backup file
        plan = []  # human-readable summary lines

        # ------------------------------------------------------------------
        # Step 1: civilization corrections
        # ------------------------------------------------------------------
        self.stdout.write(self.style.MIGRATE_HEADING("Step 1: civilization corrections"))
        civ_updates = []
        for name, wrong_civ, correct_civ in MISTAG_FIXES:
            actor = Actor.objects.filter(name=name, civilization=wrong_civ).first()
            if actor is None:
                # Either already fixed, or genuinely absent — check current state.
                already = Actor.objects.filter(name=name, civilization=correct_civ).first()
                if already:
                    self.stdout.write(f"  [skip] {name!r} already {correct_civ} (id={already.id})")
                else:
                    self.stdout.write(self.style.ERROR(
                        f"  [warn] {name!r} not found with civilization={wrong_civ} or {correct_civ} — skipping"
                    ))
                continue

            before = _snapshot(actor)
            affected.append({"action": "civilization_fix", "before": before})
            plan.append(f"UPDATE Actor(id={actor.id}, name={name!r}): civilization {wrong_civ} -> {correct_civ}")
            self.stdout.write(
                f"  {name!r} (id={actor.id}): civilization {wrong_civ} -> {correct_civ}"
                f"  [role={actor.role} realm={before['realm_code']} — unchanged]"
            )
            civ_updates.append((actor, correct_civ))

        # ------------------------------------------------------------------
        # Step 2: duplicate resolution
        # ------------------------------------------------------------------
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Step 2: duplicate resolution"))
        dedup_deletes = []
        for name in DUPLICATE_NAMES:
            rows = list(Actor.objects.filter(name=name))
            if len(rows) <= 1:
                self.stdout.write(f"  [skip] {name!r}: {len(rows)} active row(s) — nothing to dedupe")
                continue

            scored = sorted(
                rows,
                key=lambda a: (-_reference_count(a), a.created_at),
            )
            keeper = scored[0]
            losers = scored[1:]

            self.stdout.write(f"  {name!r}: {len(rows)} active rows")
            self.stdout.write(
                f"    KEEP   id={keeper.id} civ={keeper.civilization} role={keeper.role} "
                f"realm={keeper.realm.realm_code if keeper.realm else None} refs={_reference_count(keeper)}"
            )
            for loser in losers:
                before = _snapshot(loser)
                affected.append({"action": "soft_delete_duplicate", "before": before, "kept_id": str(keeper.id)})
                plan.append(f"SOFT-DELETE Actor(id={loser.id}, name={name!r}) — duplicate of {keeper.id}")
                self.stdout.write(
                    f"    DELETE id={loser.id} civ={loser.civilization} role={loser.role} "
                    f"realm={loser.realm.realm_code if loser.realm else None} refs={_reference_count(loser)}"
                )
                dedup_deletes.append(loser)

        # ------------------------------------------------------------------
        # Step 3: spelling merges (same entity, two spellings)
        # ------------------------------------------------------------------
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Step 3: spelling merges"))
        spelling_renames = []
        for dup_name, canonical_name, civ in SPELLING_MERGES:
            dup = Actor.objects.filter(name=dup_name, civilization=civ).first()
            canonical = Actor.objects.filter(name=canonical_name, civilization=civ).first()

            if dup is None:
                self.stdout.write(
                    f"  [skip] {dup_name!r} ({civ}) not present — nothing to merge into "
                    f"{canonical_name!r}"
                )
                continue

            if canonical is None:
                # `Actor.objects` hides soft-deleted rows, but the
                # unique_actor_tenant_civ_name constraint does not — a
                # soft-deleted "Ma'at" still occupies the name, and renaming
                # into it would raise IntegrityError mid-run.
                buried = Actor.all_objects.filter(
                    name=canonical_name, civilization=civ, is_deleted=True
                ).first()
                if buried is not None:
                    self.stdout.write(self.style.ERROR(
                        f"  [CONFLICT] cannot rename {dup_name!r} (id={dup.id}) to "
                        f"{canonical_name!r}: a soft-deleted row already holds that name "
                        f"(id={buried.id}, reason: {buried.delete_reason or 'none recorded'}). "
                        f"The unique constraint does not exclude deleted rows."
                    ))
                    self.stdout.write(self.style.ERROR(
                        "    ACTION REQUIRED: restore or hard-delete that row, then re-run."
                    ))
                    continue

                # Only the duplicate spelling exists. Renaming it IS the merge,
                # and it is the safest form of one: every FK pointing at the row
                # follows the row, so nothing has to be re-pointed and nothing
                # is deleted.
                before = _snapshot(dup)
                affected.append({"action": "spelling_rename", "before": before, "to": canonical_name})
                plan.append(
                    f"UPDATE Actor(id={dup.id}): name {dup_name!r} -> {canonical_name!r} "
                    f"(canonical spelling)"
                )
                self.stdout.write(
                    f"  {dup_name!r} (id={dup.id}): rename to {canonical_name!r} — no "
                    f"{canonical_name!r} row exists, so {_reference_count(dup)} reference(s) "
                    f"travel with the row"
                )
                spelling_renames.append((dup, canonical_name))
                continue

            refs = _reference_count(dup)
            self.stdout.write(f"  {dup_name!r}/{canonical_name!r} ({civ}): both rows exist")
            self.stdout.write(
                f"    KEEP   id={canonical.id} name={canonical.name!r} "
                f"role={canonical.role} refs={_reference_count(canonical)}"
            )
            if refs:
                # Deleting a referenced row would strand Judgment.judge /
                # User.actor on a row the app filters out. Report and stop.
                self.stdout.write(self.style.ERROR(
                    f"  [CONFLICT] {dup_name!r} (id={dup.id}) has {refs} live reference(s) — "
                    f"NOT deleting."
                ))
                self.stdout.write(
                    f"    users={list(dup.users.values_list('id', 'username'))} "
                    f"judgments={dup.judgments_conducted.count()} "
                    f"workflow_nodes={dup.approvalnode_set.count()} "
                    f"cross_tenant_participations={dup.judgment_participations.count()}"
                )
                self.stdout.write(self.style.ERROR(
                    f"    ACTION REQUIRED: re-point those references at Actor(id={canonical.id}, "
                    f"name={canonical_name!r}), then re-run."
                ))
                continue

            before = _snapshot(dup)
            affected.append({
                "action": "soft_delete_spelling_duplicate",
                "before": before,
                "kept_id": str(canonical.id),
            })
            plan.append(
                f"SOFT-DELETE Actor(id={dup.id}, name={dup_name!r}) — spelling duplicate of "
                f"{canonical_name!r} ({canonical.id})"
            )
            self.stdout.write(f"    DELETE id={dup.id} name={dup.name!r} refs=0")
            dedup_deletes.append(dup)

        # ------------------------------------------------------------------
        # Summary / apply
        # ------------------------------------------------------------------
        self.stdout.write("")
        if not civ_updates and not dedup_deletes and not spelling_renames:
            self.stdout.write(self.style.SUCCESS("Nothing to do — data is already correct."))
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
        backup_path = backup_dir / f"actor_civilization_fix_{timezone.now().strftime('%Y%m%dT%H%M%SZ')}.json"
        with open(backup_path, "w", encoding="utf-8") as f:
            json.dump(affected, f, ensure_ascii=False, indent=2)
        self.stdout.write(self.style.SUCCESS(f"\nBackup written to {backup_path}"))

        for actor, correct_civ in civ_updates:
            actor.civilization = correct_civ
            actor.save(update_fields=["civilization"])

        for actor, canonical_name in spelling_renames:
            actor.name = canonical_name
            actor.save(update_fields=["name"])

        for loser in dedup_deletes:
            loser.soft_delete(reason="Duplicate seed record from actor civilization mis-tagging fix")

        self.stdout.write(self.style.SUCCESS(
            f"\nApplied: {len(civ_updates)} civilization fix(es), "
            f"{len(spelling_renames)} spelling rename(s), {len(dedup_deletes)} soft-delete(s)."
        ))
