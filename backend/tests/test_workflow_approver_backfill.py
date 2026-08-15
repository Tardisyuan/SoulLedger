"""`workflow/0011_backfill_ten_court_approvers` — what it writes, what it
refuses to write, and that it can be taken back.

The migration exists because the identity check `4ceffe8` added could not
refuse anything: measured against the live database on 2026-08-15, all 30
ApprovalNodes were `approver_type='SYSTEM'` with `approver_actor IS NULL`, and
`approve_node` only consulted `can_approve` for nodes that named an approver.
0011 gives the ten-court nodes the kings their own template names, so the gate
in `views.approve_node` has rows to act on.

The assertions that matter here are the negative ones. A backfill that writes
an approver into a decided node rewrites a record of who actually approved it,
and a backfill that invents an Actor to satisfy a template invents a member of
the pantheon. Both are asserted absent.
"""
from importlib import import_module

import pytest

MIGRATION = "apps.workflow.migrations.0011_backfill_ten_court_approvers"

# The signature rows the migration is keyed on. Imported from the migration
# rather than restated, so a test cannot pass by agreeing with a copy of the
# table that the migration no longer uses. (`import_module` because the module
# name starts with a digit and cannot be written as an import statement — the
# same reason tests/test_purgatorio_terraces.py reaches for it.)
ROWS = import_module(MIGRATION).ROWS

TEN_COURTS = [row for row in ROWS if row[1].endswith("殿")]


@pytest.fixture
def migration():
    return import_module(MIGRATION)


@pytest.fixture
def registry():
    """The current app registry, which is what `apps.get_model` needs."""
    from django.apps import apps

    return apps


def _tenant(code="CN_DIYU", name="Chinese Diyu"):
    from apps.tenants.models import Tenant

    return Tenant.objects.get_or_create(code=code, defaults={"display_name": name})[0]


def _kings(tenant):
    from apps.actors.models import Actor

    return {
        actor_name: Actor.objects.create(
            name=actor_name, civilization="CHINESE", role="JUDGE", tenant=tenant
        )
        for _, _, _, _, actor_name in TEN_COURTS
    }


def _ten_court_workflow(tenant, node_overrides=None):
    """A 十殿审判流程 whose nodes look exactly like the live ones: SYSTEM,
    PENDING, no approver_actor."""
    from apps.souls.models import Soul
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow

    node_overrides = node_overrides or {}
    soul = Soul.objects.create(name="回填受审魂", tenant=tenant)
    workflow = ApprovalWorkflow.objects.create(
        workflow_name="十殿审判流程", soul=soul, case_type="ROUTINE", tenant=tenant
    )
    for node_name, court_code, node_order, _, _ in TEN_COURTS:
        fields = {
            "workflow": workflow,
            "node_name": node_name,
            "court_code": court_code,
            "node_order": node_order,
            "node_type": "TRIAL",
            "approver_type": "SYSTEM",
            "status": "PENDING",
        }
        fields.update(node_overrides.get(node_order, {}))
        ApprovalNode.objects.create(**fields)
    return workflow


