"""A preset a user edits and saves must be a template the API accepts.

Why this file exists
--------------------
``frontend/src/config/workflow-templates.ts`` writes each node's ``type`` as a
**Chinese step name** — 「分流」, 「初审」, 「申诉受理」 … —  while
``apps/workflow/models.py::NodeType`` has five members. ``app/workflow/page.tsx``
mapped that value straight onto ``node_type``, ``WorkflowEditor`` kept it
(``n.node_type || n.nodeType || "TRIAL"``), and ``getTemplateNodes()`` POSTed it.
``WorkflowTemplateNodeSerializer.node_type`` is a ``ChoiceField``. Measured
before the fix, through the real endpoint with a real Bearer token::

    POST /api/v1/workflow/templates/ -> 400
    {'nodes': [{'node_type': ['"分流" is not a valid choice.']},
               {'node_type': ['"初审" is not a valid choice.']},
               {'node_type': ['"终审" is not a valid choice.']}]}

— so every one of the seventeen presets was un-saveable from the moment the
「编辑」 button existed.

The thing that made this more than a typo: the two template tables disagree
about what the ``type`` **key means**, not merely about its values.
``apps/workflow/services.py::WORKFLOW_TEMPLATES`` puts real ``NodeType`` members
there. So a Chinese step name is not a misspelling that a rename table can fix
(which is all ``apps/workflow/node_shape.py`` does, ``name`` ↔ ``node_name``) —
it is a label that has to be *read* as a NodeType, and the same label reads
differently on different nodes. The proof is in the backend table itself:
「秦广王 · 分流」 is ``TRIAL`` and 「案件分类」 is ``EVALUATION``, and both
carried the preset ``type`` 「分流」.

The fix is a decision table on the frontend,
``src/config/workflow-node-types.ts::PRESET_NODE_TYPE``, applied by ``page.tsx``
before the value leaves the browser. ``src/__tests__/presetNodeTypes.test.ts``
holds it total over the presets. This file holds the three things Jest cannot
reach: that the mapped values survive the serializer, that a mapped preset POSTed
over HTTP builds a real workflow, and that where both template tables carry the
same node they agree about its type.

Why the presets are read as text
--------------------------------
Same reason as ``tests/test_workflow_template_cast.py`` and
``tests/test_workflow_preset_approvers.py``, which already do it: pytest has no
TypeScript toolchain and Jest cannot reach the database. If the modules are ever
reformatted so the patterns below stop matching, the parse raises instead of
returning an empty list — a cross-end test that silently stops finding what it
compares is worse than no cross-end test.

What "would really fail" means here
-----------------------------------
Every assertion was checked by breaking it; the mutations and their output are in
the task report. Deleting a ``PRESET_NODE_TYPE`` entry, pointing one at a value
the backend types differently, and reverting ``page.tsx``'s call each redden a
different test below.
"""
import io
import re
from pathlib import Path

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.souls.models import CIVILIZATION_TENANT, Civilization, Soul
from apps.tenants.managers import clear_current_tenant
from apps.tenants.models import Tenant
from apps.workflow.models import CaseType, NodeType, WorkflowTemplate
from apps.workflow.node_shape import NODE_TYPE_VALUES, normalize_template_node
from apps.workflow.serializers import WorkflowTemplateNodeSerializer
from apps.workflow.services import WORKFLOW_TEMPLATES, WorkflowService

REPO_ROOT = Path(__file__).resolve().parents[2]
PRESETS_TS = REPO_ROOT / "frontend" / "src" / "config" / "workflow-templates.ts"
NODE_TYPES_TS = REPO_ROOT / "frontend" / "src" / "config" / "workflow-node-types.ts"

#: `  CHINESE_ROUTINE: {` — one line per preset, at two-space indent.
_PRESET_KEY = re.compile(r'^  ([A-Z][A-Z_]*): \{$', re.MULTILINE)

#: `    civilization: "CHINESE",` / `    caseType: "ROUTINE",` / the template's
#: own `    name: "十殿审判流程",` — all at four-space indent, which is what
#: keeps the node literals' `name:` out of the last one.
_FIELD = re.compile(r'^    (civilization|caseType|name): "([^"]*)",$', re.MULTILINE)

#: `{ id: "n1", name: "秦广王 · 分流", court: "第一殿", type: "分流", order: 1 },`
_NODE = re.compile(
    r'\{\s*id:\s*"([^"]*)",\s*name:\s*"([^"]*)",\s*court:\s*"([^"]*)",'
    r'\s*type:\s*"([^"]*)",\s*order:\s*(\d+)\s*,?\s*\}'
)

