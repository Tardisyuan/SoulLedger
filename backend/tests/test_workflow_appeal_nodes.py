"""An appeal workflow must have nodes, whichever door it was raised through.

The defect
----------
``WorkflowService.create_appeal_workflow`` looked its template up like this::

    appeal_template = WORKFLOW_TEMPLATES.get((soul.civilization, CaseType.APPEAL))
    if appeal_template:
        ...create the nodes...

``WORKFLOW_TEMPLATES`` carried an ``APPEAL`` entry for the **Chinese only**, so
for a European or Egyptian soul that ``get`` answered ``None``, the ``if`` was
false, the node loop never ran, and the method returned an ``ApprovalWorkflow``
with **zero nodes**: ``status=PENDING`` and ``current_node=None``. Such a row
cannot be advanced (``advance_to_next`` finds no next node), cannot be approved
(``approve_node`` answers 404 "Node not found") and cannot be escalated
(``escalate`` needs a next node too). It is a stuck row, and nothing raised.

Two causes, not one — and the distinction is why both were fixed:

1. **Structural.** This method did not resolve templates the way
   ``create_from_judgment`` does. That method reads the tenant's stored
   ``WorkflowTemplate`` rows first, falls back to ``WORKFLOW_TEMPLATES``, and
   ends in a generic one-node flow — so it *cannot* produce a node-less
   workflow. This one read one table and had no fallback at all. It also never
   read stored templates, so a tenant that had saved its own ``EUROPEAN_APPEAL``
   preset still got nothing through this door.
2. **Content.** ``WORKFLOW_TEMPLATES`` had no European or Egyptian appeal to
   find. Fixing only (1) would have made both civilizations' appeals a single
   generic 「审批节点」 — movable, but saying nothing about who hears an appeal.

Both are closed: ``_resolve_template`` is now the single lookup both doors call,
and ``WORKFLOW_TEMPLATES`` carries ``(EUROPEAN, APPEAL)`` and
``(EGYPTIAN, APPEAL)`` ported from the presets in
``frontend/src/config/workflow-templates.ts``, which already carried the
sourcing. No actor was invented for them: Michael, Christ, Isis, Nephthys and
Osiris are all rows ``seed_mythology`` seeds, and this file asserts that rather
than assuming it.

Scope
-----
This was a **latent** defect. ``create_appeal_workflow`` has no production
caller anywhere in the backend — only tests reach it — so no stuck row has
actually been created. It is repaired because the two doors are meant to answer
the same question the same way, which is the same reason ``8b5aa00`` gave this
method the case-type validation the other door already ran.

What "would really fail" means here
-----------------------------------
Every assertion below was checked by breaking it; the mutations and their output
are in the task report. Deleting the ``(EUROPEAN, APPEAL)`` entry, and reverting
``create_appeal_workflow`` to the old ``WORKFLOW_TEMPLATES.get(...)`` lookup,
redden different cases.
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.models import Actor, resolve_actor_by_any_name
from apps.judgment.models import Judgment
from apps.souls.models import CIVILIZATION_TENANT, Civilization, Soul
from apps.tenants.managers import clear_current_tenant
from apps.tenants.models import Tenant
from apps.workflow.models import (
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    CaseType,
    WorkflowTemplate,
)
from apps.workflow.services import (
    VALID_CASE_TYPES_BY_CIVILIZATION,
    WORKFLOW_TEMPLATES,
    WorkflowService,
)

CIVILIZATIONS = (Civilization.CHINESE, Civilization.EUROPEAN, Civilization.EGYPTIAN)


@pytest.fixture
def seeded(db):
    clear_current_tenant()
    call_command("seed_mythology", stdout=io.StringIO())


def _tenant(civilization: str) -> Tenant:
    return Tenant.objects.get(code=CIVILIZATION_TENANT[civilization])


def _rejected_original(civilization, tenant, name):
    """A workflow to appeal against, built without a judgment.

    `ApprovalWorkflow.judgment` is a OneToOne, so an original *with* one cannot
    be followed by a second workflow on the same judgment —
    `tests/test_workflow_appeal_across_civilizations.py` records the same
    constraint.
    """
    return ApprovalWorkflow.objects.create(
        soul=Soul.objects.create(name=name, tenant=tenant),
        workflow_name="原流程",
        case_type=CaseType.ROUTINE,
        status=ApprovalWorkflowStatus.REJECTED,
        tenant=tenant,
    )


# ── the case: three civilizations, one door ───────────────────────────


@pytest.mark.django_db
@pytest.mark.parametrize("civilization", CIVILIZATIONS)
def test_create_appeal_workflow_builds_nodes_for_every_civilization(
    seeded, civilization
):
    """THE regression. Before the fix, EUROPEAN and EGYPTIAN came back empty.

    Measured then::

        EUROPEAN: nodes=0 status=PENDING current_node=None
        EGYPTIAN: nodes=0 status=PENDING current_node=None
        CHINESE:  nodes=4 status=IN_PROGRESS current_node=魏征 · 察查司
    """
    tenant = _tenant(civilization)
    original = _rejected_original(civilization, tenant, f"{civilization} 申诉魂")

    appeal = WorkflowService.create_appeal_workflow(original)

    # Read unfiltered, so a tenant contextvar cannot make an empty result look
    # like a pass.
    stored = ApprovalWorkflow.all_objects.get(pk=appeal.pk)
    assert stored.nodes.count() > 0, (
        f"{civilization} appeal workflow was created with no nodes at all — it "
        f"cannot be advanced, approved or escalated"
    )
    assert stored.current_node is not None
    assert stored.status == ApprovalWorkflowStatus.IN_PROGRESS
    assert stored.tenant_id == tenant.id, (
        "the appeal landed on no tenant, so no tenant-scoped read returns it"
    )


@pytest.mark.django_db
@pytest.mark.parametrize("civilization", CIVILIZATIONS)
def test_both_doors_build_the_same_appeal_flow(seeded, civilization):
    """The two entry points resolve the same template, node for node.

    This is the structural half. Asserting only "has nodes" would stay green if
    one door kept its own lookup and happened to find *something* — the generic
    单节点 fallback, for instance.
    """
    tenant = _tenant(civilization)

    soul = Soul.objects.create(name=f"{civilization} 判决申诉魂", tenant=tenant)
    judgment = Judgment.objects.create(
        soul=soul, civilization=civilization, court="—",
        verdict="REJECTED", is_final=True, tenant=tenant,
    )
    through_judgment = WorkflowService.create_from_judgment(judgment, is_appeal=True)
    through_appeal_door = WorkflowService.create_appeal_workflow(
        _rejected_original(civilization, tenant, f"{civilization} 门二申诉魂")
    )

    def shape(workflow):
        return [
            (node.node_name, node.node_type, node.court_code, node.node_order)
            for node in workflow.nodes.order_by("node_order")
        ]

    assert shape(through_judgment) == shape(through_appeal_door), (
        "the two doors built different appeal flows for the same civilization"
    )
    assert len(shape(through_appeal_door)) > 1, (
        f"{civilization} appeals resolve to a single node, which is the "
        f"generic 审批节点 fallback — a flow that moves but names nothing. "
        f"WORKFLOW_TEMPLATES should carry a real appeal template for this "
        f"civilization."
    )


@pytest.mark.django_db
def test_the_appeal_door_reads_the_tenant_s_own_stored_template(seeded):
    """It never did, and that was the second half of the structural gap.

    A tenant that has saved its own appeal template gets *that* flow through
    either door. Before the fix this door read only `WORKFLOW_TEMPLATES` and
    the saved template was invisible to it.
    """
    tenant = _tenant(Civilization.EUROPEAN)
    WorkflowTemplate.objects.create(
        name="本租户自定申诉流程",
        civilization=Civilization.EUROPEAN,
        case_type=CaseType.APPEAL,
        is_active=True,
        tenant=tenant,
        nodes_json=[{
            "id": "n1", "node_name": "Christ · 终审", "node_type": "FINAL",
            "court_code": "Heaven", "approver_role": "",
            "approver_type": "ROLE", "node_order": 1,
        }],
    )

    appeal = WorkflowService.create_appeal_workflow(
        _rejected_original(Civilization.EUROPEAN, tenant, "自定模板申诉魂")
    )

    assert appeal.workflow_name == "申诉: 原流程"  # the name still names the original
    assert [node.node_name for node in appeal.nodes.all()] == ["Christ · 终审"], (
        "the stored template was ignored; the hardcoded table answered instead"
    )


# ── the invariant, over every reachable pair ──────────────────────────


@pytest.mark.django_db
def test_no_reachable_pair_resolves_to_a_template_without_nodes(seeded):
    """A node-less workflow must be unbuildable, not merely unbuilt.

    Stated over every `(civilization, case_type)` the validator admits rather
    than over the pairs that have entries today — the defect was precisely a
    pair with no entry, so a test enumerating the entries would have been green
    throughout.
    """
    empty = []
    for civilization, case_types in VALID_CASE_TYPES_BY_CIVILIZATION.items():
        for case_type in case_types:
            template, _priority = WorkflowService._resolve_template(
                civilization, case_type, _tenant(civilization)
            )
            if not template.get("nodes"):
                empty.append(f"{civilization}/{case_type}")

    assert empty == [], (
        f"pairs resolving to a template with no nodes: {empty}. Every one of "
        f"them would produce a workflow that cannot be advanced, approved or "
        f"escalated."
    )


@pytest.mark.django_db
def test_a_template_with_no_nodes_is_refused_rather_than_stored(seeded):
    """The last guard, reached only by a caller bypassing `_resolve_template`.

    It is asserted because it is the thing that makes 「a node-less workflow
    cannot be built」 a property of the code rather than of the current contents
    of one dict. And it refuses *inside* the transaction, so the half-built
    workflow does not survive the refusal.
    """
    tenant = _tenant(Civilization.CHINESE)
    workflow = ApprovalWorkflow.objects.create(
        soul=Soul.objects.create(name="空模板魂", tenant=tenant),
        workflow_name="空流程", case_type=CaseType.ROUTINE, tenant=tenant,
    )

    with pytest.raises(ValueError, match="defines no nodes"):
        WorkflowService._create_nodes(
            workflow, {"name": "空流程", "nodes": []}, Civilization.CHINESE
        )


# ── the two new templates: cast, and who decides each step ────────────


@pytest.mark.django_db
@pytest.mark.parametrize(
    "civilization,expected",
    [
        (
            Civilization.EUROPEAN,
            [("申诉受理", "SYSTEM", None),
             ("Michael · 引领呈上", "ACTOR", "Michael"),
             ("Christ · 终审", "ACTOR", "Christ")],
        ),
        (
            Civilization.EGYPTIAN,
            [("Isis · 受理", "ACTOR", "Isis"),
             ("Nephthys · 复核", "ACTOR", "Nephthys"),
             ("Osiris · 终审", "ACTOR", "Osiris")],
        ),
    ],
)
def test_the_new_appeal_nodes_designate_the_gods_the_cast_supplies(
    seeded, civilization, expected
):
    """Every named step resolves to a seeded Actor; the unnamed one stays SYSTEM.

    Nodes that name somebody the cast cannot supply are created SYSTEM and are
    then approvable by nobody — a workflow with nodes that is stuck anyway,
    which would be a quieter version of the defect this file is about. 「申诉
    受理」 is SYSTEM deliberately: it names an act, and is recorded as such in
    `TEMPLATE_NODES_WITHOUT_AN_APPROVER`.
    """
    tenant = _tenant(civilization)
    appeal = WorkflowService.create_appeal_workflow(
        _rejected_original(civilization, tenant, f"{civilization} 名册申诉魂")
    )

    actual = [
        (node.node_name, node.approver_type,
         node.approver_actor.name if node.approver_actor else None)
        for node in appeal.nodes.order_by("node_order")
    ]
    assert actual == expected


@pytest.mark.django_db
@pytest.mark.parametrize(
    "civilization", [Civilization.EUROPEAN, Civilization.EGYPTIAN]
)
def test_no_actor_was_invented_for_the_new_templates(seeded, civilization):
    """Every `actor` key in the two new templates names a row seed_mythology seeds.

    `8308204` is why this is stated on its own: two frameworks were once
    'completed' with beings nobody seeds, and the whole change had to be pulled.
    A template naming somebody the cast has not got does not fail — it produces
    a SYSTEM node, silently.
    """
    template = WORKFLOW_TEMPLATES[(civilization, CaseType.APPEAL)]
    tenant = _tenant(civilization)

    missing = []
    for node in template["nodes"]:
        name = node.get("actor")
        if not name:
            continue
        actor = resolve_actor_by_any_name(
            Actor._base_manager.filter(
                civilization=civilization, tenant_id=tenant.pk, is_deleted=False
            ),
            name,
        )
        if actor is None:
            missing.append(f"{node['name']} -> {name}")

    assert missing == [], (
        f"{civilization} appeal template names actors the cast cannot supply: "
        f"{missing}. Do not seed a new Actor to satisfy a template."
    )
