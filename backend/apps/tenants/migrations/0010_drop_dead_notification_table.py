"""Drop `apps.tenants.Notification` — no reader anywhere in the repository.

See `backend/tests/test_a_dispatch_notification_reaches_a_reader.py` and
`apps/tenants/models.py` for what this table was and why it never mattered:
four writers in `apps/dispatch/services.py`, zero readers (no serializer, no
view, no consumer). `apps.notifications.UserNotification` is the model that is
actually served.

**Before running this migration against 192.168.2.115 (or any shared
environment), check whether that table has rows.** This is a plain
`DeleteModel`, not a conditional `IF EXISTS` drop like migration 0009 — the
model existed on every database this migration's dependency chain runs on, so
there is no "was this table ever created" question here. There IS a "does it
have data nothing has read yet" question, and this migration does not answer
it — it only removes the table.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("tenants", "0009_drop_dead_cross_tenant_permission_table"),
    ]

    operations = [
        migrations.DeleteModel(
            name="Notification",
        ),
    ]
