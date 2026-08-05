"""
Data migration: backfill Organization.tenant from `category`.

Same CIV_TO_TENANT mapping apps/tenants/management/commands/
migrate_to_multitenant.py uses for Soul/Realm/Actor/Judgment:

  CHINESE  -> CN_DIYU
  EUROPEAN -> EU_HEAVEN_HELL
  EGYPTIAN -> EG_DUAT

Organization was never in that command's `models_with_civ` list (see the
command's module docstring), which is why the backfill lives here instead of
being folded into it — that command is a standalone, manually-invoked script
(not run on deploy; nothing in the codebase calls it besides a developer at a
shell), so a model landing in the database only after the command last ran
would stay unbackfilled forever if the fix were made there instead of in a
migration. A migration runs automatically wherever `manage.py migrate` does,
new install or existing database alike.

Idempotent: filters on `tenant__isnull=True`, so re-running (e.g. a partial
apply retried) only ever touches rows still missing the FK. `category` has no
default None state — it is a required CharField with choices — so every
Organization row has one of the three mapped values and nothing is left
behind; there is no null-backfill-to-CN_DIYU phase like the command's Phase 2,
because there is no fourth case here to catch.

The Tenant row for a category is only get_or_create'd when there is at least
one Organization row to backfill for it — checked with .exists() before
touching Tenant at all. Every `manage.py migrate` run, including the one that
builds a throwaway test database from scratch, applies this migration; a
version that created CN_DIYU/EU_HEAVEN_HELL/EG_DUAT unconditionally would
plant three Tenant rows in every fresh test database whether or not any
Organization ever needed them, which is exactly the kind of surprise state
apps/org/tests.py::OrganizationAPITest.setUp() (creates its own CN_DIYU) was
tripped by during development of this migration — fixed here by gating tenant
creation on there being backfill work to do.

Reversal clears the FK back to null, mirroring 0004_realm_tenant's sibling
migrations elsewhere in the codebase that add a data-migration counterpart.
"""
from django.db import migrations

CIV_TO_TENANT = {
    "CHINESE": "CN_DIYU",
    "EUROPEAN": "EU_HEAVEN_HELL",
    "EGYPTIAN": "EG_DUAT",
}

TENANT_DISPLAY_NAMES = {
    "CN_DIYU": "Chinese Afterlife",
    "EU_HEAVEN_HELL": "European Afterlife",
    "EG_DUAT": "Egyptian Afterlife",
}


def backfill_tenant(apps, schema_editor):
    Organization = apps.get_model("org", "Organization")
    Tenant = apps.get_model("tenants", "Tenant")

    # Both models mix in SoftDeleteMixin, whose migration state only carries
    # `all_objects` (declared first, as the base manager — see
    # org/migrations/0002_alter_organization_managers and
    # tenants/migrations/0007_..._alter_tenant_managers). The historical
    # model apps.get_model() returns here has no `.objects` attribute at all.
    # `all_objects` is also the correct choice regardless: a soft-deleted
    # Organization still needs its tenant backfilled, and Tenant lookups must
    # not silently recreate a row that exists but is soft-deleted.
    for category, tenant_code in CIV_TO_TENANT.items():
        pending = Organization.all_objects.filter(category=category, tenant__isnull=True)
        if not pending.exists():
            # Nothing to backfill for this category — do not create the
            # Tenant row as a side effect of a migration that had no work to
            # do. Matters most for a from-scratch test database, which has no
            # Organization rows at all yet applies this migration anyway.
            continue
        tenant, _ = Tenant.all_objects.get_or_create(
            code=tenant_code, defaults={"display_name": TENANT_DISPLAY_NAMES[tenant_code]}
        )
        pending.update(tenant=tenant)


def clear_tenant(apps, schema_editor):
    Organization = apps.get_model("org", "Organization")
    Organization.all_objects.filter(category__in=CIV_TO_TENANT).update(tenant=None)


class Migration(migrations.Migration):

    dependencies = [
        ("org", "0003_organization_tenant"),
    ]

    operations = [
        migrations.RunPython(backfill_tenant, clear_tenant),
    ]
