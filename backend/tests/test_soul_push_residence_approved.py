"""调拨被批准时推一条「即将暂居」(2026-09-18 用户决定),走真实的 DispatchService。

批准与执行各一条、各自的 dedupe_key;同一类偏好开关管两条;批准撤销后没发出去的那条不再发。
"""
import json

import pytest

from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.soul_push import services
from apps.soul_push.models import PushDelivery, PushPreference, PushStatus
from apps.tenants.models import Tenant
from tests.soul_account_support import ready_soul
from tests.soul_push_support import FakeSender, enqueued, push_on, register  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup():
    home = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})[0]
    away = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "EG"})[0]
    account, client = ready_soul(home, name="亡魂乙")
    assert register(client).status_code == 201
    record = DispatchRecord.objects.create(
        source_tenant=home, target_tenant=away, soul=account.soul, status=DispatchStatus.PROPOSED,
        reason="理由SECRET-DISPATCH", tenant=home)
    return account, record


def _kinds():
    return sorted(PushDelivery.objects.values_list("kind", flat=True))


def test_approval_and_execution_each_push_once_under_their_own_key(setup, enqueued):  # noqa: F811
    account, record = setup
    DispatchService.approve(record, "approver")
    [approved] = PushDelivery.objects.all()
    assert (approved.kind, approved.title) == ("residence_approved", "即将暂居")
    assert approved.dedupe_key == f"residence:{record.pk}:DISPATCH_APPROVED"
    assert approved.data == {"screen": "Life", "kind": "residence_approved"}

    record.refresh_from_db()
    DispatchService.execute(record, "executor")
    assert _kinds() == ["residence_approved", "residence_started"]
    started = PushDelivery.objects.get(kind="residence_started")
    assert started.dedupe_key == f"residence:{record.pk}:DISPATCH_EXECUTED"
    # 两条各自一行:批准那条没被执行覆盖,标题仍是批准的
    approved.refresh_from_db()
    assert approved.title == "即将暂居"

    everything = json.dumps(list(PushDelivery.objects.values("title", "body", "data")), ensure_ascii=False)
    for secret in ("SECRET", "EG_DUAT", "CN_DIYU", str(record.pk)):
        assert secret not in everything, secret


def test_proposal_and_rejection_push_nothing(setup, enqueued):  # noqa: F811
    _, record = setup
    DispatchService.reject(record, "rejector", reason="不准")
    assert _kinds() == []


def test_the_residence_preference_switches_off_the_approval_push_too(setup, enqueued):  # noqa: F811
    account, record = setup
    PushPreference.objects.create(account=account, soul=account.soul, residence=False)
    DispatchService.approve(record, "approver")
    record.refresh_from_db()
    DispatchService.execute(record, "executor")
    assert _kinds() == []


def test_an_approval_cancelled_before_sending_is_not_sent(setup, push_on, enqueued):  # noqa: F811
    _, record = setup
    DispatchService.approve(record, "approver")
    record.refresh_from_db()
    DispatchService.cancel(record, "canceller")
    [row] = PushDelivery.objects.all()
    assert services.send_deliveries([str(row.pk)]) == 0
    row.refresh_from_db()
    assert row.status == PushStatus.CANCELLED and FakeSender.batches == []


def test_a_still_approved_dispatch_is_sent(setup, push_on, enqueued):  # noqa: F811
    _, record = setup
    DispatchService.approve(record, "approver")
    [row] = PushDelivery.objects.all()
    assert services.send_deliveries([str(row.pk)]) == 1
    assert [m["title"] for m in FakeSender.batches[0]] == ["即将暂居"]


def test_when_both_wait_in_the_queue_only_the_execution_is_sent(setup, push_on, enqueued):  # noqa: F811
    """补发时两条可能同时在队里:已执行就不再说「即将」。"""
    _, record = setup
    DispatchService.approve(record, "approver")
    record.refresh_from_db()
    DispatchService.execute(record, "executor")
    assert services.send_deliveries(list(map(str, PushDelivery.objects.values_list("pk", flat=True)))) == 1
    assert [m["title"] for m in FakeSender.batches[0]] == ["暂居开始"]
    assert PushDelivery.objects.get(kind="residence_approved").status == PushStatus.CANCELLED
