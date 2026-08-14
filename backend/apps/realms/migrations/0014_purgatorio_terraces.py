"""
Give the seven capital sins the place Dante actually put them: the seven
terraces of Mount Purgatory.

What was wrong
--------------
The seven sins were seeded in 6017f04 as seven ``DEADLY_SIN`` statutes, each
carrying a ``dante_circle`` — and that field names a coordinate the *Commedia*
does not have. Dante layers hell on Aristotle's tripartition, said outright by
Virgil in Inf. XI.79-84 (*incontinenza / malizia / matta bestialitade*), and
pride, envy and sloth get no circle in it at all. Four of the seven appear to
line up with circles 2-5 only because "incontinence" and those four sins are
adjacent vocabularies, not because Dante mapped one onto the other. The seven
sins order exactly one structure in the poem: Purgatorio X-XXVII, the seven
terraces, and this project had no such realms — so when ``8308204`` withdrew
the corpus, the articles had nowhere to go back to. They are back now, keyed to
terraces instead of circles; see ``seed_mythology.EUROPEAN_STATUTES``.

What this does
--------------
1. **Creates seven realms**, ``EU_PURGATORY_T1_PRIDE`` … ``EU_PURGATORY_T7_LUST``,
   bottom to top in Dante's order — pride, envy, wrath, sloth, avarice,
   gluttony, lust — with ``tier`` = the terrace number, the same way ``tier`` is
   the circle number for ``EU_HELL_*`` and the court number for ``DY_COURT_*``.

   Only the identifying columns are written here. ``seed_mythology`` owns the
   prose, for the reason ``realms/0012`` and ``0013`` both gave: a migration
   carrying the descriptions would be a second copy of ``EUROPEAN_REALMS`` that
   nothing keeps in step. On an existing database the descriptions arrive with
   the next ``seed_mythology --update``; a fresh database never runs this
   migration's body at all (see the guard) and gets everything from the seeder.

   ``is_judgment_required`` is deliberately **not** set here, so these rows take
   the model default — which is what ``seed_mythology`` produces on a fresh
   database, since ``REALM_FIELDS`` does not include that column either. Setting
   it would make a migrated database differ from a freshly seeded one in a field
   nothing reconciles.

2. **Hangs them off ``EU_PURGATORY`` via ``parent_realm``.** Dante's Purgatory
   is one mountain with parts — Ante-Purgatory (Purg. I-IX), the seven terraces,
   and the Earthly Paradise at the summit — so the terraces are sub-realms and
   not seven new peers of it. The link is set on rows that have no parent yet,
   including rows a ``seed_mythology`` run created before this migration was
   applied; a row already pointing somewhere else is left alone, because that is
   a posting somebody made.

What this deliberately does NOT do
----------------------------------
* **``EU_PURGATORY`` is not replaced, retired or repointed.** It is a live
  routing destination — ``DispositionService._route_european`` sends every
  PURGATORY and RETRY verdict to it — executed dispositions record it, and Lethe
  stands on it. Replacing it with seven terraces would break routing and orphan
  the actor; the terraces are what it contains, not what it becomes.

* **No verdict is routed to a terrace, and this migration does not add one.**
  A terrace is chosen by *which* sin, and nothing in a ``Judgment`` records
  that; the router has verdict and karma. Routing by karma magnitude would
  rebuild the severity ladder that made "seven sins over nine circles" look
  plausible to begin with. These rows are reference data, exactly as
  ``EU_PLATO_MEADOW`` is. ``tests/test_purgatorio_terraces.py`` asserts the
  absence, so adding a route has to be a decision rather than a drift.

* **The statutes are not seeded here.** ``EU-DS-T1..T7`` are new rows with no
  predecessor to migrate, and ``seed_mythology`` creates missing rows on any
  database it is run against without needing ``--update`` — the same division
  ``realms/0013`` used for Christ. They are also *not* the withdrawn
  ``EU-DS-01..07`` under new provenance: those codes stay retired, because
  ``judgment/0012`` deliberately left any cited article live and re-using a
  citation key would rewrite the recorded grounds of a decided case.

* **Nothing is moved onto a terrace.** No actor and no disposition currently
  names one, and inventing a tenant for the seven or reassigning souls to them
  would be this migration deciding something nobody asked it to.

Reversibility
-------------
``backwards`` deletes the seven rows it created and nothing else — including
nothing in ``judgment``: the ``EU-DS-T1..T7`` articles are the seeder's rows,
not this migration's, and after a rollback they sit with a
``payload_json["terrace_realm_code"]`` that resolves to nothing until the
migration is re-applied. That is the same shape ``realms/0013`` leaves Christ
in, and the alternative — a realms migration reaching into another app to delete
rows it never wrote — is worse. It is safe in
the order written: ``parent_realm`` is ``SET_NULL`` and points *from* the
terraces at ``EU_PURGATORY``, so removing the children cannot touch the parent,
and ``Actor.realm`` is ``SET_NULL`` too. Round-tripping ``migrate realms 0014``
/ ``migrate realms 0013`` leaves 0013's world.

All row access goes through ``_base_manager``: ``Realm.objects`` is
tenant-scoped and soft-delete-filtered, and under a migration there is no tenant
in context — it would report a silent success over an untouched table.
"""
from django.db import migrations

