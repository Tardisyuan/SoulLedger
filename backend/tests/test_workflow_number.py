"""审批编号(`ApprovalWorkflow.number`,`WF-0582`,用户 2026-10-17):每条创建路径都发号、全局一个序列、
单调、不留空号、唯一;存量回填(workflow/0023–0025)按 (created_at, id) 编、可往返。

号由 `ApprovalWorkflow.save()` 从 `JudgmentCaseCounter` 的 `WF` 行发 —— 与案号同一张计数表、同一句
`UPDATE … last = last + 1`(PostgreSQL 上行锁握到事务提交)。并发那一半 SQLite 测不到(整库写锁),
案号那边的 `test_eight_cases_opened_at_once_get_eight_consecutive_numbers` 在真 PostgreSQL 上守着同一段代码
(`JudgmentCaseCounter.bump`)。
"""
from datetime import UTC, datetime

import pytest
from django.db import IntegrityError, transaction

from apps.judgment.models import Judgment, JudgmentCaseCounter
from apps.souls.models import Soul, SoulState
from apps.workflow.models import ApprovalWorkflow, CaseType, format_workflow_number
from apps.workflow.services import WorkflowService
from tests.migration_roundtrip import snapshot_rows


def _soul(tenant, name="编号之魂"):
    return Soul.objects.create(name=name, tenant=tenant, current_state=SoulState.JUDGING)


def _bare(tenant, name="w"):
    return ApprovalWorkflow.objects.create(soul=_soul(tenant), tenant=tenant, workflow_name=name)


def test_the_format_pads_to_four_and_never_truncates():
    assert format_workflow_number(7) == "WF-0007"
    assert format_workflow_number(582) == "WF-0582"
    assert format_workflow_number(10000) == "WF-10000"


@pytest.mark.django_db
def test_one_global_sequence_across_halls_without_gaps(cn_tenant, eu_tenant):
    numbers = [_bare(cn_tenant).number, _bare(eu_tenant).number, _bare(cn_tenant).number]
    # 不分殿:欧洲那条接着中国的号,而不是从 1 起 —— 编号里没有殿的前缀。
    assert numbers == ["WF-0001", "WF-0002", "WF-0003"]
    assert JudgmentCaseCounter.objects.get(key="WF").last == 3
    # 案号的计数行不受影响。
    assert not JudgmentCaseCounter.objects.exclude(key="WF").exists()


@pytest.mark.django_db
def test_an_existing_number_is_kept_on_save(cn_tenant):
    flow = _bare(cn_tenant)
    number = flow.number
    flow.workflow_name = "改名"
    flow.save()
    flow.refresh_from_db()
    assert flow.number == number
    assert JudgmentCaseCounter.objects.get(key="WF").last == 1


@pytest.mark.django_db(transaction=True)
def test_a_create_that_fails_gives_its_number_back(cn_tenant):
    first = _bare(cn_tenant)
    soul = _soul(cn_tenant, "失败")
    with pytest.raises(IntegrityError), transaction.atomic():
        # 撞唯一约束:发号与写入同一个事务,号跟着回滚。
        ApprovalWorkflow.objects.create(soul=soul, tenant=cn_tenant, workflow_name="dup", judgment=None,
                                        number=first.number)
    assert _bare(cn_tenant).number == "WF-0002"


@pytest.mark.django_db
def test_numbers_are_unique(cn_tenant):
    flow = _bare(cn_tenant)
    with pytest.raises(IntegrityError), transaction.atomic():
        ApprovalWorkflow.objects.create(soul=flow.soul, tenant=cn_tenant, workflow_name="x", number=flow.number)


# ── 每条创建路径 ─────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_start_workflow_numbers_it(cn_tenant):
    soul = _soul(cn_tenant)
    flow = WorkflowService.start_workflow(soul, case_type=CaseType.ROUTINE, tenant=cn_tenant, notes="手动")
    assert flow.number == "WF-0001"


@pytest.mark.django_db
def test_create_from_judgment_numbers_it(cn_tenant):
    soul = _soul(cn_tenant)
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=cn_tenant,
                                   verdict="PASSED", is_final=True, court="—")
    flow = WorkflowService.create_from_judgment(case)
    assert flow.number == "WF-0001"