#: Any `order: <n>`, used only to prove `_NODE` did not silently miss some.
_ORDER = re.compile(r"order:\s*\d+")

#: The mapping table's block, and one `步骤名: "MEMBER",` entry inside it. The
#: key is bare where TypeScript allows it and quoted where it does not
#: (「42审判」 starts with a digit), so both spellings are matched.
_MAP_BLOCK = re.compile(
    r"export const PRESET_NODE_TYPE[^{]*\{(.*?)\n\};", re.DOTALL
)
_MAP_ENTRY = re.compile(r'^  "?([^":\s]+)"?: "([A-Z]+)",$', re.MULTILINE)

#: The `NodeTypeMember` union, so the TS copy of NodeType cannot drift either.
_MEMBER_UNION = re.compile(r"export type NodeTypeMember =([^;]*);")


def _read(path: Path) -> str:
    if not path.exists():
        raise AssertionError(
            f"{path.relative_to(REPO_ROOT)} is missing. This test compares the "
            f"frontend workflow presets against the backend NodeType; if the "
            f"module moved, move the path here with it rather than deleting the "
            f"comparison."
        )
    return path.read_text(encoding="utf-8")


def _presets() -> dict[str, dict]:
    """Every preset as ``{key: {civilization, caseType, name, nodes}}``."""
    source = _read(PRESETS_TS)
    starts = [(m.group(1), m.start()) for m in _PRESET_KEY.finditer(source)]
    if not starts:
        raise AssertionError(
            f"no `  KEY: {{` preset headers found in {PRESETS_TS.name}. The "
            f"presets are parsed as text; they have to stay one key per line at "
            f"two-space indent. Failing loudly rather than over an empty dict."
        )

    presets: dict[str, dict] = {}
    bounds = [s for _, s in starts] + [len(source)]
    for index, (key, _) in enumerate(starts):
        block = source[bounds[index]:bounds[index + 1]]
        fields = dict(_FIELD.findall(block))
        nodes = [
            {
                "id": m.group(1),
                "name": m.group(2),
                "court": m.group(3),
                "type": m.group(4),
                "order": int(m.group(5)),
            }
            for m in _NODE.finditer(block)
        ]
        missing = {"civilization", "caseType", "name"} - set(fields)
        if missing or not nodes:
            raise AssertionError(
                f"preset {key} parsed with fields {sorted(fields)} and "
                f"{len(nodes)} nodes; every preset carries civilization, "
                f"caseType, name and at least one node"
            )
        presets[key] = {**fields, "nodes": nodes}
    return presets


def _step_names() -> list[str]:
    """Every distinct node `type` any preset uses, in file order."""
    seen: dict[str, None] = {}
    for preset in _presets().values():
        for node in preset["nodes"]:
            seen.setdefault(node["type"], None)
    return list(seen)


def _mapping() -> dict[str, str]:
    """`PRESET_NODE_TYPE`, as step name -> NodeType member."""
    block = _MAP_BLOCK.search(_read(NODE_TYPES_TS))
    if block is None:
        raise AssertionError(
            f"no `export const PRESET_NODE_TYPE = {{ … }};` in "
            f"{NODE_TYPES_TS.relative_to(REPO_ROOT)}. It is the table that turns "
            f"a preset step name into a NodeType; without it every preset save "
            f"is a 400 again. If it was renamed, rename it here; if it was "
            f"deleted, this test has nothing left to check and must fail."
        )
    entries = dict(_MAP_ENTRY.findall(block.group(1)))
    if not entries:
        raise AssertionError(
            "PRESET_NODE_TYPE parsed as empty. Entries have to stay "
            '`<step>: "<MEMBER>",` on one line each at two-space indent.'
        )
    return entries


def _mapped_nodes(preset: dict) -> list[dict]:
    """The preset, in the shape `getTemplateNodes()` POSTs after `page.tsx`.

    Deliberately built from the parsed preset and the parsed table rather than
    written out here: a copy of the payload is a copy that drifts, and the whole
    point is that what ships is what is tested.
    """
    mapping = _mapping()
    return [
        {
            "id": node["id"],
            "node_name": node["name"],
            "node_type": mapping[node["type"]],
            "court_code": node["court"],
            # WorkflowEditor defaults every node to this pair.
            "approver_role": "",
            "approver_type": "ROLE",
            "node_order": node["order"],
        }
        for node in preset["nodes"]
    ]


@pytest.fixture
def seeded(db):
    clear_current_tenant()
    call_command("seed_mythology", stdout=io.StringIO())


def _tenant(civilization: str) -> Tenant:
    return Tenant.objects.get(code=CIVILIZATION_TENANT[civilization])


