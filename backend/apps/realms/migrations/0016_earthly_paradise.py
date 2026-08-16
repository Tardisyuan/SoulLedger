"""
Put Lethe where Dante puts it, and take it off the ten places it never was.

What was wrong
--------------
Two errors, one cause: ``memory_reset_mechanism="LETHE"`` was applied to the
European cosmology as a property of the *civilization* rather than of a place,
and the actor that is the river was hung on the largest European row that
looked purgatorial.

1. **All eleven original European realms carried LETHE**, the nine circles and
   heaven included. For the circles this asserts the opposite of what the
   *Inferno* is: Dante's damned keep their memories, and the poem is largely
   made of them — Francesca tells the story of the book and the kiss (Inf. V),
   Ulysses his last voyage (Inf. XXVI), Ugolino the tower and the door (Inf.
   XXXIII). Farinata gives the mechanics outright (Inf. X.100-108): the damned
   see the distant future and are blind to the present, so memory of the world
   is the one link to it they still have. A damned soul that had drunk Lethe
   would not know what it was being punished for. For heaven it is wrong the
   other way: the blessed remember (Piccarda, Par. III; Justinian, Par.
   VI; Cacciaguida, Par. XV-XVII), and in any case Lethe is two realms below —
   a soul arrives already washed, so the field would be recording something
   that happened somewhere else. The project's own ``docs/01`` comparison table
   already said 「基督教 记忆消除=否」 while these rows said LETHE; one of the
   two had to give, and it was the rows.

2. **Lethe stood on ``EU_PURGATORY``** — the whole mountain, which since
   ``realms/0014`` has seven terraces hanging off it. That put the river on
   every terrace, i.e. on exactly the seven places a soul still needs the
   memory of the life it is doing penance for. Dante is specific: Matelda keeps
   the two streams in the Earthly Paradise at the *summit*, above the seventh
   terrace (Purg. XXVIII); Dante is drawn through Lethe after his confession
   (XXXI) and given Eunoè last of all (XXXIII).

``0014`` already declined to copy the error onto the terraces and said in as
many words where the water actually is. This is the rest of that repair.

What this does
--------------
1. **Creates ``EU_EARTHLY_PARADISE``**, ``tier`` 8, parented to
   ``EU_PURGATORY``. ``tier`` on this mountain is the position in the ascent —
   1..7 are the terraces — so 8 is what says "above all seven"; it does not
   make this an eighth terrace, and there is none (``EU-DS-T1..T7`` stop at
   seven because the eighth thing on the mountain is not a sin). ``realm_type``
   is PURGATORY because this is part of Mount Purgatory: BLISS would claim it
   is the beatitude, which is ``EU_HEAVEN``, and NEUTRAL would file Eden beside
   the ferry crossing as another waypoint.

   Only the identifying columns are written here. ``seed_mythology`` owns the
   prose, for the reason ``realms/0012``, ``0013`` and ``0014`` all gave: a
   migration carrying the description would be a second copy of
   ``EUROPEAN_REALMS`` that nothing keeps in step. ``is_judgment_required`` is
   deliberately not set, so the row takes the model default and a migrated
   database matches a freshly seeded one in a column nothing reconciles —
   ``0014``'s rule, for ``0014``'s reason.

2. **Moves Lethe onto it.** This cannot be left to the seeder:
   ``seed_mythology`` is create-only by default, so on an existing database it
   would report "exists, differs on [realm] — left as-is" and the river would
   stay on the mountain. Same reason ``realms/0013`` had to move fourteen
   actors itself.

3. **Sets the nine circles and heaven to NONE**, matched on their current value
   being LETHE. A row somebody has changed by hand to something else is left
   alone — the same rule ``0013``'s ``_move_actors`` applies to a posting it
   does not recognise, and what makes this reversible exactly rather than
   approximately.

What this deliberately does NOT do
----------------------------------
* **``EU_PURGATORY`` keeps LETHE, and keeps everything else.** It is not a
  level, it is the whole ascent, and the ascent ends in the water: a soul
  admitted to the mountain leaves it by being drawn through Lethe and Eunoè at
  the summit and by no other exit. Clearing it would make the destination
  ``DispositionService._route_european`` sends every PURGATORY and RETRY
  verdict to say that no memory reset happens on a mountain whose own
  description names both rivers. It also stays the routing destination and
  stays unparented — the summit is what it contains, not what it becomes.

* **Eunoè is not created here.** She is a new row with no predecessor to
  migrate, and ``seed_mythology`` creates missing rows on any database it is
  run against without needing ``--update`` — the division ``0013`` used for
  Christ and ``0014`` for ``EU-DS-T1..T7``.

* **Nothing in ``disposition`` is rewritten.** ``Disposition.memory_reset`` is
  a record of a sentence that was actually carried out. Rewriting it to match
  corrected reference data would forge the history to tidy the vocabulary —
  ``realms/0012``'s rule, applied again.

Empty-database guard
--------------------
A database with no European cosmology is a fresh install: there is nothing to
move and nothing to correct, and populating it is ``seed_mythology``'s job.
``0014`` and ``0015`` carry the same guard for the same reason.

Reversibility
-------------
``backwards`` restores LETHE on the ten rows, moves Lethe back onto the
mountain, and *then* deletes ``EU_EARTHLY_PARADISE`` — in that order, because
``Actor.realm`` is ``SET_NULL`` and deleting the summit first would silently
destroy the posting the step before it exists to restore. That is precisely how
``realms/0012`` lost five kings, and why ``backend/tests/migration_roundtrip.py``
compares data rather than exit status;
``backend/tests/test_earthly_paradise.py`` runs this migration forward → back →
forward through it.

Two things reverse cannot do, both recorded rather than worked around:

* On a database seeded *after* this migration, Eunoè exists and stands on the
  summit. The reverse deletes the summit, so her ``realm`` becomes NULL —
  ``0015``'s world has no place for her, and inventing one would be the reverse
  deciding something. ``seed_mythology --update`` restores it once the
  migration is re-applied. Same shape as ``0014``'s reverse leaving
  ``EU-DS-T1..T7`` pointing at terraces that no longer exist.
* Also on such a database the ten rows are already NONE, having been seeded
  from the corrected table, and the reverse writes LETHE onto them regardless —
  "what these realms said at migration 0015" is exactly what reverse restores,
  and skipping them would make the result depend on which run created the row.
  ``0015`` documents the identical asymmetry for its rename.

All row access goes through ``_base_manager``: ``Realm.objects`` and
``Actor.objects`` are tenant-scoped and soft-delete-filtered, and under a
migration there is no tenant in context — they would report a silent success
over an untouched table.
"""
from django.db import migrations

