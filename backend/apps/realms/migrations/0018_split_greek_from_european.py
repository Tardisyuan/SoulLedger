"""Move Plato's judgment ground and the three judges who stand on it to GREEK.

What was wrong
--------------
``Civilization`` had three members and the Greek cosmology was filed under
``EUROPEAN``. That was never a claim anybody checked; it was the only slot
available. The consequences were not cosmetic:

* ``Soul.civilization`` is derived from the soul's tenant through
  ``TENANT_CIVILIZATION``, so every Greek row answered to ``EU_HEAVEN_HELL`` —
  the tenant whose other rows are the Nicene Creed's last judgment and Dante's
  nine circles.
* Anything reading a Greek row's cosmology got EUROPEAN and therefore got the
  European ledger reading (``culpa``/``poena``, ``apps/ledger/readings.py``),
  which is *poena* after *culpa* has been forgiven. Plato's instrument is a term
  served — tenfold repayment over a thousand-year circuit, Republic X 615a-b —
  and the two have nothing in common but the word "judgment".

What this migration moves, and what it does not
-----------------------------------------------
FOUR ROWS. One realm and three actors, named explicitly below rather than
selected by any rule:

* ``EU_PLATO_MEADOW`` — Plato's fork in the road, Gorgias 524a.
* ``Hades``, ``Aeacus``, ``Rhadamanthus`` — the three who already stood on it.
  Two of them carry the sentence *He does not appear in Dante* in their own
  seeded descriptions.

MINOS, CERBERUS AND CHARON DELIBERATELY STAY EUROPEAN, and this is the decision
most likely to be re-litigated by somebody who reads only the names. Every
anchor those three rows cite is Dante's: Minos allots the circle at the entrance
to the second (Inf. V.4-15), Cerberus stands over the gluttons in the third
(Inf. VI), Charon works Acheron at the gate of hell (Inf. III). They are Greek
figures Dante borrowed, and what this database holds of them is the borrowing.
``EU_ACHERON`` stays EUROPEAN with Charon for the same reason.

``THE REALM CODE DOES NOT CHANGE``. ``EU_PLATO_MEADOW`` keeps its code under
GREEK. A ``realm_code`` is a join key — ``Reincarnation.target_realm`` stores it
as text, ``consolidate_eu_pantheon`` audits against it, and the frontend has
hard-coded one before — which is why realms/0012 and realms/0015 each needed a
dedicated migration to rename one. The prefix records where the row was written,
not what it now belongs to.

NOTHING IS CREATED HERE. Plato's Minos, ``GR_ISLES_OF_THE_BLESSED`` and
``GR_TARTARUS`` are new rows with no predecessor to migrate, and
``seed_mythology`` creates missing rows on any database it is run against
without needing ``--update`` — the division realms/0013 used for Christ,
realms/0014 for ``EU-DS-T1..T7`` and realms/0016 for Eunoè. A migration that
also inserted them would be a second copy of the seed tables that nothing keeps
in step.

NO OTHER MODEL HAS A ROW TO MOVE. ``Judgment``, ``Statute``, ``SoulRecord`` and
``WorkflowTemplate`` all carry a ``civilization``, and none of them can hold a
Greek one on a database predating this change: there was no ``GR_HADES`` tenant,
so no soul could read GREEK, so no judgment, record or template was ever filed
under it. ``Soul`` and ``ApprovalWorkflow`` have no ``civilization`` column at
all — the soul's is a derived property. Their ``AlterField`` migrations widen
the ``choices`` and write no data, which is the whole of what they have to do.

The tenant
----------
``GR_HADES`` is created here only if there is at least one row that actually
needs it — i.e. one of the four is currently owned by ``EU_HEAVEN_HELL``. A
migration that created a tenant unconditionally would plant a row in every
throwaway test database whether or not anything referenced it, which is the
surprise org/0004 documents having been bitten by.

A row whose ``tenant`` is NULL keeps its NULL. An unset owner is not a decision
being changed, it is a row the seeder has not reached yet, and rewriting it here
would make the reverse unable to tell "was European" from "was nobody's".

Empty-database guard
--------------------
If none of the four rows is present as a EUROPEAN row, this writes nothing at
all. A fresh install has no cosmology to move and ``seed_mythology`` builds it
under the correct civilization from the start. realms/0014, 0015 and 0016 carry
the same guard.

Reversibility
-------------
``backwards`` puts the four rows back to ``EUROPEAN`` and returns whichever of
them this migration re-owned to ``EU_HEAVEN_HELL``. Both directions match on the
explicit name/code lists *and* on the civilization they expect to find, so:

* a row somebody has moved somewhere else by hand is left alone, and
* the reverse cannot sweep up rows it never created — on a database seeded after
  this migration, Plato's Minos, ``GR_ISLES_OF_THE_BLESSED`` and ``GR_TARTARUS``
  are GREEK too, and none of them is named here, so all three keep their
  civilization while the four originals go back. They are then GREEK rows in a
  world whose enum has no GREEK, which is exactly the residue realms/0016's
  reverse documents for Eunoè: the reverse restores what the migration changed
  and does not delete what it never made.

Both directions are re-runnable, and
``backend/tests/test_greek_civilization.py`` runs forward → reverse → forward
through a real ``migrate`` with the ``migration_round_trip`` fixture, comparing
rows rather than exit status.

All row access goes through ``_base_manager``: ``Realm.objects`` and
``Actor.objects`` are tenant-scoped and soft-delete-filtered, and a migration has
no tenant in context — they would report a silent success over an untouched
table.
"""
from django.db import migrations