def _bearer(user) -> dict:
    """APIClient kwargs for a JWT carrying the claim TenantMiddleware reads.

    Not `force_authenticate`: that leaves the created template with
    `tenant=NULL`, `create_from_judgment`'s tenant filter skips it, and the case
    passes without ever reading the template it just saved. Same trap, same
    reason, as `tests/test_workflow_node_shape.py`.
    """
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}


def _admin(tenant, username):
    return User.objects.create_user(
        username=username, password="x", role="ADMIN", tenant=tenant
    )


def _workflow_for(civilization, tenant, case_type=None):
    soul = Soul.objects.create(name=f"{civilization} 受审魂", tenant=tenant)
    judgment = Judgment.objects.create(
        soul=soul, civilization=civilization, court="—",
        verdict="PASSED", is_final=True, tenant=tenant,
    )
    return WorkflowService.create_from_judgment(judgment, case_type=case_type)


# ── the parsers, before anything trusts them ──────────────────────────


def test_the_preset_file_parses_into_every_node_it_contains():
    """The parser sees all of them, or this file is measuring a subset."""
    presets = _presets()
    parsed = sum(len(preset["nodes"]) for preset in presets.values())

    # EGYPTIAN_AFTERLIFE 已合并进 EGYPTIAN_ROUTINE（它是同一次称心的低分辨率写法，Budge《亚尼纸草》1895 图版 III–IV），17→16。
    assert len(presets) == 16, f"parsed {len(presets)} presets: {sorted(presets)}"
    assert parsed == len(_ORDER.findall(_read(PRESETS_TS))), (
        f"{parsed} node literals matched but "
        f"{len(_ORDER.findall(_read(PRESETS_TS)))} `order:` values are present "
        f"in {PRESETS_TS.name} — the node regex is missing some. Fix the "
        f"pattern; do not narrow what this file checks."
    )
    civilizations = {preset["civilization"] for preset in presets.values()}
    assert civilizations == {"CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"}, (
        f"presets parsed for {sorted(civilizations)}. GREEK joined when "
        f"`EUROPEAN_GREEK` was re-filed as `GREEK_ROUTINE` — its nodes name "
        f"Aeacus, Rhadamanthus and Plato's Minos, who are seeded under "
        f"`Civilization.GREEK` and the `GR_HADES` tenant."
    )


# ── the table, against NodeType ───────────────────────────────────────


def test_the_frontend_copy_of_node_type_matches_the_real_one():
    """Three copies of the same five members; none may drift.

    The union in `workflow-node-types.ts`, `NODE_TYPE_VALUES` in
    `node_shape.py` (spelled out because the module must stay importable from a
    migration), and the `ChoiceField` list on the serializer are all restatements
    of `NodeType.choices`. A drift in any of them is a value one layer accepts
    and another refuses, which is the defect this whole file is about.
    """
    union = _MEMBER_UNION.search(_read(NODE_TYPES_TS))
    assert union is not None, "NodeTypeMember union not found"
    from_ts = set(re.findall(r'"([A-Z]+)"', union.group(1)))

    assert from_ts == set(NodeType.values)
    assert set(NODE_TYPE_VALUES) == set(NodeType.values)
    assert list(NODE_TYPE_VALUES) == list(NodeType.values)
    assert (
        set(WorkflowTemplateNodeSerializer().fields["node_type"].choices)
        == set(NodeType.values)
    )


def test_every_preset_step_name_has_a_node_type():
    """The mapping is total over the presets, and carries nothing stale.

    `src/__tests__/presetNodeTypes.test.ts` asserts the same thing against the
    imported modules. It is asserted here too because this file's later cases
    build their payloads out of the parsed table: if the table were missing an
    entry they would raise `KeyError` from the helper instead of saying what is
    wrong.
    """
    mapping = _mapping()
    steps = _step_names()

    unmapped = sorted(step for step in steps if step not in mapping)
    assert unmapped == [], (
        f"preset step names with no NodeType: {unmapped}. Saving such a preset "
        f"POSTs the Chinese label as node_type and the API answers 400. Decide "
        f"which NodeType the step is and record it in PRESET_NODE_TYPE."
    )
    stale = sorted(step for step in mapping if step not in steps)
    assert stale == [], (
        f"PRESET_NODE_TYPE maps step names no preset uses: {stale}. A mapping "
        f"nothing exercises is a judgement nobody is making; the next step that "
        f"happens to be named this inherits it silently."
    )
    bad = sorted(f"{k} -> {v}" for k, v in mapping.items() if v not in NodeType.values)
    assert bad == [], f"mapped to something that is not a NodeType: {bad}"