@pytest.mark.django_db
class TestBackfillForwards:
    """The forward pass, run directly against the current registry."""

    def test_it_writes_nothing_to_an_empty_database(self, migration, registry, db):
        """The guard every data migration in this repo carries. A fresh install
        has no in-flight workflow to rescue and `WorkflowService` now sets the
        approver at creation; writing here would only hand `seed_mythology`
        rows it did not make."""
        from apps.workflow.models import ApprovalNode

        assert ApprovalNode.objects.count() == 0
        migration.forwards(registry, None)
        assert ApprovalNode.objects.count() == 0

    def test_each_court_gets_its_own_king(self, migration, registry, db):
        from apps.tenants.managers import clear_current_tenant
        from apps.workflow.models import ApprovalNode

        clear_current_tenant()
        tenant = _tenant()
        kings = _kings(tenant)
        workflow = _ten_court_workflow(tenant)

        migration.forwards(registry, None)

        for node_name, _, node_order, _, actor_name in TEN_COURTS:
            node = ApprovalNode.objects.get(workflow=workflow, node_order=node_order)
            assert node.approver_type == "ACTOR", (
                f"{node_name} was left as {node.approver_type}"
            )
            assert node.approver_actor_id == kings[actor_name].pk, (
                f"{node_name} was assigned {node.approver_actor} instead of "
                f"{actor_name} — the court/king pairing is the whole basis for "
                f"this backfill"
            )

    def test_a_decided_node_is_not_rewritten(self, migration, registry, db):
        """The one thing this migration must never do. A node carrying a
        verdict records who actually approved it; writing an approver_actor in
        afterwards dresses a later assumption up as the original decision."""
        from apps.tenants.managers import clear_current_tenant
        from apps.workflow.models import ApprovalNode

        clear_current_tenant()
        tenant = _tenant()
        _kings(tenant)
        workflow = _ten_court_workflow(
            tenant,
            {
                1: {"status": "APPROVED", "verdict": "PASSED"},
                2: {"status": "REJECTED", "verdict": "FAILED"},
            },
        )

        migration.forwards(registry, None)

        for node_order in (1, 2):
            node = ApprovalNode.objects.get(workflow=workflow, node_order=node_order)
            assert node.approver_type == "SYSTEM", (
                f"node {node_order} is decided ({node.status}/{node.verdict}) and "
                f"the backfill touched it anyway"
            )
            assert node.approver_actor_id is None
        # …while its still-pending siblings were backfilled, so the filter is
        # selective rather than a migration that quietly did nothing.
        assert (
            ApprovalNode.objects.filter(workflow=workflow, approver_type="ACTOR").count()
            == 8
        )

    def test_an_already_configured_node_is_left_alone(self, migration, registry, db):
        """Somebody assigning an approver by hand made a decision. The backfill
        fills blanks; it does not overrule."""
        from apps.actors.models import Actor
        from apps.tenants.managers import clear_current_tenant
        from apps.workflow.models import ApprovalNode

        clear_current_tenant()
        tenant = _tenant()
        _kings(tenant)
        stand_in = Actor.objects.create(
            name="判官", civilization="CHINESE", role="JUDGE", tenant=tenant
        )
        workflow = _ten_court_workflow(
            tenant,
            {5: {"approver_type": "ACTOR", "approver_actor": stand_in}},
        )

        migration.forwards(registry, None)

        node = ApprovalNode.objects.get(workflow=workflow, node_order=5)
        assert node.approver_actor_id == stand_in.pk, (
            "the backfill overwrote a hand-assigned approver with 阎罗王"
        )

    def test_a_missing_actor_leaves_the_node_system(self, migration, registry, db):
        """No Actor row, no backfill — and no Actor row created either. The
        node stays SYSTEM, which after this change means escalate-only, and
        that is the safe side. Inventing 秦广王 because a template mentions him
        is how fabricated cast members get into a database."""
        from apps.actors.models import Actor
        from apps.tenants.managers import clear_current_tenant
        from apps.workflow.models import ApprovalNode

        clear_current_tenant()
        tenant = _tenant()
        workflow = _ten_court_workflow(tenant)  # no kings seeded at all
        actors_before = Actor.objects.count()

        migration.forwards(registry, None)

        assert Actor.objects.count() == actors_before, (
            "the migration created Actor rows to satisfy a workflow template"
        )
        assert ApprovalNode.objects.filter(
            workflow=workflow, approver_type="SYSTEM"
        ).count() == 10

    def test_another_tenants_king_is_not_borrowed(self, migration, registry, db):
        """`Actor.name` is not globally unique. A tenant whose own bench is
        empty must fall through to SYSTEM rather than adopt the neighbouring
        tenant's 秦广王 as its approver."""
        from apps.tenants.managers import clear_current_tenant
        from apps.workflow.models import ApprovalNode

        clear_current_tenant()
        neighbour = _tenant(code="CN_DIYU_B", name="Another Diyu")
        _kings(neighbour)
        mine = _tenant()
        workflow = _ten_court_workflow(mine)

        migration.forwards(registry, None)

        assert ApprovalNode.objects.filter(
            workflow=workflow, approver_type="SYSTEM"
        ).count() == 10, "a node was assigned an approver from another tenant"

    def test_running_it_twice_changes_nothing(self, migration, registry, db):
        from apps.tenants.managers import clear_current_tenant
        from apps.workflow.models import ApprovalNode

        clear_current_tenant()
        tenant = _tenant()
        _kings(tenant)
        workflow = _ten_court_workflow(tenant)

        migration.forwards(registry, None)
        first = dict(
            ApprovalNode.objects.filter(workflow=workflow).values_list(
                "node_order", "approver_actor_id"
            )
        )
        migration.forwards(registry, None)
        second = dict(
            ApprovalNode.objects.filter(workflow=workflow).values_list(
                "node_order", "approver_actor_id"
            )
        )
        assert first == second

    def test_backwards_restores_system(self, migration, registry, db):
        from apps.tenants.managers import clear_current_tenant
        from apps.workflow.models import ApprovalNode

        clear_current_tenant()
        tenant = _tenant()
        _kings(tenant)
        workflow = _ten_court_workflow(tenant)

        migration.forwards(registry, None)
        migration.backwards(registry, None)

        rows = ApprovalNode.objects.filter(workflow=workflow)
        assert rows.count() == 10
        assert all(node.approver_type == "SYSTEM" for node in rows)
        assert all(node.approver_actor_id is None for node in rows)

    def test_backwards_leaves_a_reassigned_node_alone(self, migration, registry, db):
        """The reverse takes back what the forward wrote. A node somebody
        repointed at a different king afterwards is a posting, not this
        migration's row to delete."""
        from apps.actors.models import Actor
        from apps.tenants.managers import clear_current_tenant
        from apps.workflow.models import ApprovalNode

        clear_current_tenant()
        tenant = _tenant()
        _kings(tenant)
        workflow = _ten_court_workflow(tenant)
        migration.forwards(registry, None)

        stand_in = Actor.objects.create(
            name="崔府君", civilization="CHINESE", role="JUDGE", tenant=tenant
        )
        ApprovalNode.objects.filter(workflow=workflow, node_order=5).update(
            approver_actor=stand_in
        )

        migration.backwards(registry, None)

        node = ApprovalNode.objects.get(workflow=workflow, node_order=5)
        assert node.approver_actor_id == stand_in.pk
        assert node.approver_type == "ACTOR"