PARENT_CODE = "EU_PURGATORY"

# (realm_code, tier, name_local, name_zh, name_en, name_egy). Identifying
# columns only — the seeder owns the descriptions. Order is Dante's, bottom to
# top, and the tier repeats it so that neither this list's order nor the
# seeder's can silently become the only place the sequence is recorded.
TERRACES = [
    ("EU_PURGATORY_T1_PRIDE", 1, "炼狱第一层", "傲慢之台",
     "First Terrace - Pride", "Superbia"),
    ("EU_PURGATORY_T2_ENVY", 2, "炼狱第二层", "嫉妒之台",
     "Second Terrace - Envy", "Invidia"),
    ("EU_PURGATORY_T3_WRATH", 3, "炼狱第三层", "愤怒之台",
     "Third Terrace - Wrath", "Ira"),
    ("EU_PURGATORY_T4_SLOTH", 4, "炼狱第四层", "懒惰之台",
     "Fourth Terrace - Sloth", "Acedia"),
    ("EU_PURGATORY_T5_AVARICE", 5, "炼狱第五层", "贪婪之台",
     "Fifth Terrace - Avarice", "Avaritia"),
    ("EU_PURGATORY_T6_GLUTTONY", 6, "炼狱第六层", "暴食之台",
     "Sixth Terrace - Gluttony", "Gula"),
    ("EU_PURGATORY_T7_LUST", 7, "炼狱第七层", "淫欲之台",
     "Seventh Terrace - Lust", "Luxuria"),
]

# Not LETHE, which every European row used to carry. Lethe is at the summit, in
# the Earthly Paradise above the seventh terrace (Purg. XXVIII, XXXI) — a soul
# climbing the mountain still has its memory, and needs it: the penance is for
# a life it remembers living.
TERRACE_MEMORY_RESET = "NONE"


def forwards(apps, schema_editor):
    realm = apps.get_model("realms", "Realm")

    # A database with no cosmology yet gets nothing written to it: populating a
    # fresh install is `seed_mythology`'s job, and half-seeding ahead of it
    # hands the seeder rows it did not create — untenanted, and present on a
    # database `seed_mythology --dry-run` is entitled to find empty. The same
    # guard realms/0012 and 0013 carry, for the same reason.
    if not realm._base_manager.filter(civilization="EUROPEAN").exists():
        return

    parent = realm._base_manager.filter(realm_code=PARENT_CODE).first()

    # Tenant is taken from a sibling European realm rather than guessed from a
    # tenant code, so the rows do not land under an owner nobody named. If the
    # siblings are themselves untenanted these inherit that and the seeder fills
    # it in on its next run.
    sibling = (
        realm._base_manager.filter(civilization="EUROPEAN")
        .exclude(tenant__isnull=True)
        .first()
    )
    tenant_id = sibling.tenant_id if sibling else None

    for realm_code, tier, name_local, name_zh, name_en, name_egy in TERRACES:
        realm._base_manager.get_or_create(
            realm_code=realm_code,
            defaults={
                "civilization": "EUROPEAN",
                "realm_type": "PURGATORY",
                "tier": tier,
                "name_local": name_local,
                "name_zh": name_zh,
                "name_en": name_en,
                "name_egy": name_egy,
                "memory_reset_mechanism": TERRACE_MEMORY_RESET,
                "is_eternal": False,
                "tenant_id": tenant_id,
                "parent_realm_id": parent.pk if parent is not None else None,
            },
        )

    if parent is None:
        # EU_PURGATORY absent from a database that has other European realms is
        # odd enough to leave alone rather than invent. The terraces exist and
        # are unparented; `seed_mythology` links them once the mountain is back.
        return

    # Rows that already existed — created by a `seed_mythology` run that got
    # here before this migration did — keep their posting unless they have none.
    realm._base_manager.filter(
        realm_code__in=[row[0] for row in TERRACES], parent_realm__isnull=True
    ).update(parent_realm=parent.pk)


def backwards(apps, schema_editor):
    realm = apps.get_model("realms", "Realm")
    realm._base_manager.filter(
        realm_code__in=[row[0] for row in TERRACES]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("realms", "0013_correct_mythological_positions"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
