"""
Migration: Apply data scope filter to RowLevelDataScope.

This migration seeds sample RowLevelDataScope entries that demonstrate
the data scope filtering capability.
"""
import json
import uuid

from django.db import migrations

# What seed_sample_data_scopes() writes, restated as data so reverse_seed() can
# delete by description instead of by role name alone. Kept as a separate
# constant rather than driving the forward from it: this migration is applied
# in production, and the only edit its forward has taken is the explicit
# ``id=uuid.uuid4()`` that makes the insert reach the table at all (see that
# function's docstring) — the rows it describes are unchanged. So the constant
# the reverse reads is still not the constant the forward writes from, and the
# pairing is held in step by
# tests/test_migration_reverse_scope.py::test_perm_0008_seeded_scopes_table_matches_the_forward
# and ::test_perm_0008_forward_actually_inserts_through_a_real_migrate, which
# run the forward — against the current models and against 0008's own
# historical state respectively — and compare what it produced against this
# table.
SEEDED_MODEL_NAME = 'Soul'
SEEDED_SCOPE_TYPE = 'READ'
SEEDED_SCOPES = [
    # (role name, filter_conditions, priority)
    ('ACTOR', {"current_state": ["PENDING"]}, 10),
    ('GUARDIAN', {"current_state": ["DISPOSED"]}, 10),
    ('VIEWER', {"current_state": ["ALIVE"]}, 5),
]


def _freeze(conditions):
    """A comparable, order-independent form of a filter_conditions value.

    ``{"a": 1, "b": 2}`` and ``{"b": 2, "a": 1}`` are the same filter and
    should compare equal; whichever of the two a given backend happens to hand
    back from a JSONField must not change what the rollback deletes.
    """
    return json.dumps(conditions, sort_keys=True, ensure_ascii=False)


def seed_sample_data_scopes(apps, schema_editor):
    """
    Seed sample RowLevelDataScope entries for demonstration.

    In production, these would be managed via admin or fixtures.

    ``id=uuid.uuid4()`` is passed explicitly on every row. ``RowLevelDataScope.id``
    is a UUIDField whose ``default=uuid.uuid4`` does not arrive until perm/0010,
    so the historical model this migration is handed has no default at all: the
    ``bulk_create(..., ignore_conflicts=True)`` below was offering the backend a
    NULL primary key, and SQLite's ``INSERT OR IGNORE`` swallowed the NOT NULL
    violation and dropped all three rows in silence. (PostgreSQL's ``ON CONFLICT
    DO NOTHING`` does not absorb NOT NULL and would have raised instead — the
    two backends disagreed about whether this migration worked.)

    Why that went unseen for so long, and why fixing it changes nothing on any
    existing database: the ``Role.objects.exists()`` guard three lines down
    returns first. perm/0017 holds the only ``Role...get_or_create`` in any
    migration in the tree — 0017's own docstring records that Role rows were
    otherwise being made by the runtime init API and owned by no migration — so
    on a database migrated from empty this forward is already back out the door
    before it reaches the insert. Measured: a full ``manage.py migrate`` from
    scratch, before this change and after it, produces byte-identical
    databases, both with zero rows in ``permissions_row_level_data_scope``. And
    any PostgreSQL database that applied 0008 without raising had an empty Role
    table when it did, since the NOT NULL would have stopped it otherwise.

    So the seeding is reachable only where Role rows predate 0008, which today
    is only the round-trip tests. Were it ever reached for real, the GUARDIAN
    and VIEWER rows would narrow those roles' Soul lists to ``DISPOSED`` and
    ``ALIVE`` respectively through ``apps/perm/filters.py::DataScopeFilter``;
    the ACTOR row names a role that exists in neither ``UserRole`` nor
    ``DEFAULT_ROLES`` and would match nobody. That is a decision about
    visibility, not a defect fix, and it is deliberately not taken here — the
    guards, and therefore what every real database ends up holding, are
    untouched.
    """
    # Skip if running in test environment without Role model
    try:
        Role = apps.get_model('perm', 'Role')
        RowLevelDataScope = apps.get_model('perm', 'RowLevelDataScope')
    except LookupError:
        return

    # Only seed if tables exist and are empty
    if not Role.objects.exists():
        return

    def get_role(name):
        try:
            return Role.objects.get(name=name)
        except Role.DoesNotExist:
            return None

    scopes_to_create = []

    # ACTOR can only see PENDING souls in their civilization
    actor_role = get_role('ACTOR')
    if actor_role and not RowLevelDataScope.objects.filter(role=actor_role, model_name='Soul').exists():
        scopes_to_create.append(
            RowLevelDataScope(
                id=uuid.uuid4(),
                role=actor_role,
                model_name='Soul',
                filter_conditions={"current_state": ["PENDING"]},
                scope_type='READ',
                priority=10,
                is_active=True,
            )
        )

    # GUARDIAN can see DISPOSED souls in their civilization
    guardian_role = get_role('GUARDIAN')
    if guardian_role and not RowLevelDataScope.objects.filter(role=guardian_role, model_name='Soul').exists():
        scopes_to_create.append(
            RowLevelDataScope(
                id=uuid.uuid4(),
                role=guardian_role,
                model_name='Soul',
                filter_conditions={"current_state": ["DISPOSED"]},
                scope_type='READ',
                priority=10,
                is_active=True,
            )
        )

    # VIEWER can see ALIVE souls
    viewer_role = get_role('VIEWER')
    if viewer_role and not RowLevelDataScope.objects.filter(role=viewer_role, model_name='Soul').exists():
        scopes_to_create.append(
            RowLevelDataScope(
                id=uuid.uuid4(),
                role=viewer_role,
                model_name='Soul',
                filter_conditions={"current_state": ["ALIVE"]},
                scope_type='READ',
                priority=5,
                is_active=True,
            )
        )

    if scopes_to_create:
        RowLevelDataScope.objects.bulk_create(scopes_to_create, ignore_conflicts=True)


