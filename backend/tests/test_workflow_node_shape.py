"""A template saved through the API must be able to build a workflow.

Why this file exists
--------------------
``WorkflowTemplate.nodes_json`` had two spellings, and each writer was paired
with the reader that could not read it::

    WorkflowTemplateNodeSerializer  ->  node_name/node_type/court_code/node_order
      (every save from /workflow)       read by WorkflowEditor.tsx
    seed_workflow_templates         ->  name/court/type/order/actor
      (WORKFLOW_TEMPLATES verbatim)     read by WorkflowService.create_from_judgment

Measured on the code before the fix, saving a template through
``WorkflowTemplateSerializer`` (the shape ``WorkflowEditor.getTemplateNodes``
POSTs) and then building a workflow from it::

    STORED nodes_json = [{'id': 'n1', 'node_name': 'Christ · 私审判', ...}]
    apps/workflow/services.py:513: in create_from_judgment
        node_name=node_def["name"]
    E   KeyError: 'name'

— i.e. a 500 from ``apps/judgment/services.py:189`` for any template a user had
actually saved, while a template in the *preset* spelling worked. And the mirror,
on a row in the shape ``seed_workflow_templates`` wrote::

    E   KeyError: "Got KeyError when attempting to get a value for field
        `node_name` on serializer `WorkflowTemplateNodeSerializer`."

— a 500 from ``GET /api/v1/workflow/templates/{id}/``.

Both directions are held below. The canonical shape and the reasoning for
picking it are in ``apps/workflow/node_shape.py``.

No data migration, and how to check that
----------------------------------------
Normalization reads both shapes, so no stored row needs rewriting — which is
the point, because the stored rows could not be inspected from where this was
written: production (192.168.2.115) is unreachable from the sandbox
(``nc -z -w 3 192.168.2.115 5432`` → no route to host) and the local dev SQLite
has ``0`` rows in ``workflow_workflowtemplate``. The last real measurement is
``workflow/0011``'s, 2026-08-15 against the live database: 7 template rows,
``nodes_json`` empty on all 7 — and an empty ``nodes_json`` never reaches a
reader (``create_from_judgment`` excludes it). An operator with database access
can confirm there is nothing to migrate::

    SELECT id, name, civilization, case_type, is_active,
           jsonb_array_length(nodes_json::jsonb) AS node_count,
           nodes_json::jsonb -> 0 AS first_node
    FROM workflow_workflowtemplate
    WHERE jsonb_array_length(nodes_json::jsonb) > 0;

Rows whose ``first_node`` has a ``name`` key are in the legacy spelling; rows
with ``node_name`` are canonical. Either is read correctly after this change —
the query answers "was anything ever stored", not "does anything still break".
"""
import io

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.actors.models import Actor
from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.souls.models import CIVILIZATION_TENANT, Civilization, Soul
from apps.tenants.managers import clear_current_tenant
from apps.tenants.models import Tenant
from apps.workflow.models import CaseType, NodeType, WorkflowTemplate
from apps.workflow.node_shape import normalize_template_node
from apps.workflow.serializers import WorkflowTemplateSerializer
from apps.workflow.services import WorkflowService

#: The European preset as it reaches the backend through the editor: `page.tsx`
#: maps the preset's `name/court/type` onto `node_name/court_code/node_type`,
#: `WorkflowEditor` puts them in React Flow node data, and
#: `getTemplateNodes()` POSTs them back in this exact shape — including the
#: `approver_type: "ROLE"` / `approver_role: ""` pair it defaults every node to.
EDITOR_SAVED_NODES = [
    {"id": "n1", "node_name": "Christ · 私审判", "node_type": "TRIAL",
     "court_code": "天堂", "approver_role": "", "approver_type": "ROLE",
     "node_order": 1},
    {"id": "n2", "node_name": "Michael · 引领入光", "node_type": "TRIAL",
     "court_code": "天堂", "approver_role": "", "approver_type": "ROLE",
     "node_order": 2},
    {"id": "n3", "node_name": "Christ · 公审判", "node_type": "FINAL",
     "court_code": "天堂", "approver_role": "", "approver_type": "ROLE",
     "node_order": 3},
]

#: The same three steps in the older spelling, to assert the two agree.
LEGACY_SAVED_NODES = [
    {"id": "n1", "name": "Christ · 私审判", "type": "TRIAL", "court": "天堂", "order": 1},
    {"id": "n2", "name": "Michael · 引领入光", "type": "TRIAL", "court": "天堂", "order": 2},
    {"id": "n3", "name": "Christ · 公审判", "type": "FINAL", "court": "天堂", "order": 3},
]


@pytest.fixture
def seeded(db):
    clear_current_tenant()
    call_command("seed_mythology", stdout=io.StringIO())


