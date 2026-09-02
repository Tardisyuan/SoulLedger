"""A preset's `caseType` must be a case type this system has.

Why this file exists
--------------------
Three of the seventeen presets in ``packages/core/src/config/workflow-templates.ts``
declared ``caseType: "EMERGENCY"`` — ``CHINESE_EMERGENCY``,
``EUROPEAN_EMERGENCY``, ``EGYPTIAN_EMERGENCY`` — and
``apps/workflow/models.py::CaseType`` has no ``EMERGENCY`` member. Measured
before the fix, through the real endpoint with a real Bearer token::

    POST /api/v1/workflow/templates/  {"case_type": "EMERGENCY", …} -> 400
    {'case_type': ['"EMERGENCY" is not a valid choice.']}

This is a *different* defect from the one ``f60254f`` fixed. That one was
``node_type`` carrying a Chinese step name; its test
(``test_workflow_preset_node_types.py::test_no_preset_is_rejected_for_its_node_types``)
deliberately narrowed its assertion to the ``nodes`` key so the two would not be
folded into one number. This file is the other half, and it asserts the whole
status code: **all seventeen presets POST 201.**

The decision this file records
------------------------------
The fix was *not* to add ``EMERGENCY`` to ``CaseType``. The nine existing
members all answer the same question — *what kind of proceeding is this* —
including ``ROUTINE``, which names the standard full procedure (十殿审判流程,
ten nodes; the fallback for all three civilizations in
``VALID_CASE_TYPES_BY_CIVILIZATION``) rather than "the un-hurried one".
``EMERGENCY`` answers a different question: *how fast*.

That question already has a column. ``ApprovalWorkflow.priority``
(``0=normal, 1=urgent, 2=critical``) is live, not vestigial: ``views.py`` reads
it off the create request, ``WorkflowFilter`` exposes ``priority_min`` /
``priority_max`` and lists it in ``ordering_fields``, both workflow serializers
carry it, and ``app/workflow/[id]/page.tsx`` renders it. Its value-1 label in
``frontend/messages/zh-Hans.json`` is 「紧急」 — the exact word the three presets
are named with. A ``CaseType.EMERGENCY`` labelled 「紧急审判」 would put urgency
in two columns at once.

The repository had already written this down, twice, in the presets themselves:

* ``workflow-templates.ts`` on ``EUROPEAN_EMERGENCY`` n2 —
  「队列的紧急程度是本系统的调度概念，改变不了谁审判」.
* ``workflow-node-types.ts`` on 「紧急受理」 — the node 「确认案件够得上紧急
  队列——是对案件的分诊」, and on 「紧急审判」 —
  「队列的紧急程度改变不了谁审判」.

So the three presets were re-filed under the case type that says what kind of
case each one is, and urgency stays on ``priority``:

* ``CHINESE_EMERGENCY`` -> ``SPECIAL`` (特案审判). It bypasses the ten courts and
  is decided at 酆都 outside the ordinary ladder of instances; its own
  description already called it 「特殊紧急案件」. It joins 枉死城流程 and
  阿鼻地狱流程, which are the same shape (2–4 nodes, off the standard ladder).
* ``EUROPEAN_EMERGENCY`` -> ``ROUTINE``. The preset's own comment says the case
  is the same judgment by the same and only judge — 「紧急队列仍由基督审判——
  没有可以升级到的第二位审判者」. Nothing about the *kind* of case differs from
  ``EUROPEAN_ROUTINE``; only the queue does.
* ``EGYPTIAN_EMERGENCY`` -> ``DIVINE_TRIAL`` (神判). Osiris judges directly,
  without the weighing of the heart — a god deciding outside the rite is what
  ``DIVINE_TRIAL`` names, and it is the only preset that fills that slot.

Each of the three lands inside its civilization's set in
``VALID_CASE_TYPES_BY_CIVILIZATION``, so the change adds nothing to
``CASE_TYPES_NOT_VALID_FOR_THEIR_CIVILIZATION`` below.

Why the presets are read as text
--------------------------------
Same reason as ``tests/test_workflow_template_cast.py`` and
``tests/test_workflow_preset_node_types.py``, whose parser this file imports
rather than copying: pytest has no TypeScript toolchain and Jest cannot reach
the database. Importing means a rename over there raises here instead of
silently comparing against a stale copy.

What "would really fail" means here
-----------------------------------
Every assertion below was checked by breaking it; the mutations and their output
are in the task report.
"""
import json
import re

