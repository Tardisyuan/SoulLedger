"""Rename ``EG_DEVOURER`` to ``EG_ANNIHILATION``.

What this finishes
------------------
``79dee57`` corrected what this row *claims* — it is 「第二次死亡 / 湮灭 /
Second Death」 now, not 「吞噬者 / Devourer's Realm」, and Ammit was moved back
to ``EG_HALL_TWO_TRUTHS`` where every standard vignette draws her (Budge,
Papyrus of Ani, Plate III; BM EA 9901). It deliberately left the ``realm_code``
alone and said why, in as many words:

    the code string is a live identifier in three places, including a hardcoded
    check in SoulLifecycleTimeline that is the frontend's only signal for
    annihilation. Renaming it here alone would stop that rendering silently.

So the rename waited for a change that could move all three at once. This is
that change; the other two halves are ``DispositionService.EG_ANNIHILATION``
and ``ANNIHILATION_REALM_CODE`` in ``frontend/src/lib/realmCodes.ts``, which
``backend/tests/test_annihilation_realm_code.py`` now compares against each
other so a future rename cannot land on one side only.

What this does
--------------
1. **Renames the row in place.** ``Realm.realm_code`` is a plain unique
   ``CharField``, so the row keeps its primary key and every ForeignKey aimed
   at it follows without being touched — ``Disposition.destination_realm``
   above all, which is the column that records where an already-executed
   sentence sent a soul. Nothing is deleted and nothing is re-pointed: a
   disposition that recorded this destination still resolves to the same row,
   which is the whole reason a rename is the right operation and a
   delete-and-recreate is not.

2. **Rewrites ``Reincarnation.target_realm``.** That column is a plain
   ``CharField`` holding a realm_code, not a ForeignKey, so unlike (1) it does
   *not* follow a rename; left alone it would hold a code matching no realm.
   ``realms/0012`` had to do the same thing for the five renamed courts and
   this is a copy of its step 6, for the same reason.

   In practice a soul routed here is annihilated and has nothing to reincarnate
   into, so the expected count is zero — but "the router should never have
   produced this" is not a reason to leave a dangling string behind if some
   database has one. The statement is cheap and the alternative is a silent
   orphan.

Empty-database guard
--------------------
A database with no Egyptian cosmology is a fresh install: there is nothing to
rename, and populating it is ``seed_mythology``'s job — which now seeds
``EG_ANNIHILATION`` directly. ``realms/0014`` and ``judgment/0013`` carry the
same guard for the same reason.

Reversibility
-------------
``backwards`` renames the row back and reverses the ``target_realm`` rewrite.
There is no lossy step: the row is the same row throughout, no vocabulary is
widened or narrowed, and every FK is untouched in both directions.
``backend/tests/test_annihilation_realm_code.py`` runs it forward → back →
forward through the ``migration_round_trip`` fixture and compares the *data*,
not merely that both directions exited without raising.

The one thing reverse cannot do is un-rename a row that never carried the old
code — a database seeded fresh after this migration has an ``EG_ANNIHILATION``
row that ``0014``'s world does know, under a name it does not. Reverse renames
it to ``EG_DEVOURER`` regardless, because "the code this realm answers to at
migration 0014" is exactly what reverse is restoring, and leaving a fresh
database's row alone would make the reverse's result depend on which run
created the row.

All row access goes through ``_base_manager``. ``Realm.objects`` is
tenant-scoped and soft-delete-filtered and there is no tenant in context under
a migration, so it would report a silent success over an untouched table.
"""
from django.db import migrations

OLD_CODE = "EG_DEVOURER"
NEW_CODE = "EG_ANNIHILATION"


def _rename(apps, old, new):
    realm = apps.get_model("realms", "Realm")
    reincarnation = apps.get_model("reincarnation", "Reincarnation")

    # Nothing to rename on a database with no Egyptian cosmology — see the
    # "Empty-database guard" note above.
    if not realm._base_manager.filter(civilization="EGYPTIAN").exists():
        return

    realm._base_manager.filter(realm_code=old).update(realm_code=new)
    reincarnation._base_manager.filter(target_realm=old).update(target_realm=new)


def forwards(apps, schema_editor):
    _rename(apps, OLD_CODE, NEW_CODE)


def backwards(apps, schema_editor):
    _rename(apps, NEW_CODE, OLD_CODE)


class Migration(migrations.Migration):

    dependencies = [
        ("realms", "0014_purgatorio_terraces"),
        # Reincarnation.target_realm is rewritten here. Pinned to the same
        # migration realms/0012 pinned for the same column.
        ("reincarnation", "0012_alter_reincarnation_rebirth_form"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
