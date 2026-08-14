"""
Put the misplaced gods where their sources put them, on databases that already
have a cosmology.

What was wrong
--------------
Fourteen actors across three civilizations stood in a realm no source supports,
and two Egyptian realms asserted places that do not exist. None of it was
caught, because the two things watching this data —
``consolidate_eu_pantheon``'s Greco-Roman audit and
``tests/test_seed_mythology.py`` — both locked an actor's *role* and said
nothing about its *realm*. Every placement below passed as OK for months. The
audit and the test now check both columns; this migration is the data half of
that repair, and ``seed_mythology`` is the other half.

Greco-Roman and Christian:

* **Minos** sat in the ninth circle carrying a description of second-circle
  work ("assigns souls to their hell-circle"). Allotting the circle is
  precisely what Dante's Minos does at the entrance to the second (Inf.
  V.4-15); a judge who allots circles cannot be sitting in the last one.
* **Aeacus** and **Rhadamanthus** sat in the ninth circle too — with Satan, who
  is also seeded there. Neither appears in the *Commedia* at all. Their
  division of labour is Plato's (Gorgias 524a), and Plato's judgment happens at
  a fork in a meadow, *before* punishment. There is no ninth circle in Plato;
  the layering is Dante's.
* **Charon** sat in Purgatory. Dante's purgatorial boatman is an angel (Purg.
  II); Charon works Acheron at the gate of hell (Inf. III), as in Virgil (Aen.
  6.295-297).
* **Cerberus** sat in the first circle. Dante sets him over the gluttons in the
  third (Inf. VI); the Greek tradition has him at the gate of the underworld
  itself. Neither is Limbo.
* **Hades** sat in Limbo, which has no basis in any text — Dante has no "Hades'
  level", and his Dis is the walled city of the sixth circle and Lucifer.
* **Michael** was a JUDGE on the strength of weighing souls, which is medieval
  iconography borrowed from Egyptian *psychostasia* rather than scripture or
  doctrine; his liturgical office is to lead (*signifer sanctus Michael
  repraesentet eas in lucem sanctam*). **Satan** was a JUDGE too, and is the
  accuser in theology (Rev 12:10) and an instrument of punishment in Dante
  (Inf. XXXIV) — neither is a judge. **Christ**, whom the creed names as the
  judge, was in no table at all.

Egyptian — six of nine were in the wrong room:

* **Horus** was a GUARDIAN at the gate of the Duat. In both the Ani and Hunefer
  papyri he takes the vindicated dead by the hand *in the Hall* and leads him
  to Osiris: CONDUIT, in ``EG_HALL_TWO_TRUTHS``.
* **Isis**, **Nephthys** and **Ra** were in the Field of Reeds, which is where
  the acquitted go *after* the judgment these three attend.
* **Ammit** was in a realm named after her. She stands at the balance in the
  Hall in every standard vignette.
* **Ma'at** was a JUDGE. Her feather is the counterweight in the pan — she is
  the standard the heart is measured against, not a member of the bench.

Chinese:

* **孟婆** was in the holding pen, serving the broth of forgetting to souls
  *awaiting* judgment — which would have them face their court with no memory
  of the life being tried. 《玉历宝钞》 puts her 醧忘台 「居第十殿，冥王殿前六桥
  之外」 and the broth after sentence. The repo's own tenth-court realm row
  already said so, so the two tables contradicted each other.

What this does
--------------
1. **Creates two Greek realms.** ``EU_ACHERON`` (the crossing, Virgil *Aen.*
   6.295-297 / Dante *Inf.* III) and ``EU_PLATO_MEADOW`` (the fork, Plato
   *Gorg.* 524a). They exist because the Greek cast had no Greek place to stand
   in: all eleven European realms were Christian or Dantean, so every Greek
   figure had been filed into whichever Dantean row looked nearest. Only the
   identifying columns are written here; ``seed_mythology --update`` owns the
   prose, for the same reason ``realms/0012`` gave — a migration carrying the
   descriptions would be a second copy of ``EUROPEAN_REALMS`` that nothing
   keeps in step.

2. **Retires ``EG_AM_TYAT``** by soft-delete. "Amtyat" is not an Egyptian
   place: it is absent from Budge's Book of the Dead glossary, from *Egyptian
   Heaven and Hell* vol. II, from UCL Digital Egypt, from museum records and
   from general search. The likely origins are *Am-Tuat* — the title of a book,
   the Amduat — or *Amentet*, "the West", i.e. a book or a direction mistaken
   for a border realm. Soft-delete, not hard: ``Realm.objects`` filters it out
   of pickers and routing while ``all_objects`` and any existing ForeignKey
   still resolve it, exactly as ``realms/0012`` retired the three 小地狱.

3. **Repoints fourteen actors and re-roles five**, by name. This cannot be left
   to the seeder: ``seed_mythology`` is create-only by default, so on an
   existing database it would leave every one of them where it is and report
   "exists, differs — left as-is". A fresh database gets the corrected data
   straight from the seed tables and this migration writes nothing to it.

What this deliberately does NOT do
----------------------------------
* **``EG_DEVOURER`` is not renamed.** Modelling annihilation as a realm is
  wrong — being devoured by Ammit is the second death, the person ceases to
  exist, there is nowhere to go — and the honest code would be
  ``EG_ANNIHILATION``. But that string is a live identifier, not a label:
  ``DispositionService`` routes every failed Egyptian heart to it, executed
  dispositions record it as their destination, and
  ``frontend/src/components/souls/SoulLifecycleTimeline.tsx`` hard-codes
  ``realm_code === "EG_DEVOURER"`` as its only signal that a soul was
  annihilated. Renaming it is a coordinated backend+frontend change, not a
  one-liner; renaming it here alone would silently stop the annihilation state
  rendering. What the row *claims* is corrected in the seed tables instead —
  its name and description now say it is an outcome and not Ammit's address —
  and Ammit herself moves back to the Hall below, which is the part that is
  unambiguous.
* **Christ is not created here.** He is a new row with no predecessor to
  migrate, so he belongs to the seeder, which creates him on any database it
  is run against — including existing ones, since creation does not need
  ``--update``.
* **Dispositions and reincarnations are not rewritten.** A disposition that
  recorded "this soul went to EG_AM_TYAT" is a record of a sentence that was
  actually passed. Repointing it would forge the history to tidy the reference
  data — the same rule ``realms/0012`` applied to the retired 小地狱.

Reversibility
-------------
``backwards`` puts every actor back on the realm and role it had, undeletes
``EG_AM_TYAT``, and deletes the two realms it created — in that order, so that
nothing is still pointing at a row when it is removed. Round-tripping
``migrate realms 0013`` / ``migrate realms 0012`` leaves the placements 0012's
world had.

All row access goes through ``_base_manager``: ``Realm.objects`` and
``Actor.objects`` are soft-delete-filtered, and step 2 soft-deletes a row this
migration must still find on reverse.
"""
from django.db import migrations

# (realm_code, civilization, realm_type, tier, name_local, name_zh, name_en,
#  name_egy, memory_reset_mechanism). Identifying columns only — the seeder owns
# the descriptions.
NEW_REALMS = [
    ("EU_ACHERON", "EUROPEAN", "NEUTRAL", 0,
     "阿刻戎渡口", "冥河渡口", "The Crossing of Acheron", "Acheron", "NONE"),
    ("EU_PLATO_MEADOW", "EUROPEAN", "NEUTRAL", 0,
     "岔路草原", "审判岔路", "The Meadow at the Parting of the Ways", "Meadow", "NONE"),
]

RETIRED_REALMS = ["EG_AM_TYAT"]
RETIRE_REASON = (
    "Unattested. 'Amtyat' is not an Egyptian place — absent from Budge's Book "
    "of the Dead glossary, from Egyptian Heaven and Hell II, from UCL Digital "
    "Egypt, from museum records and from search. Most likely Am-Tuat (a book "
    "title, the Amduat) or Amentet ('the West') turned into a border realm. "
    "Retired by realms/0013."
)

# actor name -> (civilization, realm before, realm after). One entry per actor
# whose posting changes. `None` before means the row had no realm.
ACTOR_MOVES = {
    "Minos": ("EUROPEAN", "EU_HELL_9TH", "EU_HELL_2ND"),
    "Aeacus": ("EUROPEAN", "EU_HELL_9TH", "EU_PLATO_MEADOW"),
    "Rhadamanthus": ("EUROPEAN", "EU_HELL_9TH", "EU_PLATO_MEADOW"),
    "Charon": ("EUROPEAN", "EU_PURGATORY", "EU_ACHERON"),
    "Cerberus": ("EUROPEAN", "EU_HELL_1ST", "EU_HELL_3RD"),
    "Hades": ("EUROPEAN", "EU_HELL_1ST", "EU_PLATO_MEADOW"),
    "Horus": ("EGYPTIAN", "EG_DUAT_ENTRY", "EG_HALL_TWO_TRUTHS"),
    "Isis": ("EGYPTIAN", "EG_AARU", "EG_HALL_TWO_TRUTHS"),
    "Nephthys": ("EGYPTIAN", "EG_AARU", "EG_HALL_TWO_TRUTHS"),
    "Ra": ("EGYPTIAN", "EG_AARU", "EG_HALL_TWO_TRUTHS"),
    "Ammit": ("EGYPTIAN", "EG_DEVOURER", "EG_HALL_TWO_TRUTHS"),
    "孟婆": ("CHINESE", "DY_00_PURGATORY", "DY_COURT_10_ZHUANLUN"),
}

# actor name -> (civilization, role before, role after).
ACTOR_ROLES = {
    "Michael": ("EUROPEAN", "JUDGE", "CONDUIT"),
    "Satan": ("EUROPEAN", "JUDGE", "EXECUTOR"),
    "Horus": ("EGYPTIAN", "GUARDIAN", "CONDUIT"),
    "Ma'at": ("EGYPTIAN", "JUDGE", "GUARDIAN"),
}


