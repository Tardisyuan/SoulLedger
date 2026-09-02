"""A workflow node may only name somebody the cast can actually supply.

Why this file exists
--------------------
`3b634c5` corrected the mythology in the frontend presets and deliberately left
one error standing, saying so in the commit:

    Michael is left serving as both first and final instance in three European
    presets, deliberately. The right fix names Christ, and Christ was not in the
    database when this was written — pointing a preset at an actor the system
    cannot supply is the failure this file's own Norse comment records.

Two things in that sentence are load-bearing and neither was checked anywhere.
The first is "the system cannot supply": a preset node naming somebody with no
`Actor` row is not an aesthetic problem. `/workflow` can save a preset as a
`WorkflowTemplate` row (`page.tsx` maps `nodes` -> `nodes_json`), and
`WorkflowService.create_from_judgment` prefers a stored template over
`WORKFLOW_TEMPLATES`, so those node names become `ApprovalNode.node_name` — the
line the UI shows as who is deciding this step. Nothing fails when the name
denotes nobody; the node is created `SYSTEM` and becomes un-approvable, quietly.

The second is "was not in the database when this was written". `79dee57` seeded
Christ, and nothing anywhere went red or green as a result. A recorded reason of
the form "X is not in the cast" decays the moment X joins the cast, and it decays
silently — it keeps reading like a finding while having become false. That is the
same failure shape as the Norse comment in `workflow-templates.ts` and as the
milestone docs this repository has already been bitten by.

So this file asserts the rule in both directions, over both sides:

    a node either names somebody the seeded cast resolves, or it is recorded as
    naming nobody — never both, and never neither.

"Never both" is the half that would have caught this task's own situation: the
day Christ was seeded, an entry excusing a node called 「基督 · 终审」 would have
gone red instead of aging into a lie.

Why it lives in the backend suite
---------------------------------
Same reason as `tests/test_annihilation_realm_code.py`, which this file follows:
the cast is a backend fact and only pytest can query it, while Jest cannot import
Python. So the frontend module is read as text. If it is ever reformatted so the
node literals or the reason table stop matching the patterns below, the parse
raises rather than returning an empty list — a contract test that quietly stops
finding what it compares is worse than no contract test.

What "would really fail" means here
-----------------------------------
Every assertion below was checked by breaking it; the mutations and their output
are in the task report:

* renaming a preset node's person to somebody unseeded (`Christ` -> `Peter`)
  reddens `test_every_preset_node_names_somebody_the_cast_can_supply`, naming the
  template, the node and the unresolvable string;
* deleting a reason-table entry reddens the same test for the excused node;
* excusing a node whose name the cast *does* resolve reddens it too, from the
  "never both" branch;
* renaming a backend node listed in `TEMPLATE_NODES_WITHOUT_AN_APPROVER` to a
  seeded person reddens `test_no_excused_backend_node_names_somebody_the_cast_has`;
* changing one side's reason table alone for a node both sides carry reddens
  `test_the_two_sides_excuse_the_same_shared_nodes`.
"""
import io
import re
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.actors.models import Actor, resolve_actor_by_any_name
from apps.souls.models import CIVILIZATION_TENANT
from apps.tenants.models import Tenant
from apps.workflow.services import (
    TEMPLATE_NODES_WITHOUT_AN_APPROVER,
    WORKFLOW_TEMPLATES,
)

# backend/tests/… -> backend/tests -> backend -> repo root. Derived from this
# file's location and never hardcoded — see tests/test_production.py's header.
REPO_ROOT = Path(__file__).resolve().parents[2]
PRESETS_TS = REPO_ROOT / "packages" / "core" / "src" / "config" / "workflow-templates.ts"

#: `{ id: "n1", name: "秦广王 · 分流", court: "第一殿", type: "分流", order: 1 },`
#: One object literal per preset node, all seventeen presets written this way.
_NODE = re.compile(
    r'\{\s*id:\s*"[^"]*",\s*name:\s*"([^"]*)",\s*court:\s*"([^"]*)",'
    r'\s*type:\s*"([^"]*)",\s*order:\s*(\d+)\s*,?\s*\}'
)

#: `civilization: "EUROPEAN",` — the marker each preset opens with. The quotes
#: are what keeps the `civilization: string;` of the interface out of this.
_CIVILIZATION = re.compile(r'civilization:\s*"([A-Z_]+)"')

#: Any `order: <n>`, used only to prove `_NODE` did not silently miss some.
_ORDER = re.compile(r"order:\s*\d+")

#: The reason table's block, and the keys inside it.
_REASON_BLOCK = re.compile(
    r"export const NODES_THAT_NAME_NO_ACTOR[^{]*\{(.*?)\n\};", re.DOTALL
)
_REASON_ENTRY = re.compile(r'^\s*"([^"]+)":\s*"([^"]*)"', re.MULTILINE)

