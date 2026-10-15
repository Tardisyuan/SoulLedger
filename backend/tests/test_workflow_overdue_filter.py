"""`/workflows/?overdue=` and the list row's `is_overdue` (「已超时」).

Overdue = in progress, the current node still PENDING, with a `timeout_hours` that has run out since
`activated_at`. Mutation-proved: with the `_deadline__lt=timezone.now()` comparison in
`WorkflowFilter.filter_overdue` flipped to `__gt`, `test_overdue_true_keeps_only_the_late_pending_node` goes red.
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.judgment.models import Judgment
from apps.souls.models import Soul
from apps.workflow import versioning
from apps.workflow.filters import WorkflowFilter
from apps.workflow.models import ApprovalNode, ApprovalWorkflow, NodeStatus, WorkflowTemplate
from apps.workflow.serializers import ApprovalWorkflowListSerializer
from apps.workflow.services import WorkflowService


def _flow(tenant, name, *, hours, ago_hours, node_status=NodeStatus.PENDING):
    template = WorkflowTemplate.objects.create(name=name, civilization="CHINESE", case_type="ROUTINE", tenant=tenant, nodes_json=[])
    versioning.save_draft(template, [{
        "id": "n1", "node_name": "初审", "node_type": "TRIAL", "court_code": "",
        "approver_type": "ROLE", "approver_role": "JUDGE", "node_order": 1,
    }])
    versioning.publish(template)
    soul = Soul.objects.create(name=name, tenant=tenant)
    judgment = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="—", verdict="PASSED", is_final=True, tenant=tenant)
    wf = WorkflowService.create_from_judgment(judgment)
    ApprovalNode.objects.filter(pk=wf.current_node_id).update(
        timeout_hours=hours, activated_at=timezone.now() - timedelta(hours=ago_hours), status=node_status
    )
    return ApprovalWorkflow._base_manager.select_related("current_node").get(pk=wf.pk)


def _pks(value):
    qs = ApprovalWorkflow._base_manager.all()
    return set(WorkflowFilter({"overdue": value}, queryset=qs).qs.values_list("pk", flat=True))


@pytest.mark.django_db
def test_overdue_true_keeps_only_the_late_pending_node(cn_tenant):
    late = _flow(cn_tenant, "late", hours=2, ago_hours=5)
    others = [
        _flow(cn_tenant, "in-time", hours=10, ago_hours=5),
        _flow(cn_tenant, "no-limit", hours=None, ago_hours=500),
        _flow(cn_tenant, "late-but-decided", hours=2, ago_hours=5, node_status=NodeStatus.APPROVED),
    ]
    assert _pks("true") == {late.pk}
    # Absence: false is the complement, not "everything".
    assert _pks("false") == {w.pk for w in others}


@pytest.mark.django_db
def test_the_row_flag_agrees_with_the_filter(cn_tenant):
    late = _flow(cn_tenant, "late", hours=2, ago_hours=5)
    ok = _flow(cn_tenant, "in-time", hours=10, ago_hours=5)
    assert ApprovalWorkflowListSerializer(late).data["is_overdue"] is True
    assert ApprovalWorkflowListSerializer(ok).data["is_overdue"] is False
