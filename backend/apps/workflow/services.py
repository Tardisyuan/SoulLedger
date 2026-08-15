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
            {"name": "阿努比斯 · 引渡审判", "court": "Hall of Two Truths", "type": NodeType.TRIAL, "order": 1, "actor": "Anubis"},
            {"name": "四十二神官 · 罪行核实", "court": "Hall of Two Truths", "type": NodeType.TRIAL, "order": 2},
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
    "主教座堂初审": "An institution (Diocese). EUROPEAN_ACTORS has no bishop.",
    "教省复审": "An institution (Archdiocese).",
    "罗马教廷终审": "An institution (the Curia). Naming a pope would be inventing "
               "one.",
    "忏悔赦免审核": "A sacrament, not a person.",
    "炼狱净化评估": "Names the process. Purgatorio's terraces have no seated "
               "judge — see realms/0014, which deliberately added no actor.",
    "天堂准入终审": "Names the gate. Peter is not in EUROPEAN_ACTORS.",
    "四十二神官 · 罪行核实": "The forty-two assessors are forty-two Actor rows "
                     "(seed_mythology seeds them individually). One FK cannot "
                     "hold a bench, and the confession is made to all of them "
                     "in turn (BD 125).",
    # Generic fallback built in create_from_judgment
    "审批节点": "The fallback node for a (civilization, case_type) pair with no "
             "template. By construction nothing is known about who decides it.",
}


# Valid case types per civilization
VALID_CASE_TYPES_BY_CIVILIZATION = {
    Civilization.CHINESE: {CaseType.ROUTINE, CaseType.APPEAL, CaseType.CROSS_REALM, CaseType.SPECIAL},
    Civilization.EUROPEAN: {CaseType.CANONIZATION, CaseType.PURGATORY_REVIEW, CaseType.HERESY_TRIAL, CaseType.ROUTINE},
    Civilization.EGYPTIAN: {CaseType.HEART_WEIGHING, CaseType.DIVINE_TRIAL, CaseType.ROUTINE},
}