def test_every_mapped_step_survives_the_serializer():
    """The whole point, at the boundary that used to answer 400.

    One node per *distinct step name*, so all forty are exercised rather than
    whichever ones happen to sit in the preset a later case picks.
    """
    rejected = {}
    for step, member in sorted(_mapping().items()):
        serializer = WorkflowTemplateNodeSerializer(data={
            "id": "n1", "node_name": f"节点 · {step}", "node_type": member,
            "court_code": "第一殿", "approver_role": "", "approver_type": "ROLE",
            "node_order": 1,
        })
        if not serializer.is_valid():
            rejected[step] = serializer.errors
    assert rejected == {}, rejected

    # Assert the absence too: the raw step names are still refused, so this is
    # measuring the mapping and not a boundary somebody quietly widened.
    for step in sorted(_mapping()):
        serializer = WorkflowTemplateNodeSerializer(data={
            "node_name": f"节点 · {step}", "node_type": step, "node_order": 1,
        })
        assert not serializer.is_valid(), (
            f"the serializer now accepts the raw step name {step!r}. The "
            f"ChoiceField is the boundary node_shape.py names as the reason the "
            f"canonical shape won; widening it is not the fix."
        )


# ── the two template tables, where they overlap ───────────────────────


def test_the_two_sides_agree_on_a_shared_node_s_type():
    """A node both tables carry must come out the same type either way.

    The two sets are separate by design (see the header of
    `apps/workflow/services.py`) but they share node names, and
    `create_from_judgment` reads whichever of the two the tenant happens to
    have. If they disagreed, 「案件分类」 would be an EVALUATION when the
    workflow was built from the hardcoded table and a TRIAL when it was built
    from a saved preset — the same step, two types, decided by nothing the user
    can see.

    This is also what makes the twelve mappings taken from the backend table
    *checked* rather than asserted.
    """
    mapping = _mapping()
    backend = {
        node["name"]: str(node["type"])
        for template in WORKFLOW_TEMPLATES.values()
        for node in template["nodes"]
    }
    preset_types = {
        node["name"]: mapping[node["type"]]
        for preset in _presets().values()
        for node in preset["nodes"]
    }

    shared = sorted(set(backend) & set(preset_types))
    assert len(shared) >= 12, (
        f"only {len(shared)} node names are shared: {shared}. This comparison is "
        f"what grounds the mapping in the backend table; if the two sets really "
        f"diverged, delete this test deliberately."
    )

    disagreements = [
        f"{name}: preset={preset_types[name]} backend={backend[name]}"
        for name in shared
        if preset_types[name] != backend[name]
    ]
    assert disagreements == [], (
        f"the two template tables type the same node differently: "
        f"{disagreements}"
    )


# ── end to end: POST a preset, then build a workflow from it ──────────


@pytest.mark.django_db
def test_a_preset_saved_through_the_api_builds_a_workflow(seeded):
    """THE regression: POST the ten-court preset, then create_from_judgment.

    Over HTTP with a real Bearer token, because the defect lived exactly in what
    the endpoint accepts — a test that wrote `nodes_json` itself is the test that
    stayed green while every save from /workflow answered 400.
    """
    tenant = _tenant(Civilization.CHINESE)
    client = APIClient(**_bearer(_admin(tenant, "preset_type_admin")))
    preset = _presets()["CHINESE_ROUTINE"]

    response = client.post(
        "/api/v1/workflow/templates/",
        {
            "name": preset["name"],
            "description": "",
            "civilization": preset["civilization"],
            "case_type": preset["caseType"],
            "is_active": True,
            "nodes": _mapped_nodes(preset),
        },
        format="json",
    )
    assert response.status_code == 201, response.data

    stored = WorkflowTemplate.all_objects.get(pk=response.data["id"])
    assert [node["node_type"] for node in stored.nodes_json] == (
        ["TRIAL"] * 9 + ["FINAL"]
    )
    # Absence: not one Chinese step name reached the column.
    assert all(node["node_type"] in NodeType.values for node in stored.nodes_json)

    workflow = _workflow_for(Civilization.CHINESE, tenant)
    assert workflow.workflow_name == preset["name"], (
        "the stored template did not win over WORKFLOW_TEMPLATES; this case is "
        "then not testing the path that broke"
    )
    built = [
        (node.node_name, node.node_type)
        for node in workflow.nodes.order_by("node_order")
    ]
    assert built == [
        ("秦广王 · 分流", "TRIAL"), ("楚江王 · 初审", "TRIAL"),
        ("宋帝王 · 二审", "TRIAL"), ("五官王 · 三审", "TRIAL"),
        ("阎罗王 · 四审", "TRIAL"), ("卞城王 · 五审", "TRIAL"),
        ("泰山王 · 六审", "TRIAL"), ("都市王 · 七审", "TRIAL"),
        ("平等王 · 八审", "TRIAL"), ("转轮王 · 终审", "FINAL"),
    ]
    # …and the identity work `625f4d1` does off the label still happens, so the
    # type fix did not buy a saveable template at the price of a stuck one.
    assert workflow.nodes.filter(approver_type="SYSTEM").count() == 0


