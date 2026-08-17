"""
Workflow service — creates ApprovalWorkflow instances from judgment verdicts.
Routes to civilization-specific approval templates.
"""

from django.db import transaction

from apps.judgment.models import Judgment
from apps.souls.models import Civilization
from apps.workflow.models import (
    ApprovalNode,
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    CaseType,
    NodeStatus,
    NodeType,
    WorkflowTemplate,
)
from apps.workflow.node_shape import normalize_template_node

# Workflow templates by civilization and case type
#
# ``actor`` names the approver a node designates, spelled exactly as the
# ``Actor.name`` column ``seed_mythology`` writes. It is what
# ``_resolve_approver`` turns into ``approver_actor``, and it is present on a
# node only where the template already said who decides — see
# ``TEMPLATE_NODES_WITHOUT_AN_APPROVER`` below for the ones deliberately left
# without it and why. A node with no ``actor`` key is created as ``SYSTEM``,
# which after ``0011_backfill_ten_court_approvers`` means it can only be moved
# by the audited ``escalate`` path. That is the intended cost: an approval
# flow whose steps do not say who approves them is not a thing this system
# should be able to run silently.
#
# THIS IS NOT THE SAME TABLE AS THE FRONTEND PRESETS, AND THAT IS DELIBERATE.
# ``frontend/src/config/workflow-templates.ts`` holds seventeen presets keyed by
# name (``CHINESE_ROUTINE``, ``EUROPEAN_GREEK``, …); this dict holds eight keyed
# by ``(civilization, case_type)``. Neither is generated from the other and their
# node sets differ — the frontend has Greek, Dante and 枉死城 flows this file has
# never had, this file has the two European ecclesiastical flows the frontend has
# never had, and a European ROUTINE judgment falls through *here* to the generic
# 审批节点 below while the frontend offers a 末日审判流程 preset for the same pair.
# The presets are what a user picks in the editor and can save as a
# ``WorkflowTemplate`` row, which ``create_from_judgment`` then reads in
# preference to this dict — so the two sets meet in the database rather than in
# code. The one rule both must obey is that a node naming a person must name a
# person the cast can supply; ``tests/test_workflow_template_cast.py`` asserts it
# across both.
#
# TWO OF THE EIGHT ARE PORTS OF A PRESET, WHICH IS NEW AND IS NOT A CHANGE OF
# POLICY. ``(EUROPEAN, APPEAL)`` and ``(EGYPTIAN, APPEAL)`` carry the same node
# labels as ``EUROPEAN_APPEAL`` / ``EGYPTIAN_APPEAL`` above, because without an
# entry here an appeal for those two civilizations resolved to nothing at all —
# see ``WorkflowService._resolve_template``. Sharing the labels is what puts
# them under ``tests/test_workflow_preset_node_types.py::
# test_the_two_sides_agree_on_a_shared_node_s_type``, so the two tables' reading
# of those steps is compared rather than assumed. The other six entries stay
# spelled this file's own way; the two tables are still two tables.
WORKFLOW_TEMPLATES = {
    # Chinese ten courts.
    #
    # Every node here names a king, and the court it names him in agrees with
    # the court he sits in per CHINESE_ACTORS / CHINESE_REALMS (king N in
    # DY_COURT_NN, as `79dee57` corrected and test_seed_mythology asserts). Two
    # independent columns saying the same thing is why this template — and only
    # this one — can be backfilled without judgement calls.
    (Civilization.CHINESE, CaseType.ROUTINE): {
        "name": "十殿审判流程",
        "nodes": [
            {"name": "秦广王 · 分流", "court": "第一殿", "type": NodeType.TRIAL, "order": 1, "actor": "秦广王"},
            {"name": "楚江王 · 初审", "court": "第二殿", "type": NodeType.TRIAL, "order": 2, "actor": "楚江王"},
            {"name": "宋帝王 · 二审", "court": "第三殿", "type": NodeType.TRIAL, "order": 3, "actor": "宋帝王"},
            {"name": "五官王 · 三审", "court": "第四殿", "type": NodeType.TRIAL, "order": 4, "actor": "五官王"},
            {"name": "阎罗王 · 四审", "court": "第五殿", "type": NodeType.TRIAL, "order": 5, "actor": "阎罗王"},
            {"name": "卞城王 · 五审", "court": "第六殿", "type": NodeType.TRIAL, "order": 6, "actor": "卞城王"},
            {"name": "泰山王 · 六审", "court": "第七殿", "type": NodeType.TRIAL, "order": 7, "actor": "泰山王"},
            {"name": "都市王 · 七审", "court": "第八殿", "type": NodeType.TRIAL, "order": 8, "actor": "都市王"},
            {"name": "平等王 · 八审", "court": "第九殿", "type": NodeType.TRIAL, "order": 9, "actor": "平等王"},
            {"name": "转轮王 · 终审", "court": "第十殿", "type": NodeType.FINAL, "order": 10, "actor": "转轮王"},
        ],
    },
    # Chinese appeal
    (Civilization.CHINESE, CaseType.APPEAL): {
        "name": "申诉审判流程",
        "nodes": [
            {"name": "魏征 · 察查司", "court": "察查司", "type": NodeType.APPEAL, "order": 1, "actor": "魏征"},
            {"name": "原殿阎王 · 复核", "court": "原审判殿", "type": NodeType.TRIAL, "order": 2},
            {"name": "上级殿阎王", "court": "上一殿", "type": NodeType.TRIAL, "order": 3},
            {"name": "酆都大帝 · 终审", "court": "酆都", "type": NodeType.FINAL, "order": 4},
        ],
    },
    # Chinese cross-realm
    (Civilization.CHINESE, CaseType.CROSS_REALM): {
        "name": "跨域审判流程",
        "nodes": [
            {"name": "案件分类", "court": "第一殿", "type": NodeType.EVALUATION, "order": 1},
            {"name": "城隍初审", "court": "城隍体系", "type": NodeType.TRIAL, "order": 2},
            {"name": "十殿联审", "court": "十殿", "type": NodeType.TRIAL, "order": 3},
            {"name": "酆都大帝 · 终审", "court": "酆都", "type": NodeType.FINAL, "order": 4},
        ],
    },
    # European canonization
    (Civilization.EUROPEAN, CaseType.CANONIZATION): {
        "name": "封圣审查流程",
        "nodes": [
            {"name": "主教座堂初审", "court": "Diocese", "type": NodeType.TRIAL, "order": 1},
            {"name": "教省复审", "court": "Archdiocese", "type": NodeType.TRIAL, "order": 2},
            {"name": "罗马教廷终审", "court": "Vatican", "type": NodeType.FINAL, "order": 3},
        ],
    },
    # European purgatory review
    (Civilization.EUROPEAN, CaseType.PURGATORY_REVIEW): {
        "name": "炼狱复核流程",
        "nodes": [
            {"name": "忏悔赦免审核", "court": "Confessional", "type": NodeType.EVALUATION, "order": 1},
            {"name": "炼狱净化评估", "court": "Purgatory Court", "type": NodeType.TRIAL, "order": 2},
            {"name": "天堂准入终审", "court": "Heaven Gate", "type": NodeType.FINAL, "order": 3},
        ],
    },
    # European appeal
    #
    # ADDED BECAUSE `create_appeal_workflow` HAD NOTHING TO BUILD FROM HERE.
    # Until this entry existed, `WORKFLOW_TEMPLATES.get((EUROPEAN, APPEAL))`
    # answered None, the node loop ran zero times, and a European appeal came
    # out as an ApprovalWorkflow with no nodes at all — PENDING with
    # `current_node=None`, which cannot be advanced, approved or escalated.
    # `create_from_judgment` never had that failure because it ends in a
    # generic single-node fallback; that fallback is now shared (see
    # `_resolve_template`), so the stuck row is impossible either way. This
    # entry is the *other* half: a generic 审批节点 is movable but says nothing,
    # and 「天堂申诉流程」 is a flow this repository already had a sourced
    # version of.
    #
    # THE CONTENT IS THE FRONTEND PRESET, NOT A NEW READING. `EUROPEAN_APPEAL`
    # in `frontend/src/config/workflow-templates.ts` carries the sourcing —
    # 约 5:22 / 林后 5:10 for Christ as the only judge, the Requiem offertory's
    # `repraesentet` for Michael presenting rather than deciding, and the
    # deletion of the invented 天使议会 复核 layer. Nothing here is decided
    # afresh; the node labels are copied character for character, which is what
    # puts these three nodes under
    # `tests/test_workflow_preset_node_types.py::test_the_two_sides_agree_on_a_shared_node_s_type`
    # — the two tables' readings of them are now compared rather than merely
    # written the same way twice.
    #
    # The court column is this file's own spelling (English, like Diocese and
    # Vatican above) rather than the preset's 天堂: courts are not compared
    # across the two tables, and the Egyptian block below already shows that
    # each table keeps its own column conventions while agreeing about the
    # reading.
    (Civilization.EUROPEAN, CaseType.APPEAL): {
        "name": "天堂申诉流程",
        "nodes": [
            {"name": "申诉受理", "court": "Heaven", "type": NodeType.APPEAL, "order": 1},
            {"name": "Michael · 引领呈上", "court": "Heaven", "type": NodeType.EXECUTION, "order": 2, "actor": "Michael"},
            {"name": "Christ · 终审", "court": "Heaven", "type": NodeType.FINAL, "order": 3, "actor": "Christ"},
        ],
    },
    # Egyptian appeal
    #
    # Same reason and same provenance as the European appeal above: without it
    # `create_appeal_workflow` built an Egyptian appeal with no nodes. The
    # content is `EGYPTIAN_APPEAL` from the preset file, whose sourcing is
    # Budge/Ani Plate IV — Isis and Nephthys stand behind Osiris' throne *in
    # the Hall of Two Truths*, not in the Field of Reeds and not in a generic
    # 「埃及」.
    #
    # The labels are the preset's English spellings (`Isis`, `Nephthys`,
    # `Osiris`) rather than the Chinese ones the heart-weighing template above
    # uses (阿努比斯, 欧西里斯). That is a deliberate difference between two
    # blocks of the same file, so: the Chinese spellings up there are frozen by
    # `0011`/`0012`, which wrote them into live rows and must keep naming them
    # that way. These nodes are new, nothing has ever been stored under them,
    # and copying the preset's spelling is what lets the two tables be compared
    # node-for-node instead of only civilization-for-civilization. Either
    # spelling resolves — `Actor.name` for the Egyptian cast *is* the English
    # form, and 欧西里斯 resolves through EGYPTIAN_ACTOR_ALIASES.
    (Civilization.EGYPTIAN, CaseType.APPEAL): {
        "name": "埃及申诉流程",
        "nodes": [
            {"name": "Isis · 受理", "court": "Hall of Two Truths", "type": NodeType.APPEAL, "order": 1, "actor": "Isis"},
            {"name": "Nephthys · 复核", "court": "Hall of Two Truths", "type": NodeType.TRIAL, "order": 2, "actor": "Nephthys"},
            {"name": "Osiris · 终审", "court": "Hall of Two Truths", "type": NodeType.FINAL, "order": 3, "actor": "Osiris"},
        ],
    },
    # Egyptian heart weighing
    (Civilization.EGYPTIAN, CaseType.HEART_WEIGHING): {
        "name": "欧西里斯称重流程",
        "nodes": [
            # `actor` carries the seeded `Actor.name`, which for the Egyptian
            # cast is the English form — the Chinese in the node label is the
            # `name_zh` column. Node 1's label 阿努比斯 is character-for-character
            # Anubis' `name_zh`; node 3's 欧西里斯 is NOT — the seeder spells
            # Osiris 奥西里斯. Two renderings of Wsir, and both are kept: the
            # owner's decision was to keep both translations and record the
            # correspondence rather than pick one.
            #
            # It is recorded now. 「欧西里斯」 is an alias on the Osiris row
            # (EGYPTIAN_ACTOR_ALIASES -> powers_json["aliases"]), so the
            # node-label-to-deity mapping is data in the database and not the
            # inference it was when workflow/0011 wrote it down.
            # `_resolve_approver` reads that data, and
            # tests/test_actor_name_aliases.py asserts that every personal name
            # in a node label resolves to the actor the node designates — so
            # this pairing is checked rather than asserted in a comment.
            #
            # NODES 1 AND 2 WERE BOTH RENAMED AND BOTH RE-TYPED, FROM
            # 「阿努比斯 · 引渡审判」/TRIAL AND 「四十二神官 · 罪行核实」/TRIAL.
            # The old values said, twice each, the thing the sources deny.
            #
            # * **Anubis operates the balance; he does not judge.** Plate III's
            #   inscription calls him 「O weigher of righteousness」 and BD 30B
            #   「him who keepeth the scales」 (Budge, Papyrus of Ani 1895;
            #   independently in BM EA 9901, Hunefer). The verdict is Thoth's to
            #   record and read out and Osiris' to accept. So the step produces a
            #   measurement, which is EVALUATION — and 「审判」 in the old label
            #   asserted the opposite in the one column a reader sees first.
            #   docs/lore-verification/README.md's position table lists
            #   「Anubis | judge | operates the scales」 among the errors its
            #   audits could not see, and verify-egyptian.md §7 row 8 files
            #   `Anubis → JUDGE` as wrong in kind.
            # * **The forty-two declarations are a statement, not an instance.**
            #   BD 125B has the deceased make all forty-two negative
            #   declarations in one passage of the hall; no assessor decides
            #   anything, and there is nothing for them to 「核实」 — the old
            #   label made the bench the actor of a verification the rite does
            #   not contain. Recording a step is a measurement, not a hearing,
            #   so it is EVALUATION too.
            #
            # The frontend had already corrected its own copies of these two —
            # `Anubis · 引导与称量` and `42审判者 · 否定告白`, both mapped to
            # EVALUATION in `frontend/src/config/workflow-node-types.ts`, whose
            # comment on 灵魂引导 said outright that the backend node was still
            # carrying 「阿努比斯审判」的旧读法. It no longer is, and that comment
            # was updated with this change. The step words here are the frontend's;
            # the deity spellings stay this file's own (Chinese labels, English
            # `actor` keys), so the two tables agree about the reading without
            # pretending to be one table — see the header above.
            #
            # Already-stored rows carrying the old spellings are corrected by
            # `0012_correct_the_egyptian_weighing_nodes`, which also records why
            # `0011`'s frozen ROWS still name the old label and must.
            {"name": "阿努比斯 · 引导与称量", "court": "Hall of Two Truths", "type": NodeType.EVALUATION, "order": 1, "actor": "Anubis"},
            {"name": "四十二神官 · 否定告白", "court": "Hall of Two Truths", "type": NodeType.EVALUATION, "order": 2},
            {"name": "欧西里斯 · 终审", "court": "Duat", "type": NodeType.FINAL, "order": 3, "actor": "Osiris"},
        ],
    },
}