def _move_actors(apps, direction):
    """Repoint actors. `direction` is 'after' going forwards, 'before' on reverse.

    An actor whose current realm is not the one this migration expects is left
    alone. That is not caution for its own sake: a deployment may have moved a
    row by hand, and overwriting an unexpected posting would destroy a decision
    somebody made without ever saying so. The skip is silent by necessity
    (migrations have no reporting channel) but recoverable — the audit and the
    test both name the actor and both realms when this happens.
    """
    actor_model = apps.get_model("actors", "Actor")
    realm_model = apps.get_model("realms", "Realm")
    by_code = {r.realm_code: r.pk for r in realm_model._base_manager.all()}

    for name, (civilization, before, after) in ACTOR_MOVES.items():
        source, target = (before, after) if direction == "after" else (after, before)
        target_pk = by_code.get(target)
        if target_pk is None:
            # The destination realm is absent on this database. Leave the actor
            # where it is rather than nulling a posting that cannot be restored.
            continue
        actor_model._base_manager.filter(
            name=name,
            civilization=civilization,
            realm__realm_code=source,
        ).update(realm=target_pk)


def _set_roles(apps, direction):
    actor_model = apps.get_model("actors", "Actor")
    for name, (civilization, before, after) in ACTOR_ROLES.items():
        source, target = (before, after) if direction == "after" else (after, before)
        actor_model._base_manager.filter(
            name=name, civilization=civilization, role=source
        ).update(role=target)


def forwards(apps, schema_editor):
    from django.utils import timezone

    realm = apps.get_model("realms", "Realm")

    # A database with no cosmology yet gets nothing written to it. Populating a
    # fresh install is `seed_mythology`'s job, and a migration that half-seeds
    # ahead of it hands the seeder rows it did not create — untenanted, and
    # present on a database `seed_mythology --dry-run` is entitled to find
    # empty. realms/0012 learned this the hard way; see its guard.
    if not realm._base_manager.exists():
        return

    # 1. The two Greek realms. Tenant is taken from a sibling European realm so
    #    they do not land unowned and invisible to EU_HEAVEN_HELL; if the
    #    siblings are themselves untenanted these inherit that, and the seeder
    #    fills it in on its next run. Guessing a tenant code here would file
    #    rows under an owner nobody has named.
    sibling = (
        realm._base_manager.filter(civilization="EUROPEAN")
        .exclude(tenant__isnull=True)
        .first()
    )
    tenant_id = sibling.tenant_id if sibling else None
    if realm._base_manager.filter(civilization="EUROPEAN").exists():
        for (realm_code, civilization, realm_type, tier, name_local, name_zh,
             name_en, name_egy, memory_reset) in NEW_REALMS:
            realm._base_manager.get_or_create(
                realm_code=realm_code,
                defaults={
                    "civilization": civilization,
                    "realm_type": realm_type,
                    "tier": tier,
                    "name_local": name_local,
                    "name_zh": name_zh,
                    "name_en": name_en,
                    "name_egy": name_egy,
                    "memory_reset_mechanism": memory_reset,
                    "is_eternal": False,
                    "is_judgment_required": False,
                    "tenant_id": tenant_id,
                },
            )

    # 2. Move the actors, before anything is retired, so nobody is left standing
    #    on a tombstone. (Nothing is seeded into EG_AM_TYAT today, but an actor
    #    put there by hand would be.)
    _move_actors(apps, "after")
    _set_roles(apps, "after")

    # 3. Retire EG_AM_TYAT.
    realm._base_manager.filter(realm_code__in=RETIRED_REALMS).update(
        is_deleted=True,
        deleted_at=timezone.now(),
        delete_reason=RETIRE_REASON,
    )


def backwards(apps, schema_editor):
    realm = apps.get_model("realms", "Realm")

    # Reverse of 3.
    realm._base_manager.filter(realm_code__in=RETIRED_REALMS).update(
        is_deleted=False, deleted_at=None, delete_reason=""
    )

    # Reverse of 2. Must run before the realms are deleted: the actors are still
    # pointing at EU_ACHERON and EU_PLATO_MEADOW, and deleting those rows first
    # would SET_NULL the postings this step exists to restore.
    _set_roles(apps, "before")
    _move_actors(apps, "before")

    # Reverse of 1, last. Deleted rather than soft-deleted: 0012's world has no
    # such realm at all, and a tombstone it does not know about is not the same
    # thing as absence.
    realm._base_manager.filter(
        realm_code__in=[row[0] for row in NEW_REALMS]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("realms", "0012_ten_courts"),
        # Actor.realm and Actor.role are rewritten here. Pinned to the migration
        # that installs `all_objects` as the base manager, so `_base_manager` on
        # the historical model is the unfiltered one and not the soft-delete one.
        ("actors", "0008_actor_delete_cascade_id"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