SUMMIT_CODE = "EU_EARTHLY_PARADISE"
MOUNTAIN_CODE = "EU_PURGATORY"

# Identifying columns only — the seeder owns the description. Shaped like
# realms/0013's NEW_REALMS and realms/0014's TERRACES.
SUMMIT = {
    "civilization": "EUROPEAN",
    "realm_type": "PURGATORY",
    # Above the seventh terrace. Not an eighth terrace; see the docstring.
    "tier": 8,
    "name_local": "地上乐园",
    "name_zh": "地上乐园",
    "name_en": "The Earthly Paradise",
    "name_egy": "EarthlyParadise",
    # The one European row besides the mountain that resets memory, and the
    # only one where the water physically is.
    "memory_reset_mechanism": "LETHE",
    "is_eternal": False,
}

# actor name -> (civilization, realm before, realm after). One entry, and the
# same structure realms/0013 used, so a second river or a second move is added
# to a table rather than to the body of a function.
ACTOR_MOVES = {
    "Lethe": ("EUROPEAN", MOUNTAIN_CODE, SUMMIT_CODE),
}

# The nine circles and heaven. EU_PURGATORY is deliberately absent — see the
# docstring — and so are the seven terraces, which realms/0014 already created
# with NONE.
MEMORY_RESET_CORRECTED = [
    "EU_HEAVEN",
    "EU_HELL_1ST", "EU_HELL_2ND", "EU_HELL_3RD", "EU_HELL_4TH", "EU_HELL_5TH",
    "EU_HELL_6TH", "EU_HELL_7TH", "EU_HELL_8TH", "EU_HELL_9TH",
]
MEMORY_RESET_BEFORE = "LETHE"
MEMORY_RESET_AFTER = "NONE"