#: How a node label names a person: 「<name> · <step>」. A label with no
#: separator is taken whole, so 「城隍初审」 is probed as a name too rather than
#: being excused by its own formatting.
SEPARATOR = " · "


def _source() -> str:
    if not PRESETS_TS.exists():
        raise AssertionError(
            f"{PRESETS_TS.relative_to(REPO_ROOT)} is missing. This test compares "
            f"the frontend workflow presets against the cast seed_mythology "
            f"seeds; if the module moved, move the path here with it rather "
            f"than deleting the comparison."
        )
    return PRESETS_TS.read_text(encoding="utf-8")


def _preset_nodes() -> list[tuple[str, str]]:
    """Every preset node as ``(civilization, node name)``, in file order.

    The civilization comes from the nearest preceding ``civilization: "…"``,
    which is how each preset opens. Raises if a node is found before any such
    marker — that would mean the file's shape changed under the parser.
    """
    source = _source()
    nodes: list[tuple[str, str]] = []
    civilization: str | None = None

    for match in re.finditer(
        f"({_CIVILIZATION.pattern})|({_NODE.pattern})", source
    ):
        civ = _CIVILIZATION.match(match.group(0))
        if civ is not None:
            civilization = civ.group(1)
            continue
        node = _NODE.match(match.group(0))
        assert node is not None
        if civilization is None:
            raise AssertionError(
                f"preset node {node.group(1)!r} appears before any "
                f"`civilization: \"…\"` in {PRESETS_TS.name}; this parser "
                f"assigns each node the civilization of the preset it is "
                f"written in and cannot do that for this one"
            )
        nodes.append((civilization, node.group(1)))

    if not nodes:
        raise AssertionError(
            f"no node literals found in {PRESETS_TS.relative_to(REPO_ROOT)}. "
            f"The presets are parsed as text (pytest has no TypeScript "
            f"toolchain), so the node objects have to stay one-per-literal with "
            f"quoted `name`/`court`/`type` and a numeric `order`. Failing loudly "
            f"rather than passing over an empty list."
        )
    return nodes


def _preset_reasons() -> dict[str, str]:
    """`NODES_THAT_NAME_NO_ACTOR`, as a dict of node name -> recorded reason."""
    block = _REASON_BLOCK.search(_source())
    if block is None:
        raise AssertionError(
            f"no `export const NODES_THAT_NAME_NO_ACTOR = {{ … }};` found in "
            f"{PRESETS_TS.relative_to(REPO_ROOT)}. It is the frontend half of "
            f"this contract — the record of which preset nodes name nobody and "
            f"why. If it was renamed, rename it here; if it was deleted, this "
            f"test has nothing left to check and must fail."
        )
    entries = dict(_REASON_ENTRY.findall(block.group(1)))
    if not entries:
        raise AssertionError(
            "NODES_THAT_NAME_NO_ACTOR parsed as empty. Entries have to stay "
            "`\"<node name>\": \"<reason>\",` on one line each."
        )
    return entries


def _named_person(node_name: str) -> str:
    """The part of a node label that claims to be somebody's name."""
    return node_name.split(SEPARATOR)[0] if SEPARATOR in node_name else node_name


@pytest.fixture
def seeded(db):
    call_command("seed_mythology", stdout=io.StringIO())


def _resolver():
    """`_resolve_approver`'s lookup, scoped exactly the way it scopes it."""
    tenants = {
        civilization: Tenant.objects.get(code=code).pk
        for civilization, code in CIVILIZATION_TENANT.items()
    }

    def find(civilization: str, name: str):
        return resolve_actor_by_any_name(
            Actor._base_manager.filter(
                civilization=civilization,
                tenant_id=tenants[civilization],
                is_deleted=False,
            ),
            name,
        )

    return find


# ── the frontend presets ──────────────────────────────────────────────


def test_the_preset_file_parses_into_every_node_it_contains():
    """The parser sees all of them, or this file is measuring a subset.

    Without this, a reformatted node literal would drop out of `_NODE` and every
    assertion below would go on passing over the nodes it still matched — the
    exact way a contract test rots into decoration.
    """
    nodes = _preset_nodes()
    literal_orders = len(_ORDER.findall(_source()))

    assert len(nodes) == literal_orders, (
        f"{len(nodes)} node literals matched but {literal_orders} `order:` "
        f"values are present in {PRESETS_TS.name} — the node regex is missing "
        f"some. Fix the pattern; do not narrow what this file checks."
    )
    civilizations = {civilization for civilization, _ in nodes}
    assert civilizations == {"CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"}, (
        f"presets parsed for {sorted(civilizations)}; all four cosmologies "
        f"have presets in this file. GREEK arrived when `EUROPEAN_GREEK` was "
        f"re-filed as `GREEK_ROUTINE` — the preset's node people (Aeacus, "
        f"Rhadamanthus, Plato's Minos) are seeded under GREEK, and the resolver "
        f"below scopes each probe to its preset's civilization."
    )


