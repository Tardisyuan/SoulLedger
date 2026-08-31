"""审批流程的**参照数据** —— 模板表,以及读它们要用到的两个谓词。

从 `apps/workflow/services.py` 拆出(2026-09-01)。那个文件 1125 行,而它的
**前 461 行全是数据**、之后才是 `WorkflowService`。CLAUDE.md 写着 500 行上限,
用户 2026-09-01 的决定是拆生产代码里最大的几个。

拆的是**这条缝**而不是随便找一刀:表是「有哪些流程」,类是「怎么按流程走」。
两者的改动理由不一样 —— 加一个文明要动表,改审批人解析要动类。

**`services.py` 仍然重导出这里的每一个名字**,所以 64 处
`from apps.workflow.services import WORKFLOW_TEMPLATES` 一处都不用改。
那是一层兼容面,不是「表住在 services 里」—— services 那边的注释说明了这一点。
"""
import logging

from apps.souls.models import Civilization
from apps.workflow.models import CaseType, NodeType

logger = logging.getLogger(__name__)

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
# name (``CHINESE_ROUTINE``, ``GREEK_ROUTINE``, …); this dict holds eight keyed
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
# 埃及的「常规」审判**就是**称心,所以两个 case type 指向同一份模板。
#
# 实测(2026-09-01,`_resolve_template`):
#
#     (EGYPTIAN, HEART_WEIGHING) → '欧西里斯称重流程'   3 节点
#     (EGYPTIAN, ROUTINE)        → 'EGYPTIAN 审批流程'  1 节点  ← 泛用兜底
#
# 而 `frontend/src/config/workflow-templates.ts` 的 `EGYPTIAN_ROUTINE` 预设**叫**
# 「心脏称重流程」、节点是两真之殿(Anubis/Osiris/Ammit),`caseType` 写的却是
# `ROUTINE`。两边各自都合法(ROUTINE 在 `VALID_CASE_TYPES_BY_CIVILIZATION[EGYPTIAN]`
# 里),所以既有的那几条跨栈守卫一条都不会红 —— 而一个埃及 ROUTINE 判决拿到的是
# 一个泛用单节点流程,不是两真之殿。
#
# **这不是命名口味,是考据。** 埃及没有第二种「普通」审判:每个死者的心都要对着
# 玛阿特的羽毛称一次(BD 125),称心就是那个程序本身。所以 ROUTINE 对埃及只能
# 指向称重流程 —— 别的答案都要先说出「不称心的埃及审判」是什么。
#
# 指同一个 dict 对象而不是抄一份:抄一份就会漂,而这两个 key 说的是同一件事。
# `tests/test_workflow_egyptian_routine_is_the_weighing.py` 钉住这个同一性。
WORKFLOW_TEMPLATES[(Civilization.EGYPTIAN, CaseType.ROUTINE)] = WORKFLOW_TEMPLATES[
    (Civilization.EGYPTIAN, CaseType.HEART_WEIGHING)
]

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
# EVERY CIVILIZATION ALLOWS `APPEAL`, AND THIS TABLE IS THE THING THAT
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
    # GREEK, AND WHY IT IS TWO MEMBERS RATHER THAN A COPY OF EUROPEAN'S SET.
    #
    # This entry is not optional decoration on the GREEK split; without it the
    # civilization is validated against `.get(civilization, set())`, i.e. the
    # empty set, and *every* Greek case type is a ValueError — including the
    # appeal path, which writes `case_type=APPEAL` for a soul of any
    # civilization and then validates it here.
    #
    # ROUTINE is the whole of what Gorgias 524a describes: every Greek dead is
    # judged at the meadow's fork and sent to the Isles of the Blessed or to
    # Tartarus. That is the ordinary complete proceeding on this side, which is
    # what ROUTINE names. `GREEK_ROUTINE` in
    # `frontend/src/config/workflow-templates.ts` is that flow.
    #
    # APPEAL for the reason the whole table gained it: both entry points write
    # it unconditionally for any civilization, so a set without it makes the
    # feature raise rather than refuse.
    #
    # NOTHING ELSE IS ADMITTED, and the omissions are decisions rather than an
    # unfinished list. CANONIZATION and PURGATORY_REVIEW are Christian
    # institutions; HERESY_TRIAL is Dante's sixth circle; HEART_WEIGHING and
    # DIVINE_TRIAL are Egyptian; CROSS_REALM and SPECIAL are Chinese-side
    # members whose meaning rests on the ten courts' ladder of instances, and
    # Plato's fork has no ladder to skip. Adding one here on the strength of
    # "the other civilizations have more" is exactly the template-filling this
    # repository keeps finding in its own history.
    Civilization.GREEK: {CaseType.ROUTINE, CaseType.APPEAL},
}