def _tenant(civilization: str) -> Tenant:
    return Tenant.objects.get(code=CIVILIZATION_TENANT[civilization])


def _bearer(user) -> dict:
    """APIClient kwargs for a JWT carrying the claim TenantMiddleware reads."""
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}


def _workflow_for(civilization, tenant, case_type=None):
    soul = Soul.objects.create(name=f"{civilization} 受审魂", tenant=tenant)
    judgment = Judgment.objects.create(
        soul=soul, civilization=civilization, court="—",
        verdict="PASSED", is_final=True, tenant=tenant,
    )
    return WorkflowService.create_from_judgment(judgment, case_type=case_type)


def _stored(nodes_json, civilization, tenant, case_type=CaseType.ROUTINE):
    return WorkflowTemplate.objects.create(
        name="shape under test", civilization=civilization, case_type=case_type,
        is_active=True, nodes_json=nodes_json, tenant=tenant,
    )


def _described(workflow):
    return [
        (n.node_name, n.node_order, n.node_type, n.court_code,
         n.approver_type, n.approver_actor_id, n.approver_role)
        for n in workflow.nodes.order_by("node_order")
    ]


# ── the defect, end to end ────────────────────────────────────────────


@pytest.mark.django_db
def test_a_template_saved_through_the_api_builds_a_workflow(seeded):
    """THE regression: POST a template, then build a workflow from it.

    Goes through the HTTP endpoint rather than the service, because the whole
    defect lived in the seam between what the endpoint stores and what the
    service reads — a test that wrote `nodes_json` itself is exactly the test
    that stayed green while this was broken (`tests/test_workflow_preset_approvers.py`
    writes the other shape directly, and all twelve of its cases passed
    throughout).
    """
    tenant = _tenant(Civilization.CHINESE)
    admin = User.objects.create_user(
        username="shape_admin", password="x", role="ADMIN", tenant=tenant,
    )
    # A real Bearer token carrying the `tenant_code` claim, not
    # `force_authenticate`: `TenantMiddleware` reads that claim and nothing
    # else, and `TenantCreateMixin` stamps the row from `request.tenant`. With
    # force_authenticate the template lands with `tenant=NULL` and
    # `create_from_judgment`'s tenant filter skips it — the case would pass
    # while never reading the stored template at all.
    client = APIClient(**_bearer(admin))

    response = client.post(
        "/api/v1/workflow/templates/",
        {
            "name": "自建十殿流程",
            "description": "",
            "civilization": "CHINESE",
            "case_type": "ROUTINE",
            "is_active": True,
            "nodes": [
                {"id": "n1", "node_name": "秦广王 · 分流", "node_type": "TRIAL",
                 "court_code": "第一殿", "approver_role": "", "approver_type": "ROLE",
                 "node_order": 1},
                {"id": "n2", "node_name": "阎罗王 · 四审", "node_type": "TRIAL",
                 "court_code": "第五殿", "approver_role": "", "approver_type": "ROLE",
                 "node_order": 2},
                {"id": "n3", "node_name": "转轮王 · 终审", "node_type": "FINAL",
                 "court_code": "第十殿", "approver_role": "", "approver_type": "ROLE",
                 "node_order": 3},
            ],
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    stored = WorkflowTemplate.all_objects.get(pk=response.data["id"])
    assert [node["node_name"] for node in stored.nodes_json] == [
        "秦广王 · 分流", "阎罗王 · 四审", "转轮王 · 终审"
    ]

    workflow = _workflow_for(Civilization.CHINESE, tenant)

    assert workflow.workflow_name == "自建十殿流程", (
        "the stored template did not win over WORKFLOW_TEMPLATES; this case "
        "is then not testing the path that broke"
    )
    kings = {
        name: Actor._base_manager.get(
            name=name, civilization=Civilization.CHINESE, tenant=tenant
        ).pk
        for name in ("秦广王", "阎罗王", "转轮王")
    }
    assert _described(workflow) == [
        ("秦广王 · 分流", 1, "TRIAL", "第一殿", "ACTOR", kings["秦广王"], ""),
        ("阎罗王 · 四审", 2, "TRIAL", "第五殿", "ACTOR", kings["阎罗王"], ""),
        ("转轮王 · 终审", 3, "FINAL", "第十殿", "ACTOR", kings["转轮王"], ""),
    ]
    # Assert the absence too: no node fell through to SYSTEM, and none claims
    # an approver it does not have.
    assert workflow.nodes.filter(approver_type="SYSTEM").count() == 0
    assert all(node.designates_approver for node in workflow.nodes.all())


@pytest.mark.django_db
def test_the_two_shapes_produce_the_same_nodes(seeded):
    """Both spellings of the same three steps must build the same workflow.

    Compared against each other rather than against a written-down expectation,
    so this stays true of whatever the resolution rules become.
    """
    tenant = _tenant(Civilization.EUROPEAN)
    template = _stored(EDITOR_SAVED_NODES, Civilization.EUROPEAN, tenant)
    from_canonical = _described(_workflow_for(Civilization.EUROPEAN, tenant))

    template.nodes_json = LEGACY_SAVED_NODES
    template.save(update_fields=["nodes_json"])
    from_legacy = _described(_workflow_for(Civilization.EUROPEAN, tenant))

    assert from_canonical == from_legacy
    christ = Actor._base_manager.get(
        name="Christ", civilization=Civilization.EUROPEAN, tenant=tenant
    )
    assert [row[0] for row in from_canonical] == [
        "Christ · 私审判", "Michael · 引领入光", "Christ · 公审判"
    ]
    assert from_canonical[0][5] == christ.pk


@pytest.mark.django_db
def test_the_api_renders_a_row_in_the_older_shape(seeded):
    """The mirror defect: GET on a `seed_workflow_templates` row used to 500."""
    tenant = _tenant(Civilization.EUROPEAN)
    row = _stored(LEGACY_SAVED_NODES, Civilization.EUROPEAN, tenant)

    rendered = WorkflowTemplateSerializer(row).data["nodes"]

    assert [node["node_name"] for node in rendered] == [
        "Christ · 私审判", "Michael · 引领入光", "Christ · 公审判"
    ]
    assert [node["court_code"] for node in rendered] == ["天堂", "天堂", "天堂"]
    assert [node["node_order"] for node in rendered] == [1, 2, 3]
    # …and this is the field WorkflowEditor.tsx reads to draw the node's label.
    assert all(node["node_name"] for node in rendered)


@pytest.mark.django_db
def test_the_seed_command_writes_the_canonical_shape(seeded):
    """`seed_workflow_templates` must not mint rows the API cannot render."""
    call_command("seed_workflow_templates", stdout=io.StringIO())
    row = WorkflowTemplate.all_objects.get(name="十殿审判流程")

    assert "name" not in row.nodes_json[0], row.nodes_json[0]
    assert row.nodes_json[0]["node_name"] == "秦广王 · 分流"
    assert row.nodes_json[0]["court_code"] == "第一殿"
    assert row.nodes_json[0]["node_order"] == 1
    # `actor` has no canonical field and is carried through, because it is what
    # _resolve_approver prefers over the label.
    assert row.nodes_json[0]["actor"] == "秦广王"

    rendered = WorkflowTemplateSerializer(row).data["nodes"]
    assert len(rendered) == 10
    assert rendered[0]["node_name"] == "秦广王 · 分流"


# ── the label key the approver resolution depends on ──────────────────


@pytest.mark.django_db
def test_the_label_is_still_what_designates_the_approver(seeded):
    """`625f4d1`'s fallback, asked in the canonical spelling.

    That fix resolves a node's approver from its label when the node carries no
    `actor` key. Every test of it hands `_resolve_approver` a node spelled
    `name`; a normalization that moved the label to a key the resolver does not
    read would leave all of those green and every real node SYSTEM again. So it
    is asked here in both spellings, of the same method, for the same answer.
    """
    tenant = _tenant(Civilization.EUROPEAN)
    christ = Actor._base_manager.get(
        name="Christ", civilization=Civilization.EUROPEAN, tenant=tenant
    )

    canonical = WorkflowService._resolve_approver(
        {"node_name": "Christ · 私审判", "node_type": "TRIAL",
         "court_code": "天堂", "node_order": 1},
        Civilization.EUROPEAN, tenant.pk,
    )
    legacy = WorkflowService._resolve_approver(
        {"name": "Christ · 私审判", "court": "天堂", "type": "TRIAL", "order": 1},
        Civilization.EUROPEAN, tenant.pk,
    )

    assert canonical == legacy
    assert canonical["approver_type"] == "ACTOR"
    assert canonical["approver_actor"].pk == christ.pk


@pytest.mark.django_db
def test_an_excused_label_is_still_excused_in_the_canonical_spelling(seeded):
    """The two excuse tables are keyed by label; normalization must not lose it.

    Same shape as `test_workflow_preset_approvers.py`'s exclusion cases: an
    Actor is created that *answers to* the excused label, so a resolver that
    ignored the tables would designate it.
    """
    tenant = _tenant(Civilization.EGYPTIAN)
    bench = Actor.all_objects.create(
        name="42审判者", civilization=Civilization.EGYPTIAN, role="JUDGE", tenant=tenant,
    )
    got = WorkflowService._resolve_approver(
        {"node_name": "42审判者 · 否定告白", "node_type": "TRIAL",
         "court_code": "Hall of Two Truths", "node_order": 1},
        Civilization.EGYPTIAN, tenant.pk,
    )
    assert got == {"approver_type": "SYSTEM"}, f"the bench was resolved to {bench.pk}"


# ── the role a node carries ───────────────────────────────────────────


@pytest.mark.django_db
def test_an_explicit_role_designates_when_the_label_names_nobody(seeded):
    """A role somebody typed is a designation, and used to be discarded.

    `approver_role` is one of exactly two things `designates_approver` accepts.
    A node whose label names no person but whose row says JUDGE must come out
    ROLE/JUDGE, not SYSTEM — SYSTEM is approvable by nobody, which is the stuck
    flow `e7e87e7` measured, reached through a different key.
    """
    tenant = _tenant(Civilization.CHINESE)
    _stored(
        [{"id": "n1", "node_name": "案件分类", "node_type": "EVALUATION",
          "court_code": "第一殿", "approver_role": "JUDGE",
          "approver_type": "ROLE", "node_order": 1}],
        Civilization.CHINESE, tenant,
    )
    node = _workflow_for(Civilization.CHINESE, tenant).nodes.get()

    assert (node.approver_type, node.approver_role) == ("ROLE", "JUDGE")
    assert node.approver_actor_id is None
    assert node.designates_approver is True

    judge = User.objects.create_user(
        username="role_judge", password="x", role="JUDGE", tenant=tenant,
    )
    overseer = User.objects.create_user(
        username="role_overseer", password="x", role="OVERSEER", tenant=tenant,
    )
    assert node.can_approve(judge) is True
    assert node.can_approve(overseer) is False


@pytest.mark.django_db
def test_an_empty_role_is_a_default_and_designates_nobody(seeded):
    """`WorkflowEditor` defaults every node to ROLE with an empty role.

    So an empty `approver_role` must stay SYSTEM — honouring the default as a
    designation would make every editor-saved node claim ROLE while naming no
    role, the `designates_approver is False` shape the guard refuses.
    """
    tenant = _tenant(Civilization.CHINESE)
    _stored(
        [{"id": "n1", "node_name": "案件分类", "node_type": "EVALUATION",
          "court_code": "第一殿", "approver_role": "", "approver_type": "ROLE",
          "node_order": 1}],
        Civilization.CHINESE, tenant,
    )
    node = _workflow_for(Civilization.CHINESE, tenant).nodes.get()

    assert (node.approver_type, node.approver_role) == ("SYSTEM", "")
    assert node.designates_approver is False


@pytest.mark.django_db
def test_a_named_person_wins_over_a_role_the_node_also_carries(seeded):
    """Naming an individual is the more specific designation.

    The ordering matters in one direction only: `approver_type: "ROLE"` is what
    the editor writes on *every* node, so a role-first rule would have taken
    「秦广王 · 分流」 away from 秦广王 for every template saved from /workflow —
    unpicking `625f4d1` through the door it was written to close.
    """
    tenant = _tenant(Civilization.CHINESE)
    _stored(
        [{"id": "n1", "node_name": "秦广王 · 分流", "node_type": "TRIAL",
          "court_code": "第一殿", "approver_role": "JUDGE",
          "approver_type": "ROLE", "node_order": 1}],
        Civilization.CHINESE, tenant,
    )
    node = _workflow_for(Civilization.CHINESE, tenant).nodes.get()

    king = Actor._base_manager.get(
        name="秦广王", civilization=Civilization.CHINESE, tenant=tenant
    )
    assert (node.approver_type, node.approver_actor_id) == ("ACTOR", king.pk)
    assert node.approver_role == ""


# ── the normalizer itself ─────────────────────────────────────────────


def test_normalization_is_idempotent_and_drops_the_legacy_keys():
    once = normalize_template_node(LEGACY_SAVED_NODES[0])
    assert once == normalize_template_node(once)
    # Only canonical keys survive, so a future reader reaching for `name` gets
    # a KeyError instead of silently reading a key no API-saved row carries.
    assert set(once) == {"id", "node_name", "node_order", "node_type", "court_code"}
    assert once["node_name"] == "Christ · 私审判"


def test_normalization_fills_only_what_is_missing():
    assert normalize_template_node({}, position=7) == {
        "node_name": "", "node_order": 7, "node_type": "TRIAL", "court_code": "",
    }
    # The literal default and the enum member must not drift apart —
    # node_shape.py spells it as a string to stay importable from a migration.
    assert normalize_template_node({})["node_type"] == NodeType.TRIAL
    assert normalize_template_node({"node_order": 3}, position=7)["node_order"] == 3


def test_normalization_carries_the_keys_the_canonical_shape_has_no_field_for():
    node = normalize_template_node(
        {"name": "阿努比斯 · 引导与称量", "court": "Hall of Two Truths",
         "type": "EVALUATION", "order": 1, "actor": "Anubis"}
    )
    assert node["actor"] == "Anubis"
    assert node["node_name"] == "阿努比斯 · 引导与称量"
