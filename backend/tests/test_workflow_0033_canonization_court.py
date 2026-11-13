"""workflow/0033: the canonization second station's court (Archdiocese → Vatican, reversible) and the older name
「主教座堂初审」 (→ 教区主教调查, one way), 2026-11-13.

The court half goes forward, back and forward again through real `migrate`. The name half cannot ride in that
harness — it demands the reversed rows equal the baseline, and this half is deliberately not reversed — so it has
its own test.
"""
from importlib import import_module
from types import SimpleNamespace

import pytest

from apps.souls.models import Civilization
from apps.workflow.models import CaseType
from apps.workflow.services import WORKFLOW_TEMPLATES

MIGRATION = import_module("apps.workflow.migrations.0033_canonization_second_station_sits_in_the_vatican")

#: (node_name, court) as seeded -> court after 0033. Only the first row is the migration's.
COURTS = [
    ("列圣部审查", "Archdiocese", "Vatican"),
    ("列圣部审查", "Rome, by my own hand", "Rome, by my own hand"),  # a second station somebody re-courted
    ("教省巡视", "Archdiocese", "Archdiocese"),  # another station that also sits in Archdiocese
    ("教区主教调查", "Diocese", "Diocese"),
    ("教宗裁定", "Vatican", "Vatican"),
]


def test_the_template_seats_the_second_station_in_the_vatican():
    nodes = WORKFLOW_TEMPLATES[(Civilization.EUROPEAN, CaseType.CANONIZATION)]["nodes"]
    assert [(node["name"], node["court"]) for node in nodes] == [
        ("教区主教调查", "Diocese"), ("列圣部审查", "Vatican"), ("教宗裁定", "Vatican"),
    ]
    assert not any(
        node["court"] == "Archdiocese" for template in WORKFLOW_TEMPLATES.values() for node in template["nodes"]
    )


def test_workflow_0033_court_round_trip(migration_round_trip):
    from tests.migration_roundtrip import snapshot_rows

    def stored_nodes():
        # Both stored spellings of the keys: the canonical one and the legacy one (`node_shape.LEGACY_NODE_KEYS`).
        return [
            *({"node_name": name, "court_code": court, "node_order": i} for i, (name, court, _) in enumerate(COURTS, 1)),
            *({"name": name, "court": court} for name, court, _ in COURTS),
        ]

    def seed(state):
        tenant = state.get_model("tenants", "Tenant")._base_manager.create(code="EU_RT_0033", display_name="往返")
        soul = state.get_model("souls", "Soul")._base_manager.create(name="往返封圣魂", tenant=tenant)
        workflow = state.get_model("workflow", "ApprovalWorkflow")._base_manager.create(
            workflow_name="封圣审查流程", soul=soul, case_type="CANONIZATION", tenant=tenant, number="RT-0033",
        )
        nodes = state.get_model("workflow", "ApprovalNode")._base_manager
        for order, (name, court, _after) in enumerate(COURTS, 1):
            nodes.create(
                workflow=workflow, node_name=name, court_code=court, node_order=order,
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
            fields={"node_name": "node_name", "court_code": "court_code", "status": "status"},
            prefix="node:",
        )
        for model_name in ("WorkflowTemplate", "WorkflowTemplateVersion"):
            rows |= snapshot_rows(
                state.get_model("workflow", model_name)._base_manager.all(),
                key=lambda row: "only", fields={"nodes_json": "nodes_json"}, prefix=f"{model_name}:",
            )
        return rows

    def courts(state):
        nodes = state.get_model("workflow", "ApprovalNode")._base_manager.order_by("node_order")
        return [(node.node_name, node.court_code) for node in nodes]

    def stored(state):
        return [
            [(node.get("node_name") or node.get("name"), node.get("court_code") or node.get("court"))
             for node in row.nodes_json]
            for model_name in ("WorkflowTemplate", "WorkflowTemplateVersion")
            for row in state.get_model("workflow", model_name)._base_manager.all()
        ]

    def check(index):
        def checker(state):
            expected = [(row[0], row[index]) for row in COURTS]
            assert courts(state) == expected
            assert stored(state) == [expected * 2, expected * 2]
        return checker

    migration_round_trip(
        before=("workflow", "0032_anubis_leads_and_canonization_steps"),
        after=("workflow", "0033_canonization_second_station_sits_in_the_vatican"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check(2),
        check_reverse=check(1),
    )


@pytest.mark.django_db
def test_the_cathedral_name_is_brought_up_to_date_and_not_taken_back():
    """「主教座堂初审」 → 「教区主教调查」 forward; hand-named rows untouched; backwards leaves every name alone."""
    from django.apps import apps
    from django.db import connection

    from apps.souls.models import Soul
    from apps.tenants.models import Tenant
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, WorkflowTemplate

    #: (name, English) as seeded -> (name, English) after forwards — and after backwards too.
    rows = [
        (("主教座堂初审", "Cathedral's first review"), ("教区主教调查", "Diocesan bishop's inquiry")),
        (("主教座堂初审", "My own English"), ("教区主教调查", "My own English")),
        (("主教座堂初审 · 我自己起的名", "Cathedral's first review"),) * 2,
        (("教区主教调查", "Diocesan bishop's inquiry"),) * 2,  # what 0032 wrote: the reason this half is one way
    ]
    tenant = Tenant._base_manager.create(code="EU_0033_NAME", display_name="旧名")
    soul = Soul._base_manager.create(name="旧名封圣魂", tenant=tenant)
    workflow = ApprovalWorkflow._base_manager.create(
        workflow_name="封圣审查流程", soul=soul, case_type="CANONIZATION", tenant=tenant, number="NAME-0033",
    )
    for order, ((name, english), _after) in enumerate(rows, 1):
        ApprovalNode._base_manager.create(
            workflow=workflow, node_name=name, node_name_en=english, court_code="Diocese", node_order=order,
            node_type="TRIAL", approver_type="SYSTEM", status="PENDING",
        )
    template = WorkflowTemplate._base_manager.create(
        name="旧名模板", civilization="EUROPEAN", case_type="CANONIZATION", tenant=tenant,
        nodes_json=[{"name": name, "name_en": english} for (name, english), _after in rows],
    )

    def read():
        nodes = ApprovalNode._base_manager.filter(workflow=workflow).order_by("node_order")
        template.refresh_from_db()
        return (
            [(node.node_name, node.node_name_en) for node in nodes],
            [(node["name"], node["name_en"]) for node in template.nodes_json],
        )

    after = [after for _before, after in rows]
    editor = SimpleNamespace(connection=connection)
    MIGRATION.forwards(apps, editor)
    assert read() == (after, after)
    MIGRATION.backwards(apps, editor)
    assert read() == (after, after), "backwards took a name back: it cannot tell 主教座堂初审 from 0032's rows"