def reverse_seed(apps, schema_editor):
    """Remove the seeded data scopes — the seeded ones, and nothing else.

    This used to delete every ACTOR/GUARDIAN/VIEWER row with
    ``model_name='Soul'``, which is strictly more than the forward can ever
    create. The forward's own guard is what makes that dangerous: it skips a
    role that *already has* a Soul scope, so on a database carrying a
    hand-written ACTOR/Soul rule the forward writes nothing for ACTOR at all —
    and the old reverse then deleted that hand-written rule. A migration that
    inserted no rows still removed one.

    So the match here is the full row description from SEEDED_SCOPES: role
    name, model_name, scope_type, priority, filter_conditions and is_active,
    all of them. A scope somebody added for the same role and model with a
    different state filter, priority or scope_type is left where it is.

    The comparison is done in Python rather than as a ``filter_conditions=...``
    lookup: JSONField exact-match semantics differ between the SQLite used
    locally and the PostgreSQL used in production, and a rollback that deletes
    a different set of rows depending on the backend is worse than one that is
    merely slow. There are three rows to consider.

    Residual case, unclosable without changing an already-applied forward: a
    hand-written scope that happens to match the seed description exactly is
    indistinguishable from the seed and is deleted with it. The forward's guard
    means such a row would in fact have *prevented* the seed from being written
    — so this is the one shape where the reverse still removes a row the
    forward did not create.
    """
    try:
        RowLevelDataScope = apps.get_model('perm', 'RowLevelDataScope')
        apps.get_model('perm', 'Role')
    except LookupError:
        return

    seeded = {
        (role_name, SEEDED_SCOPE_TYPE, priority, _freeze(conditions))
        for role_name, conditions, priority in SEEDED_SCOPES
    }
    doomed = [
        scope.pk
        for scope in RowLevelDataScope._base_manager.filter(
            role__name__in=[name for name, _, _ in SEEDED_SCOPES],
            model_name=SEEDED_MODEL_NAME,
            is_active=True,
        ).select_related('role')
        if (
            scope.role.name,
            scope.scope_type,
            scope.priority,
            _freeze(scope.filter_conditions),
        ) in seeded
    ]
    RowLevelDataScope._base_manager.filter(pk__in=doomed).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('perm', '0007_role_parent'),
    ]

    operations = [
        migrations.RunPython(
            seed_sample_data_scopes,
            reverse_seed,
        ),
    ]