@pytest.mark.django_db
def test_judgment_conclude_with_create_workflow_numbers_it(cn_tenant):
    soul = _soul(cn_tenant)
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=cn_tenant, court="第一殿")
    case.conclude("PASSED", "结案", create_workflow=True)
    flow = ApprovalWorkflow.all_objects.get(judgment=case)
    assert flow.number == "WF-0001"


@pytest.mark.django_db
def test_the_appeal_workflow_numbers_it(cn_tenant):
    original = WorkflowService.start_workflow(_soul(cn_tenant), case_type=CaseType.ROUTINE, tenant=cn_tenant)
    appeal = WorkflowService.start_workflow(_soul(cn_tenant), case_type=CaseType.APPEAL, tenant=cn_tenant,
                                            is_appeal=True)
    assert (original.number, appeal.number) == ("WF-0001", "WF-0002")


@pytest.mark.django_db
def test_the_rebirth_application_workflow_numbers_it(cn_tenant):
    from apps.soul_accounts.rebirth import _create_workflow

    soul = _soul(cn_tenant)
    flow = _create_workflow(soul, [("初审", "TRIAL", "JUDGE")], name="转生申请")
    assert flow.number == "WF-0001"


@pytest.mark.django_db
def test_both_serializers_carry_the_number(cn_tenant):
    from apps.workflow.serializers import ApprovalWorkflowListSerializer, ApprovalWorkflowSerializer

    flow = _bare(cn_tenant)
    assert ApprovalWorkflowSerializer(flow).data["number"] == flow.number
    assert ApprovalWorkflowListSerializer(flow).data["number"] == flow.number


# ── 回填:0022 → 0025 往返 ─────────────────────────────────────────────────


# 两段:整段(0022 ↔ 0025)与只有数据那一步(0023 ↔ 0024,列留着,反向必须自己清空它与 `WF` 行,
# 否则再前进时号接着旧的往上数)。
@pytest.mark.parametrize("before, after", [
    ("0022_node_cosigners", "0025_b37_workflow_number_unique"),
    ("0023_b37_workflow_number", "0024_b37_backfill_workflow_number"),
])
def test_workflow_0023_to_0025_backfill_in_creation_order_and_reverse(migration_round_trip, before, after):
    def seed(state):
        tenant_model = state.get_model("tenants", "Tenant")
        cn = tenant_model._base_manager.create(code="CN_WFRT", display_name="cn")
        eg = tenant_model._base_manager.create(code="EG_WFRT", display_name="eg")
        soul = state.get_model("souls", "Soul")._base_manager.create(name="s")
        workflow = state.get_model("workflow", "ApprovalWorkflow")
        # 插入顺序与时间顺序不同;两殿交错 —— 全局一个序列,只看时间。
        rows = [
            (cn, datetime(2025, 3, 1, tzinfo=UTC), "c"),
            (eg, datetime(2024, 12, 31, 23, tzinfo=UTC), "a"),
            (cn, datetime(2025, 1, 2, tzinfo=UTC), "b"),
            (None, datetime(2025, 6, 1, tzinfo=UTC), "d"),
        ]
        for tenant, at, name in rows:
            row = workflow._base_manager.create(soul=soul, tenant=tenant, workflow_name=name)
            workflow._base_manager.filter(pk=row.pk).update(created_at=at)

    def snapshot(state):
        workflow = state.get_model("workflow", "ApprovalWorkflow")
        fields = {"tenant": lambda w: w.tenant_id}
        if any(f.name == "number" for f in workflow._meta.get_fields()):
            fields["number"] = "number"
        return snapshot_rows(workflow._base_manager.all(), key="workflow_name", fields=fields)

    def check_forward(state):
        assert {k: v["number"] for k, v in snapshot(state).items()} == {
            "a": "WF-0001", "b": "WF-0002", "c": "WF-0003", "d": "WF-0004",
        }
        counters = state.get_model("judgment", "JudgmentCaseCounter")
        assert counters.objects.get(key="WF").last == 4

    def check_reverse(state):
        counters = state.get_model("judgment", "JudgmentCaseCounter")
        assert not counters.objects.filter(key="WF").exists()

    migration_round_trip(
        before=("workflow", before),
        after=("workflow", after),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )
