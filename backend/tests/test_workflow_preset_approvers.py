"""A workflow built from a preset must resolve the people its nodes name.

Why this file exists
--------------------
`7fe9a28` made `can_approve` `approve_node`'s only gate, deliberately
fail-closed: a node with no `approver_actor` cannot be decided by anyone and has
to go through the audited `escalate`. `e7e87e7` then found what that costs on
the path nobody had measured — a workflow built from a *preset*:

    frontend/src/config/workflow-templates.ts nodes carry `name/court/type/order`
    and no `actor` key. /workflow saves a preset into `WorkflowTemplate.nodes_json`.
    `create_from_judgment` prefers `nodes_json` over `WORKFLOW_TEMPLATES`.
    `_resolve_approver` read only the `actor` key.

So every node of such a workflow was created `SYSTEM`, and the flow was stuck
from the moment it was created — while its labels named Christ and Michael, both
of whom the cast can supply. Measured before the fix (the same run this file's
first test asserts against):

    1.'Christ · 私审判'   SYSTEM None
    2.'Michael · 引领入光' SYSTEM None
    3.'Christ · 公审判'   SYSTEM None
    Christ 本人 can_approve(节点1) = False

The fix resolves the node *label* when there is no `actor` key, taking the part
before 「 · 」 exactly the way `tests/test_workflow_template_cast.py` probes it —
the two must agree, because that file's assertion ("every preset node names
somebody the cast can supply") is only worth anything if the runtime resolves
what the test probes. `test_the_probe_agrees_with_the_cross_side_contract`
imports that file's own `_named_person` rather than restating it.

What the fallback must NOT do
-----------------------------
`TEMPLATE_NODES_WITHOUT_AN_APPROVER` and the frontend's `NODES_THAT_NAME_NO_ACTOR`
list the nodes that name *nobody on purpose* — benches (四十二神官, 十殿联审),
institutions (主教座堂), and actions (案件分类). Resolving one of those to a
single `Actor` would record a joint session as one judge's decision, which is a
worse failure than the stuck flow this file fixes. Both tables are consulted at
runtime, and two tests here create an `Actor` that answers to an excused label
and assert the node stays `SYSTEM` anyway — otherwise the exclusion would be
"true because nothing happens to answer to those names", which is luck, not a
rule.
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.models import Actor
from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.souls.models import CIVILIZATION_TENANT, Civilization, Soul
from apps.tenants.managers import clear_current_tenant
from apps.tenants.models import Tenant
from apps.workflow.models import CaseType, WorkflowTemplate
from apps.workflow.services import (
    PRESET_NODES_THAT_NAME_NO_ACTOR,
    TEMPLATE_NODES_WITHOUT_AN_APPROVER,
    WORKFLOW_TEMPLATES,
    WorkflowService,
)

#: `frontend/src/config/workflow-templates.ts :: EUROPEAN_ROUTINE`, verbatim —
#: including the Chinese `type` strings, which are what the preset actually
#: holds (they are not `NodeType` members; `create_from_judgment` copies them
#: through unvalidated, and that is out of scope here).
#: `test_the_european_preset_copied_here_is_the_one_that_ships` compares this
#: against the module rather than trusting the copy.
EUROPEAN_ROUTINE_PRESET = [
    {"id": "n1", "name": "Christ · 私审判", "court": "天堂", "type": "私审判", "order": 1},
    {"id": "n2", "name": "Michael · 引领入光", "court": "天堂", "type": "引领", "order": 2},
    {"id": "n3", "name": "Christ · 公审判", "court": "天堂", "type": "终审", "order": 3},
]


@pytest.fixture
def seeded(db):
    clear_current_tenant()
    call_command("seed_mythology", stdout=io.StringIO())


def _tenant(civilization: str) -> Tenant:
    return Tenant.objects.get(code=CIVILIZATION_TENANT[civilization])


def _workflow_from(nodes_json, civilization, tenant, case_type=CaseType.ROUTINE):
    """Save `nodes_json` as this tenant's template and build a workflow off it.

    This is the chain the defect lived in: preset -> `WorkflowTemplate.nodes_json`
    -> `create_from_judgment` (which prefers a stored template) -> `ApprovalNode`.
    """
    WorkflowTemplate.objects.create(
        name="preset under test",
        civilization=civilization,
        case_type=case_type,
        is_active=True,
        nodes_json=nodes_json,
        tenant=tenant,
    )
    return _workflow_for(civilization, tenant, case_type)


def _workflow_for(civilization, tenant, case_type=None):
    soul = Soul.objects.create(name=f"{civilization} 受审魂", tenant=tenant)
    judgment = Judgment.objects.create(
        soul=soul,
        civilization=civilization,
        court="—",
        verdict="PASSED",
        is_final=True,
        tenant=tenant,
    )
    return WorkflowService.create_from_judgment(judgment, case_type=case_type)


def _by_order(workflow) -> list:
    return list(workflow.nodes.order_by("node_order"))


# ── the defect, reversed ──────────────────────────────────────────────


def test_a_preset_saved_as_a_template_designates_the_people_it_names(seeded):
    """THE regression test, in the shape `e7e87e7` measured.

    Before the fallback existed all three nodes came out `SYSTEM`/None and the
    workflow was un-approvable by anybody the moment it was created.
    """
    tenant = _tenant(Civilization.EUROPEAN)
    workflow = _workflow_from(
        EUROPEAN_ROUTINE_PRESET, Civilization.EUROPEAN, tenant
    )
    christ = Actor._base_manager.get(
        name="Christ", civilization=Civilization.EUROPEAN, tenant=tenant
    )
    michael = Actor._base_manager.get(
        name="Michael", civilization=Civilization.EUROPEAN, tenant=tenant
    )

    designated = [
        (node.node_name, node.approver_type, node.approver_actor_id)
        for node in _by_order(workflow)
    ]
    assert designated == [
        ("Christ · 私审判", "ACTOR", christ.pk),
        ("Michael · 引领入光", "ACTOR", michael.pk),
        ("Christ · 公审判", "ACTOR", christ.pk),
    ], designated

    # Assert the absence too: not one node is left SYSTEM, and none of them
    # claims ACTOR while designating nobody — the shape `designates_approver`
    # exists to refuse.
    assert workflow.nodes.filter(approver_type="SYSTEM").count() == 0
    assert all(node.designates_approver for node in _by_order(workflow))


def test_the_named_judge_can_decide_his_own_node_and_nobody_else_can(seeded):
    """The point of resolving at all: somebody can now move the flow — and it
    is the person the node names, not whoever reaches it first. `can_approve`
    is unchanged; it is being *fed* an approver for the first time."""
    tenant = _tenant(Civilization.EUROPEAN)
    workflow = _workflow_from(
        EUROPEAN_ROUTINE_PRESET, Civilization.EUROPEAN, tenant
    )
    first, second, _third = _by_order(workflow)

    christ = User.objects.create_user(
        username="preset_christ", password="x", role="JUDGE", tenant=tenant,
        actor=Actor._base_manager.get(
            name="Christ", civilization=Civilization.EUROPEAN, tenant=tenant
        ),
    )
    michael = User.objects.create_user(
        username="preset_michael", password="x", role="JUDGE", tenant=tenant,
        actor=Actor._base_manager.get(
            name="Michael", civilization=Civilization.EUROPEAN, tenant=tenant
        ),
    )
    unlinked = User.objects.create_user(
        username="preset_admin", password="x", role="ADMIN", tenant=tenant,
        actor=None,
    )

    assert first.can_approve(christ) is True
    assert first.can_approve(michael) is False
    assert second.can_approve(michael) is True
    assert second.can_approve(christ) is False
    # ADMIN still gets no bypass — `7fe9a28`/`4ceffe8`'s position, restated
    # here because this file is the one that made these nodes approvable.
    assert first.can_approve(unlinked) is False


def test_a_label_naming_somebody_the_cast_lacks_stays_system(seeded):
    """Unresolvable stays fail-closed, and invents nobody.

    `Peter` is the name `e7e87e7` measured as unresolvable ('Peter'->SYSTEM
    None) and the reason 天堂准入终审 is excused on the backend side.
    """
    tenant = _tenant(Civilization.EUROPEAN)
    before = Actor._base_manager.count()

    workflow = _workflow_from(
        [{"name": "Peter · 天堂之门", "court": "天堂", "type": "终审", "order": 1}],
        Civilization.EUROPEAN,
        tenant,
    )
    node = _by_order(workflow)[0]
    assert (node.approver_type, node.approver_actor_id) == ("SYSTEM", None)
    assert node.designates_approver is False
    assert Actor._base_manager.count() == before, (
        "the fallback created an Actor to satisfy a node label"
    )


# ── the nodes that name nobody on purpose ─────────────────────────────


def test_an_excused_bench_is_not_resolved_to_one_of_its_members(seeded):
    """「四十二神官 · 否定告白」 is forty-two assessors, not a judge.

    The label is listed in `TEMPLATE_NODES_WITHOUT_AN_APPROVER`, and this test
    makes the exclusion do work rather than being true by accident: it puts a
    row on the Egyptian bench that *answers to* 「四十二神官」, so a fallback
    that ignored the table would designate it and record a forty-two-member
    confession as one being's decision.
    """
    tenant = _tenant(Civilization.EGYPTIAN)
    bench = Actor.all_objects.create(
        name="四十二神官", civilization=Civilization.EGYPTIAN,
        role="JUDGE", tenant=tenant,
    )

    workflow = _workflow_for(Civilization.EGYPTIAN, tenant)
    first, second, third = _by_order(workflow)

    assert second.node_name == "四十二神官 · 否定告白"
    assert (second.approver_type, second.approver_actor_id) == ("SYSTEM", None), (
        f"the bench node was resolved to {bench.pk}"
    )
    # …while the two nodes beside it, which do name individuals, resolve.
    assert first.approver_type == "ACTOR"
    assert third.approver_type == "ACTOR"


def test_a_node_excused_only_by_the_frontend_table_is_not_resolved_either(seeded):
    """The same bench, spelled the way the *preset* spells it.

    「42审判者 · 否定告白」 appears only in `NODES_THAT_NAME_NO_ACTOR` — the
    backend table has never heard of it, because the backend template spells the
    same bench 「四十二神官 · 否定告白」. The fallback exists to serve preset-built
    nodes, so it has to honour the preset's own record of which of them name
    nobody; consulting only the backend table would leave every frontend-only
    bench, institution and action name to be resolved on luck.
    """
    tenant = _tenant(Civilization.EGYPTIAN)
    Actor.all_objects.create(
        name="42审判者", civilization=Civilization.EGYPTIAN,
        role="JUDGE", tenant=tenant,
    )

    workflow = _workflow_from(
        [{"name": "42审判者 · 否定告白", "court": "Hall of Two Truths",
          "type": "否定告白", "order": 1}],
        Civilization.EGYPTIAN,
        tenant,
        case_type=CaseType.HEART_WEIGHING,
    )
    node = _by_order(workflow)[0]
    assert (node.approver_type, node.approver_actor_id) == ("SYSTEM", None)


def test_the_preset_excuse_mirror_matches_the_frontend_table():
    """The Python mirror of `NODES_THAT_NAME_NO_ACTOR` must not drift.

    The runtime cannot read TypeScript, so the names are copied. A copy with no
    comparison is how this repository's court numbering ended up in five
    conflicting places — so the copy is compared, against the same file
    `tests/test_workflow_template_cast.py` parses and by importing its parser
    rather than writing a second one.
    """
    from tests.test_workflow_template_cast import _preset_reasons

    recorded = set(_preset_reasons())
    assert recorded == PRESET_NODES_THAT_NAME_NO_ACTOR, (
        "the mirror in apps/workflow/services.py and NODES_THAT_NAME_NO_ACTOR "
        "in frontend/src/config/workflow-templates.ts disagree.\n"
        f"  only in the mirror: {sorted(PRESET_NODES_THAT_NAME_NO_ACTOR - recorded)}\n"
        f"  only in the preset file: {sorted(recorded - PRESET_NODES_THAT_NAME_NO_ACTOR)}"
    )


def test_the_probe_agrees_with_the_cross_side_contract():
    """`_named_person` here and there must be the same rule.

    `test_workflow_template_cast.py` asserts that every preset node names
    somebody the cast can supply, probing 「<person> · <step>」. That assertion
    only means anything if the runtime resolves the same substring, so the
    contract's own function is imported and compared rather than restated.
    """
    from apps.workflow.services import _named_person as runtime
    from tests.test_workflow_template_cast import _named_person as contract
    from tests.test_workflow_template_cast import _preset_nodes

    labels = [name for _civilization, name in _preset_nodes()]
    labels += [
        node["name"]
        for template in WORKFLOW_TEMPLATES.values()
        for node in template["nodes"]
    ]
    labels += ["名字里没有分隔符", "a · b · c", ""]

    disagreements = [
        (label, runtime(label), contract(label))
        for label in labels
        if runtime(label) != contract(label)
    ]
    assert disagreements == [], disagreements


def test_the_backend_templates_keep_designating_exactly_who_they_did(seeded):
    """The fallback must not quietly re-decide the hardcoded templates.

    Every `WORKFLOW_TEMPLATES` node without an `actor` key is listed in
    `TEMPLATE_NODES_WITHOUT_AN_APPROVER` (asserted by
    `apps/workflow/tests.py::TestTemplateApproverBasis`), so the fallback must
    leave all of them `SYSTEM` — that is what keeps `workflow/0011`'s backfill
    and this code saying the same thing about the same rows.
    """
    resolved_anyway = []
    for (civilization, _case_type), template in WORKFLOW_TEMPLATES.items():
        tenant = _tenant(civilization)
        for node in template["nodes"]:
            if node.get("actor"):
                continue
            assert node["name"] in TEMPLATE_NODES_WITHOUT_AN_APPROVER
            got = WorkflowService._resolve_approver(node, civilization, tenant.pk)
            if got["approver_type"] != "SYSTEM":
                resolved_anyway.append((node["name"], got.get("approver_actor")))

    assert resolved_anyway == [], resolved_anyway


# ── scope: the workflow's own tenant and civilization ─────────────────


def test_the_fallback_does_not_reach_into_another_tenant(seeded):
    """`Actor.name` is unique per tenant, not globally.

    Asserted against `_resolve_approver` directly rather than through a second
    European workflow, because `Soul.civilization` is *derived from the tenant
    code* (`TENANT_CIVILIZATION`) — a second tenant is by construction not
    European, so the end-to-end route cannot express this case at all. The
    scope being checked is the one `workflow/0011`'s backfill used: this
    workflow's own tenant, and only it.
    """
    node = {"name": "Christ · 私审判"}
    seeded_tenant = _tenant(Civilization.EUROPEAN)
    seeded_christ = Actor._base_manager.get(
        name="Christ", civilization=Civilization.EUROPEAN, tenant=seeded_tenant
    )
    other = Tenant.objects.create(code="EU_SECOND", display_name="Second Heaven")
    assert Actor._base_manager.filter(tenant=other).count() == 0

    here = WorkflowService._resolve_approver(
        node, Civilization.EUROPEAN, seeded_tenant.pk
    )
    assert here["approver_actor"].pk == seeded_christ.pk

    elsewhere = WorkflowService._resolve_approver(
        node, Civilization.EUROPEAN, other.pk
    )
    assert elsewhere == {"approver_type": "SYSTEM"}, (
        f"the neighbour's Christ leaked into tenant {other.code}: {elsewhere}"
    )

    # And once that tenant has a Christ of its own, it resolves to *that* row.
    own_christ = Actor.all_objects.create(
        name="Christ", civilization=Civilization.EUROPEAN, role="JUDGE", tenant=other,
    )
    now = WorkflowService._resolve_approver(node, Civilization.EUROPEAN, other.pk)
    assert now["approver_actor"].pk == own_christ.pk
    assert now["approver_actor"].pk != seeded_christ.pk


def test_the_fallback_does_not_cross_civilizations(seeded):
    """Same name, different cosmology — not the same being.

    The seeded European tenant is given a CHINESE row named `Christ`; a
    EUROPEAN probe must not pick it up, and (the other direction, which a
    name-only lookup would also get wrong) a CHINESE probe must not pick up the
    European Christ.
    """
    tenant = _tenant(Civilization.EUROPEAN)
    chinese_row = Actor.all_objects.create(
        name="Christ", civilization=Civilization.CHINESE, role="JUDGE", tenant=tenant,
    )
    european = WorkflowService._resolve_approver(
        {"name": "Christ · 私审判"}, Civilization.EUROPEAN, tenant.pk
    )
    assert european["approver_actor"].pk != chinese_row.pk
    assert european["approver_actor"].civilization == Civilization.EUROPEAN

    chinese = WorkflowService._resolve_approver(
        {"name": "Christ · 私审判"}, Civilization.CHINESE, tenant.pk
    )
    assert chinese["approver_actor"].pk == chinese_row.pk


def test_a_soft_deleted_actor_is_not_designated(seeded):
    """A retired row is not a bench member. `resolve_actor_by_any_name` is given
    a queryset that already excludes `is_deleted`; this asserts the caller keeps
    passing it that way."""
    tenant = _tenant(Civilization.EUROPEAN)
    christ = Actor._base_manager.get(
        name="Christ", civilization=Civilization.EUROPEAN, tenant=tenant
    )
    christ.is_deleted = True
    christ.save(update_fields=["is_deleted"])

    workflow = _workflow_from(
        EUROPEAN_ROUTINE_PRESET, Civilization.EUROPEAN, tenant
    )
    first, second, third = _by_order(workflow)
    assert (first.approver_type, third.approver_type) == ("SYSTEM", "SYSTEM")
    assert second.approver_type == "ACTOR"  # Michael is untouched


def test_the_european_preset_copied_here_is_the_one_that_ships():
    """The three labels above are a copy of the preset; copies drift."""
    from tests.test_workflow_template_cast import _preset_nodes

    shipped = [name for civilization, name in _preset_nodes() if civilization == "EUROPEAN"]
    for node in EUROPEAN_ROUTINE_PRESET:
        assert node["name"] in shipped, (
            f"{node['name']!r} is no longer a European preset node; this file's "
            f"copy of EUROPEAN_ROUTINE has drifted from the shipped one"
        )