import pytest
from rest_framework.test import APIClient

from apps.souls.models import Civilization
from apps.workflow.models import ApprovalWorkflow, CaseType, WorkflowTemplate
from apps.workflow.services import VALID_CASE_TYPES_BY_CIVILIZATION

# The parser and the HTTP helpers are the ones `f60254f` wrote for the node_type
# half of this same boundary. Copying them would give two parsers that drift;
# importing gives one that fails loudly if the module moves. `seeded` comes
# across as a fixture the same way.
from tests.test_workflow_preset_node_types import (
    REPO_ROOT,
    _admin,
    _bearer,
    _mapped_nodes,
    _presets,
    _tenant,
    seeded,  # noqa: F401  (pytest fixture, used by name in the cases below)
)

MESSAGES_DIR = REPO_ROOT / "frontend" / "messages"
EDITOR_TSX = REPO_ROOT / "frontend" / "src" / "components" / "workflow" / "WorkflowEditor.tsx"

#: The three bundles, which `docs`-less convention keeps exactly aligned.
BUNDLES = ("en", "zh-Hans", "egy")

#: `<option value="ROUTINE">{t("workflow.case_types.ROUTINE")}</option>` — the
#: case-type picker in the editor toolbar. Matched on the i18n key rather than
#: the `value`, so an option whose value and label disagree cannot pass.
_CASE_TYPE_OPTION = re.compile(
    r'<option value="([A-Z_]+)">\{t\("workflow\.case_types\.\1"\)\}</option>'
)