def test_workflow_0011_round_trip(migration_round_trip):
    """forward -> reverse -> forward through real `migrate`, compared as rows.

    The class above calls the migration's two functions against the current
    registry, which says nothing about whether `manage.py migrate workflow
    0010` actually runs. See tests/migration_roundtrip.py for why "the reverse
    ran" is not the assertion that matters.
    """
    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        tenant_model = state.get_model("tenants", "Tenant")
        actor_model = state.get_model("actors", "Actor")
        soul_model = state.get_model("souls", "Soul")
        workflow_model = state.get_model("workflow", "ApprovalWorkflow")
        node_model = state.get_model("workflow", "ApprovalNode")

        tenant = tenant_model._base_manager.create(
            code="CN_DIYU", display_name="Chinese Diyu"
        )
        for _, _, _, _, actor_name in TEN_COURTS:
            actor_model._base_manager.create(
                name=actor_name, civilization="CHINESE", role="JUDGE", tenant=tenant
            )
        soul = soul_model._base_manager.create(name="往返受审魂", tenant=tenant)
        workflow = workflow_model._base_manager.create(
            workflow_name="十殿审判流程", soul=soul, case_type="ROUTINE", tenant=tenant
        )
        for node_name, court_code, node_order, _, _ in TEN_COURTS:
            # The fifth court is already decided. It has to survive the round
            # trip untouched in *both* directions — the forward must not
            # backfill it and the reverse must not clear anything off it.
            decided = node_order == 5
            node_model._base_manager.create(
                workflow=workflow,
                node_name=node_name,
                court_code=court_code,
                node_order=node_order,
                node_type="TRIAL",
                approver_type="SYSTEM",
                status="APPROVED" if decided else "PENDING",
                verdict="PASSED" if decided else "",
            )

    def snapshot(state):
        node_model = state.get_model("workflow", "ApprovalNode")
        return snapshot_rows(
            node_model._base_manager.select_related("approver_actor"),
            key=lambda n: f"{n.court_code}#{n.node_order}",
            fields={
                "node_name": "node_name",
                "approver_type": "approver_type",
                "status": "status",
                "verdict": "verdict",
                "approver_actor": lambda n: (
                    n.approver_actor.name if n.approver_actor_id else None
                ),
            },
            prefix="node:",
        )

    def check_forward(state):
        rows = snapshot(state)
        for node_name, court_code, node_order, _, actor_name in TEN_COURTS:
            row = rows[f"node:{court_code}#{node_order}"]
            if node_order == 5:
                assert row["approver_type"] == "SYSTEM", (
                    f"the decided fifth-court node was backfilled: {row}"
                )
                assert row["approver_actor"] is None
                continue
            assert row["approver_type"] == "ACTOR", f"{node_name} left as {row}"
            assert row["approver_actor"] == actor_name, (
                f"{node_name} was given {row['approver_actor']}, not {actor_name}"
            )

    def check_reverse(state):
        rows = snapshot(state)
        left = sorted(k for k, v in rows.items() if v["approver_actor"] is not None)
        assert left == [], f"the reverse left approvers behind: {left}"
        assert rows["node:第五殿#5"]["status"] == "APPROVED", (
            "the reverse disturbed the decided node"
        )

    migration_round_trip(
        before=("workflow", "0010_approvalnode_delete_cascade_id_and_more"),
        after=("workflow", "0011_backfill_ten_court_approvers"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )
