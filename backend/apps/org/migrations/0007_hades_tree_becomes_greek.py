"""Refile the 冥界 / 希腊冥界 org subtree under GREEK.

What was wrong
--------------
``init_organizations`` creates two nodes for the Greek underworld — ``HADES``
(冥界) and its child ``HADES_GREEK`` (希腊冥界) — and both carried
``category="EUROPEAN"``. The child said what it was in its own name while filing
itself under somebody else's civilization, which is the same mislabelling
realms/0018 corrects on the Realm and Actor rows, in the one model that keeps
its copy of the civilization in a column called something else.

It is not a cosmetic label. ``Organization.tenant`` was backfilled from
``category`` by org/0004 (CHINESE -> CN_DIYU, EUROPEAN -> EU_HEAVEN_HELL,
EGYPTIAN -> EG_DUAT), and ``TenantQuerySetMixin`` scopes non-ADMIN roles to
their own tenant's org tree — so a Greek administrator's org subtree was visible
only to the European tenant, and a Greek tenant would have seen no org tree at
all.

What this does
--------------
Two rows, named explicitly. ``HEAVEN``/``HEAVEN_ANGEL``/``HEAVEN_EXEC`` and
``HELL`` stay EUROPEAN: they are the Christian and Dantean halves, and they are
where Christ, Michael, Gabriel, Satan and the three figures Dante borrowed
belong.

``category`` and ``tenant`` move together. A node whose ``tenant`` is NULL keeps
its NULL — an unset owner is a row org/0004 skipped or a row created since, not
a decision to reverse — and ``GR_HADES`` is created only if one of the two nodes
is actually owned by ``EU_HEAVEN_HELL``, which is org/0004's own rule for not
planting tenant rows in databases that had no work to do.

``parent`` is untouched. ``HADES_GREEK`` hangs off ``HADES`` before and after;
both move, so the tree keeps its shape and no node is orphaned across a
civilization boundary at any point.

Empty-database guard
--------------------
A database with neither node under EUROPEAN gets nothing written — a fresh
install runs ``init_organizations``, whose table now says GREEK, and a database
that has already been through this migration finds nothing to do on a re-run.

Reversibility
-------------
``backwards`` puts both nodes back to EUROPEAN and returns whichever of them
this migration re-owned to ``EU_HEAVEN_HELL``. Both directions match on the two
codes *and* on the category they expect, so a node somebody has recategorised by
hand is left alone, and a GREEK org node created after this migration under some
other code is not swept into EUROPEAN by the rollback.

``all_objects`` throughout: ``Organization`` and ``Tenant`` both mix in
``SoftDeleteMixin``, whose migration state carries ``all_objects`` as the base
manager and no ``objects`` at all (see org/0002 and tenants/0007). A
soft-deleted org node still needs its category corrected, and a Tenant lookup
must not silently recreate a row that exists but is soft-deleted — org/0004's
reasoning, unchanged.
"""
from django.db import migrations

EUROPEAN = "EUROPEAN"
GREEK = "GREEK"

EUROPEAN_TENANT_CODE = "EU_HEAVEN_HELL"
GREEK_TENANT_CODE = "GR_HADES"
GREEK_TENANT_DISPLAY_NAME = "Greek Afterlife"

#: 冥界 and 希腊冥界. Not HEAVEN/HELL — those are the Christian and Dantean
#: halves and they stay EUROPEAN.
GREEK_ORG_CODES = ["HADES", "HADES_GREEK"]


def _move(apps, *, from_category, to_category, from_tenant_code, to_tenant_code,
          to_tenant_display_name):
    organization = apps.get_model("org", "Organization")
    tenant = apps.get_model("tenants", "Tenant")

    pks = list(
        organization.all_objects.filter(
            code__in=GREEK_ORG_CODES, category=from_category
        ).values_list("pk", flat=True)
    )
    if not pks:
        # Empty database, or already applied. See the docstring.
        return

    organization.all_objects.filter(pk__in=pks).update(category=to_category)

    source_tenant = tenant.all_objects.filter(code=from_tenant_code).first()
    if source_tenant is None:
        return
    owned = organization.all_objects.filter(pk__in=pks, tenant=source_tenant)
    if not owned.exists():
        # No owner to transfer — do not create the destination tenant as a side
        # effect. org/0004's rule.
        return
    destination, _ = tenant.all_objects.get_or_create(
        code=to_tenant_code, defaults={"display_name": to_tenant_display_name}
    )
    owned.update(tenant=destination)


def forwards(apps, schema_editor):
    _move(
        apps,
        from_category=EUROPEAN,
        to_category=GREEK,
        from_tenant_code=EUROPEAN_TENANT_CODE,
        to_tenant_code=GREEK_TENANT_CODE,
        to_tenant_display_name=GREEK_TENANT_DISPLAY_NAME,
    )


def backwards(apps, schema_editor):
    _move(
        apps,
        from_category=GREEK,
        to_category=EUROPEAN,
        from_tenant_code=GREEK_TENANT_CODE,
        to_tenant_code=EUROPEAN_TENANT_CODE,
        to_tenant_display_name="European Afterlife",
    )


class Migration(migrations.Migration):

    dependencies = [
        # The AlterField that lets `category` hold GREEK.
        ("org", "0006_alter_organization_category"),
        ("tenants", "0008_notification_delete_cascade_id_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
