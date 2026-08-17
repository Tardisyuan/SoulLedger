"""The four migrations whose reverse reached further than their forward.

``2e82fcd`` built the round-trip harness and, on the way, audited every
``RunPython`` in the tree. Four came back with the same shape — a *conditional*
forward paired with an *unconditional* reverse. Each of those reverses ran
without error and still destroyed rows the migration had never written:

  authentication/0010  forward fills ``rbac_role`` only where it is NULL;
                       reverse did ``User.objects.all().update(rbac_role=None)``
  org/0004             forward fills ``tenant`` only where it is NULL;
                       reverse nulled *every* row of a mapped ``category``
  perm/0008            forward skips a role that already has a Soul scope;
                       reverse deleted every Soul scope of the three roles
  perm/0013            forward get_or_creates six Permissions and two roles'
                       grants; reverse deleted the Permission rows outright,
                       and the FK cascade took everybody else's grants with them

All four are applied in production, so none of the forwards could be given a
marker column recording which rows it had touched. Each reverse is instead
narrowed to the *complement of its own forward's condition*; each migration's
reverse docstring names the one residual shape that leaves behind.

Every test here seeds a row the forward provably skips and then requires it to
survive the rollback. Against the unfixed reverses each of these failed, with
the harness naming the row that went missing.

Two of the four had forwards that did not work, which ``2e82fcd`` recorded and
left alone: authentication/0010 raised ``AttributeError`` whenever perm had
reached 0012, and perm/0008 inserted nothing on any backend that tolerates a
NULL primary key in ``INSERT OR IGNORE``. Both are repaired here, and each has
a test that runs the *forward* through a real ``migrate`` rather than only
asserting on the reverse —
``test_auth_0010_forward_runs_with_perm_already_past_0012`` and
``test_perm_0008_forward_actually_inserts_through_a_real_migrate``.
"""
import json
import uuid
from importlib import import_module

import pytest

from tests.migration_roundtrip import migrate_to, migrate_to_latest, snapshot_rows

AUTH_0010 = import_module("apps.authentication.migrations.0010_populate_rbac_role")
PERM_0008 = import_module("apps.perm.migrations.0008_apply_data_scope_filter")
PERM_0013 = import_module("apps.perm.migrations.0013_add_workflow_permissions")


# --------------------------------------------------------------------------
# authentication/0010_populate_rbac_role
# --------------------------------------------------------------------------

AUTH_USERNAMES = ("blank_admin", "blank_judge", "posted_admin", "unmapped_guardian")