class WorkflowService:
    """
    Creates approval workflow instances from concluded judgments.
    Routes to civilization-specific templates.
    """

    @classmethod
    def _resolve_approver(cls, node_def: dict, civilization: str, tenant_id) -> dict:
        """Turn a template node's ``actor`` name into approver columns.

        Returns the kwargs ``ApprovalNode.objects.create`` should get:
        ``{"approver_type": "ACTOR", "approver_actor": <Actor>}`` when the named
        actor is on this tenant's bench, and ``{"approver_type": "SYSTEM"}``
        otherwise.

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
        """
        actor_name = node_def.get("actor")
        if not actor_name:
            return {"approver_type": "SYSTEM"}

        from apps.actors.models import Actor, resolve_actor_by_any_name

        actor = resolve_actor_by_any_name(
            Actor._base_manager.filter(
                civilization=civilization, tenant_id=tenant_id, is_deleted=False
            ),
            actor_name,
        )
        if actor is None:
            return {"approver_type": "SYSTEM"}
        return {"approver_type": "ACTOR", "approver_actor": actor}

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
    def create_from_judgment(
        cls,
        judgment: Judgment,
        case_type: str | None = None,
        is_appeal: bool = False,
        priority: int = 0,
    ) -> ApprovalWorkflow | None:
        """
        Create an ApprovalWorkflow instance from a Judgment.

        Args:
            judgment: The concluded judgment
            case_type: Override case type (auto-detected from judgment if not provided)
            is_appeal: Whether this is an appeal workflow
            priority: Workflow priority (0=normal, 1=urgent, 2=critical)

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

        # Look up template: DB first, then hardcoded fallback.
        #
        # A DB template only wins if it actually defines nodes. Without that
        # check an active template with nodes_json=[] shadows the hardcoded
        # default and yields a workflow with no steps — which is exactly what
        # happened: seven empty templates left over from testing sat on
        # CHINESE/ROUTINE, so every Chinese routine judgment silently got an
        # empty shell instead of 十殿审判流程. An unconfigured template should
        # fall through to something that works, not override it.
        #
        # The query is also scoped to judgment.tenant. WorkflowTemplate is a
        # genuinely per-tenant resource (WorkflowTemplateViewSet enforces
        # DataScope + tenant on every other path, and the model even used to
        # carry a unique_workflow_template_tenant_name constraint) — it is
        # not a shared/global resource the way Menu or the RBAC
        # Permission/Role tables turned out to be. Without this filter, a
        # tenant with no custom template for (civilization, case_type) could
        # silently pick up another tenant's active template instead of
        # falling through to the hardcoded WORKFLOW_TEMPLATES default.
        template = None
        try:
            db_template = (
                WorkflowTemplate.objects.filter(
                    civilization=civilization,
                    case_type=case_type,
                    is_active=True,
                    tenant=judgment.tenant,
                )
                .exclude(nodes_json=[])
                .first()
            )
            if db_template and db_template.nodes_json:
                template = {
                    "name": db_template.name,
                    "nodes": db_template.nodes_json,
                }
        except Exception:
            pass

        if template is None:
            template = WORKFLOW_TEMPLATES.get((civilization, case_type))

        # Fallback for unhandled combinations
        if template is None:
            # Generic minimal workflow
            template = {
                "name": f"{civilization} 审批流程",
                "nodes": [
                    {"name": "审批节点", "court": civilization, "type": NodeType.TRIAL, "order": 1},
                ],
            }

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

            # Create nodes
            first_node = None
            for node_def in template["nodes"]:
                node = ApprovalNode.objects.create(
                    workflow=workflow,
                    node_name=node_def["name"],
                    node_order=node_def["order"],
                    node_type=node_def["type"],
                    court_code=node_def["court"],
                    status=NodeStatus.PENDING,
                    required_verdicts=["PASSED", "FAILED", "CONFIRMED", "REJECTED", "SKIPPED"],
                    # Was a hardcoded `approver_type="SYSTEM"`, which is why
                    # all 30 nodes in the live database designate nobody and
                    # why the identity check `4ceffe8` added could not refuse a
                    # single one of them. Backfilling the existing rows
                    # (0011_backfill_ten_court_approvers) without fixing this
                    # would have closed the hole for exactly as long as it took
                    # someone to create the next workflow.
                    **cls._resolve_approver(node_def, civilization, judgment.tenant_id),
                )
                if first_node is None:
                    first_node = node

            # Set first node as current
            if first_node:
                workflow.current_node = first_node
                workflow.status = ApprovalWorkflowStatus.IN_PROGRESS
                workflow.save()

        return workflow

    @classmethod
    def create_appeal_workflow(
        cls,
        original_workflow: ApprovalWorkflow,
        priority: int = 1,
    ) -> ApprovalWorkflow:
        """
        Create an appeal workflow from an existing rejected workflow.
        """
        judgment = original_workflow.judgment
        soul = original_workflow.soul

        appeal_workflow = ApprovalWorkflow.objects.create(
            judgment=judgment,
            soul=soul,
            workflow_name=f"申诉: {original_workflow.workflow_name}",
            case_type=CaseType.APPEAL,
            priority=priority,
            status=ApprovalWorkflowStatus.PENDING,
            is_appeal=True,
            original_workflow=original_workflow,
            tenant=judgment.tenant if judgment else None,
        )

        # Create appeal nodes
        appeal_template = WORKFLOW_TEMPLATES.get((soul.civilization, CaseType.APPEAL))
        if appeal_template:
            first_node = None
            for node_def in appeal_template["nodes"]:
                node = ApprovalNode.objects.create(
                    workflow=appeal_workflow,
                    node_name=node_def["name"],
                    node_order=node_def["order"],
                    node_type=node_def["type"],
                    court_code=node_def["court"],
                    status=NodeStatus.PENDING,
                    required_verdicts=["PASSED", "FAILED", "CONFIRMED", "REJECTED", "SKIPPED"],
                    # Same resolution as create_from_judgment. Only 魏征 ·
                    # 察查司 resolves in this template; the other three name a
                    # court relative to a case (原殿/上一殿) or a god with no
                    # Actor row (酆都大帝), so they stay SYSTEM. See
                    # TEMPLATE_NODES_WITHOUT_AN_APPROVER.
                    **cls._resolve_approver(
                        node_def, soul.civilization, appeal_workflow.tenant_id
                    ),
                )
                if first_node is None:
                    first_node = node

            if first_node:
                appeal_workflow.current_node = first_node
                appeal_workflow.status = ApprovalWorkflowStatus.IN_PROGRESS
                appeal_workflow.save()

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