def test_the_preset_reason_table_has_no_stale_entries():
    """A reason recorded for a node no preset has explains nothing.

    It also silently widens the excuse list: the day somebody adds a node with
    that name back, it is excused without anyone deciding to excuse it.
    """
    names = {name for _, name in _preset_nodes()}
    stale = sorted(set(_preset_reasons()) - names)
    assert stale == [], (
        f"NODES_THAT_NAME_NO_ACTOR records reasons for nodes no preset has: "
        f"{stale}"
    )
    blank = sorted(name for name, reason in _preset_reasons().items() if not reason.strip())
    assert blank == [], f"entries with an empty reason: {blank}"


def test_every_preset_node_names_somebody_the_cast_can_supply(seeded):
    """The assertion this file exists for.

    Either the label resolves to an `Actor` of that preset's civilization, or
    the node is recorded in `NODES_THAT_NAME_NO_ACTOR`. Never both — "both" is a
    reason that has expired, which is precisely what happened to "Christ is not
    in the database" the day `79dee57` put him in it.
    """
    find = _resolver()
    reasons = _preset_reasons()

    unresolvable, stale_excuse = [], []
    for civilization, node_name in _preset_nodes():
        person = _named_person(node_name)
        actor = find(civilization, person)
        excused = node_name in reasons
        if actor is None and not excused:
            unresolvable.append(f"{civilization}/{node_name} (probed {person!r})")
        if actor is not None and excused:
            stale_excuse.append(f"{civilization}/{node_name} -> {actor.name}")

    assert unresolvable == [], (
        f"preset nodes naming somebody the cast cannot supply: {unresolvable}. "
        f"Saved as a WorkflowTemplate, each of these becomes an ApprovalNode "
        f"labelled for a being with no Actor row — approver SYSTEM, movable "
        f"only by escalate, and the UI still shows the name as if somebody were "
        f"deciding it. Either spell the name the way seed_mythology spells it, "
        f"or record in NODES_THAT_NAME_NO_ACTOR why this step names nobody."
    )
    assert stale_excuse == [], (
        f"preset nodes recorded as naming nobody, whose name the cast now "
        f"resolves: {stale_excuse}. The reason has expired — delete the entry "
        f"and let the node designate the actor it names. This is the branch "
        f"that the seeding of Christ should have tripped."
    )


# ── the backend templates ─────────────────────────────────────────────


def test_no_excused_backend_node_names_somebody_the_cast_has(seeded):
    """The same staleness guard for `TEMPLATE_NODES_WITHOUT_AN_APPROVER`.

    `apps/workflow/tests.py::TestTemplateApproverBasis` already asserts that
    every backend node either carries an `actor` or is listed there, and
    `tests/test_actor_name_aliases.py` asserts that the ones carrying an `actor`
    resolve to the row they designate. Neither can notice the third case: a node
    *listed* as having no possible approver whose label names somebody the cast
    has since acquired. That case reads as settled and is wrong, so it is the
    one nobody re-derives.
    """
    find = _resolver()

    stale = []
    for (civilization, case_type), template in WORKFLOW_TEMPLATES.items():
        for node in template["nodes"]:
            if node["name"] not in TEMPLATE_NODES_WITHOUT_AN_APPROVER:
                continue
            person = _named_person(node["name"])
            actor = find(civilization, person)
            if actor is not None:
                stale.append(f"{civilization}/{case_type}/{node['name']} -> {actor.name}")

    assert stale == [], (
        f"nodes recorded as having no possible approver, whose label the cast "
        f"now resolves: {stale}. Give the node an `actor` and delete its entry "
        f"from TEMPLATE_NODES_WITHOUT_AN_APPROVER — a recorded reason that has "
        f"become false is worse than none, because it reads as a finding."
    )


def test_the_two_sides_excuse_the_same_shared_nodes():
    """Where both sides carry a node of the same name, both must say the same.

    The two template sets are separate by design (see the header of
    `apps/workflow/services.py`), but nine node names appear in both. One side
    excusing a name the other resolves would mean the same step designates
    somebody in one place and nobody in the other, depending only on whether the
    workflow was built from a preset or from the hardcoded table.
    """
    preset_names = {name for _, name in _preset_nodes()}
    preset_reasons = _preset_reasons()
    backend_names = {
        node["name"]
        for template in WORKFLOW_TEMPLATES.values()
        for node in template["nodes"]
    }

    shared = sorted(preset_names & backend_names)
    assert shared, (
        "the two template sets no longer share a single node name, which would "
        "make this comparison vacuous. If they genuinely diverged, delete this "
        "test deliberately."
    )

    disagreements = [
        (
            name,
            "excused in the preset only"
            if name in preset_reasons
            else "excused in the backend template only",
        )
        for name in shared
        if (name in preset_reasons) != (name in TEMPLATE_NODES_WITHOUT_AN_APPROVER)
    ]
    assert disagreements == [], (
        f"the two sides disagree about who these shared nodes name: "
        f"{disagreements}"
    )
