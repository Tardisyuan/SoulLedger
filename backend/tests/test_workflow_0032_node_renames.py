"""workflow/0032: 「阿努比斯 · 引导」 (EG-23) and the canonization steps (EU-10), 2026-11-13.

What the templates say now is asserted where the templates are tested (`test_workflow_egyptian_node_reading.py`,
`apps/workflow/tests.py`); this file holds the migration to its table and takes it forward, back and forward again
through real `migrate`.
"""
from importlib import import_module

from apps.souls.models import Civilization
from apps.workflow.english import NAME_EN
from apps.workflow.models import CaseType
from apps.workflow.services import TEMPLATE_NODES_WITHOUT_AN_APPROVER, WORKFLOW_TEMPLATES

MIGRATION = import_module("apps.workflow.migrations.0032_anubis_leads_and_canonization_steps")

CANONIZATION = [
    ("教区主教调查", "Diocesan bishop's inquiry"),
    ("列圣部审查", "Congregation for the Causes of Saints' examination"),
    ("教宗裁定", "The Pope's decision"),
]


def test_the_templates_carry_the_new_names_and_the_migration_writes_their_english():
    canonization = WORKFLOW_TEMPLATES[(Civilization.EUROPEAN, CaseType.CANONIZATION)]["nodes"]
    assert [(node["name"], NAME_EN[node["name"]]) for node in canonization] == CANONIZATION
    weighing = WORKFLOW_TEMPLATES[(Civilization.EGYPTIAN, CaseType.HEART_WEIGHING)]["nodes"]
    assert weighing[0]["name"] == "阿努比斯 · 引导"
    assert weighing[1]["name"] == "四十二判官 · 否定告白", "EG-23 moved no station"

    for old, new in MIGRATION.RENAMES.items():
        # The English the migration writes is the English a newly built node gets.
        assert MIGRATION.ENGLISH[old][1] == NAME_EN[new], new
        assert old not in NAME_EN, f"{old!r} still has English: something still writes it"
        assert old not in TEMPLATE_NODES_WITHOUT_AN_APPROVER, f"a reason is still recorded for {old!r}"
    for name, _english in CANONIZATION:
        assert name in TEMPLATE_NODES_WITHOUT_AN_APPROVER


def test_stored_template_nodes_are_rewritten_and_the_rest_left():
    stored = [
        {"node_name": "Anubis · 引导与称量", "name_en": "Anubis · guides and weighs", "node_order": 1},
        {"name": "教省复审", "name_en": "Somebody's own English"},
        {"node_name": "教区初审 · 我自己起的名"},
    ]
    assert MIGRATION._rewrite(stored, MIGRATION.FORWARD) == [
        {"node_name": "Anubis · 引导", "name_en": "Anubis · guides", "node_order": 1},
        {"name": "列圣部审查", "name_en": "Somebody's own English"},
        {"node_name": "教区初审 · 我自己起的名"},
    ]
    # Nothing matched: None, so the row is not written at all.
    assert MIGRATION._rewrite([{"node_name": "教区初审 · 我自己起的名"}], MIGRATION.FORWARD) is None
    assert MIGRATION._rewrite(None, MIGRATION.FORWARD) is None


def test_workflow_0032_round_trip(migration_round_trip):
    """Old names in nodes and in both `nodes_json` columns, beside rows somebody renamed by hand."""
    from tests.migration_roundtrip import snapshot_rows

    old = [(name, english[0]) for name, english in MIGRATION.ENGLISH.items()]
    hand_named = [("教区初审 · 我自己起的名", "My own name"), ("阿努比斯 · 引导与称量（改）", "")]
    #: A stored name whose English somebody rewrote: the name follows, the English stays.
    own_english = ("罗马教廷终审", "Rome decides")

    def stored_nodes():
        return [
            *({"node_name": name, "name_en": english, "node_order": i} for i, (name, english) in enumerate(old, 1)),
            *({"name": name, "name_en": english} for name, english in hand_named),
            {"node_name": own_english[0], "name_en": own_english[1]},
        ]

    def seed(state):
        tenant = state.get_model("tenants", "Tenant")._base_manager.create(code="EU_RT_0032", display_name="往返")
        soul = state.get_model("souls", "Soul")._base_manager.create(name="往返封圣魂", tenant=tenant)
        workflow = state.get_model("workflow", "ApprovalWorkflow")._base_manager.create(
            workflow_name="封圣审查流程", soul=soul, case_type="CANONIZATION", tenant=tenant, number="RT-0032",
        )
        nodes = state.get_model("workflow", "ApprovalNode")._base_manager
        for order, (name, english) in enumerate([*old, *hand_named, own_english], 1):
            nodes.create(
                workflow=workflow, node_name=name, node_name_en=english, court_code="Vatican", node_order=order,
                node_type="TRIAL", approver_type="SYSTEM", status="PENDING",
            )
        template = state.get_model("workflow", "WorkflowTemplate")._base_manager.create(
            name="往返模板", civilization="EUROPEAN", case_type="CANONIZATION", tenant=tenant,
            nodes_json=stored_nodes(),
        )
        state.get_model("workflow", "WorkflowTemplateVersion")._base_manager.create(
            template=template, number=1, nodes_json=stored_nodes(),
        )

    def snapshot(state):
        rows = snapshot_rows(
            state.get_model("workflow", "ApprovalNode")._base_manager.all(),
            key=lambda n: str(n.node_order),
            fields={"node_name": "node_name", "node_name_en": "node_name_en", "status": "status"},
            prefix="node:",
        )
        for model_name in ("WorkflowTemplate", "WorkflowTemplateVersion"):
            rows |= snapshot_rows(
                state.get_model("workflow", model_name)._base_manager.all(),
                key=lambda row: "only", fields={"nodes_json": "nodes_json"}, prefix=f"{model_name}:",
            )
        return rows

    def names(state):
        nodes = state.get_model("workflow", "ApprovalNode")._base_manager.order_by("node_order")
        return [(node.node_name, node.node_name_en) for node in nodes]

    def stored(state):
        return [
            [(node.get("node_name") or node.get("name"), node["name_en"]) for node in row.nodes_json]
            for model_name in ("WorkflowTemplate", "WorkflowTemplateVersion")
            for row in state.get_model("workflow", model_name)._base_manager.all()
        ]

    def check_forward(state):
        renamed = [(MIGRATION.RENAMES[name], MIGRATION.ENGLISH[name][1]) for name, _english in old]
        expected = [*renamed, *hand_named, ("教宗裁定", "Rome decides")]
        assert names(state) == expected
        assert stored(state) == [expected, expected]

    def check_reverse(state):
        expected = [*old, *hand_named, own_english]
        assert names(state) == expected
        assert stored(state) == [expected, expected]

    migration_round_trip(
        before=("workflow", "0031_egypt_the_forty_two_are_assessors_panguan"),
        after=("workflow", "0032_anubis_leads_and_canonization_steps"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )
