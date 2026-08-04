"""Move souls that were never going to be reborn out of REINCARNATING.

Until 0022, `DispositionService.execute` sent every executed disposition's
soul to REINCARNATING regardless of cosmology, so European and Egyptian souls
have been accumulating in a state that says they are queued for a rebirth
their cosmology does not have. `assert_rebirth_capable` (apps/karma/services.py)
has always refused to actually reincarnate them, so none of these souls can be
legitimately in flight — they are all stuck, and every one of them is safe to
relabel.

Only the two tenant codes whose cosmology is *known* terminal are touched.
Souls whose tenant code is unrecognised are deliberately left where they are:
an unknown tenant is an unknown cosmology, and SETTLED is a state nothing
leaves, so guessing wrong there would close a case that may well have a next
life. Fixing what an unrecognised tenant code means is a separate problem
(see Soul.civilization); this migration does not pretend to have solved it.

The codes are written out literally rather than imported from
apps.souls.models / apps.karma.services on purpose. A migration is frozen
history: it has to keep meaning what it meant on the day it ran, even after
the mapping it was derived from moves.
"""
from django.db import migrations

# Tenant codes whose cosmology ends at a final destination — Heaven/Hell/
# Purgatory-then-Heaven for the European tenant, Aaru or Ammit for the
# Egyptian one. Correct as of this migration; see the module docstring for why
# it is not read from the live mapping.
TERMINAL_TENANT_CODES = ("EU_HEAVEN_HELL", "EG_DUAT")


def settle_terminal_souls(apps, schema_editor):
    Soul = apps.get_model("souls", "Soul")
    # all_objects, not objects: Soul's default manager is tenant-scoped
    # (SoulManager), and a migration has no request and therefore no tenant
    # context, so the scoped manager would silently see nothing. It is also
    # the only manager the historical model carries — see 0018.
    Soul.all_objects.filter(
        current_state="REINCARNATING",
        tenant__code__in=TERMINAL_TENANT_CODES,
    ).update(current_state="SETTLED")


def unsettle_terminal_souls(apps, schema_editor):
    """Put them back the way the pre-0022 code would have left them.

    This is the exact inverse of the whole change, not only of the rows this
    migration moved: souls that reach SETTLED *after* it runs are souls the
    old code would have parked in REINCARNATING, so sending them back there on
    a rollback restores the state the rolled-back code expects to find.
    """
    Soul = apps.get_model("souls", "Soul")
    # all_objects, not objects: Soul's default manager is tenant-scoped
    # (SoulManager), and a migration has no request and therefore no tenant
    # context, so the scoped manager would silently see nothing. It is also
    # the only manager the historical model carries — see 0018.
    Soul.all_objects.filter(
        current_state="SETTLED",
        tenant__code__in=TERMINAL_TENANT_CODES,
    ).update(current_state="REINCARNATING")


class Migration(migrations.Migration):

    dependencies = [
        ("souls", "0022_soulstate_settled"),
    ]

    operations = [
        migrations.RunPython(settle_terminal_souls, unsettle_terminal_souls),
    ]
