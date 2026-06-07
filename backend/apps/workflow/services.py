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
WORKFLOW_TEMPLATES = {
    # Chinese ten courts
    (Civilization.CHINESE, CaseType.ROUTINE): {
        "name": "十殿审判流程",
        "nodes": [
            {"name": "秦广王 · 分流", "court": "第一殿", "type": NodeType.TRIAL, "order": 1},
            {"name": "楚江王 · 初审", "court": "第二殿", "type": NodeType.TRIAL, "order": 2},
            {"name": "宋帝王 · 二审", "court": "第三殿", "type": NodeType.TRIAL, "order": 3},
            {"name": "五官王 · 三审", "court": "第四殿", "type": NodeType.TRIAL, "order": 4},
            {"name": "阎罗王 · 四审", "court": "第五殿", "type": NodeType.TRIAL, "order": 5},
            {"name": "卞城王 · 五审", "court": "第六殿", "type": NodeType.TRIAL, "order": 6},
            {"name": "泰山王 · 六审", "court": "第七殿", "type": NodeType.TRIAL, "order": 7},
            {"name": "都市王 · 七审", "court": "第八殿", "type": NodeType.TRIAL, "order": 8},
            {"name": "平等王 · 八审", "court": "第九殿", "type": NodeType.TRIAL, "order": 9},
            {"name": "转轮王 · 终审", "court": "第十殿", "type": NodeType.FINAL, "order": 10},
        ],
    },
    # Chinese appeal
    (Civilization.CHINESE, CaseType.APPEAL): {
        "name": "申诉审判流程",
        "nodes": [
            {"name": "魏征 · 察查司", "court": "察查司", "type": NodeType.APPEAL, "order": 1},
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
            {"name": "阿努比斯 · 引渡审判", "court": "Hall of Two Truths", "type": NodeType.TRIAL, "order": 1},
            {"name": "四十二神官 · 罪行核实", "court": "Hall of Two Truths", "type": NodeType.TRIAL, "order": 2},
            {"name": "欧西里斯 · 终审", "court": "Duat", "type": NodeType.FINAL, "order": 3},
        ],
    },
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

        # Look up template: DB first, then hardcoded fallback
        template = None
        try:
            db_template = WorkflowTemplate.objects.filter(
                civilization=civilization,
                case_type=case_type,
                is_active=True,
            ).first()
            if db_template:
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
                    approver_type="SYSTEM",  # Default to system approval
                    court_code=node_def["court"],
                    status=NodeStatus.PENDING,
                    required_verdicts=["PASSED", "FAILED", "CONFIRMED", "REJECTED", "SKIPPED"],
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
                    approver_type="SYSTEM",
                    court_code=node_def["court"],
                    status=NodeStatus.PENDING,
                    required_verdicts=["PASSED", "FAILED", "CONFIRMED", "REJECTED", "SKIPPED"],
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
