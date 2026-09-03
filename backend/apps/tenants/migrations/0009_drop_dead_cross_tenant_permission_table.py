"""Drop `permissions_cross_tenant`, the table of the deleted `apps.permissions`.

WHY THIS LIVES IN `tenants` AND NOT IN `permissions`. The app is gone, so its
own migrations are gone with it and cannot carry a `DeleteModel`. The table has
to be dropped from an app that still exists, and `tenants` is the one both of
`CrossTenantPermission`'s foreign keys pointed at.

WHY `IF EXISTS` AND NOT `DeleteModel`. On a fresh database the deleted app's
`0001_initial` never runs, so the table is never created and an unconditional
`DROP TABLE` would fail on exactly the databases that were always clean.

WHAT IS DELIBERATELY NOT MATCHED. `apps.perm` — the live permissions app — owns
a table called `permissions_row_level_data_scope`. Two tables share the
`permissions_` prefix and only one of them is dead. The drop below names its
table in full, and there is no pattern anywhere in this file, because a
`LIKE 'permissions_%'` here would take the row-level data scopes with it.
"""

from django.db import migrations

DEAD_TABLE = "permissions_cross_tenant"
DEAD_APP_LABEL = "permissions"


def drop_dead_table(apps, schema_editor):
    """Drop the table and the registry rows that outlive it.

    Three things are left behind by deleting an app: the table, its
    `django_content_type` row (which cascades to four `auth_permission` rows),
    and its `django_migrations` records. None of them break anything, but a
    content type with no model is the kind of debris that makes the next
    person's audit query lie.
    """
    connection = schema_editor.connection
    quoted = connection.ops.quote_name(DEAD_TABLE)
    with connection.cursor() as cursor:
        cursor.execute(f"DROP TABLE IF EXISTS {quoted}")

    ContentType = apps.get_model("contenttypes", "ContentType")
    # Deleting the content type cascades to `auth_permission` through its FK.
    ContentType.objects.filter(app_label=DEAD_APP_LABEL).delete()

    with connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM django_migrations WHERE app = %s", [DEAD_APP_LABEL]
        )


def noop_reverse(apps, schema_editor):
    """Reversing does not bring the table back, and should not.

    Nothing reads `CrossTenantPermission` — that is why it was removed — so
    recreating an empty table on a rollback would restore the confusion without
    restoring any data. Reversal is allowed so that `migrate tenants 0008` still
    works; it simply leaves the table absent.
    """


class Migration(migrations.Migration):
    dependencies = [
        ("tenants", "0008_notification_delete_cascade_id_and_more"),
        ("contenttypes", "0002_remove_content_type_name"),
    ]

    operations = [
        migrations.RunPython(drop_dead_table, noop_reverse),
    ]
