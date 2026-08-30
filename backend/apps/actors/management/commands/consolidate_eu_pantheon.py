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

  1. Pluto/Hades merge: same deity, two rows, two OVERSEERs. (Not quite "the
     Roman name", as this file used to say: Πλούτων is a Greek cult title from
     πλοῦτος, wealth — Plato, Cratylus 403a — and Latin Pluto transcribes it.
     Rome's own underworld gods are Dis Pater and Orcus. The merge is right;
     what it folds is two cult aspects of one Greek god.) Before merging, live
     references (User.actor,
     Judgment.judge, WorkflowNode.approver_actor,
     CrossTenantJudgmentParticipant.participant_actor) are checked. If only
     one row is referenced (or neither), the unreferenced/lesser-referenced
     row is soft-deleted, and on a tie Hades is the survivor by name — the
     Greek name is the canonical one, so the outcome does not depend on
     which row happened to be inserted first. If BOTH are referenced, this
     command does NOT merge — it reports the conflict and leaves both rows
     untouched, so a human can decide how to migrate the reference.

  2. Greco-Roman completeness audit (read-only): confirms each of the seven is
     present, holds its role, AND STANDS IN ITS REALM. Deviations are printed,
     nothing is changed. `seed_mythology` seeds exactly this cast, so a freshly
     seeded database passes this audit clean.

     IT IS TWO TABLES SINCE GREEK BECAME ITS OWN CIVILIZATION. The audit looks
     rows up by `(name, civilization)`, so the split moved four of the six names
     out from under the query without touching the data: Hades, Aeacus and
     Rhadamanthus are GREEK now, and Plato's Minos is a new GREEK row alongside
     Dante's EUROPEAN one. A single six-name table would have reported three
     MISSING on every correctly-seeded database — which is precisely the state
     this audit was in before those three were seeded at all, and the reason
     that failure is worth naming twice. `GREEK_EXPECTED` is checked against
     GREEK and `GRECO_ROMAN_EXPECTED` against EUROPEAN; a deviation line says
     which civilization it is about, because "Minos: wrong realm" no longer
     identifies a row.

     THE REALM HALF OF THAT CHECK IS NEW, AND ITS ABSENCE IS WHY THIS AUDIT
     REPORTED OK FOR SO LONG OVER DATA THAT WAS WRONG. Until 2026-08-15 the
     expectation was a name -> role mapping and nothing else, and
     tests/test_seed_mythology.py's copy of it had the same shape. Every one of
     the following passed the audit clean: Minos in the ninth circle when
     Dante's Minos allots circles from the entrance to the second (Inf.
     V.4-15); Aeacus and Rhadamanthus in the ninth circle, a place that exists
     in Dante — who does not use either of them — and not in Plato, who is
     where their division of labour comes from (Gorg. 524a, a fork in a meadow
     before any punishment); Charon in Purgatory, when Dante's purgatorial
     boatman is an angel and Charon works Acheron at the gate of hell (Inf.
     III); Cerberus in the first circle when Dante sets him over the gluttons
     in the third (Inf. VI); Hades in Limbo, which has no basis in any text.
     Six actors, five wrong placements, and a green audit over all of them —
     because the audit was only ever asked about roles, and the roles were
     right. An audit that checks one column of a two-column fact reports
     success at exactly the rate the unchecked column goes wrong.

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
GREEK_TENANT_CODE = "GR_HADES"

# Norse actors that historical databases may still hold. No seed path creates
# them; --purge-norse soft-deletes whichever of them are found, after the
# live-reference check. No Norse realm (Valhalla / Fólkvangr / Helheim) has
# ever existed in this system, so these rows are typically mistagged onto the
# Christian EU_HEAVEN realm or onto one of Dante's circles.
NORSE_NAMES = ["Odin", "Freya", "Hel", "Valkyries"]

MERGE_NAMES = ("Pluto", "Hades")
# On a reference-count tie the Greek name wins. Without this the survivor was
# decided by created_at, i.e. by seed insertion order, while the soft-delete
# reason written to the database claimed unconditionally that the row was
# "merged into Hades".
MERGE_SURVIVOR = "Hades"