# The template nodes that name no approver, and the reason each one names none.
#
# This list is not consulted at runtime. It exists so that "this node has no
# `actor` key" reads as a recorded finding instead of an omission somebody
# forgot to fill in — and so that adding an `actor` to one of them has to be a
# deliberate deletion from this list. `tests.py::TestTemplateApproverBasis`
# asserts the two stay in step: every node in WORKFLOW_TEMPLATES either carries
# an `actor` or appears here, never both and never neither.
TEMPLATE_NODES_WITHOUT_AN_APPROVER = {
    # 申诉审判流程
    "原殿阎王 · 复核": "「原殿」 is whichever court first tried the case. The node "
                   "does not say which, and ApprovalWorkflow records no such "
                   "column — original_workflow is nullable and is not set for "
                   "an appeal raised outside create_appeal_workflow. Resolving "
                   "it would mean picking one of ten kings.",
    "上级殿阎王": "「上一殿」 is relative to the court above, which is unknown for "
              "the same reason 原殿阎王 is.",
    "酆都大帝 · 终审": "酆都大帝 has no Actor row in any civilization's cast "
                  "(0 hits in seed_mythology). Creating one to satisfy a "
                  "workflow template would be inventing a member of the "
                  "pantheon.",
    "案件分类": "Names an activity, not a person.",
    "城隍初审": "城隍 is an office held by many local City Gods and has no Actor "
             "row; 「城隍体系」 in the court column says so outright — it is a "
             "system, not a seat.",
    "十殿联审": "Ten kings sitting jointly. approver_actor is a single FK; "
             "picking one of the ten would misrecord a joint session as one "
             "king's decision.",
    # 天堂申诉流程. Shared with the preset, which excuses the same name for the
    # same reason — `tests/test_workflow_template_cast.py::
    # test_the_two_sides_excuse_the_same_shared_nodes` asserts the two sides do
    # not disagree about it.
    "申诉受理": "Names the act of accepting an appeal, not a person. It used to "
             "read 「Gabriel · 受理」 in the preset; Gabriel announces to the "
             "living (Dan 8:16, 9:21; Lk 1:11-38) and does not receive the "
             "dead's cases — see the European section of "
             "frontend/src/config/workflow-templates.ts.",
    "主教座堂初审": "An institution (Diocese). EUROPEAN_ACTORS has no bishop.",
    "教省复审": "An institution (Archdiocese).",
    "罗马教廷终审": "An institution (the Curia). Naming a pope would be inventing "
               "one.",
    "忏悔赦免审核": "A sacrament, not a person.",
    "炼狱净化评估": "Names the process. Purgatorio's terraces have no seated "
               "judge — see realms/0014, which deliberately added no actor.",
    # THIS ONE IS NOW A DECISION RATHER THAN AN ABSENCE, AND IT IS WHY THE
    # REASON GREW. It used to say only "Names the gate. Peter is not in
    # EUROPEAN_ACTORS." — true when written, and no longer the whole story:
    # `79dee57` seeded Christ, so the cast does contain a judge who could be
    # named here, and the next reader who notices that will point this node at
    # him. Do not. There is no second adjudication at the exit of purgatory:
    # the particular judgment already referred the life to Christ (CCC
    # 1021-1022), and CCC 1030-1032 has purgation followed by entry into
    # heaven with nothing further to decide. Naming a judge here would invent
    # a tribunal, which is the same move as the archangel council the frontend
    # preset used to run (see the European section of
    # frontend/src/config/workflow-templates.ts).
    "天堂准入终审": "Names the gate. Peter is not in EUROPEAN_ACTORS, and Christ — "
               "who is, since 79dee57 — does not judge here: the particular "
               "judgment referred the life to him already (CCC 1021-1022) and "
               "purgation is followed by entry, not by a second verdict (CCC "
               "1030-1032).",
    # Renamed from 「四十二神官 · 罪行核实」 with the node itself — the reason is
    # unchanged, but the old step word claimed the bench performed a
    # verification, which is the reading the rename removes.
    "四十二神官 · 否定告白": "The forty-two assessors are forty-two Actor rows "
                     "(seed_mythology seeds them individually). One FK cannot "
                     "hold a bench, and the declarations are addressed to all "
                     "of them in one passage of the hall (BD 125).",
    # Generic fallback built in create_from_judgment
    "审批节点": "The fallback node for a (civilization, case_type) pair with no "
             "template. By construction nothing is known about who decides it.",
}