@pytest.mark.django_db
def test_no_preset_is_rejected_for_its_node_types(seeded):
    """All seventeen, POSTed as the editor would send them.

    Asserts only the `node_type` dimension. Three presets carry
    `caseType: "EMERGENCY"`, which is not a `CaseType` member, so they are still
    refused — on a different field, for a different reason, and not by anything
    this change touched. Narrowing the assertion to `node_type` is what keeps
    this case honest about which defect it measures; the EMERGENCY one is
    reported separately rather than folded in here.
    """
    # One admin per civilization, derived from `Civilization` rather than
    # listed. Listing fails as a KeyError at POST time for the preset of a
    # civilization added later, which is a crash rather than a finding and says
    # nothing about whether that preset's node types are accepted.
    tenant_for = {
        civilization.value: _tenant(civilization) for civilization in Civilization
    }
    clients = {
        civilization: APIClient(**_bearer(_admin(tenant, f"preset_{civilization}")))
        for civilization, tenant in tenant_for.items()
    }

    complaints = {}
    for key, preset in _presets().items():
        response = clients[preset["civilization"]].post(
            "/api/v1/workflow/templates/",
            {
                "name": f"{key} 存盘",
                "description": "",
                "civilization": preset["civilization"],
                "case_type": preset["caseType"],
                "is_active": True,
                "nodes": _mapped_nodes(preset),
            },
            format="json",
        )
        if response.status_code != 201 and "nodes" in response.data:
            complaints[key] = response.data["nodes"]

    assert complaints == {}, (
        f"presets still rejected for their nodes: {complaints}"
    )


# ── the value that may already be stored ──────────────────────────────


@pytest.mark.django_db
def test_a_stored_step_name_normalises_instead_of_landing_in_the_column(seeded):
    """`create_from_judgment` copies `node_type` into a `choices` column raw.

    `ApprovalNode.node_type` is `choices`-constrained but `objects.create()` runs
    no `full_clean()`, so whatever a stored template says goes straight in. The
    API has validated this field since `14a4c44`, so no row it wrote can carry a
    step name — but a hand-written UPDATE can, and the production database is not
    reachable from here to say otherwise (`nc -z -w 3 192.168.2.115 5432` → no
    route to host). The queries an operator can run are in `node_shape.py`'s
    module docstring.

    So the repair is at the read boundary rather than in a migration: it fixes
    any shape, including one written after a migration would have run.
    """
    tenant = _tenant(Civilization.CHINESE)
    WorkflowTemplate.objects.create(
        name="手工改过的模板", civilization=Civilization.CHINESE,
        case_type=CaseType.ROUTINE, is_active=True, tenant=tenant,
        nodes_json=[
            {"id": "n1", "node_name": "秦广王 · 分流", "node_type": "分流",
             "court_code": "第一殿", "approver_role": "", "approver_type": "ROLE",
             "node_order": 1},
            {"id": "n2", "node_name": "转轮王 · 终审", "node_type": "FINAL",
             "court_code": "第十殿", "approver_role": "", "approver_type": "ROLE",
             "node_order": 2},
        ],
    )

    workflow = _workflow_for(Civilization.CHINESE, tenant)
    built = [
        (node.node_name, node.node_type)
        for node in workflow.nodes.order_by("node_order")
    ]

    assert built == [("秦广王 · 分流", "TRIAL"), ("转轮王 · 终审", "FINAL")]
    # Absence: nothing outside NodeType reached the column, and the good value
    # beside it was not flattened along with the bad one.
    assert all(node.node_type in NodeType.values for node in workflow.nodes.all())


def test_normalisation_only_touches_a_value_outside_node_type():
    """Unit form of the above, plus the four values that must pass through."""
    assert normalize_template_node({"type": "分流"})["node_type"] == "TRIAL"
    assert normalize_template_node({"node_type": "轮回分流"})["node_type"] == "TRIAL"
    assert normalize_template_node({"node_type": ""})["node_type"] == "TRIAL"
    for member in NodeType.values:
        assert normalize_template_node({"node_type": member})["node_type"] == member