#: Presets whose `caseType` is a real `CaseType` member but is *not* in that
#: civilization's set in `VALID_CASE_TYPES_BY_CIVILIZATION`, and the reason each
#: one is recorded rather than fixed.
#:
#: **It is empty, and that is the current finding rather than an oversight.**
#: Every preset that was ever listed here has since been re-filed into a member
#: its civilization's set accepts — the history is kept in the comments inside
#: the dict, because each deletion records a decision. Adding an entry back (or
#: re-filing a preset into one) has to be a deliberate edit to this table.
#:
#: The consequence is real but is *not* the 400 this file is about: these
#: presets save fine (`WorkflowTemplateSerializer` validates `case_type` against
#: `CaseType.choices` only), but `WorkflowService.create_from_judgment` raises
#: `ValueError` for the pair, so no judgment of that civilization can ever be
#: routed to the template the operator just saved.
CASE_TYPES_NOT_VALID_FOR_THEIR_CIVILIZATION: dict[str, str] = {
    # THREE ENTRIES WERE DELETED FROM THIS TABLE RATHER THAN EDITED, AND THE
    # DELETIONS ARE THE POINT.
    #
    # `EUROPEAN_APPEAL` and `EGYPTIAN_APPEAL` were here because APPEAL was
    # missing from two of the three sets in `VALID_CASE_TYPES_BY_CIVILIZATION`,
    # which made *every* European and Egyptian appeal a ValueError out of
    # `create_from_judgment(..., is_appeal=True)`. All three sets now carry
    # APPEAL and both entry points validate against them (see the comment above
    # the table and `create_appeal_workflow`'s docstring), so the two entries
    # became false and `test_each_preset_case_type_is_valid_for_its_civilization_or_is_recorded`
    # would have reddened on `stale` — which is the half of that assertion that
    # stops a finding from aging into a lie.
    #
    # `EGYPTIAN_TRIALS` was here because a preset *named* 神判流程 carried
    # SPECIAL rather than DIVINE_TRIAL — and 神判 is DIVINE_TRIAL's own label.
    # It now carries DIVINE_TRIAL, so it too is gone from here. Note that
    # `EGYPTIAN_EMERGENCY` (re-filed by `a77a41e`) carries DIVINE_TRIAL as well;
    # nothing selects a unique template by `(civilization, case_type)`
    # (`create_from_judgment` uses `.first()`, `WorkflowTemplate` has no such
    # constraint since `0006`/`0008`, and the presets are keyed by their own
    # names), and two presets sharing a case type is the pre-existing shape of
    # the three SPECIAL pairs below.
    #
    # THE LAST THREE ENTRIES ARE NOW GONE TOO, AND THE TABLE IS DELIBERATELY
    # EMPTY RATHER THAN DELETED.
    #
    # `EUROPEAN_GREEK`, `EUROPEAN_HELL_CIRCLE` and `EGYPTIAN_AFTERLIFE` were the
    # remaining three, all carrying SPECIAL, which is in neither the European
    # nor the Egyptian set. The repair was *not* to add SPECIAL to those two
    # sets — nobody has ever defined what "special case" means for Europe or
    # Egypt, and the Chinese SPECIAL presets (枉死城, 阿鼻地狱, 紧急) all name
    # flows that skip a ladder of instances those two civilizations do not have.
    # Each was re-filed by content into a member its own civilization's set
    # already carries; the reasoning is written on each preset in
    # `packages/core/src/config/workflow-templates.ts` and summarised here:
    #
    # * `GREEK_ROUTINE` (then named `EUROPEAN_GREEK`) -> `ROUTINE`. Gorgias 524a
    #   judges *every* Greek dead at the meadow's fork and sends them to the
    #   Isles of the Blest or Tartarus — the ordinary complete proceeding on that
    #   side, not an exception. What made it look special is that it belongs to
    #   another textual tradition (Plato, not Dante), and "which tradition" is
    #   not what `case_type` answers — the same argument that kept "how urgent"
    #   out of it. Greek and Dante sharing one civilization was a separate
    #   recorded defect (`docs/lore-verification/README.md` §3,
    #   `verify-greek.md` §3.1) and has since been fixed at its own layer:
    #   `Civilization.GREEK` is the fourth enum member, the preset carries it,
    #   and `VALID_CASE_TYPES_BY_CIVILIZATION[GREEK]` is `{ROUTINE, APPEAL}`. The
    #   case type did not have to move to accommodate that, which is the point —
    #   it was already answering the right question.
    # * `EUROPEAN_HELL_CIRCLE` -> `ROUTINE`. `HERESY_TRIAL` would name one of
    #   the nine circles for a flow that classifies all of them (Dante divides
    #   by Aristotle's tripartition, Inf. XI, not by heresy or the seven sins);
    #   `PURGATORY_REVIEW` and `CANONIZATION` are already two other, real flows
    #   in this repo's server-side `WORKFLOW_TEMPLATES`. Inf. V.4-15 has Minos
    #   examine and assign *every* damned soul, which is the ordinary path.
    # * `EGYPTIAN_AFTERLIFE` -> `ROUTINE`, and this is the one the previous
    #   entry called an open lore question. Both of its negatives still hold —
    #   it is not `DIVINE_TRIAL` (a god deciding outside the rite) and it must
    #   not be `HEART_WEIGHING`, since it performs no weighing while the preset
    #   that does (`EGYPTIAN_ROUTINE`, 心脏称重流程) is itself filed under
    #   ROUTINE, so that pairing would swap the two. What the entry missed is
    #   the third candidate. The lore answer is that Egyptian sources have *no*
    #   merit-sorting of the dead separate from the weighing: this flow's hall
    #   (两真之殿) and its two outcomes (Aaru / Ammit, the second death) are the
    #   weighing's hall and the weighing's two outcomes (Budge, Ani 1895,
    #   Plates III-IV; `docs/lore-verification/verify-egyptian.md` §3.3). So it
    #   is not another kind of proceeding but the ordinary one written at the
    #   resolution of its outcomes — which is what ROUTINE names, and how
    #   `CHINESE_REINCARNATION` (功德核定 → 轮回分流, the identical shape) is
    #   already filed.
    #
    # The table stays as an empty dict, not as a deleted symbol: the assertion
    # below reads it from both ends, so an empty table is the strongest possible
    # statement — *no* preset is filed under a case type its civilization
    # refuses — and the next preset that needs an excuse has to add it here on
    # purpose.
}


