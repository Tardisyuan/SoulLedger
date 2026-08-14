"""
Give the Ten Courts of Diyu ten realms, one each, numbered the way the rest of
the system numbers them.

What was wrong
--------------
The Chinese side had eleven realms and no court among them. Eight HELL rows
were named either after a punishment (剑树狱, 寒冰狱, 烊铜狱) or after whichever
king had been filed there (阎罗殿, 泰山府), and five of them held two or three
kings at once — 秦广王 and 楚江王 shared DY_03_QISHI, while DY_10_YAMA held
阎罗王, 平等王 and 判官. On top of that the codes carried numbers that agreed
with nothing: DY_03_QISHI's `name_en` was "Seventh Court Qishi", and DY_10_YAMA
was displayed as 第十殿 / "Tenth Court Yama" even though 22d9cd0 had just
settled 阎罗王 as the *fifth* court everywhere else in the repo
(apps/org's init_organizations, apps/workflow's 十殿审判流程 template, the actor
titles in seed_mythology). "Which court is this" had three answers.

What this does
--------------
1. **Renames five rows in place.** Each keeps its primary key, so every
   ForeignKey pointing at it — dispositions, actors, workflow nodes — follows
   the row without being touched:

       DY_03_QISHI   -> DY_COURT_01_QINGUANG
       DY_10_YAMA    -> DY_COURT_05_YANLUO      (阎罗王's court, now numbered 5)
       DY_04_TAISHAN -> DY_COURT_07_TAISHAN
       DY_05_CITY    -> DY_COURT_08_DUSHI
       DY_06_ZHUAN   -> DY_COURT_10_ZHUANLUN

   The pairing is by who or what the row actually was, not by its old number:
   DY_10_YAMA was 阎罗殿, so it becomes the fifth court because that is where
   阎罗王 sits; DY_06_ZHUAN was the wheel of rebirth, which is the tenth court's
   function.

2. **Creates the five courts that had no row at all** — 02 楚江王, 03 宋帝王,
   04 五官王, 06 卞城王, 09 平等王. Only the identifying columns are written
   here; `manage.py seed_mythology --update` owns descriptions and cycle limits
   and will fill them in. A migration that also carried the prose would be a
   second copy of CHINESE_REALMS that nothing keeps in sync.

3. **Seats each king in his own court.** Actor.realm has to be rewritten by
   hand: the seeder is create-only by default, so on an existing database it
   would leave 楚江王 pointing at the row that is now the *first* court. The
   named judicial personnel move with the row they were on (判官, 魏征, 崔府君
   were on 阎罗殿 = court 5; 地藏王菩萨 was on DY_03_QISHI = court 1).

4. **Retires 剑树狱 / 寒冰狱 / 烊铜狱** by soft-delete. They are 小地狱 —
   instruments used inside a court — not courts, and leaving them beside the
   ten would rebuild the ambiguity this migration exists to remove. Soft-delete
   is what "retired" means here: `Realm.objects` filters `is_deleted=False`, so
   they vanish from realm pickers and from `DispositionService`'s routing
   lookup, while `Realm.all_objects` and every existing ForeignKey still resolve
   them.

   Their rows are deliberately **not** repointed. A disposition that recorded
   "this soul was sent to 剑树狱" is a historical fact about a sentence that was
   actually passed, and rewriting it to name a court the soul was never sent to
   would be forging the record to tidy the reference data. Only 钟馗 moves — he
   is reference data, not history, and an actor must have a current posting.

5. **Rewrites Reincarnation.target_realm strings** for the five renamed rows.
   That column is a plain CharField holding a realm_code, so unlike the FKs it
   does not follow a rename; left alone it would hold codes that match no realm.
   Retired codes are left as they are, for the same reason as (4) — the row is
   still there under that code.

Reversibility
-------------
`reverse_code` restores the five names, deletes the five rows this created,
undeletes the three retired rows, puts every actor back on the realm it was on,
and reverses the target_realm rewrite. Because nothing was repointed off the
retired realms, there is no lossy step: `migrate realms 0011` leaves exactly
the eleven realms and the actor placements that existed before.

The one thing reverse cannot undo is a *new* row created after this migration
ran — a disposition routed to DY_COURT_09_PINGDENG has no pre-migration realm
to go back to, and reverse leaves it pointing at a row that 0011's code does
not know about. That is inherent to reversing a data migration that widened a
vocabulary, not something this migration chose.

All row access goes through `_base_manager`. `Realm.objects` and `Actor.objects`
are soft-delete-filtered managers, and a data migration that silently skips
soft-deleted rows is the failure mode disposition/0009 was written to avoid —
here it would be worse, since step 4 soft-deletes rows this very migration
still has to read back on reverse.
"""
from django.db import migrations