# name -> (role, realm_code). BOTH halves are checked. Adding the realm column
# is the whole point of these tables: see the note in the module docstring for
# the five misplacements a role-only expectation waved through for months.
#
# THERE ARE TWO TABLES NOW, AND THE SPLIT IS NOT COSMETIC. This audit queries by
# `civilization`, so when GREEK stopped being a value of EUROPEAN, a single
# six-name table would have reported Hades, Aeacus and Rhadamanthus MISSING on
# every correctly-seeded database — the exact failure mode the audit's own
# docstring records it having had before those three were seeded at all. Each
# table is checked against the civilization its rows actually live in.
#
# Each entry is the placement a source supports, and the source is on the actor
# row in the corresponding mythology module:
#
# EUROPEAN — the three Dante borrowed, in apps.actors.mythology.actors_european:
#   Minos        EU_HELL_2ND      Dante, Inferno V.4-15 — he allots the circle
#                                 from the entrance to the second.
#   Charon       EU_ACHERON       Virgil, Aeneid 6.295-297; Dante, Inferno III.
#   Cerberus     EU_HELL_3RD      Dante, Inferno VI — over the gluttons.
#
# GREEK — in apps.actors.mythology.actors_greek:
#   Hades        EU_PLATO_MEADOW  overseer of the Greek judgment ground. The one
#                                 engineering placement here: no house of Hades
#                                 is modelled, and Limbo was not a substitute.
#                                 The realm keeps its EU_ code, which records
#                                 where it was written and not what owns it.
#   Aeacus       EU_PLATO_MEADOW  Plato, Gorgias 524a — tries those from Europe.
#   Rhadamanthus EU_PLATO_MEADOW  Plato, Gorgias 524a — tries those from Asia.
#   Minos        EU_PLATO_MEADOW  Plato, Gorgias 524a — the final decision when
#                                 the other two are in doubt. A DIFFERENT ROW
#                                 from the EUROPEAN Minos above and a different
#                                 office; both are audited, and a database that
#                                 has only one of them fails here naming which.
#
# Kept in sync by hand with tests/test_seed_mythology.py's GRECO_ROMAN_CAST and
# GREEK_CAST, which are a deliberate second copy — importing these would make
# that test ratify whatever this file happens to say.
GRECO_ROMAN_EXPECTED = {
    "Minos": (ActorRole.JUDGE, "EU_HELL_2ND"),
    "Charon": (ActorRole.CONDUIT, "EU_ACHERON"),
    "Cerberus": (ActorRole.GUARDIAN, "EU_HELL_3RD"),
}