def _bundle(name: str) -> dict:
    path = MESSAGES_DIR / f"{name}.json"
    if not path.exists():
        raise AssertionError(
            f"{path.relative_to(REPO_ROOT)} is missing. This test asserts every "
            f"preset case type has copy in every bundle; if a locale moved, move "
            f"the path here with it rather than dropping the locale."
        )
    return json.loads(path.read_text(encoding="utf-8"))


def _editor_options() -> list[str]:
    if not EDITOR_TSX.exists():
        raise AssertionError(
            f"{EDITOR_TSX.relative_to(REPO_ROOT)} is missing. It holds the "
            f"case-type picker a preset's value has to be selectable in."
        )
    options = _CASE_TYPE_OPTION.findall(EDITOR_TSX.read_text(encoding="utf-8"))
    if not options:
        raise AssertionError(
            "no `<option value=\"X\">{t(\"workflow.case_types.X\")}</option>` "
            "found in WorkflowEditor.tsx. The options are read as text; they "
            "have to stay one per line in that exact shape. Failing loudly "
            "rather than over an empty list."
        )
    return options


def _preset_case_types() -> dict[str, str]:
    """`{preset key: caseType}` for all seventeen."""
    return {key: preset["caseType"] for key, preset in _presets().items()}


# ── the value itself ──────────────────────────────────────────────────


def test_every_preset_case_type_is_a_real_case_type():
    """The defect, stated at the smallest place it is visible.

    Nothing here needs a database or a request: a preset carrying a value
    `CaseType` does not have is already broken, whatever the endpoint does with
    it afterwards.
    """
    unknown = sorted(
        f"{key} -> {value}"
        for key, value in _preset_case_types().items()
        if value not in CaseType.values
    )
    assert unknown == [], (
        f"presets carrying a case type the backend has no member for: "
        f"{unknown}. Saving one POSTs the value straight at a ChoiceField and "
        f"the API answers 400. Either the value is wrong, or CaseType is "
        f"missing a member — decide which, do not widen the ChoiceField."
    )


def test_emergency_is_not_a_case_type():
    """Absence, because the other repair for this defect was available.

    Adding `EMERGENCY` to `CaseType` would also have turned the 400 green, and
    would have put "how urgent" into the column that answers "what kind of
    case" — next to `ApprovalWorkflow.priority`, which already carries urgency
    and whose value-1 label is the same word. This case is what makes that a
    decision somebody has to reverse on purpose rather than a green somebody
    reaches for.
    """
    assert "EMERGENCY" not in CaseType.values, (
        "CaseType gained an EMERGENCY member. Urgency lives on "
        "ApprovalWorkflow.priority (0=normal, 1=urgent, 2=critical), which is "
        "read by views.py, WorkflowFilter (priority_min/priority_max, "
        "ordering_fields), both serializers and app/workflow/[id]/page.tsx. If "
        "this is now deliberate, say so here and in the presets' comments — but "
        "then decide what priority still means."
    )
    # …and the priority column is still the place it points at, so this test
    # does not survive the field being deleted underneath it.
    assert ApprovalWorkflow._meta.get_field("priority") is not None


# ── the boundary that answered 400 ────────────────────────────────────


@pytest.mark.django_db
def test_every_preset_saves_through_the_api(seeded):  # noqa: F811  (imported fixture)
    """All seventeen, POSTed as the editor sends them, asserting **201**.

    `test_workflow_preset_node_types.py` POSTs the same seventeen but narrows
    its assertion to the `nodes` key, on purpose, so that its number could not
    be read as covering this defect. Here nothing is narrowed: the status code
    is the assertion, and the three EMERGENCY presets are what made it fail.

    Real Bearer token rather than `force_authenticate`, for the reason recorded
    in `_bearer`: force-auth leaves the template `tenant=NULL` and every
    tenant-scoped read downstream skips it.
    """
    # One admin per civilization a preset can be filed under. Derived from
    # `Civilization` rather than listed, because the failure mode of listing is
    # a KeyError at POST time for the preset of a civilization added later —
    # which is a crash, not a finding, and says nothing about whether that
    # preset saves.
    tenant_for = {
        civilization: _tenant(civilization) for civilization in Civilization
    }
    clients = {
        civilization: APIClient(**_bearer(_admin(tenant, f"case_type_{civilization}")))
        for civilization, tenant in tenant_for.items()
    }

    presets = _presets()
    # EGYPTIAN_AFTERLIFE 已合并进 EGYPTIAN_ROUTINE（它是同一次称心的低分辨率写法，Budge《亚尼纸草》1895 图版 III–IV），17→16。
    assert len(presets) == 16, f"parsed {len(presets)} presets, not 16"

    rejected = {}
    saved = {}
    for key, preset in presets.items():
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
        if response.status_code != 201:
            rejected[key] = (response.status_code, response.data)
        else:
            saved[key] = response.data["id"]

    assert rejected == {}, f"presets the API refused: {rejected}"
    assert len(saved) == 16

    # Absence as well as presence: what came back is the case type that was
    # sent, on a row that carries a tenant. A 201 that stored something else,
    # or stored it unscoped, is not the fix either.
    for key, template_id in saved.items():
        stored = WorkflowTemplate.all_objects.get(pk=template_id)
        assert stored.case_type == presets[key]["caseType"], key
        assert stored.case_type in CaseType.values, key
        assert stored.tenant is not None, (
            f"{key} saved with tenant=NULL — the request was not tenant-scoped, "
            f"so this case is not exercising the path /workflow uses"
        )


@pytest.mark.django_db
def test_the_unknown_case_type_is_still_refused(seeded):  # noqa: F811  (imported fixture)
    """The boundary was not widened to make the seventeen pass.

    If someone "fixes" a future preset by loosening the serializer instead of
    by choosing a case type, the case above stays green and this one goes red.
    """
    tenant = _tenant(Civilization.CHINESE)
    client = APIClient(**_bearer(_admin(tenant, "case_type_reject_admin")))

    response = client.post(
        "/api/v1/workflow/templates/",
        {
            "name": "不存在的案件类型",
            "description": "",
            "civilization": Civilization.CHINESE,
            "case_type": "EMERGENCY",
            "is_active": True,
            "nodes": [],
        },
        format="json",
    )
    assert response.status_code == 400, response.data
    assert "case_type" in response.data, response.data


# ── the copy, and the picker ──────────────────────────────────────────


def test_every_preset_case_type_has_copy_in_every_bundle():
    """A case type with no bundle entry renders as "unrecognized", not as itself.

    `src/lib/domainDisplay.ts::resolveEnumDisplay` deliberately refuses to leak
    the i18n key, so a member the bundles do not cover comes out as
    `common.value.unrecognized` copy with the raw value only in `title`. That is
    what all three EMERGENCY presets rendered as in the preset preview panel —
    the 400 had a visible twin on screen that nothing failed over.

    The three bundles are kept exactly aligned; this asserts that for the keys
    this file is responsible for.
    """
    wanted = sorted(set(_preset_case_types().values()))
    missing = {}
    for name in BUNDLES:
        case_types = _bundle(name).get("workflow", {}).get("case_types", {})
        absent = [value for value in wanted if value not in case_types]
        if absent:
            missing[name] = absent
    assert missing == {}, (
        f"preset case types with no copy: {missing}. The three bundles are "
        f"aligned with no gaps; add the key to all three, in place."
    )


