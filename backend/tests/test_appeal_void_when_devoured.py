"""被阿米特吞噬之后申诉作废(P2-10,用户 2026-10-27;docs/02_奥西里斯审判详解.md「不复存在」)。

* 已被吞噬的灵魂提出申诉 → 409 `soul_devoured`,列表的 `refusal_code` 同一个码。
* 吞噬执行时还开着的申诉 → `VOID`:不补偿、不改判,`JUDGMENT_APPEAL_DECIDED` 事件(status VOID)同一事务记下;
  之后 `decide` → `appeal_closed`。
* 挂着申诉流程的那一轮:流程随之结束(REJECTED,`SOUL_DEVOURED`),不会再被 `on_ladder_finished` 结成维持原判。
"""
import pytest
from django.db import transaction

from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.judgment import appeals
from apps.judgment.models import Judgment, JudgmentAppeal
from apps.realms.models import Realm
from apps.souls.record_models import RecordCategory, SoulRecord
from apps.workflow.models import ApprovalWorkflowStatus
from tests import test_judgment_appeals as base
from tests.test_judgment_appeal_ladder import _upheld_once
from tests.test_judgment_appeals import MINE, _file

case = base.case

pytestmark = pytest.mark.django_db


def _annihilation_disposition(case):
    realm = Realm.objects.create(
        realm_code=DispositionService.EG_ANNIHILATION, name_en="Second Death", realm_type="HELL", tier=10,
        is_eternal=True, civilization="EGYPTIAN", tenant=case["judgment"].tenant, name_local="x", name_zh="x")
    return Disposition.objects.create(soul=case["soul"], tenant=case["judgment"].tenant, destination_realm=realm)


def _devour(case):
    """The one hook the three execution branches share (`_mark_executed`), in a transaction as they call it."""
    disposition = _annihilation_disposition(case)
    with transaction.atomic():
        DispositionService._mark_executed(disposition)


def test_a_devoured_soul_cannot_file(case):
    Disposition.all_objects.filter(pk=_annihilation_disposition(case).pk).update(is_executed=True)
    row = case["client"].get(MINE).data["judgments"][0]
    assert (row["can_appeal"], row["refusal_code"]) == (False, "soul_devoured")
    response = _file(case)
    assert response.status_code == 409 and response.data["code"] == "soul_devoured"
    assert not JudgmentAppeal.objects.exists()


def test_an_unexecuted_devouring_does_not_block_an_appeal(case):
    _annihilation_disposition(case)
    assert _file(case).status_code == 201


def test_devouring_voids_the_open_appeal_without_compensation(case):
    appeal_id = _file(case).data["id"]
    appeals.claim(appeal_id, case["reviewer"])
    _devour(case)
    appeal = JudgmentAppeal.all_objects.get(pk=appeal_id)
    assert appeal.status == "VOID" and appeal.decided_at is not None and appeal.new_verdict is None
    event = SoulEvent.all_objects.get(soul_id=case["soul"].pk, event_type="JUDGMENT_APPEAL_DECIDED")
    assert event.payload["status"] == "VOID" and event.payload["voided_because"] == "soul_devoured"
    with pytest.raises(appeals.AppealRefusedError) as refused:
        appeals.decide(appeal_id, case["reviewer"], outcome="AMENDED", note="x", verdict="PASSED")
    assert refused.value.code == "appeal_closed"
    assert Judgment.all_objects.get(pk=case["judgment"].pk).verdict == "FAILED"
    assert not SoulRecord.objects.filter(soul=case["soul"], category=RecordCategory.COMPENSATION).exists()


def test_devouring_ends_the_appeal_flow_and_the_flow_does_not_uphold(case):
    _upheld_once(case)
    appeal_id = _file(case, escalate=True).data["id"]
    _devour(case)
    appeal = JudgmentAppeal.all_objects.get(pk=appeal_id)
    assert appeal.status == "VOID"
    workflow = appeal.workflow
    workflow.refresh_from_db()
    assert (workflow.status, workflow.end_reason) == (ApprovalWorkflowStatus.REJECTED, appeals.END_REASON_DEVOURED)
    decided = SoulEvent.all_objects.filter(soul_id=case["soul"].pk, event_type="JUDGMENT_APPEAL_DECIDED",
                                           payload__round=2)
    assert [e.payload["status"] for e in decided] == ["VOID"]
