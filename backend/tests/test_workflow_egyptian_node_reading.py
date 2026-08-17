"""Anubis operates the balance, and the forty-two make a statement.

What was wrong
--------------
The heart-weighing template's first two nodes read::

    阿努比斯 · 引渡审判    NodeType.TRIAL
    四十二神官 · 罪行核实   NodeType.TRIAL

Both the name and the type asserted the same rejected claim, twice each.

* Anubis **operates the balance**; he is not a judge. Plate III's inscription
  calls him 「O weigher of righteousness」 and BD 30B 「him who keepeth the
  scales」 (Budge, *Papyrus of Ani* 1895; the same scene independently in
  BM EA 9901, Hunefer). Thoth records and reads the verdict, the Ennead
  approves, Osiris accepts. `docs/lore-verification/README.md`'s position table
  lists 「Anubis | judge | operates the scales」 among the errors its audits
  could not see; `verify-egyptian.md` §7 row 8 files `Anubis → JUDGE` as wrong
  in kind.
* The forty-two negative declarations are one **statement** made by the
  deceased on entering the hall (BD 125B), not an instance of a court. The
  assessors decide nothing, and there is no verification (「核实」) in the rite
  for them to perform.

The frontend had already corrected its copies —
`frontend/src/config/workflow-templates.ts` renamed them to
`Anubis · 引导与称量` and `42审判者 · 否定告白`, and
`src/config/workflow-node-types.ts` maps both to `EVALUATION` — while leaving a
comment saying the backend still carried the old reading. It did, so the same
question had two answers depending on which end you asked.

What this file pins
-------------------
1. The reading, at the source: both nodes are EVALUATION and neither name
   contains the words that carried the rejected claim.
2. The reading, in a workflow actually built — because the template is copied
   into `ApprovalNode` rows, and it is the rows a user sees.
3. That the second node is *still* excused from approver resolution. Renaming a
   node that appears in `TEMPLATE_NODES_WITHOUT_AN_APPROVER` is exactly how an
   excuse silently stops applying: the table is keyed by name.
4. That `workflow/0012` corrects rows already stored under the old spellings,
   forward and back, compared as data.

Why a migration exists at all — and what was and was not measured
-----------------------------------------------------------------
`ApprovalNode` rows are copied from the template at creation, so changing the
template only affects workflows built afterwards. Rows already stored keep the
old name and type.

Measured here: `backend/db.sqlite3` (the local development database) holds
**0** rows in `workflow_approvalnode`. Not measured here: the production
database at `192.168.2.115:5432`, which is unreachable from this environment
(`nc -z -w 3` exits 1). `0011`'s docstring records someone else's 2026-08-15
count of it — 30 nodes, all in three 十殿审判流程 workflows, no Egyptian rows —
but that is a reading this task did not take. Since absence could not be
demonstrated, the migration is written to the repository's usual shape: a no-op
on an empty table, a no-op when nothing matches the signature, and reversible.

What "would really fail" means here
-----------------------------------
Each assertion was checked by breaking it — putting `NodeType.TRIAL` back on
either node, restoring either old name, and emptying `0012.RENAMES` each redden
a different case below. The mutations and their output are in the task report.
"""
import io
from importlib import import_module

import pytest
from django.core.management import call_command

from apps.judgment.models import Judgment
from apps.souls.models import CIVILIZATION_TENANT, Civilization, Soul
from apps.tenants.managers import clear_current_tenant
from apps.tenants.models import Tenant
from apps.workflow.models import CaseType, NodeType
from apps.workflow.services import (
    TEMPLATE_NODES_WITHOUT_AN_APPROVER,
    WORKFLOW_TEMPLATES,
    WorkflowService,
)

MIGRATION = "apps.workflow.migrations.0012_correct_the_egyptian_weighing_nodes"

#: `(old_name, new_name, court, order, old_type, new_type)` — imported from the
#: migration rather than restated, so a test cannot pass by agreeing with a copy
#: of the table the migration no longer uses. (`import_module` because the
#: module name starts with a digit.)
RENAMES = import_module(MIGRATION).RENAMES

WEIGHING = (Civilization.EGYPTIAN, CaseType.HEART_WEIGHING)

#: The words the old names carried, and what each of them claimed.
REJECTED_WORDS = {
    "审判": "says Anubis judges; he operates the balance (BD 30B, plate III)",
    "核实": "says the assessors verify; BD 125B has the deceased declare",
}


@pytest.fixture
def seeded(db):
    clear_current_tenant()
    call_command("seed_mythology", stdout=io.StringIO())


def _tenant(civilization: str) -> Tenant:
    return Tenant.objects.get(code=CIVILIZATION_TENANT[civilization])


# ── the template ──────────────────────────────────────────────────────