GREEK_EXPECTED = {
    "Hades": (ActorRole.OVERSEER, "EU_PLATO_MEADOW"),
    "Aeacus": (ActorRole.JUDGE, "EU_PLATO_MEADOW"),
    "Rhadamanthus": (ActorRole.JUDGE, "EU_PLATO_MEADOW"),
    "Minos": (ActorRole.JUDGE, "EU_PLATO_MEADOW"),
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

    @staticmethod
    def _audit(queryset, civilization, expected):
        """One civilization's cast, as a list of deviation lines (empty = OK).

        `civilization` is part of the lookup and not decoration: two rows are
        named Minos — Dante's under EUROPEAN and Plato's under GREEK — and a
        name-only match would return whichever came first and then report the
        other one's realm as a deviation. `(name, civilization)` is the pair
        `unique_actor_tenant_civ_name` and `seed_mythology`'s upsert both key
        on, so it is the pair that identifies a row here too.
        """
        cast = queryset.filter(civilization=civilization)
        deviations = []
        for name, (expected_role, expected_realm) in expected.items():
            # Live rows only. A soft-deleted Hades is not a present Hades, and
            # reporting it as one would make this audit pass over exactly the
            # damage it exists to catch. The queryset is built from all_objects
            # so the merge step can see deleted rows.
            actor = cast.filter(name=name, is_deleted=False).first()
            if actor is None:
                soft_deleted = cast.filter(name=name, is_deleted=True).exists()
                deviations.append(
                    f"{civilization} {name}: MISSING (soft-deleted row exists)"
                    if soft_deleted else f"{civilization} {name}: MISSING"
                )
                continue
            # Role and realm are reported separately and both are reported, so a
            # row that is wrong twice says so twice rather than hiding the
            # second fault behind the first. Every message names who, where they
            # should be, and where they actually are — a deviation line that
            # only said "Minos: wrong realm" would send the reader back to this
            # file to find out what right looks like, and with two Minoses it
            # would not even say which one.
            if actor.role != expected_role:
                deviations.append(
                    f"{civilization} {name}: role={actor.role}, expected {expected_role}"
                )
            found_realm = actor.realm.realm_code if actor.realm else None
            if found_realm != expected_realm:
                deviations.append(
                    f"{civilization} {name}: belongs in realm {expected_realm}, "
                    f"found in {found_realm or 'no realm at all'}"
                )
        return deviations

    def handle(self, *args, **options):
        execute = options["execute"]
        purge_norse = options["purge_norse"]
        backup_dir = Path(options["backup_dir"])

        mode = "EXECUTE" if execute else "DRY-RUN"
        self.stdout.write(self.style.WARNING(f"=== consolidate_eu_pantheon ({mode}) ===\n"))

        # The European cast, and the Greek one that used to be part of it.
        #
        # Steps 1 and 3 look across BOTH, deliberately. Pluto and the Norse
        # leftovers are rows on databases that predate the GREEK split, so they
        # carry `civilization="EUROPEAN"` and the `EU_HEAVEN_HELL` tenant, while
        # the Hades that Pluto has to be merged into is GREEK and owned by
        # `GR_HADES` on any database that has run realms/0018. Scoping the merge
        # to one tenant would have found one active row on each side of the
        # split, reported "nothing to merge", and left the duplicate standing —
        # a cleanup command that stops working the moment the data it cleans up
        # is spread across the boundary it was spread across by.
        tenant_actors = Actor.all_objects.filter(
            tenant__code__in=(TENANT_CODE, GREEK_TENANT_CODE),
            civilization__in=("EUROPEAN", "GREEK"),
        )

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
                # The survivor is always MERGE_SURVIVOR. It used to be
                # "most-referenced row wins, Greek name breaks the tie", and
                # that ordering is unstable in a way that only shows up once
                # somebody restores the retired row:
                #
                #   Pluto restored and referenced by one account, Hades
                #   referenced by none -> `-refs` puts Pluto first -> **Hades
                #   is soft-deleted**, reversing a documented merge, and the
                #   row left standing carries the Roman name.
                #
                # The Greek name winning outright is the decision this command
                # was written to carry out; letting a reference count override
                # it means an account can decide lore. So the order is fixed,
                # and a reference on the row being retired is handled by
                # refusing rather than by changing who survives -- repointing
                # an account onto a row in another tenant is exactly the kind
                # of cross-tenant link this codebase spends its effort closing.
                scored = sorted(
                    active_rows.values(),
                    key=lambda a: (a.name != MERGE_SURVIVOR, a.created_at),
                )
                keeper, loser = scored[0], scored[1]

                if refs[loser.name] > 0:
                    users = _referencing_users(loser)
                    self.stdout.write(self.style.ERROR(
                        f"  [CONFLICT] {loser.name} (id={loser.id}) is referenced by "
                        f"users {users} and is the row this merge would retire."
                    ))
                    self.stdout.write(self.style.ERROR(
                        "  ACTION REQUIRED: decide where those accounts should point "
                        f"(note that {keeper.name} lives in a different tenant), then "
                        "clear the reference and re-run. No changes made to either row."
                    ))
                    merge_delete = None
                    keeper = loser = None
                elif keeper is not None:
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
        deviations = [
            *self._audit(tenant_actors, "EUROPEAN", GRECO_ROMAN_EXPECTED),
            *self._audit(tenant_actors, "GREEK", GREEK_EXPECTED),
        ]
        if deviations:
            self.stdout.write(self.style.ERROR("  Deviations found:"))
            for d in deviations:
                self.stdout.write(f"    - {d}")
            self.stdout.write(self.style.ERROR(
                "  On an existing database, `manage.py seed_mythology --update` "
                "reconciles these — the seeder is create-only by default and "
                "will not move an actor that is already there. A whole "
                "civilization reported MISSING usually means realms/0018 has "
                "not been applied and the Greek rows are still filed as "
                "EUROPEAN."
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                "  OK — EUROPEAN: Dante's Minos is JUDGE at the second circle, "
                "Charon is CONDUIT on Acheron, Cerberus is GUARDIAN over the "
                "gluttons. GREEK: Hades is sole OVERSEER and Aeacus, "
                "Rhadamanthus and Plato's Minos are JUDGE at the fork. All "
                "seven stand in the realm their source puts them in."
            ))

        lethe = tenant_actors.filter(name="Lethe").first()
        if lethe:
            self.stdout.write(
                f"  Lethe: civilization={lethe.civilization} realm={lethe.realm.realm_code if lethe.realm else None} "
                f"role={lethe.role} — Purgatory placement matches Dante's Purgatorio "
                f"(Lethe sits atop Mount Purgatory, Purg. XXVIII); no change made. "
                f"Lethe is outside both expectation tables because he is a river "
                f"modelled as an actor, not one of the cast the merge concerns — "
                f"and he stays EUROPEAN through the GREEK split, because what "
                f"this row holds is Dante's Lethe and not Virgil's."
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
            merge_delete.soft_delete(reason=(
                "Merged into Hades — Plouton is a Greek cult title of Hades and "
                "Pluto is its Latin transcription (Rome's own underworld gods "
                "are Dis Pater and Orcus); EU pantheon consolidation"
            ))

        for actor in norse_deletes:
            actor.soft_delete(
                reason="Norse removed from this system — no judgment concept; EU pantheon consolidation"
            )

        self.stdout.write(self.style.SUCCESS(
            f"\nApplied: {1 if merge_delete else 0} merge soft-delete(s), "
            f"{len(norse_deletes)} Norse soft-delete(s)."
        ))