def _move_actors(apps, direction):
    """Repoint the river(s). `direction` is 'after' forwards, 'before' back.

    An actor whose current realm is not the one this migration expects is left
    where it is: a deployment may have moved it by hand, and overwriting an
    unexpected posting would destroy a decision nobody recorded. Copied from
    realms/0013 for that reason, including the silence — a migration has no
    reporting channel, and `consolidate_eu_pantheon` names the actor and both
    realms when it audits.
    """
    actor = apps.get_model("actors", "Actor")
    realm = apps.get_model("realms", "Realm")
    by_code = {row.realm_code: row.pk for row in realm._base_manager.all()}

    for name, (civilization, before, after) in ACTOR_MOVES.items():
        source, target = (before, after) if direction == "after" else (after, before)
        target_pk = by_code.get(target)
        if target_pk is None:
            # Destination absent on this database. Leaving the actor where it
            # is beats nulling a posting that cannot then be restored.
            continue
        actor._base_manager.filter(
            name=name, civilization=civilization, realm__realm_code=source,
        ).update(realm=target_pk)


def _set_memory_reset(apps, before, after):
    realm = apps.get_model("realms", "Realm")
    realm._base_manager.filter(
        realm_code__in=MEMORY_RESET_CORRECTED, memory_reset_mechanism=before,
    ).update(memory_reset_mechanism=after)


def forwards(apps, schema_editor):
    realm = apps.get_model("realms", "Realm")

    # A database with no European cosmology yet gets nothing written to it —
    # see the "Empty-database guard" note above.
    if not realm._base_manager.filter(civilization="EUROPEAN").exists():
        return

    parent = realm._base_manager.filter(realm_code=MOUNTAIN_CODE).first()

    # Tenant is taken from a European sibling rather than guessed from a tenant
    # code, so the row does not land under an owner nobody named. If the
    # siblings are untenanted this inherits that and the seeder fills it in.
    sibling = (
        realm._base_manager.filter(civilization="EUROPEAN")
        .exclude(tenant__isnull=True)
        .first()
    )
    realm._base_manager.get_or_create(
        realm_code=SUMMIT_CODE,
        defaults={
            **SUMMIT,
            "tenant_id": sibling.tenant_id if sibling else None,
            "parent_realm_id": parent.pk if parent is not None else None,
        },
    )

    if parent is not None:
        # A row a `seed_mythology` run created before this migration reached
        # the database keeps whatever parent it has; only an unset link is
        # filled in. Repointing one that is already set is somebody's decision
        # to reverse, not this migration's. realms/0014's rule.
        realm._base_manager.filter(
            realm_code=SUMMIT_CODE, parent_realm__isnull=True,
        ).update(parent_realm=parent.pk)

    _move_actors(apps, "after")
    _set_memory_reset(apps, MEMORY_RESET_BEFORE, MEMORY_RESET_AFTER)


def backwards(apps, schema_editor):
    realm = apps.get_model("realms", "Realm")

    _set_memory_reset(apps, MEMORY_RESET_AFTER, MEMORY_RESET_BEFORE)

    # Before the delete. `Actor.realm` is SET_NULL, so removing the summit
    # first would wipe the posting this line exists to restore and the reverse
    # would still exit 0 — realms/0012's bug exactly.
    _move_actors(apps, "before")

    # Hard delete, not a tombstone: 0015's world has no such realm at all, and
    # a soft-deleted row it does not know about is not the same thing as
    # absence. realms/0013's reasoning for the two Greek rows.
    realm._base_manager.filter(realm_code=SUMMIT_CODE).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("realms", "0015_rename_devourer_to_annihilation"),
        # Actor.realm is rewritten here. Pinned to the migration that installs
        # `all_objects` as the base manager, so `_base_manager` on the
        # historical model is the unfiltered one — realms/0013's pin.
        ("actors", "0008_actor_delete_cascade_id"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