# old realm_code -> new realm_code. Renames in place; FKs follow the row.
RENAMES = {
    "DY_03_QISHI": "DY_COURT_01_QINGUANG",
    "DY_04_TAISHAN": "DY_COURT_07_TAISHAN",
    "DY_05_CITY": "DY_COURT_08_DUSHI",
    "DY_06_ZHUAN": "DY_COURT_10_ZHUANLUN",
    "DY_10_YAMA": "DY_COURT_05_YANLUO",
}

# The courts that had no row. (realm_code, tier, name_local, name_zh, name_en,
# name_egy). name_zh/name_en are the sitting king's title verbatim — see the
# CHINESE_REALMS note in seed_mythology.
NEW_COURTS = [
    ("DY_COURT_02_CHUJIANG", 2, "第二殿", "第二殿楚江王", "Second Court Chujiang", "Chujiang"),
    ("DY_COURT_03_SONGDI", 3, "第三殿", "第三殿宋帝王", "Third Court Songdi", "Songdi"),
    ("DY_COURT_04_WUGUAN", 4, "第四殿", "第四殿五官王", "Fourth Court Wuguan", "Wuguan"),
    ("DY_COURT_06_BIANCHENG", 6, "第六殿", "第六殿卞城王", "Sixth Court Biancheng", "Biancheng"),
    ("DY_COURT_09_PINGDENG", 9, "第九殿", "第九殿平等王", "Ninth Court Pingdeng", "Pingdeng"),
]

# The renamed rows also need their number and display name corrected — a rename
# alone would leave DY_COURT_05_YANLUO still calling itself 第十殿 with tier 10.
# (realm_code, tier, name_local, name_zh, name_en, name_egy)
RENAMED_COURT_FIELDS = [
    ("DY_COURT_01_QINGUANG", 1, "第一殿", "第一殿秦广王", "First Court Qinguang", "Qinguang"),
    ("DY_COURT_05_YANLUO", 5, "第五殿", "第五殿阎罗王", "Fifth Court Yama", "Yanluo"),
    ("DY_COURT_07_TAISHAN", 7, "第七殿", "第七殿泰山王", "Seventh Court Taishan", "Taishan"),
    ("DY_COURT_08_DUSHI", 8, "第八殿", "第八殿都市王", "Eighth Court Dushi", "Dushi"),
    ("DY_COURT_10_ZHUANLUN", 10, "第十殿", "第十殿转轮王", "Tenth Court Zhuanlun", "Zhuanlun"),
]

# What the renamed rows looked like before, so reverse can put them back.
# (realm_code, tier, name_local, name_zh, name_en, name_egy)
PRE_RENAME_FIELDS = [
    ("DY_03_QISHI", 3, "第七殿", "齐世寺", "Seventh Court Qishi", "Qishi"),
    ("DY_04_TAISHAN", 4, "泰山府", "泰山府", "Mount Tai Court", "Taishan"),
    ("DY_05_CITY", 5, "城池狱", "城池监狱", "City Prison Hell", "Chengchi"),
    ("DY_06_ZHUAN", 6, "转轮狱", "转轮寺", "Wheel of Rebirth Hell", "Zhuanlun"),
    ("DY_10_YAMA", 10, "第十殿", "阎罗殿", "Tenth Court Yama", "Yanluo"),
]

