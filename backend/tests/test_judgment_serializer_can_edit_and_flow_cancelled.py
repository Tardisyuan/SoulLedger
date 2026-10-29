"""`JudgmentSerializer.can_edit` / `flow_cancelled`(fix-be1 遗留·网页,2026-10-29):审判台据此藏编辑控件、给「重开一案」。

`can_edit` 与 `claims.assert_may_edit` 同一条规则(`claims.may_edit`):别人认领中、自己不持 judgment.assign 是 false;
无人认领、认领人自己、持 judgment.assign、已结案都是 true。读它不留审计。
`flow_cancelled`:这件案子自己的审批流以 CANCELLED 结束 —— 与 `reopen-cancelled/` 的前提同一条。
"""
import pytest
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.judgment.models import Judgment
from apps.workflow.models import ApprovalWorkflow
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


def _get(user, case):
    response = officer_client(user).get(f"/api/v1/judgment/{case.pk}/")
    assert response.status_code == 200, response.data
    return response.data


# 越过认领的审计行是 `assert_may_edit` 里同步 `AuditLog.objects.create` 的,不走 on_commit,未提交的事务里也看得见;
# 「读不留痕」这条断言因此不是空断言(test_rbac_be1 里同一个越过在同样的上下文里数到 1 行)。
@pytest.mark.allow_uncommitted_audit
def test_can_edit_follows_the_claim_rule(cn):
    holder = plan.officer("ce_holder", "JUDGE", cn)
    other = plan.officer("ce_other", "JUDGE", cn)
    lead = plan.officer("ce_lead", "MODERATOR", cn)
    _soul, case = plan.open_case(cn)
    assert _get(other, case)["can_edit"] is True  # 无人认领

    Judgment.all_objects.filter(pk=case.pk).update(claimed_by=holder, claimed_at=timezone.now())
    assert _get(holder, case)["can_edit"] is True
    assert _get(other, case)["can_edit"] is False
    assert _get(lead, case)["can_edit"] is True  # judgment.assign 越过
    # 列表同一个字段,同一个答案。
    rows = officer_client(other).get("/api/v1/judgment/").data["results"]
    assert [r["can_edit"] for r in rows if r["id"] == str(case.pk)] == [False]
    # 读不是越过:不留痕。
    assert not AuditLog.objects.filter(resource="judgment.claim_override").exists()


def test_flow_cancelled_only_when_the_cases_own_flow_was_cancelled(cn):
    lead = plan.officer("fc_lead", "MODERATOR", cn)
    _soul, case = plan.open_case(cn)
    assert _get(lead, case)["flow_cancelled"] is False  # 没有流程
    case.conclude("FAILED", "")
    flow = ApprovalWorkflow.objects.get(judgment=case)
    assert _get(lead, case)["flow_cancelled"] is False  # 流程在走
    ApprovalWorkflow.objects.filter(pk=flow.pk).update(status="CANCELLED", current_node=None,
                                                       end_reason="CROSS_CANCELLED")
    assert _get(lead, case)["flow_cancelled"] is True
