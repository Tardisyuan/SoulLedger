"""原审一律走审批流程(用户 2026-10-29,四文明):

- 原审结案强制建本文明的默认流程;明说不要(`create_workflow=False`)拒绝 400 `approval_flow_required`,什么都不写。
- 处置等流程 COMPLETED 才执行:服务返回 False、`POST …/execute/` 409 `approval_in_progress`、列表上 `flow_waiting` 写明原因。
- 流程驳回 → 撤回处置(系统作废)、灵魂回到审判中、重开一案(`retrial_of`,同一审法)—— 与埃及称心那条同一条路。
- 五逆(`FIVE_HEINOUS`)不经各殿、直入阿鼻:十殿流程自动跳过一至八殿,从九殿起,跳站原因记在节点上。

埃及的那一半(称心流程、`weighing_*` 码)在 tests/test_egyptian_verdict_comes_from_the_weighing.py。
"""
import pytest

from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.judgment.models import ChineseOffence, Judgment, JudgmentMethod
from apps.judgment.weighing import WeighingRefusedError, unfinished_flow
from apps.souls.models import Soul, SoulState
from apps.workflow.models import ApprovalWorkflow, ApprovalWorkflowStatus, NodeStatus
from apps.workflow.services import FIVE_HEINOUS_SKIP_REASON
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

CODES = ("CN_DIYU", "EU_HEAVEN_HELL", "GR_HADES")


def _case(code, verdict="FAILED"):
    """一件原审,结案(不说要不要流程)。返回 (case, disposition)。"""
    tenant = sp.tenant(code)
    _soul, case = sp.open_case(tenant)
    assert case.conclude(verdict, "") is True
    case.refresh_from_db()
    return case, Disposition.all_objects.get(judgment=case)


@pytest.mark.parametrize("code", CODES)
def test_every_civilizations_original_concludes_with_its_flow_and_waits_for_it(code):
    # 地府判无罪不建处置(`acquitted_to_rebirth`),这里要一份处置,地府判 FAILED;无罪那一半见
    # tests/test_serving_acquittal_retry_and_rebirth_form.py。
    case, disposition = _case(code, verdict="FAILED" if code == "CN_DIYU" else "PASSED")
    flow = ApprovalWorkflow.all_objects.get(judgment=case)
    assert flow.status == ApprovalWorkflowStatus.IN_PROGRESS
    assert unfinished_flow(disposition) == "approval_in_progress"
    assert DispositionService.execute(disposition) is False
    assert Soul.objects.get(pk=case.soul_id).current_state == SoulState.DISPOSED  # nothing moved

    sp.walk_flow(case)
    assert ApprovalWorkflow.all_objects.get(pk=flow.pk).status == ApprovalWorkflowStatus.COMPLETED
    disposition = Disposition.all_objects.get(pk=disposition.pk)
    assert unfinished_flow(disposition) is None
    assert DispositionService.execute(disposition) is True


def test_an_explicit_no_flow_is_refused_and_writes_nothing():
    tenant = sp.tenant("CN_DIYU")
    soul, case = sp.open_case(tenant)
    admin = officer_client(sp.officer("orig_admin", "ADMIN", tenant))
    res = admin.post(f"/api/v1/judgment/{case.pk}/conclude/", {"verdict": "PASSED", "create_workflow": False},
                     format="json")
    assert (res.status_code, res.data["code"]) == (400, "approval_flow_required"), res.data
    case.refresh_from_db()
    assert case.verdict is None and not case.is_final
    assert not Disposition.all_objects.filter(soul=soul).exists()
    assert not ApprovalWorkflow.all_objects.filter(soul=soul).exists()
    assert Soul.objects.get(pk=soul.pk).current_state == SoulState.JUDGING


def test_the_execute_endpoint_and_the_list_say_why_it_waits():
    case, disposition = _case("CN_DIYU")
    admin = officer_client(sp.officer("orig_exec", "ADMIN", case.tenant))
    res = admin.post(f"/api/v1/disposition/{disposition.pk}/execute/", {}, format="json")
    assert (res.status_code, res.data["code"]) == (409, "approval_in_progress"), res.data
    assert admin.get(f"/api/v1/disposition/{disposition.pk}/").data["flow_waiting"] == "approval_in_progress"

    sp.walk_flow(case)
    assert admin.get(f"/api/v1/disposition/{disposition.pk}/").data["flow_waiting"] is None
    assert admin.post(f"/api/v1/disposition/{disposition.pk}/execute/", {}, format="json").status_code == 200


def test_a_rejected_flow_withdraws_the_disposition_and_opens_the_case_again():
    from apps.sentence_plan.services import in_progress_plan

    case, disposition = _case("CN_DIYU")
    flow = ApprovalWorkflow.all_objects.get(judgment=case)
    assert flow.current_node.node_order == 1  # 秦广王:驳回不回退到别处,流程以驳回结束
    flow.complete_node(flow.current_node.pk, "FAILED")
    flow.refresh_from_db()
    assert flow.status == ApprovalWorkflowStatus.REJECTED

    soul = Soul.objects.get(pk=case.soul_id)
    assert soul.current_state == SoulState.JUDGING
    assert Disposition.all_objects.get(pk=disposition.pk).is_deleted
    assert not Disposition.objects.filter(judgment=case).exists() and in_progress_plan(soul) is None
    retrial = Judgment.objects.get(retrial_of=case)
    assert retrial.verdict is None and retrial.judgment_method == JudgmentMethod.STANDARD
    started = SoulEvent.objects.get(soul=soul, event_type="JUDGMENT_INITIATED", payload__judgment_id=str(retrial.pk))
    assert started.payload["reason"] == "REJECTED"


def test_a_reopened_case_is_not_held_by_a_flow():
    """重开、申诉改判不是原审:没有流程就不等(维持现状)。"""
    case, disposition = _case("CN_DIYU")
    Judgment.all_objects.filter(pk=case.pk).update(kind="REOPEN")
    disposition = Disposition.all_objects.get(pk=disposition.pk)
    assert unfinished_flow(disposition) is None


# ── 五逆直入阿鼻 ────────────────────────────────────────────────────────


def _offence_case(offence):
    tenant = sp.tenant("CN_DIYU")
    _soul, case = sp.open_case(tenant)
    Judgment.all_objects.filter(pk=case.pk).update(offence=offence)
    case.refresh_from_db()
    case.conclude("FAILED", "")
    return ApprovalWorkflow.all_objects.get(judgment=case)


def test_five_heinous_skips_courts_one_to_eight_and_starts_at_the_ninth():
    flow = _offence_case(ChineseOffence.FIVE_HEINOUS)
    nodes = {n.node_order: n for n in flow.nodes.all()}
    assert flow.current_node.node_order == 9
    for order in range(1, 9):
        assert nodes[order].status == NodeStatus.SKIPPED, order
        assert nodes[order].skip_reason == FIVE_HEINOUS_SKIP_REASON and nodes[order].skipped_by_id is None
    assert nodes[9].status != NodeStatus.SKIPPED and nodes[10].status == NodeStatus.PENDING


def test_another_offence_walks_from_the_first_court():
    flow = _offence_case(ChineseOffence.MURDER)
    assert flow.current_node.node_order == 1
    assert not flow.nodes.filter(status=NodeStatus.SKIPPED).exists()