# The same record, for the *presets* — the node labels
# ``frontend/src/config/workflow-templates.ts`` writes down as naming nobody in
# its own ``NODES_THAT_NAME_NO_ACTOR`` table.
#
# This one IS consulted at runtime, and it has to be: since ``_resolve_approver``
# falls back to reading the node label, the labels it reads are overwhelmingly
# preset labels (a preset saved from /workflow becomes ``nodes_json``, which
# ``create_from_judgment`` prefers over ``WORKFLOW_TEMPLATES``). Consulting only
# the backend table would leave every frontend-only bench, institution and
# action name — 42审判者 · 否定告白, 城隍申诉审理, 枉死城登记, … — to be
# resolved if the cast happens to contain a row answering to it. "Nothing
# currently answers to that name" is luck; the two tables are the decision.
#
# Names only, no reasons: the reasons are written next to the entries in the
# TypeScript file and duplicating them here would give this repository two
# copies of a rationale free to drift. What must not drift is the *set*, and
# ``tests/test_workflow_preset_approvers.py`` compares it against the parsed
# module — the same file, parsed the same way,
# ``tests/test_workflow_template_cast.py`` already reads.
PRESET_NODES_THAT_NAME_NO_ACTOR = frozenset({
    # 中国
    "原殿阎王 · 复核",
    "上级殿阎王",
    "酆都大帝 · 终审",
    "酆都大帝直审",
    "案件分类",
    "城隍初审",
    "城隍申诉审理",
    "十殿联审",
    "枉死城登记",
    "寿数折抵",
    "罪行核定",
    "阿鼻地狱入狱",
    "功德核定",
    "轮回分流",
    "功德评定",
    "紧急受理",
    "申诉受理",
    # 埃及
    "42审判者 · 否定告白",
})


#: How a node label names a person: 「<name> · <step>」. Identical to the probe
#: ``tests/test_workflow_template_cast.py`` uses to assert that every preset
#: node names somebody the cast can supply — that assertion is only worth
#: something if the runtime resolves the same substring the test probes, so the
#: two are compared in ``tests/test_workflow_preset_approvers.py`` rather than
#: merely written the same way.
NODE_LABEL_SEPARATOR = " · "


def _named_person(node_name: str) -> str:
    """The part of a node label that claims to be somebody's name.

    A label with no separator is taken whole, so 「城隍初审」 is probed as a name
    rather than excused by its own formatting — it is excused by being listed
    above, which is a decision, not a punctuation accident.
    """
    if NODE_LABEL_SEPARATOR in node_name:
        return node_name.split(NODE_LABEL_SEPARATOR)[0]
    return node_name


def _designates_nobody(node_name: str) -> bool:
    """Whether this node is *recorded* as naming nobody, by either side."""
    return (
        node_name in TEMPLATE_NODES_WITHOUT_AN_APPROVER
        or node_name in PRESET_NODES_THAT_NAME_NO_ACTOR
    )


# Valid case types per civilization.
#
# ALL THREE CIVILIZATIONS ALLOW `APPEAL`, AND THIS TABLE IS THE THING THAT
# CHANGED. Until now only the Chinese set carried it, which made *every*
# European and Egyptian appeal a `ValueError`: `create_from_judgment` sets
# `case_type = CaseType.APPEAL` unconditionally when `is_appeal=True` and no
# explicit case type is passed (the default path — `views.create_from_judgment`
# forwards `request.data.get("case_type")`, i.e. `None`, for a request that only
# says `is_appeal: true`), and then validates that value against this table.
#
# The repository answered the same question two ways, and this table was the
# one that was behind. `create_appeal_workflow` a few hundred lines below writes
# `case_type=CaseType.APPEAL` for a soul of any civilization and validated
# nothing at all, so an appeal raised through *that* entry point has always been
# legal for all three. Two presets say the same: `EUROPEAN_APPEAL` and
# `EGYPTIAN_APPEAL` in `frontend/src/config/workflow-templates.ts` are complete
# flows (Christ · 私审判 …, Isis · 受理 → Nephthys · 复核 → Osiris · 终审) that a
# user can save and that no judgment could ever be routed to. Two entry points
# and two presets against one set: the set was widened rather than the other
# four narrowed.
#
# Both entry points now run this check — see `create_appeal_workflow`, which
# validates through `validate_civilization_case_type` for the same reason. The
# agreement between them is meant to be structural, not a coincidence that
# holds while the two happen to write the same constant.
VALID_CASE_TYPES_BY_CIVILIZATION = {
    Civilization.CHINESE: {CaseType.ROUTINE, CaseType.APPEAL, CaseType.CROSS_REALM, CaseType.SPECIAL},
    Civilization.EUROPEAN: {
        CaseType.CANONIZATION, CaseType.PURGATORY_REVIEW, CaseType.HERESY_TRIAL,
        CaseType.ROUTINE, CaseType.APPEAL,
    },
    Civilization.EGYPTIAN: {
        CaseType.HEART_WEIGHING, CaseType.DIVINE_TRIAL, CaseType.ROUTINE,
        CaseType.APPEAL,
    },
}


class WorkflowService:
    """
    Creates approval workflow instances from concluded judgments.
    Routes to civilization-specific templates.
    """

    @classmethod
    def _resolve_approver(cls, node_def: dict, civilization: str, tenant_id) -> dict:
        """Turn the person a template node names into approver columns.

        Returns the kwargs ``ApprovalNode.objects.create`` should get:
        ``{"approver_type": "ACTOR", "approver_actor": <Actor>}`` when the named
        actor is on this tenant's bench, and ``{"approver_type": "SYSTEM"}``
        otherwise.

        Or ``{"approver_type": "ROLE", "approver_role": …}`` when the node
        names no person but *does* carry a role somebody typed into the editor —
        see "the role a node carries" below.

        **The node is normalized first** (``normalize_template_node``), so this
        reads one spelling whichever the caller holds — a raw
        ``WORKFLOW_TEMPLATES`` entry, a row the API serializer wrote, or an
        already-normalized dict from the loops below. It matters most here:
        reading the label is what makes preset-built nodes approvable at all
        (below), and reading it under a key half the rows lack would re-break
        that in silence, because every test of it in
        ``tests/test_workflow_preset_approvers.py`` hands this the other shape.

        **The name comes from the ``actor`` key, or failing that from the node's
        own label.** The second half is not a convenience either: nodes built
        from a *preset* have no ``actor`` key at all — ``workflow-templates.ts``
        writes ``name/court/type/order``, /workflow saves that as
        ``WorkflowTemplate.nodes_json``, and ``create_from_judgment`` prefers a
        stored template over ``WORKFLOW_TEMPLATES``. Reading only the ``actor``
        key therefore made *every* preset-built node ``SYSTEM``, and since
        ``7fe9a28`` a ``SYSTEM`` node can be decided by nobody: a workflow
        created from a preset was stuck from birth, while its labels named
        Christ and Michael, both of whom the cast supplies. Measured in
        ``e7e87e7``::

            1.'Christ · 私审判' SYSTEM None   2.'Michael · 引领入光' SYSTEM None
            3.'Christ · 公审判' SYSTEM None

        The label is probed the way ``tests/test_workflow_template_cast.py``
        probes it — the part before 「 · 」, or the whole string when there is no
        separator (see ``_named_person``). That file asserts that every preset
        node names somebody the cast can supply; the assertion is only worth
        something if this resolves the same substring, so the two probes are
        compared in ``tests/test_workflow_preset_approvers.py`` instead of being
        written the same way twice and hoped over.

        **A node recorded as naming nobody is not probed at all**, whichever of
        the two tables records it (see ``_designates_nobody``). 「四十二神官 ·
        否定告白」 is a forty-two-member bench and 「十殿联审」 is ten kings
        sitting jointly; ``approver_actor`` is a single FK, so resolving either
        would file a joint session as one being's decision — a quieter and worse
        error than the stuck flow this fallback fixes. The exclusion is checked
        against an ``Actor`` deliberately created to answer to an excused label,
        so it is a rule rather than an accident of who is currently seeded.

        Falling back to ``SYSTEM`` is the fail-closed direction, not a
        convenience: since ``can_approve`` became ``approve_node``'s only gate,
        a ``SYSTEM`` node cannot be decided by anyone and has to go through the
        audited ``escalate``. The alternative — creating the node as ``ACTOR``
        with ``approver_actor=NULL`` — looks like it designates someone and
        designates no one, which is the exact shape the guard was written to
        refuse.

        Lookup is over every name the cast records, scoped to the workflow's own
        tenant and civilization: the four name columns first, then the aliases
        on ``powers_json["aliases"]`` — see
        ``apps/actors/models.py::resolve_actor_by_any_name``. The columns have
        to be plural because the cast is spelled two ways: the Chinese kings'
        ``name`` is the Chinese (秦广王) while the Egyptian gods' is the English
        (``Osiris``), with the Chinese in ``name_zh``.

        The alias pass is the part that is *recorded* rather than lucky. Until
        ``EGYPTIAN_ACTOR_ALIASES`` existed, a template naming 「欧西里斯」 —
        which is what the heart-weighing template calls itself, while the seeder
        spells the same god 「奥西里斯」 — resolved to nobody, and the reason the
        node worked at all was that the ``actor`` key beside it happened to say
        ``"Osiris"``. That correspondence was an inference living in a comment.
        It is now a row in the database, and this is what reads it.

        The alias pass runs in Python, not as a ``powers_json`` lookup. JSON
        containment lookups are backend-specific (they are unsupported on
        SQLite, which is what the test suite runs on), and the candidate set is
        one civilization's cast for one tenant — tens of rows. ``seeding.py``
        makes the same choice for ``assessor_index`` and says the same thing.

        The tenant scope matters because ``Actor.name`` is not globally unique —
        it is unique per ``(name, civilization)`` per tenant, and an unscoped
        ``.get()`` would raise MultipleObjectsReturned the first time two
        tenants seed the same pantheon.

        **The role a node carries is the last thing tried, not the first.**
        A node saved from /workflow can set ``approver_type="ROLE"`` with an
        ``approver_role`` — and a non-empty ``approver_role`` is one of exactly
        two things ``designates_approver`` accepts, so discarding it would hand
        the user back the un-approvable node ``e7e87e7`` measured, arriving
        through a different key. It is tried *after* the name because naming a
        person is the more specific designation and because ``"ROLE"`` is what
        ``WorkflowEditor.getTemplateNodes`` defaults **every** node to
        (``approver_type ?? "ROLE"``, ``approver_role`` usually ``""``) — an
        empty role is a default, not a decision, and honouring the default
        ahead of the label would have unpicked ``625f4d1`` for every template
        the editor has ever saved. An empty role designates nobody, so it falls
        through to ``SYSTEM`` exactly as before.
        """
        node_def = normalize_template_node(node_def)
        node_name = node_def["node_name"]
        actor_name = node_def.get("actor")
        excused = not actor_name and _designates_nobody(node_name)
        if not actor_name and not excused:
            actor_name = _named_person(node_name)

        if actor_name:
            from apps.actors.models import Actor, resolve_actor_by_any_name

            actor = resolve_actor_by_any_name(
                Actor._base_manager.filter(
                    civilization=civilization, tenant_id=tenant_id, is_deleted=False
                ),
                actor_name,
            )
            if actor is not None:
                return {"approver_type": "ACTOR", "approver_actor": actor}

        role = node_def.get("approver_role") or ""
        if node_def.get("approver_type") == "ROLE" and role:
            return {"approver_type": "ROLE", "approver_role": role}

        return {"approver_type": "SYSTEM"}

    @classmethod
    def validate_civilization_case_type(cls, civilization: str, case_type: str) -> str | None:
        """
        Validate that case_type is appropriate for the given civilization.

        Args:
            civilization: The civilization code
            case_type: The case type to validate

        Returns:
            Error message if invalid, None if valid
        """
        valid_types = VALID_CASE_TYPES_BY_CIVILIZATION.get(civilization, set())
        if case_type not in valid_types:
            return (
                f"Case type '{case_type}' is not valid for civilization '{civilization}'. "
                f"Valid types: {', '.join(sorted(t.value for t in valid_types))}"
            )
        return None

    @classmethod
    def _generic_template(cls, civilization: str) -> dict:
        """The one-node flow a pair with no template of its own falls back to.

        It exists so that "no template" is a flow nobody can *read* anything
        into rather than a flow nobody can *move*: 审批节点 designates nobody
        (it is listed in ``TEMPLATE_NODES_WITHOUT_AN_APPROVER``) and so has to
        go through the audited ``escalate``, which is a visible cost. A
        node-less workflow, by contrast, is silently stuck — see
        ``_resolve_template``.
        """
        return {
            "name": f"{civilization} 审批流程",
            "nodes": [
                {"name": "审批节点", "court": civilization, "type": NodeType.TRIAL, "order": 1},
            ],
        }

    @classmethod
    def _resolve_template(
        cls, civilization: str, case_type: str, tenant
    ) -> tuple[dict, int | None]:
        """The template for this pair, and the priority it declares (if any).

        **BOTH ENTRY POINTS RESOLVE A TEMPLATE THROUGH THIS METHOD, AND THAT IS
        THE POINT OF IT EXISTING.** They used to resolve one in two different
        ways, and the difference was not a nuance:

        * ``create_from_judgment`` looked in the database first, then in
          ``WORKFLOW_TEMPLATES``, then fell back to a generic single node;
        * ``create_appeal_workflow`` looked *only* in ``WORKFLOW_TEMPLATES``
          and had no fallback at all.

        ``WORKFLOW_TEMPLATES`` carried an ``APPEAL`` entry for the Chinese
        only, so a European or Egyptian appeal raised through the second door
        got an ``ApprovalWorkflow`` with **zero nodes**: ``status=PENDING``,
        ``current_node=None``, and therefore un-advanceable (``advance_to_next``
        finds nothing), un-approvable (``approve_node`` 404s on "Node not
        found") and un-escalatable (``escalate`` needs a next node too). A row
        that can only be deleted.

        Two independent causes, and both are closed here rather than one:
        the *structural* one is that a second lookup existed at all, and the
        *content* one is that the hardcoded table had no European or Egyptian
        appeal to find. ``WORKFLOW_TEMPLATES`` now carries both — ported from
        the presets, which were already sourced — so those two appeals get
        their own flows rather than a generic 审批节点 that moves but says
        nothing.

        This was a latent defect, not an outage: ``create_appeal_workflow`` has
        no production caller anywhere in the backend (only tests reach it). It
        is repaired because the two doors are meant to answer the same question
        the same way — the same reason ``8b5aa00`` gave that method the
        case-type validation this one already ran.

        **The second element is the template's own priority**, or ``None`` when
        the template that won has nothing to say about it. Only a stored
        ``WorkflowTemplate`` row can say anything: ``WORKFLOW_TEMPLATES`` and
        the generic fallback are code, and a hardcoded urgency there would be a
        default nobody could see or change. ``None`` is not ``0`` —
        ``_resolve_priority`` distinguishes "this template asks for normal" from
        "this template does not say", and only the first outranks a floor.

        A DB template only wins if it actually defines nodes. Without that
        check an active template with ``nodes_json=[]`` shadows the hardcoded
        default and yields a workflow with no steps — which is exactly what
        happened: seven empty templates left over from testing sat on
        CHINESE/ROUTINE, so every Chinese routine judgment silently got an
        empty shell instead of 十殿审判流程. An unconfigured template should
        fall through to something that works, not override it.

        The query is scoped to ``tenant``. ``WorkflowTemplate`` is a genuinely
        per-tenant resource (``WorkflowTemplateViewSet`` enforces DataScope +
        tenant on every other path, and the model even used to carry a
        ``unique_workflow_template_tenant_name`` constraint) — it is not a
        shared/global resource the way ``Menu`` or the RBAC Permission/Role
        tables turned out to be. Without this filter, a tenant with no custom
        template for the pair could silently pick up another tenant's active
        template instead of falling through to the hardcoded default.

        **The returned template always has at least one node.** That is the
        invariant the callers rely on to be unable to build a node-less
        workflow, and ``tests/test_workflow_appeal_nodes.py`` asserts it over
        every ``(civilization, case_type)`` pair the validator admits — not
        only the ones that happen to have entries today.
        """
        try:
            db_template = (
                WorkflowTemplate.objects.filter(
                    civilization=civilization,
                    case_type=case_type,
                    is_active=True,
                    tenant=tenant,
                )
                .exclude(nodes_json=[])
                .first()
            )
            if db_template and db_template.nodes_json:
                return (
                    {"name": db_template.name, "nodes": db_template.nodes_json},
                    db_template.priority,
                )
        except Exception:
            pass

        template = WORKFLOW_TEMPLATES.get((civilization, case_type))
        if template and template["nodes"]:
            return template, None

        return cls._generic_template(civilization), None

    @classmethod
    def _resolve_priority(
        cls, explicit: int | None, template_priority: int | None, floor: int
    ) -> int:
        """Which of the two priorities wins, in one place.

        **Explicitly passed instance-level priority > template default > the
        entry point's floor.** The case that forces the argument to be
        ``int | None`` rather than ``int`` is the first ``>``: with a
        ``priority: int = 0`` signature, "the caller asked for normal" and "the
        caller said nothing" arrive as the same value, so honouring the
        template would have silently overridden every explicit ``0`` and
        honouring the argument would have made the template column dead on
        arrival. Only ``None`` distinguishes them, so ``None`` is the default
        and ``0`` means somebody chose it.

        The same reasoning is why ``views.ApprovalWorkflowViewSet``
        ``.create_from_judgment`` no longer reads
        ``request.data.get("priority", 0)``: that call turned *every* request
        that omitted the field into an explicit 0, which would have won here
        and left the template column with no effect whatsoever through the one
        endpoint that creates workflows. It now reads ``.get("priority")``, so
        an absent field arrives as ``None`` and a sent ``0`` still arrives as
        ``0``.

        ``floor`` is the entry point's own answer when nobody else has one: 0
        for ``create_from_judgment``, 1 for ``create_appeal_workflow``. The
        second is not a new decision — that method's signature has always
        defaulted to 1, on the reading that raising an appeal is itself the
        urgent act — and keeping it means this change does not quietly
        de-prioritise every appeal ever created.
        """
        if explicit is not None:
            return explicit
        if template_priority is not None:
            return template_priority
        return floor

    @classmethod
    def _create_nodes(cls, workflow: ApprovalWorkflow, template: dict, civilization: str):
        """Create ``template``'s nodes on ``workflow``; return the first one.

        Shared by both entry points for the same reason ``_resolve_template``
        is: the two loops were near-identical — same fields, same verdicts, same
        approver resolution — differing only in which template they were handed
        and in whether they ran at all. A duplicate is where the next divergence
        goes, and the divergence that had already happened was the whole defect.

        Nodes are normalized first, because ``template["nodes"]`` is one of two
        shapes — a stored ``nodes_json`` is what the API serializer wrote,
        ``WORKFLOW_TEMPLATES`` and the fallback are ``name/court/type/order`` —
        and this read only the second, so ``node_def["name"]`` raised KeyError
        (a 500 from ``apps/judgment/services.py:189``) for every template a user
        had actually saved. ``apps/workflow/node_shape.py`` has the rest.

        Raises:
            ValueError: if the template produced no nodes at all. By
                construction ``_resolve_template`` cannot return an empty one,
                so this is a guard against a *future* caller passing a template
                from somewhere else — it is the last place a node-less workflow
                could still be built, and it refuses inside the caller's
                transaction so nothing half-built is left behind.
        """
        first_node = None
        for position, raw_node_def in enumerate(template["nodes"], start=1):
            node_def = normalize_template_node(raw_node_def, position)
            node = ApprovalNode.objects.create(
                workflow=workflow,
                node_name=node_def["node_name"],
                node_order=node_def["node_order"],
                node_type=node_def["node_type"],
                court_code=node_def["court_code"],
                status=NodeStatus.PENDING,
                required_verdicts=["PASSED", "FAILED", "CONFIRMED", "REJECTED", "SKIPPED"],
                # Was a hardcoded `approver_type="SYSTEM"`, which is why all 30
                # nodes in the live database designate nobody and why the
                # identity check `4ceffe8` added could not refuse a single one
                # of them. Backfilling the existing rows
                # (0011_backfill_ten_court_approvers) without fixing this would
                # have closed the hole for exactly as long as it took someone
                # to create the next workflow.
                **cls._resolve_approver(node_def, civilization, workflow.tenant_id),
            )
            if first_node is None:
                first_node = node

        if first_node is None:
            raise ValueError(
                f"template {template.get('name')!r} defines no nodes; an "
                f"approval workflow with no nodes cannot be advanced, approved "
                f"or escalated. Use WorkflowService._resolve_template, which "
                f"always answers with at least one node."
            )

        workflow.current_node = first_node
        workflow.status = ApprovalWorkflowStatus.IN_PROGRESS
        workflow.save()
        return first_node

    @classmethod
    def create_from_judgment(
        cls,
        judgment: Judgment,
        case_type: str | None = None,
        is_appeal: bool = False,
        priority: int | None = None,
    ) -> ApprovalWorkflow | None:
        """
        Create an ApprovalWorkflow instance from a Judgment.

        Args:
            judgment: The concluded judgment
            case_type: Override case type (auto-detected from judgment if not provided)
            is_appeal: Whether this is an appeal workflow
            priority: Workflow priority (0=normal, 1=urgent, 2=critical).
                **None means "not specified"**, which is not the same as 0:
                an unspecified priority falls through to the template's own
                ``WorkflowTemplate.priority`` and only then to 0, while an
                explicit 0 wins over the template. See ``_resolve_priority``
                for why the parameter had to stop defaulting to 0 for the
                template column to mean anything at all.

        Returns:
            Created ApprovalWorkflow or None if no template matches

        Raises:
            ValueError: If case_type is not valid for the civilization
        """
        soul = judgment.soul
        civilization = soul.civilization

        # Determine case type
        if case_type is None:
            if is_appeal:
                case_type = CaseType.APPEAL
            elif civilization == Civilization.CHINESE:
                case_type = CaseType.ROUTINE
            elif civilization == Civilization.EGYPTIAN:
                case_type = CaseType.HEART_WEIGHING
            else:
                case_type = CaseType.ROUTINE  # European default

        # Validate case_type for civilization
        validation_error = cls.validate_civilization_case_type(civilization, case_type)
        if validation_error:
            raise ValueError(validation_error)

        # Look up template: DB first, then the hardcoded table, then a generic
        # one-node flow. `create_appeal_workflow` calls the same method — see
        # `_resolve_template` for what the two doors used to do differently and
        # what that cost.
        template, template_priority = cls._resolve_template(
            civilization, case_type, judgment.tenant
        )
        priority = cls._resolve_priority(priority, template_priority, floor=0)

        with transaction.atomic():
            # Create workflow
            workflow = ApprovalWorkflow.objects.create(
                judgment=judgment,
                soul=soul,
                workflow_name=template["name"],
                case_type=case_type,
                priority=priority,
                status=ApprovalWorkflowStatus.PENDING,
                is_appeal=is_appeal,
                tenant=judgment.tenant,
            )

            # Create nodes, and refuse a template that has none — see
            # `_create_nodes`. Inside the transaction, so a refusal leaves no
            # half-built workflow behind.
            cls._create_nodes(workflow, template, civilization)

        return workflow

    @classmethod
    def create_appeal_workflow(
        cls,
        original_workflow: ApprovalWorkflow,
        priority: int | None = None,
    ) -> ApprovalWorkflow:
        """
        Create an appeal workflow from an existing rejected workflow.

        Args:
            original_workflow: the workflow being appealed against.
            priority: as in ``create_from_judgment`` — **None means "not
                specified"**, and falls through to the stored template's
                ``WorkflowTemplate.priority`` and then to 1. The floor is 1
                rather than 0 because this method's signature has always
                defaulted to 1 (raising an appeal is itself the urgent act);
                the parameter changed from ``int`` to ``int | None`` so that an
                explicit ``priority=0`` is now expressible and distinguishable
                from silence. Every existing caller passing nothing still gets
                1, and ``tests/test_coverage_boost.py`` still gets 2 for
                ``priority=2``.

        Raises:
            ValueError: If APPEAL is not valid for the soul's civilization, or
                if the resolved template defines no nodes (which
                ``_resolve_template`` makes unreachable — see ``_create_nodes``).

        **Why this validates at all.** It did not, and that absence was half of
        the defect the case-type table above records: this method wrote
        ``case_type=CaseType.APPEAL`` for a soul of any civilization while
        ``create_from_judgment`` refused the same pair for two of the three. The
        table is now widened so both answers agree — but agreement between a
        checked path and an unchecked one is a coincidence, not a rule. Whoever
        removes ``APPEAL`` from one of the sets next should find out here as
        well as there, rather than shipping an appeal that only one door
        refuses.

        **This is not a no-op**, and the one case it changes is worth stating.
        For the three civilizations the answer is identical before and after,
        because ``APPEAL`` is now in every set. It differs for a soul whose
        ``civilization`` is ``UNKNOWN_CIVILIZATION`` — a soul whose tenant is
        missing or whose tenant code is not in ``TENANT_CIVILIZATION``. Before,
        that soul got an appeal workflow with **no nodes at all** (there is no
        ``(UNKNOWN, APPEAL)`` template, the node loop never runs, and the
        workflow is left ``PENDING`` with ``current_node=None``); now it raises,
        which is what ``create_from_judgment`` has always done for the same soul
        — ``VALID_CASE_TYPES_BY_CIVILIZATION.get(UNKNOWN, set())`` is empty. A
        node-less approval workflow cannot be advanced, approved or escalated,
        so the change replaces a stuck row with the error that explains it.

        **And the node-less workflow this method built for two of the three
        real civilizations is gone too.** The paragraph above closed the
        ``UNKNOWN`` case by refusing it; the European and Egyptian cases were
        not refused — they were *built*, empty, because this method read only
        ``WORKFLOW_TEMPLATES`` (which had a Chinese appeal and nothing else)
        and, unlike ``create_from_judgment``, had no generic fallback and never
        looked at the tenant's stored ``WorkflowTemplate`` rows at all. Both
        halves are now ``_resolve_template``'s job, which both doors call.
        """
        judgment = original_workflow.judgment
        soul = original_workflow.soul

        validation_error = cls.validate_civilization_case_type(
            soul.civilization, CaseType.APPEAL
        )
        if validation_error:
            raise ValueError(validation_error)

        # The appeal belongs to the tenant the case does. This used to read
        # `judgment.tenant if judgment else None`, and the `None` half was not
        # deliberate — `ApprovalWorkflow.judgment` is nullable, and it has to be
        # for an appeal to be chained at all (the FK is a OneToOne, so every
        # test that reaches this method builds its original *without* one), so the
        # common case here wrote `tenant=NULL`: a row no tenant-scoped read
        # returns, on the same soul whose original workflow does have a tenant.
        # It also decides which stored templates `_resolve_template` may see, so
        # leaving it NULL would have made the template lookup below findable
        # only by an unscoped query. The original workflow's tenant is the one
        # fact always available here.
        tenant = judgment.tenant if judgment else original_workflow.tenant
        template, template_priority = cls._resolve_template(
            soul.civilization, CaseType.APPEAL, tenant
        )
        priority = cls._resolve_priority(priority, template_priority, floor=1)

        # Atomic like create_from_judgment, so that `_create_nodes`' refusal of
        # a node-less template cannot leave the workflow row behind without
        # them. Before this, nothing here was transactional because nothing
        # here could fail — the node loop simply did not run.
        with transaction.atomic():
            appeal_workflow = ApprovalWorkflow.objects.create(
                judgment=judgment,
                soul=soul,
                workflow_name=f"申诉: {original_workflow.workflow_name}",
                case_type=CaseType.APPEAL,
                priority=priority,
                status=ApprovalWorkflowStatus.PENDING,
                is_appeal=True,
                original_workflow=original_workflow,
                tenant=tenant,
            )

            # Same resolution as create_from_judgment, because it is the same
            # method. In the Chinese appeal template only 魏征 · 察查司
            # resolves; the other three name a court relative to a case
            # (原殿/上一殿) or a god with no Actor row (酆都大帝), so they stay
            # SYSTEM. See TEMPLATE_NODES_WITHOUT_AN_APPROVER.
            cls._create_nodes(appeal_workflow, template, soul.civilization)

        return appeal_workflow

    @classmethod
    def get_workflow_stats(cls, workflow: ApprovalWorkflow) -> dict:
        """Get statistics about a workflow's progress."""
        nodes = workflow.nodes.all()
        total = nodes.count()
        approved = nodes.filter(status__in=[NodeStatus.APPROVED, NodeStatus.REJECTED, NodeStatus.SKIPPED]).count()
        pending = nodes.filter(status=NodeStatus.PENDING).count()

        return {
            "total_nodes": total,
            "completed_nodes": approved,
            "pending_nodes": pending,
            "progress_percent": (approved / total * 100) if total > 0 else 0,
        }