def test_auth_0010_round_trip(migration_round_trip):
    """The blanket ``update(rbac_role=None)`` cleared the whole user table.

    Two of the four users below are untouchable by the forward pass — one
    already carries an ``rbac_role`` (so ``rbac_role__isnull=True`` skips it),
    one has a ``role`` naming a perm.Role that does not exist (so the forward's
    ``Role.DoesNotExist`` branch skips it). Neither is this migration's row to
    clear, and the old reverse cleared both.

    This used to open by rolling perm back to 0011 for the duration, because
    the forward called ``Role.objects.get(...)`` and perm/0012 replaces
    perm.Role's managers with ``all_objects`` alone — so the forward could not
    run at all against a perm app that had reached 0012. That was a way round
    the defect rather than a fix for it; the forward now uses ``_base_manager``
    and perm is left where the test database has it (0018), which is also the
    state ``test_auth_0010_forward_runs_with_perm_already_past_0012`` pins
    directly.
    """
    role_names: dict[int, str] = {}

    def seed(state):
        role_model = state.get_model("perm", "Role")
        user_model = state.get_model("authentication", "User")

        # perm/0017 seeds ADMIN/MODERATOR/JUDGE/GUARDIAN/VIEWER into the test
        # database at creation, so these are get_or_create, and GUARDIAN has to
        # be deleted rather than merely not created.
        role_model._base_manager.filter(name="GUARDIAN").delete()
        roles = {
            name: role_model._base_manager.get_or_create(
                name=name, defaults={"display_name": name}
            )[0]
            for name in ("ADMIN", "JUDGE", "VIEWER", "MODERATOR")
        }
        role_names.update(
            {role.pk: role.name for role in role_model._base_manager.all()}
        )

        # Filled by the forward, cleared by the reverse. Without these the
        # migration would be a no-op and the round trip would prove nothing.
        user_model._base_manager.create(username="blank_admin", role="ADMIN")
        user_model._base_manager.create(username="blank_judge", role="JUDGE")
        # role='ADMIN', but posted to MODERATOR before this migration ran.
        user_model._base_manager.create(
            username="posted_admin", role="ADMIN", rbac_role=roles["MODERATOR"]
        )
        # No perm.Role named GUARDIAN, so the forward cannot touch this user at
        # all — and it still carries an rbac_role assigned from elsewhere.
        user_model._base_manager.create(
            username="unmapped_guardian", role="GUARDIAN", rbac_role=roles["VIEWER"]
        )

    def rbac_role_name(user):
        # Deliberately not a select_related join: `state` is a historical
        # registry, and joining perm_role would select whatever columns that
        # version of perm.Role happens to carry. The id->name map was frozen in
        # `seed`; a pk missing from it is a KeyError rather than a silent None
        # that would read as "this row was cleared".
        if user.rbac_role_id is None:
            return None
        return role_names[user.rbac_role_id]

    def snapshot(state):
        user_model = state.get_model("authentication", "User")
        return snapshot_rows(
            user_model._base_manager.filter(username__in=AUTH_USERNAMES),
            key="username",
            fields={"role": "role", "rbac_role": rbac_role_name},
            prefix="user:",
        )

    def check_forward(state):
        rows = snapshot(state)
        assert rows["user:blank_admin"]["rbac_role"] == "ADMIN"
        assert rows["user:blank_judge"]["rbac_role"] == "JUDGE"
        assert rows["user:posted_admin"]["rbac_role"] == "MODERATOR", (
            "the forward overwrote a posting it was supposed to leave alone"
        )
        assert rows["user:unmapped_guardian"]["rbac_role"] == "VIEWER"

    def check_reverse(state):
        rows = snapshot(state)
        assert rows["user:blank_admin"]["rbac_role"] is None
        assert rows["user:blank_judge"]["rbac_role"] is None
        assert rows["user:posted_admin"]["rbac_role"] == "MODERATOR", (
            "the reverse cleared an rbac_role that predates this migration"
        )
        assert rows["user:unmapped_guardian"]["rbac_role"] == "VIEWER", (
            "the reverse cleared a user whose `role` the forward cannot map"
        )

    migration_round_trip(
        before=("authentication", "0009_add_rbac_role_fk"),
        after=("authentication", "0010_populate_rbac_role"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )


@pytest.mark.django_db(transaction=True)
def test_auth_0010_forward_runs_with_perm_already_past_0012():
    """The forward itself, on the graph order a real ``migrate`` can produce.

    ``authentication/0010`` declares only ``("perm", "0001_initial")``, which is
    a *lower* bound and nothing more — it does not stop perm from running ahead.
    perm/0012 replaces perm.Role's managers with ``all_objects`` alone, so a
    forward that reaches for ``Role.objects`` raises the moment perm has got
    that far. A whole-database ``manage.py migrate`` happens to order
    authentication/0010 first and so never sees it; naming the app does:

        manage.py migrate                     # everything applied
        manage.py migrate authentication 0009 # unapply 0010..0013
        manage.py migrate authentication      # AttributeError

    This test is that third command. Only authentication is rolled back, so
    perm stays where the first command left it — at 0018, well past 0012 — and
    the ``hasattr`` assertion below is what keeps that true: if some later
    change puts ``objects`` back on the historical Role, this test is no longer
    exercising the condition it was written for and says so rather than
    passing quietly.
    """
    try:
        state = migrate_to([("authentication", "0009_add_rbac_role_fk")])
        role_model = state.get_model("perm", "Role")
        user_model = state.get_model("authentication", "User")

        assert not hasattr(role_model, "objects"), (
            "perm.Role still has `objects` at this state — perm is not past "
            "0012 and this test no longer covers the AttributeError it exists for"
        )

        admin = role_model._base_manager.get_or_create(
            name="ADMIN", defaults={"display_name": "Administrator"}
        )[0]
        user_model._base_manager.create(username="fwd_admin", role="ADMIN")

        state = migrate_to(
            [("authentication", "0013_loginlog_delete_cascade_id_user_delete_cascade_id")]
        )
        user_model = state.get_model("authentication", "User")
        assert (
            user_model._base_manager.get(username="fwd_admin").rbac_role_id == admin.pk
        ), "the forward ran but did not populate rbac_role"
    finally:
        migrate_to_latest()


@pytest.mark.django_db
def test_auth_0010_reverse_leaves_a_later_posting_alone():
    """The case the round trip cannot express: a value written *after* the
    migration ran.

    ``run_round_trip`` has no hook between forward and reverse, so this calls
    the two functions directly. A user promoted by application code after the
    migration carries an rbac_role that disagrees with its ``role`` string;
    rolling the migration back is not a reason to strip it.
    """
    from django.apps import apps

    from apps.authentication.models import User
    from apps.perm.models import Role

    admin_role = Role.all_objects.get_or_create(
        name="ADMIN", defaults={"display_name": "Administrator"}
    )[0]
    moderator = Role.all_objects.get_or_create(
        name="MODERATOR", defaults={"display_name": "Realm Lead"}
    )[0]

    filled = User.all_objects.create(username="rt_filled", role="ADMIN")
    AUTH_0010.populate_rbac_role(apps, None)
    filled.refresh_from_db()
    assert filled.rbac_role_id == admin_role.pk

    # …and now application code promotes somebody.
    promoted = User.all_objects.create(
        username="rt_promoted", role="ADMIN", rbac_role=moderator
    )

    AUTH_0010.reverse_populate(apps, None)

    filled.refresh_from_db()
    promoted.refresh_from_db()
    assert filled.rbac_role_id is None, "the reverse did not take back its own write"
    assert promoted.rbac_role_id == moderator.pk, (
        "the reverse stripped an rbac_role assigned after the migration ran"
    )


# --------------------------------------------------------------------------
# org/0004_backfill_organization_tenant
# --------------------------------------------------------------------------


def test_org_0004_round_trip(migration_round_trip):
    """``filter(category__in=CIV_TO_TENANT).update(tenant=None)`` never asked
    *which* tenant a row pointed at.

    A CHINESE-category organization deliberately administered by the European
    tenant is skipped by the forward — its ``tenant`` is not NULL — and was
    nulled by the reverse anyway.
    """

    def seed(state):
        tenant_model = state.get_model("tenants", "Tenant")
        org_model = state.get_model("org", "Organization")

        # Both tenants pre-exist, so the forward's get_or_create finds rather
        # than creates and the Tenant table itself round-trips unchanged.
        tenant_model._base_manager.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Chinese Afterlife"}
        )
        eu = tenant_model._base_manager.get_or_create(
            code="EU_HEAVEN_HELL", defaults={"display_name": "European Afterlife"}
        )[0]

        org_model._base_manager.create(name="第一殿", code="DIYU_01", category="CHINESE")
        org_model._base_manager.create(name="炼狱厅", code="HEAVEN_01", category="EUROPEAN")
        # Chinese by category, European by administration. Whoever set this made
        # a decision; the backfill never touched it.
        org_model._base_manager.create(
            name="联合审判庭", code="JOINT_01", category="CHINESE", tenant=eu
        )

    def snapshot(state):
        org_model = state.get_model("org", "Organization")
        tenant_model = state.get_model("tenants", "Tenant")
        rows = snapshot_rows(
            org_model._base_manager.select_related("tenant").filter(
                code__in=("DIYU_01", "HEAVEN_01", "JOINT_01")
            ),
            key="code",
            fields={
                "category": "category",
                "tenant": lambda o: (o.tenant.code if o.tenant_id else None),
            },
            prefix="org:",
        )
        # Tenants are snapshotted too. The reverse deliberately does *not*
        # delete the Tenant rows the forward may have created, and pinning the
        # table here makes that a stated decision rather than a side effect
        # nobody looked at.
        rows.update(
            snapshot_rows(
                tenant_model._base_manager.all(),
                key="code",
                fields={"display_name": "display_name"},
                prefix="tenant:",
            )
        )
        return rows

    def check_forward(state):
        rows = snapshot(state)
        assert rows["org:DIYU_01"]["tenant"] == "CN_DIYU"
        assert rows["org:HEAVEN_01"]["tenant"] == "EU_HEAVEN_HELL"
        assert rows["org:JOINT_01"]["tenant"] == "EU_HEAVEN_HELL", (
            "the forward re-pointed an organization that already had a tenant"
        )
        assert "tenant:EG_DUAT" not in rows, (
            "a Tenant was created for a category with no organization to backfill"
        )

    def check_reverse(state):
        rows = snapshot(state)
        assert rows["org:DIYU_01"]["tenant"] is None
        assert rows["org:HEAVEN_01"]["tenant"] is None
        assert rows["org:JOINT_01"]["tenant"] == "EU_HEAVEN_HELL", (
            "the reverse nulled a tenant the forward never wrote"
        )

    migration_round_trip(
        before=("org", "0003_organization_tenant"),
        after=("org", "0004_backfill_organization_tenant"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )


# --------------------------------------------------------------------------
# perm/0008_apply_data_scope_filter
# --------------------------------------------------------------------------


def _scope_rows(manager):
    """Every Soul scope, as comparable tuples. No ids: the reverse deletes rows
    and the re-forward makes new ones, so identity would only get in the way."""
    return sorted(
        (
            scope.role.name,
            scope.model_name,
            scope.scope_type,
            scope.priority,
            scope.is_active,
            json.dumps(scope.filter_conditions, sort_keys=True, ensure_ascii=False),
        )
        for scope in manager.select_related("role")
    )


HAND_WRITTEN_SCOPE = (
    "ACTOR", "Soul", "WRITE", 99, True, '{"current_state": ["APPEALING"]}'
)


@pytest.mark.django_db(transaction=True)
def test_perm_0008_forward_actually_inserts_through_a_real_migrate():
    """The forward's ``bulk_create``, run by ``migrate`` at 0008's own state.

    ``RowLevelDataScope.id`` is a UUIDField and its ``default=uuid.uuid4``
    arrives only in perm/0010, so the historical model this migration is handed
    has no default at all. ``bulk_create(..., ignore_conflicts=True)`` therefore
    offers the backend a NULL primary key, and SQLite's ``INSERT OR IGNORE``
    swallows the NOT NULL violation and drops every row without a word.
    (PostgreSQL's ``ON CONFLICT DO NOTHING`` does not absorb NOT NULL, so the
    same statement raises there — the two backends disagree about whether this
    migration is broken.)

    Nobody noticed because the forward almost never gets this far: it opens
    with ``if not Role.objects.exists(): return`` and no migration creates a
    Role row until perm/0017, so on every install the guard fires first. The
    seeding is reachable only where Role rows predate 0008 — which is what the
    seed below builds.

    Measured before the fix: three roles present, an empty scope table, and
    ``0`` rows after the forward.
    """
    try:
        state = migrate_to([("perm", "0007_role_parent")])
        role_model = state.get_model("perm", "Role")
        scope_model = state.get_model("perm", "RowLevelDataScope")

        for name in ("ACTOR", "GUARDIAN", "VIEWER"):
            role_model._base_manager.get_or_create(
                name=name, defaults={"display_name": name}
            )
        scope_model._base_manager.all().delete()

        state = migrate_to([("perm", "0008_apply_data_scope_filter")])
        scope_model = state.get_model("perm", "RowLevelDataScope")

        declared = sorted(
            (
                role_name,
                PERM_0008.SEEDED_MODEL_NAME,
                PERM_0008.SEEDED_SCOPE_TYPE,
                priority,
                True,
                json.dumps(conditions, sort_keys=True, ensure_ascii=False),
            )
            for role_name, conditions, priority in PERM_0008.SEEDED_SCOPES
        )
        assert _scope_rows(scope_model._base_manager) == declared, (
            "the forward inserted nothing (or not what SEEDED_SCOPES describes) "
            "when run by a real migrate at 0008's own historical state"
        )
    finally:
        migrate_to_latest()


@pytest.mark.django_db(transaction=True)
def test_perm_0008_reverse_stops_at_a_hand_written_scope():
    """Driven through real ``migrate``, but not through ``run_round_trip``.

    When this was written the forward inserted nothing at all — the missing
    ``id`` default meant SQLite's ``INSERT OR IGNORE`` dropped all three rows in
    silence — and the measurement was 1 scope before the forward, 1 after, and
    0 after the *old* reverse. A migration that seeded nothing still deleted a
    hand-written rule, because the forward's own guard ("skip a role that
    already has a Soul scope") means a database carrying such a rule is exactly
    the database the forward writes nothing for.

    The forward now inserts, so what this test measures has moved: ACTOR is
    still skipped by that guard, GUARDIAN and VIEWER are now genuinely written,
    and the reverse has to take back those two while leaving the hand-written
    ACTOR/WRITE/priority-99 row standing. The assertions were already phrased
    for that — "whatever the forward wrote must be gone after the reverse, and
    the hand-written row must still be there" — so they did not need loosening;
    they are simply no longer satisfiable by a reverse that does nothing.

    The reason it could not use ``run_round_trip`` has gone with the defect —
    the harness rejects a forward that changes nothing, and this one now
    changes something — so converting it is possible; it is left driving
    ``migrate_to`` by hand because that is what it already does correctly, and
    a rewrite would add no assertion the harness does not already make here.
    """
    try:
        state = migrate_to([("perm", "0007_role_parent")])
        role_model = state.get_model("perm", "Role")
        scope_model = state.get_model("perm", "RowLevelDataScope")

        roles = {
            name: role_model._base_manager.get_or_create(
                name=name, defaults={"display_name": name}
            )[0]
            for name in ("ACTOR", "GUARDIAN", "VIEWER")
        }
        scope_model._base_manager.create(
            id=uuid.uuid4(),  # no default at this historical state
            role=roles["ACTOR"],
            model_name="Soul",
            filter_conditions={"current_state": ["APPEALING"]},
            scope_type="WRITE",
            priority=99,
            is_active=True,
        )
        baseline = _scope_rows(scope_model._base_manager)
        assert baseline == [HAND_WRITTEN_SCOPE], baseline

        state = migrate_to([("perm", "0008_apply_data_scope_filter")])
        scope_model = state.get_model("perm", "RowLevelDataScope")
        after_forward = _scope_rows(scope_model._base_manager)
        assert HAND_WRITTEN_SCOPE in after_forward, (
            "the forward overwrote or removed the hand-written ACTOR scope"
        )

        state = migrate_to([("perm", "0007_role_parent")])
        scope_model = state.get_model("perm", "RowLevelDataScope")
        after_reverse = _scope_rows(scope_model._base_manager)
        assert after_reverse == baseline, (
            f"the reverse did not put the table back: {after_reverse} != {baseline}"
        )
    finally:
        migrate_to_latest()


@pytest.mark.django_db
def test_perm_0008_reverse_deletes_what_it_seeded_and_no_more():
    """The same claim with a forward that actually writes.

    The current model class has the ``uuid.uuid4`` default the historical one
    lacks, so calling the two functions directly is the only way to see the
    seeded rows exist at all — and therefore the only way to show that the
    reverse removes *those* while leaving the hand-written ACTOR rule standing.
    """
    from django.apps import apps

    from apps.perm.models import Role, RowLevelDataScope

    roles = {
        name: Role.all_objects.get_or_create(
            name=name, defaults={"display_name": name}
        )[0]
        for name in ("ACTOR", "GUARDIAN", "VIEWER")
    }
    RowLevelDataScope.objects.all().delete()
    RowLevelDataScope.objects.create(
        role=roles["ACTOR"],
        model_name="Soul",
        filter_conditions={"current_state": ["APPEALING"]},
        scope_type="WRITE",
        priority=99,
        is_active=True,
    )

    PERM_0008.seed_sample_data_scopes(apps, None)

    seeded = _scope_rows(RowLevelDataScope.objects)
    assert HAND_WRITTEN_SCOPE in seeded
    assert len(seeded) == 3, (
        f"expected GUARDIAN and VIEWER seeded and ACTOR skipped, got {seeded}"
    )

    PERM_0008.reverse_seed(apps, None)

    assert _scope_rows(RowLevelDataScope.objects) == [HAND_WRITTEN_SCOPE], (
        "the reverse deleted the hand-written ACTOR scope it never created"
    )


@pytest.mark.django_db
def test_perm_0008_seeded_scopes_table_matches_the_forward():
    """``SEEDED_SCOPES`` is the table the *reverse* deletes by.

    The forward does not read that constant — it still spells the three rows
    out longhand — so nothing in the language keeps the two in step. This test
    is that guarantee: run the real forward on an empty scope table and require
    the rows it produces to be precisely what ``SEEDED_SCOPES`` describes.

    What it is guarding against has changed. While the forward could not insert
    (no ``id`` default at 0008's historical state), this was the *only* place
    the forward's output was observable at all: it calls the function against
    the current model classes, which do carry the default, so it was reading a
    forward that no real ``migrate`` had ever been able to run. It kept the
    reverse's delete-by-description in step with a write that never happened —
    worth having, since the reverse did run and did delete, but a step removed
    from the database.

    Now the forward inserts for real, and
    ``test_perm_0008_forward_actually_inserts_through_a_real_migrate`` makes
    the same comparison at 0008's own historical state. The two overlap
    deliberately rather than redundantly: this one pins the forward against
    today's models (the shape the reverse's own tests exercise), that one pins
    it against the historical models ``migrate`` actually hands it, and the
    ``id`` defect was precisely a disagreement between those two.
    """
    from django.apps import apps

    from apps.perm.models import Role, RowLevelDataScope

    for name in ("ACTOR", "GUARDIAN", "VIEWER"):
        Role.all_objects.get_or_create(name=name, defaults={"display_name": name})
    RowLevelDataScope.objects.all().delete()

    PERM_0008.seed_sample_data_scopes(apps, None)

    declared = sorted(
        (
            role_name,
            PERM_0008.SEEDED_MODEL_NAME,
            PERM_0008.SEEDED_SCOPE_TYPE,
            priority,
            True,
            json.dumps(conditions, sort_keys=True, ensure_ascii=False),
        )
        for role_name, conditions, priority in PERM_0008.SEEDED_SCOPES
    )
    assert _scope_rows(RowLevelDataScope.objects) == declared, (
        "the forward and SEEDED_SCOPES have drifted — the reverse now deletes "
        "by a description of rows the forward no longer writes"
    )


PERM_0017 = import_module("apps.perm.migrations.0017_seed_roles_and_grants")


@pytest.mark.django_db(transaction=True)
def test_perm_0008_sample_scopes_stay_unreachable():
    """A full ``migrate`` from empty must leave the scope table empty.

    The two tests above establish that the forward *can* insert, which is what
    makes this one necessary rather than pedantic: fixing the NULL-primary-key
    defect turned a write that could never happen into one held back by a single
    guard. This pins the outcome that guard produces on a real install, so any
    later change that makes the seeding reachable — dropping the
    ``Role.objects.exists()`` early return, seeding Role rows here, moving 0017
    ahead of 0008 — has to come through this test rather than through a silent
    narrowing of two roles' soul lists.

    See the module docstring of the migration for why reachable is the wrong
    target. The assertion is on the whole table, not on the three rows: a fourth
    sample scope appearing here is the same event.
    """
    migrate_to_latest()

    from apps.perm.models import RowLevelDataScope

    assert _scope_rows(RowLevelDataScope._base_manager.all()) == [], (
        "perm/0008's sample scopes reached a database migrated from empty. "
        "They contradict perm/0017 — see that migration's frozen GRANTS, which "
        "give GUARDIAN and VIEWER an unrestricted soul.read."
    )


def test_perm_0008_sample_scopes_contradict_perm_0017():
    """Name the contradiction, so that resolving it cannot be done by accident.

    Neither constant is read by the other, and both are frozen literals inside
    applied migrations, so nothing in the language connects them. This asserts
    the disagreement *is still there* — which sounds backwards for a test until
    you consider the two ways it goes red:

      - somebody widens 0008's rows or drops one, believing the demo harmless;
      - somebody narrows 0017's ``soul.read`` for GUARDIAN or VIEWER.

    The second is the interesting one. It is the decision the migration docstring
    says belongs in its own migration, and if it is ever taken, these three
    sample rows stop being contradictory and this test is the thing that says so
    out loud — go re-read 0008 and decide deliberately whether they should live.
    """
    scoped_roles = {role_name for role_name, _, _ in PERM_0008.SEEDED_SCOPES}
    assert scoped_roles == {"ACTOR", "GUARDIAN", "VIEWER"}

    # ACTOR is not a role 0017 creates, so its scope can never match a user.
    assert "ACTOR" not in {name for name, _ in PERM_0017.ROLES}, (
        "perm/0017 now seeds an ACTOR role, so perm/0008's ACTOR scope is no "
        "longer inert — re-read 0008's docstring"
    )

    # The other two hold soul.read with no state restriction attached.
    for role_name in ("GUARDIAN", "VIEWER"):
        assert "soul.read" in PERM_0017.GRANTS[role_name], (
            f"perm/0017 no longer grants {role_name} soul.read — perm/0008's "
            f"sample scope for it may have stopped contradicting anything"
        )


# --------------------------------------------------------------------------
# perm/0013_add_workflow_permissions
# --------------------------------------------------------------------------


def _perm_snapshot(state):
    permission_model = state.get_model("perm", "Permission")
    role_permission_model = state.get_model("perm", "RolePermission")
    rows = snapshot_rows(
        permission_model._base_manager.filter(codename__startswith="workflow."),
        key="codename",
        fields={"name": "name", "category": "category"},
        prefix="perm:",
    )
    rows.update(
        snapshot_rows(
            role_permission_model._base_manager.select_related(
                "role", "permission"
            ).filter(permission__codename__startswith="workflow."),
            key=lambda rp: f"{rp.role.name}|{rp.permission.codename}",
            fields={"conditions": "conditions"},
            prefix="grant:",
        )
    )
    return rows


def test_perm_0013_round_trip(migration_round_trip):
    """Deleting the Permission row cascades into everybody else's grants.

    ``workflow.approve`` here exists before the migration and is granted to
    VIEWER by hand. The forward's ``get_or_create`` finds it and writes
    nothing; the old reverse deleted the Permission anyway, and
    ``RolePermission.permission`` being CASCADE took VIEWER's grant with it.
    So a forward that created nothing had a reverse that destroyed two rows.
    """

    def seed(state):
        role_model = state.get_model("perm", "Role")
        permission_model = state.get_model("perm", "Permission")
        role_permission_model = state.get_model("perm", "RolePermission")

        roles = {
            name: role_model._base_manager.get_or_create(
                name=name, defaults={"display_name": name}
            )[0]
            for name in ("ADMIN", "JUDGE", "VIEWER")
        }
        # Pre-existing, with a name of its own so the snapshot can tell whether
        # the round trip preserved this row or rebuilt it from the migration's
        # own table.
        approve = permission_model._base_manager.create(
            codename="workflow.approve", name="人工建的审批权", category="workflow"
        )
        role_permission_model._base_manager.create(
            role=roles["VIEWER"], permission=approve
        )

    def check_forward(state):
        rows = _perm_snapshot(state)
        for codename, _, _ in PERM_0013.WORKFLOW_PERMISSIONS:
            assert f"perm:{codename}" in rows, f"{codename} was not created"
        assert rows["perm:workflow.approve"]["name"] == "人工建的审批权", (
            "the forward overwrote the pre-existing Permission's name"
        )
        for role_name, codenames in PERM_0013.ROLE_GRANTS.items():
            for codename in codenames:
                assert f"grant:{role_name}|{codename}" in rows
        assert "grant:VIEWER|workflow.approve" in rows

    def check_reverse(state):
        rows = _perm_snapshot(state)
        assert sorted(rows) == [
            "grant:VIEWER|workflow.approve",
            "perm:workflow.approve",
        ], f"the reverse did not stop at its own rows: {sorted(rows)}"

    migration_round_trip(
        before=("perm", "0012_alter_datascope_managers_alter_permission_managers_and_more"),
        after=("perm", "0013_add_workflow_permissions"),
        seed=seed,
        snapshot=_perm_snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )


@pytest.mark.django_db
def test_perm_0013_reverse_leaves_a_later_grant_alone():
    """A grant handed out after the migration, to a role the migration never
    mentions.

    GUARDIAN holds no ``workflow.*`` permission in any migration — 0013 grants
    ADMIN and JUDGE, 0014 and 0015 grant MODERATOR, and 0017's frozen matrix
    gives GUARDIAN none — so a GUARDIAN grant can only have come from somebody
    using the permission-management UI. Rolling 0013 back must not revoke it,
    and must not delete the Permission row underneath it either, which is how
    the old reverse revoked it without ever naming GUARDIAN.
    """
    from django.apps import apps

    from apps.perm.models import Permission, Role, RolePermission

    # Start from a stated workflow.* state rather than whatever 0014/0015/0017
    # left in the test database — a preceding `transactional_db` test may have
    # flushed those rows, and "how much did the reverse remove" is only a
    # meaningful question against a known starting set.
    Permission.all_objects.filter(codename__startswith="workflow.").delete()
    roles = {
        name: Role.all_objects.get_or_create(
            name=name, defaults={"display_name": name}
        )[0]
        for name in ("ADMIN", "JUDGE", "GUARDIAN")
    }

    PERM_0013.create_workflow_permissions(apps, None)

    approve = Permission.all_objects.get(codename="workflow.approve", is_deleted=False)
    RolePermission.all_objects.get_or_create(
        role=roles["GUARDIAN"], permission=approve
    )
    guardian, admin = roles["GUARDIAN"], roles["ADMIN"]

    PERM_0013.remove_workflow_permissions(apps, None)

    assert RolePermission.all_objects.filter(
        role=guardian, permission__codename="workflow.approve"
    ).exists(), "the reverse revoked a grant handed out after the migration"
    assert Permission.all_objects.filter(
        codename="workflow.approve", is_deleted=False
    ).exists(), (
        "the reverse deleted a Permission still referenced by somebody else's "
        "grant — the cascade is what does the damage"
    )
    # …while the rows it *did* write are gone, so this is not a reverse that
    # passes by declining to do anything.
    assert not RolePermission.all_objects.filter(
        role=admin, permission__codename__startswith="workflow."
    ).exists()
    assert not Permission.all_objects.filter(codename="workflow.advance").exists(), (
        "workflow.advance was held only by ADMIN and JUDGE, so once their "
        "grants went it had nothing left pointing at it and should have gone too"
    )