RETIRED = ["DY_07_JIAN", "DY_08_HAN", "DY_09_YANG"]
RETIRE_REASON = (
    "小地狱, not one of the Ten Courts — retired by realms/0012 when the ten "
    "courts became ten realms. Existing dispositions still name it."
)

# actor name -> (realm_code before, realm_code after). Every Chinese actor whose
# posting changes. 钟馗 is the only one moving because his realm was retired.
ACTOR_MOVES = {
    "秦广王": ("DY_03_QISHI", "DY_COURT_01_QINGUANG"),
    "楚江王": ("DY_03_QISHI", "DY_COURT_02_CHUJIANG"),
    "宋帝王": ("DY_04_TAISHAN", "DY_COURT_03_SONGDI"),
    "五官王": ("DY_05_CITY", "DY_COURT_04_WUGUAN"),
    "阎罗王": ("DY_10_YAMA", "DY_COURT_05_YANLUO"),
    "卞城王": ("DY_06_ZHUAN", "DY_COURT_06_BIANCHENG"),
    "泰山王": ("DY_04_TAISHAN", "DY_COURT_07_TAISHAN"),
    "都市王": ("DY_05_CITY", "DY_COURT_08_DUSHI"),
    "平等王": ("DY_10_YAMA", "DY_COURT_09_PINGDENG"),
    "转轮王": ("DY_06_ZHUAN", "DY_COURT_10_ZHUANLUN"),
    "判官": ("DY_10_YAMA", "DY_COURT_05_YANLUO"),
    "魏征": ("DY_10_YAMA", "DY_COURT_05_YANLUO"),
    "崔府君": ("DY_10_YAMA", "DY_COURT_05_YANLUO"),
    "地藏王菩萨": ("DY_03_QISHI", "DY_COURT_01_QINGUANG"),
    "钟馗": ("DY_09_YANG", "DY_COURT_05_YANLUO"),
}


def _apply_fields(realm_model, rows):
    for realm_code, tier, name_local, name_zh, name_en, name_egy in rows:
        realm_model._base_manager.filter(realm_code=realm_code).update(
            tier=tier,
            name_local=name_local,
            name_zh=name_zh,
            name_en=name_en,
            name_egy=name_egy,
        )


def _move_actors(apps, mapping):
    """Repoint Chinese actors by realm_code. `mapping` is name -> target code."""
    actor_model = apps.get_model("actors", "Actor")
    realm_model = apps.get_model("realms", "Realm")
    by_code = {
        r.realm_code: r.pk
        for r in realm_model._base_manager.filter(civilization="CHINESE")
    }
    for name, target_code in mapping.items():
        realm_pk = by_code.get(target_code)
        if realm_pk is None:
            # The realm is absent on this database (a deployment that never ran
            # the seeder). Nothing to point at; leave the actor as it is rather
            # than nulling a posting we cannot restore on reverse.
            continue
        actor_model._base_manager.filter(
            name=name, civilization="CHINESE"
        ).update(realm=realm_pk)


def forwards(apps, schema_editor):
    from django.utils import timezone

    realm = apps.get_model("realms", "Realm")
    reincarnation = apps.get_model("reincarnation", "Reincarnation")

    # Nothing to convert on a database that has no Chinese cosmology yet — and
    # on such a database this migration must write *nothing*. Populating a
    # fresh install is `seed_mythology`'s job, and a migration that half-seeds
    # ahead of it hands the seeder five rows it did not create: they arrive
    # with no tenant (there is no CN_DIYU row at migrate time to attach them
    # to), and `seed_mythology --dry-run` on a supposedly empty database finds
    # realms already there. Both of those are assertions in
    # tests/test_seed_mythology.py, and both fired before this guard existed.
    if not realm._base_manager.filter(civilization="CHINESE").exists():
        return

    # 1. Rename in place. Ordered so a rename can never collide with a code that
    #    is still occupied: none of the DY_COURT_* targets exist yet.
    for old, new in RENAMES.items():
        realm._base_manager.filter(realm_code=old).update(realm_code=new)

    # 2. Correct the renamed rows' number and display name.
    _apply_fields(realm, RENAMED_COURT_FIELDS)

    # 3. Create the five courts that never had a row. The tenant is whatever the
    #    other Chinese realms are filed under, so these do not land unowned and
    #    invisible to CN_DIYU. If the existing rows are themselves untenanted
    #    these inherit that, which is the honest answer: `seed_mythology` fills
    #    the tenant in on its next run, and guessing CN_DIYU here would file
    #    rows under a tenant nobody has said owns them.
    sibling = (
        realm._base_manager.filter(civilization="CHINESE")
        .exclude(tenant__isnull=True)
        .first()
    )
    tenant_id = sibling.tenant_id if sibling else None
    for realm_code, tier, name_local, name_zh, name_en, name_egy in NEW_COURTS:
        realm._base_manager.get_or_create(
            realm_code=realm_code,
            defaults={
                "civilization": "CHINESE",
                "realm_type": "HELL",
                "tier": tier,
                "name_local": name_local,
                "name_zh": name_zh,
                "name_en": name_en,
                "name_egy": name_egy,
                "memory_reset_mechanism": "MENGPO",
                "is_eternal": False,
                "is_judgment_required": True,
                "tenant_id": tenant_id,
            },
        )

    # 4. Seat each king in his own court.
    _move_actors(apps, {name: after for name, (_, after) in ACTOR_MOVES.items()})

    # 5. Retire the three 小地狱. Soft-delete, after the actor move, so 钟馗 is
    #    already out of DY_09_YANG.
    realm._base_manager.filter(realm_code__in=RETIRED).update(
        is_deleted=True,
        deleted_at=timezone.now(),
        delete_reason=RETIRE_REASON,
    )

    # 6. Reincarnation.target_realm is a CharField, not an FK, so it does not
    #    follow a rename.
    for old, new in RENAMES.items():
        reincarnation._base_manager.filter(target_realm=old).update(target_realm=new)


def backwards(apps, schema_editor):
    realm = apps.get_model("realms", "Realm")
    reincarnation = apps.get_model("reincarnation", "Reincarnation")

    # Reverse of 6.
    for old, new in RENAMES.items():
        reincarnation._base_manager.filter(target_realm=new).update(target_realm=old)

    # Reverse of 5.
    realm._base_manager.filter(realm_code__in=RETIRED).update(
        is_deleted=False, deleted_at=None, delete_reason=""
    )

    # Reverse of 2 and 1, in that order: restore the old tier and names first
    # (they are keyed by the new codes), then the codes themselves.
    _apply_fields(realm, [(RENAMES[old], *rest) for old, *rest in PRE_RENAME_FIELDS])
    for old, new in RENAMES.items():
        realm._base_manager.filter(realm_code=new).update(realm_code=old)

    # Reverse of 4 — put every actor back where it was. This has to come *after*
    # the rename above, not before it: the destinations are pre-migration codes
    # (楚江王 goes back to DY_03_QISHI), and until the rename runs no row answers
    # to that code. Moving first made `_move_actors` skip all five kings whose
    # court was created rather than renamed, and the next statement then deleted
    # the rows they were still pointing at — SET_NULL left 楚江王, 宋帝王, 五官王,
    # 卞城王 and 平等王 with no realm at all, which the round-trip check caught.
    _move_actors(apps, {name: before for name, (before, _) in ACTOR_MOVES.items()})

    # Reverse of 3, last: by now nothing points at these rows. Deleting rather
    # than soft-deleting, because 0011's world has no such realm at all and a
    # tombstone it does not know about is not the same thing as its absence.
    realm._base_manager.filter(
        realm_code__in=[row[0] for row in NEW_COURTS]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("realms", "0011_lethe_storage_value"),
        # Actor.realm is rewritten here. Pinned to the migration that installs
        # `all_objects` as the base manager, so `_base_manager` on the
        # historical model is the unfiltered one and not the soft-delete one.
        ("actors", "0008_actor_delete_cascade_id"),
        # Reincarnation.target_realm is rewritten here.
        ("reincarnation", "0012_alter_reincarnation_rebirth_form"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