def test_the_editor_can_select_every_preset_case_type():
    """A preset whose case type the picker does not offer cannot be edited back.

    `WorkflowEditor` seeds `templateCaseType` from the preset, but its `<select>`
    only lists nine members. With `value="EMERGENCY"` matching no `<option>`,
    the control showed no selection while the state — and therefore the POST —
    still said EMERGENCY: the user could not see the field that was about to be
    rejected, let alone correct it.
    """
    offered = set(_editor_options())
    unselectable = sorted(
        f"{key} -> {value}"
        for key, value in _preset_case_types().items()
        if value not in offered
    )
    assert unselectable == [], (
        f"preset case types the editor's picker does not offer: "
        f"{unselectable}. The <select> is how a user corrects this field; a "
        f"value it cannot show is a value they cannot see is wrong."
    )
    # Absence: the picker offers nothing that is not a CaseType either.
    assert offered <= set(CaseType.values), sorted(offered - set(CaseType.values))


# ── the civilization the case type is filed under ─────────────────────


def test_each_preset_case_type_is_valid_for_its_civilization_or_is_recorded():
    """Never both, never neither — the shape `test_workflow_template_cast.py` uses.

    `VALID_CASE_TYPES_BY_CIVILIZATION` is what `create_from_judgment` checks
    before it will build a workflow, so a preset outside its civilization's set
    saves but can never be routed to. The presets still in that state are
    recorded above with reasons; the point of asserting it from both ends is
    that a preset must be re-filed into a case type *inside* its set rather than
    quietly joining the list — and that an entry whose gap gets fixed goes red
    instead of aging into a lie. The `stale` half is not hypothetical: widening
    the three sets with APPEAL, and re-filing EGYPTIAN_TRIALS onto DIVINE_TRIAL,
    each reddened it until the matching entry was deleted. Re-filing the last
    three SPECIALs reddened it a third time, and putting one of them back on
    SPECIAL — with its entry already gone — reddens the `unrecorded` half
    instead. Both directions were measured; the output is in the task report.
    """
    presets = _preset_case_types()
    civilization_of = {key: preset["civilization"] for key, preset in _presets().items()}

    outside = {
        key
        for key, value in presets.items()
        if value not in VALID_CASE_TYPES_BY_CIVILIZATION.get(civilization_of[key], set())
    }
    recorded = set(CASE_TYPES_NOT_VALID_FOR_THEIR_CIVILIZATION)

    assert recorded - set(presets) == set(), (
        f"the table records presets that no longer exist: "
        f"{sorted(recorded - set(presets))}"
    )
    unrecorded = sorted(outside - recorded)
    assert unrecorded == [], (
        f"presets filed under a case type their civilization does not accept, "
        f"with no reason recorded: "
        f"{[(k, presets[k], civilization_of[k]) for k in unrecorded]}. "
        f"create_from_judgment raises ValueError for the pair, so a template "
        f"saved from one can never be reached. Pick a case type inside the "
        f"civilization's set, or record why not."
    )
    stale = sorted(recorded - outside)
    assert stale == [], (
        f"the table excuses presets whose case type IS valid for their "
        f"civilization now: {stale}. The gap was closed; delete the entry "
        f"rather than leaving a finding that has become false."
    )
    # Every preset re-filed out of this table, named directly so the decisions
    # do not rest on the arithmetic above alone: the three EMERGENCY ones
    # (`a77a41e`), EGYPTIAN_TRIALS (`8b5aa00`), and the last three SPECIALs.
    for key in (
        "CHINESE_EMERGENCY", "EUROPEAN_EMERGENCY", "EGYPTIAN_EMERGENCY",
        "EGYPTIAN_TRIALS",
        "GREEK_ROUTINE", "EUROPEAN_HELL_CIRCLE", "EGYPTIAN_AFTERLIFE",
    ):
        assert key not in outside, (
            f"{key} was re-filed into a case type its civilization does not "
            f"accept ({presets[key]} for {civilization_of[key]}). That trades a "
            f"400 at save time for a ValueError at routing time."
        )
