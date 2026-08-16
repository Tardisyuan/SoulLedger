"""
Data migration: populate User.rbac_role from User.role TextChoices.
"""
from django.db import migrations

# Hoisted out of populate_rbac_role() unchanged so reverse_populate() can undo
# exactly the pairs the forward writes. The dict's contents and iteration order
# are identical to the literal that used to sit inside the function, so what
# the forward writes is byte-for-byte what it wrote before — this migration is
# applied in production and its forward behaviour must not move.
ROLE_MAPPING = {
    "ADMIN": "ADMIN",
    "JUDGE": "JUDGE",
    "GUARDIAN": "GUARDIAN",
    "VIEWER": "VIEWER",
}


def populate_rbac_role(apps, schema_editor):
    """Map User.role (CharField) → User.rbac_role (FK to perm.Role).

    ``_base_manager`` rather than ``.objects``, for the reason ``reverse_populate``
    below already gives: perm/0012 replaces perm.Role's managers with
    ``all_objects`` alone, and this migration's only perm dependency is
    ``perm/0001`` — a *lower* bound, which does not stop perm from running
    ahead. A whole-database ``manage.py migrate`` happens to schedule this one
    before perm/0012 and so never notices; naming the app does not::

        manage.py migrate                     # everything applied
        manage.py migrate authentication 0009 # unapply 0010..0013
        manage.py migrate authentication      # AttributeError

    …because the second command rolls back only authentication, leaving perm at
    0018 and the historical ``Role`` without an ``objects`` to call.

    The rows found are the same ones either way, so this is not a change of
    behaviour and the already-applied forward stays honest: at every state this
    migration can run in, ``Role.objects`` is the auto-created default manager
    and ``User.objects`` is a plain ``UserManager`` (the soft-delete manager
    arrives in authentication/0012, which cannot be applied while 0010 is not),
    and ``_base_manager`` is unfiltered too. ``.get`` is kept rather than
    ``.filter(...).first()`` so the ``Role.DoesNotExist`` branch below is
    reached exactly as before.
    """
    User = apps.get_model("authentication", "User")
    Role = apps.get_model("perm", "Role")

    for user_role_name, perm_role_name in ROLE_MAPPING.items():
        try:
            perm_role = Role._base_manager.get(name=perm_role_name)
            User._base_manager.filter(
                role=user_role_name, rbac_role__isnull=True
            ).update(rbac_role=perm_role)
        except Role.DoesNotExist:
            pass  # perm.Role not seeded yet — skip


def reverse_populate(apps, schema_editor):
    """Clear only the rbac_role values this migration's forward pass wrote.

    It used to be ``User.objects.all().update(rbac_role=None)`` — every user in
    the table, whatever their rbac_role was and whoever set it. The forward
    writes far less than that: it fills ``rbac_role`` only where the column is
    NULL *and* ``role`` names an existing perm.Role, so the exact complement is
    ``role == X AND rbac_role == Role(name=X)``, one statement per mapped pair.

    Rows the blanket version destroyed and this one leaves alone:

    * a user whose rbac_role was already set when the migration ran and differs
      from the mapping — e.g. ``role='ADMIN'`` posted to MODERATOR. The forward
      skipped it on ``rbac_role__isnull=True``; it is not this migration's to
      clear.
    * a user whose ``role`` names no perm.Role at all, which is the forward's
      ``Role.DoesNotExist`` branch. It was never touched going forward and can
      still be carrying an rbac_role assigned elsewhere.
    * anything application code assigned after the migration whose rbac_role
      disagrees with its ``role`` string — a promotion, in other words.

    The residual case, which cannot be closed without changing the forward: a
    user who already had ``role='ADMIN'`` *and* ``rbac_role=ADMIN`` before this
    migration ran is indistinguishable from one the forward has just written,
    and is cleared along with them. The forward records nothing about which
    rows it touched, and giving it a marker would mean rewriting a migration
    that is already applied in production.

    ``_base_manager`` rather than ``.objects``: perm/0012 replaces perm.Role's
    managers with ``all_objects`` alone, so a rollback of a database whose perm
    app has moved past 0012 finds no ``Role.objects`` to call. Both managers
    are unfiltered, so the rows found are the same ones either way.

    The forward above had that same exposure and now uses ``_base_manager``
    too; ``tests/test_migration_reverse_scope.py::
    test_auth_0010_forward_runs_with_perm_already_past_0012`` runs it through a
    real ``migrate`` with perm left at 0018, which is where it used to raise.
    """
    User = apps.get_model("authentication", "User")
    Role = apps.get_model("perm", "Role")

    for user_role_name, perm_role_name in ROLE_MAPPING.items():
        perm_role = Role._base_manager.filter(name=perm_role_name).first()
        if perm_role is None:
            # The forward's Role.DoesNotExist branch wrote nothing for this
            # pair, so there is nothing to take back.
            continue
        User._base_manager.filter(
            role=user_role_name, rbac_role=perm_role
        ).update(rbac_role=None)


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0009_add_rbac_role_fk"),
        ("perm", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(populate_rbac_role, reverse_populate),
    ]