def test_the_weighing_and_the_confession_are_evaluations_not_trials():
    """Neither step adjudicates, so neither is a TRIAL.

    Stated on the two nodes by position rather than by name, so that renaming
    one of them cannot make this pass by matching nothing.
    """
    nodes = WORKFLOW_TEMPLATES[WEIGHING]["nodes"]
    assert [node["order"] for node in nodes] == [1, 2, 3]

    weighing, confession, verdict = nodes
    assert weighing["type"] == NodeType.EVALUATION, (
        f"{weighing['name']} is typed {weighing['type']}. Anubis operates the "
        f"balance — plate III's 「O weigher of righteousness」, BD 30B's 「him "
        f"who keepeth the scales」 — and the verdict is Thoth's to read and "
        f"Osiris' to accept. Weighing produces a measurement, not a decision."
    )
    assert confession["type"] == NodeType.EVALUATION, (
        f"{confession['name']} is typed {confession['type']}. The forty-two "
        f"declarations are one statement made on entering the hall (BD 125B); "
        f"the assessors hold no instance of a court."
    )
    # Absence: the step that IS the decision is still typed as one, so this is
    # not a file that flattened the whole template into EVALUATION.
    assert verdict["type"] == NodeType.FINAL, (
        f"{verdict['name']} is typed {verdict['type']}. Osiris accepts the "
        f"verdict; that step is the adjudication and must stay FINAL."
    )


def test_neither_name_still_carries_the_reading_the_type_no_longer_does():
    """The words, not just the enum.

    Changing `node_type` while leaving 「引渡审判」 in the label would leave the
    node contradicting itself in the one column a reader sees first — and the
    label is what `_resolve_approver` reads, what the migration matches on, and
    what appears in the UI.
    """
    names = [node["name"] for node in WORKFLOW_TEMPLATES[WEIGHING]["nodes"][:2]]
    offenders = [
        f"{name}: 「{word}」 {why}"
        for name in names
        for word, why in REJECTED_WORDS.items()
        if word in name
    ]
    assert offenders == [], (
        f"heart-weighing node labels still asserting what their type denies: "
        f"{offenders}"
    )
    assert names == ["阿努比斯 · 引导与称量", "四十二神官 · 否定告白"], names


def test_the_renamed_bench_is_still_recorded_as_naming_nobody():
    """`TEMPLATE_NODES_WITHOUT_AN_APPROVER` is keyed by name.

    So renaming a node listed there silently drops its excuse and hands the
    label to `_resolve_approver`'s fallback. The generic
    `TestTemplateApproverBasis` case would catch the *unexplained* direction,
    but this states the specific one that this change could have broken.
    """
    confession = WORKFLOW_TEMPLATES[WEIGHING]["nodes"][1]
    assert confession["name"] in TEMPLATE_NODES_WITHOUT_AN_APPROVER
    assert "罪行核实" not in TEMPLATE_NODES_WITHOUT_AN_APPROVER, (
        "the old key is still in the table, explaining a node no template has"
    )


# ── a workflow actually built from it ─────────────────────────────────


@pytest.mark.django_db
def test_a_heart_weighing_workflow_is_built_with_the_corrected_reading(seeded):
    """The rows, not the dict. `ApprovalNode` is what a user reads."""
    tenant = _tenant(Civilization.EGYPTIAN)
    soul = Soul.objects.create(name="称心魂", tenant=tenant)
    judgment = Judgment.objects.create(
        soul=soul, civilization=Civilization.EGYPTIAN, court="—",
        verdict="PASSED", is_final=True, tenant=tenant,
    )

    workflow = WorkflowService.create_from_judgment(judgment)
    built = [
        (node.node_name, node.node_type)
        for node in workflow.nodes.order_by("node_order")
    ]

    assert built == [
        ("阿努比斯 · 引导与称量", NodeType.EVALUATION),
        ("四十二神官 · 否定告白", NodeType.EVALUATION),
        ("欧西里斯 · 终审", NodeType.FINAL),
    ]

    # …and the approver work `625f4d1` does off the label still happens: Anubis
    # resolves through his `actor` key, the bench stays SYSTEM because it is
    # recorded as naming nobody, and Osiris resolves through his alias. A
    # rename that quietly turned the first node SYSTEM would pass the list
    # above and be a stuck workflow.
    first, second, third = workflow.nodes.order_by("node_order")
    assert (first.approver_type, first.approver_actor.name) == ("ACTOR", "Anubis")
    assert (second.approver_type, second.approver_actor_id) == ("SYSTEM", None)
    assert (third.approver_type, third.approver_actor.name) == ("ACTOR", "Osiris")


# ── the rows that may already be stored ───────────────────────────────


@pytest.mark.django_db
def test_the_migration_writes_nothing_to_an_empty_database(db):
    """The guard every data migration in this repo carries."""
    from django.apps import apps

    from apps.workflow.models import ApprovalNode

    assert ApprovalNode.objects.count() == 0
    import_module(MIGRATION).forwards(apps, None)
    assert ApprovalNode.objects.count() == 0