EUROPEAN = "EUROPEAN"
GREEK = "GREEK"

EUROPEAN_TENANT_CODE = "EU_HEAVEN_HELL"
GREEK_TENANT_CODE = "GR_HADES"
GREEK_TENANT_DISPLAY_NAME = "Greek Afterlife"

#: Plato's fork. The one realm that moves; EU_ACHERON stays with Charon.
MOVED_REALM_CODES = ["EU_PLATO_MEADOW"]

#: The three who stand on it. Minos is absent on purpose — the EUROPEAN Minos
#: is Dante's and stays, and Plato's is a separate row `seed_mythology` creates.
MOVED_ACTOR_NAMES = ["Hades", "Aeacus", "Rhadamanthus"]


def _rows(apps, civilization):
    """The realm and actor querysets this migration owns, at `civilization`."""
    realm = apps.get_model("realms", "Realm")
    actor = apps.get_model("actors", "Actor")
    return (
        realm._base_manager.filter(
            realm_code__in=MOVED_REALM_CODES, civilization=civilization
        ),
        actor._base_manager.filter(
            name__in=MOVED_ACTOR_NAMES, civilization=civilization
        ),
    )


def _move(apps, *, from_civilization, to_civilization, from_tenant_code,
          to_tenant_code, to_tenant_display_name):
    tenant = apps.get_model("tenants", "Tenant")
    realms, actors = _rows(apps, from_civilization)

    # Primary keys first: the second update below has to address the same rows
    # after the first has changed the column it selected them by.
    realm_pks = list(realms.values_list("pk", flat=True))
    actor_pks = list(actors.values_list("pk", flat=True))
    if not realm_pks and not actor_pks:
        # Empty-database guard, and also the "already applied" case — running
        # either direction twice finds nothing to do rather than doing it twice.
        return

    realm = apps.get_model("realms", "Realm")
    actor = apps.get_model("actors", "Actor")
    realm._base_manager.filter(pk__in=realm_pks).update(civilization=to_civilization)
    actor._base_manager.filter(pk__in=actor_pks).update(civilization=to_civilization)

    source_tenant = tenant._base_manager.filter(code=from_tenant_code).first()
    if source_tenant is None:
        # Nothing to re-own. Rows with a NULL tenant, or with an owner nobody
        # named, are left exactly as they are — see the docstring.
        return
    owned_realms = realm._base_manager.filter(pk__in=realm_pks, tenant=source_tenant)
    owned_actors = actor._base_manager.filter(pk__in=actor_pks, tenant=source_tenant)
    if not owned_realms.exists() and not owned_actors.exists():
        # Do not create the destination tenant as a side effect of a migration
        # that had no owner to transfer. org/0004's rule.
        return

    destination, _ = tenant._base_manager.get_or_create(
        code=to_tenant_code, defaults={"display_name": to_tenant_display_name}
    )
    owned_realms.update(tenant=destination)
    owned_actors.update(tenant=destination)


def forwards(apps, schema_editor):
    _move(
        apps,
        from_civilization=EUROPEAN,
        to_civilization=GREEK,
        from_tenant_code=EUROPEAN_TENANT_CODE,
        to_tenant_code=GREEK_TENANT_CODE,
        to_tenant_display_name=GREEK_TENANT_DISPLAY_NAME,
    )


def backwards(apps, schema_editor):
    _move(
        apps,
        from_civilization=GREEK,
        to_civilization=EUROPEAN,
        from_tenant_code=GREEK_TENANT_CODE,
        to_tenant_code=EUROPEAN_TENANT_CODE,
        # Only used if EU_HEAVEN_HELL is somehow absent, which on a database
        # that had European rows to move it cannot be. `seed_tenants` and
        # `seed_mythology` both write the same display name.
        to_tenant_display_name="European Afterlife",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("realms", "0017_alter_realm_civilization"),
        # Actor.civilization and Actor.tenant are rewritten here. Pinned to the
        # AlterField that widens the choices, which in turn sits after
        # actors/0007, the migration that installs `all_objects` as the base
        # manager — so `_base_manager` on the historical model is the unfiltered
        # one. realms/0013 and 0016 pin the same way.
        ("actors", "0009_alter_actor_civilization"),
        # The GR_HADES row is created through this model.
        ("tenants", "0008_notification_delete_cascade_id_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