@pytest.mark.django_db
def test_the_migration_leaves_a_node_somebody_else_re_typed_alone(db):
    """Signature match includes `node_type`, on purpose.

    A node carrying the old name but a type nobody in `RENAMES` wrote is
    somebody's decision, not a row this migration is responsible for.
    """
    from django.apps import apps

    from apps.workflow.models import ApprovalNode, ApprovalWorkflow

    clear_current_tenant()
    tenant = Tenant.objects.create(code="EG_DUAT_X", display_name="Duat")
    soul = Soul.objects.create(name="手工改过的魂", tenant=tenant)
    workflow = ApprovalWorkflow.objects.create(
        soul=soul, workflow_name="欧西里斯称重流程",
        case_type=CaseType.HEART_WEIGHING, tenant=tenant,
    )
    hand_edited = ApprovalNode.objects.create(
        workflow=workflow, node_name="阿努比斯 · 引渡审判",
        court_code="Hall of Two Truths", node_order=1,
        node_type="APPEAL", approver_type="SYSTEM", status="PENDING",
    )

    import_module(MIGRATION).forwards(apps, None)

    hand_edited.refresh_from_db()
    assert (hand_edited.node_name, hand_edited.node_type) == (
        "阿努比斯 · 引渡审判", "APPEAL"
    )


def test_workflow_0012_round_trip(migration_round_trip):
    """forward -> reverse -> forward through real `migrate`, compared as rows.

    See `tests/migration_roundtrip.py` for why "the reverse ran" is not the
    assertion that matters.
    """
    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        tenant_model = state.get_model("tenants", "Tenant")
        soul_model = state.get_model("souls", "Soul")
        workflow_model = state.get_model("workflow", "ApprovalWorkflow")
        node_model = state.get_model("workflow", "ApprovalNode")

        tenant = tenant_model._base_manager.create(
            code="EG_DUAT", display_name="Egyptian Duat"
        )
        soul = soul_model._base_manager.create(name="往返称心魂", tenant=tenant)
        workflow = workflow_model._base_manager.create(
            workflow_name="欧西里斯称重流程", soul=soul,
            case_type="HEART_WEIGHING", tenant=tenant,
        )
        for old_name, _new, court, order, old_type, _new_type in RENAMES:
            # The first of the two is already decided. Its name and type are
            # corrected like any other — that is the whole difference from
            # 0011's PENDING-only filter, and it is deliberate: this migration
            # fixes a description that was wrong when the row was written, and
            # touches no column recording who decided what.
            decided = order == 1
            node_model._base_manager.create(
                workflow=workflow,
                node_name=old_name,
                court_code=court,
                node_order=order,
                node_type=old_type,
                approver_type="SYSTEM",
                status="APPROVED" if decided else "PENDING",
                verdict="PASSED" if decided else "",
            )
        # A third node the migration must not touch at all.
        node_model._base_manager.create(
            workflow=workflow, node_name="欧西里斯 · 终审", court_code="Duat",
            node_order=3, node_type="FINAL", approver_type="SYSTEM",
            status="PENDING", verdict="",
        )

    def snapshot(state):
        node_model = state.get_model("workflow", "ApprovalNode")
        return snapshot_rows(
            node_model._base_manager.all(),
            key=lambda n: f"{n.court_code}#{n.node_order}",
            fields={
                "node_name": "node_name",
                "node_type": "node_type",
                "status": "status",
                "verdict": "verdict",
            },
            prefix="node:",
        )

    def check_forward(state):
        node_model = state.get_model("workflow", "ApprovalNode")
        for _old, new_name, court, order, _old_type, new_type in RENAMES:
            node = node_model._base_manager.get(court_code=court, node_order=order)
            assert (node.node_name, node.node_type) == (new_name, new_type), (
                f"node {order} is {node.node_name!r}/{node.node_type} after "
                f"the forward pass, expected {new_name!r}/{new_type}"
            )
        # The decided node kept every column recording the decision.
        decided = node_model._base_manager.get(node_order=1)
        assert (decided.status, decided.verdict) == ("APPROVED", "PASSED"), (
            "the correction rewrote a record of what was actually decided"
        )
        # And the node outside RENAMES was not touched.
        untouched = node_model._base_manager.get(node_order=3)
        assert (untouched.node_name, untouched.node_type) == (
            "欧西里斯 · 终审", "FINAL"
        )

    def check_reverse(state):
        node_model = state.get_model("workflow", "ApprovalNode")
        for old_name, _new, court, order, old_type, _new_type in RENAMES:
            node = node_model._base_manager.get(court_code=court, node_order=order)
            assert (node.node_name, node.node_type) == (old_name, old_type)

    migration_round_trip(
        before=("workflow", "0011_backfill_ten_court_approvers"),
        after=("workflow", "0012_correct_the_egyptian_weighing_nodes"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )
