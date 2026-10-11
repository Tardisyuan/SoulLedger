"""移交可以取消:只有发起方、只在对方批准之前(PROPOSED);以及 DELETE 不再能绕过状态机。

`POST /dispatch/records/{id}/cancel/`  body `{"reason": …}`(必填)
  * 发起方的官员(`dispatch.manage`)→ 200,状态 CANCELLED,理由记在记录上,事件 `DISPATCH_CANCELLED`
    写在事务里,执行地的人在提交后收到站内通知;
  * 执行地(对方)→ 403;第三方租户 → 404;
  * 非 PROPOSED(已批准 / 已驳回 / 已执行 / 已取消 / 草稿)→ 409 `not_cancellable`,什么都不写。
状态机本身仍允许 APPROVED → CANCELLED(受刑计划撤销整份计划要用),所以接口层的限制在这里钉住。
并发(批准与取消同时)只能在 PostgreSQL 上测,见 `tests/test_concurrency.py`。
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.events.models import SoulEvent
from apps.notifications.models import UserNotification
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests import sentence_plan_support as plan

pytestmark = pytest.mark.django_db
User = get_user_model()
BASE = "/api/v1/dispatch/records/"
REASON = "改派到别处,不必再等"


def _client(user, tenant):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    a = Tenant.objects.get_or_create(code="TT_A", defaults={"display_name": "TT A"})[0]
    b = Tenant.objects.get_or_create(code="TT_B", defaults={"display_name": "TT B"})[0]
    c = Tenant.objects.get_or_create(code="TT_C", defaults={"display_name": "TT C"})[0]
    mod_a = User.objects.create_user(username="cx_mod_a", password="x", role="MODERATOR", tenant=a)
    mod_b = User.objects.create_user(username="cx_mod_b", password="x", role="MODERATOR", tenant=b)
    mod_c = User.objects.create_user(username="cx_mod_c", password="x", role="MODERATOR", tenant=c)
    judge_a = User.objects.create_user(username="cx_judge_a", password="x", role="JUDGE", tenant=a)
    soul = Soul.objects.create(name="TravellingSoul", current_state=SoulState.ALIVE, tenant=a)
    record = DispatchRecord.objects.create(
        source_tenant=a, target_tenant=b, soul=soul, reason="x" * 30,
        dispatched_by=mod_a, status=DispatchStatus.PROPOSED, tenant=a,
    )
    return {
        "a": a, "b": b, "soul": soul, "record": record, "mod_a": mod_a, "mod_b": mod_b,
        "client_a": _client(mod_a, a), "client_b": _client(mod_b, b), "client_c": _client(mod_c, c),
        "client_judge_a": _client(judge_a, a),
    }


def _cancel(client, record, reason=REASON):
    body = {} if reason is None else {"reason": reason}
    return client.post(f"{BASE}{record.pk}/cancel/", body, format="json")


def _untouched(world, status=DispatchStatus.PROPOSED):
    record = DispatchRecord.all_objects.get(pk=world["record"].pk)
    assert record.status == status and record.decision_reason == "" and record.decided_by_id is None
    assert not SoulEvent.objects.filter(soul=world["soul"], payload__action="DISPATCH_CANCELLED").exists()


def test_the_sending_hall_cancels_a_proposal_and_the_target_is_told_after_commit(
        world, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        res = _cancel(world["client_a"], world["record"])
    assert res.status_code == 200, res.data
    record = DispatchRecord.all_objects.get(pk=world["record"].pk)
    assert record.status == DispatchStatus.CANCELLED and record.decided_at is not None
    # 决定理由与决定人在自己的字段里;`reason` 仍是发起时的原文,不被追加。
    assert record.decision_reason == REASON and record.decided_by_id == world["mod_a"].pk
    assert record.reason == world["record"].reason and "Cancellation reason" not in record.reason
    [event] = SoulEvent.objects.filter(soul=world["soul"], payload__action="DISPATCH_CANCELLED")
    assert event.payload["dispatch_id"] == str(record.pk) and event.payload["reason"] == REASON
    [note] = UserNotification.objects.filter(user=world["mod_b"], related_id=str(record.pk))
    assert note.notification_type == "DISPATCH_CANCELLED" and note.params["reason"] == REASON
    assert note.related_resource == "DispatchRecord" and REASON in note.message
    # 发起方自己不收通知,它在做这件事。
    assert not UserNotification.objects.filter(user__tenant=world["a"], related_id=str(record.pk)).exists()
    # 取消后目标殿的待批列表里没有它了。
    assert world["client_b"].get(f"{BASE}proposed/").data["count"] == 0


def test_a_reason_is_required(world):
    for body in (None, "", "   "):
        assert _cancel(world["client_a"], world["record"], reason=body).status_code == 400
    _untouched(world)


def test_the_target_hall_cannot_cancel_and_a_third_hall_never_sees_it(world):
    assert _cancel(world["client_b"], world["record"]).status_code == 403
    assert _cancel(world["client_c"], world["record"]).status_code == 404
    _untouched(world)


def test_cancelling_needs_the_same_permission_as_proposing(world):
    assert _cancel(world["client_judge_a"], world["record"]).status_code == 403
    _untouched(world)


@pytest.mark.parametrize("state", [
    DispatchStatus.APPROVED, DispatchStatus.REJECTED, DispatchStatus.EXECUTED, DispatchStatus.CANCELLED,
])
def test_once_it_is_no_longer_proposed_the_sender_cannot_cancel_it(world, state):
    DispatchRecord.all_objects.filter(pk=world["record"].pk).update(status=state)
    res = _cancel(world["client_a"], world["record"])
    assert res.status_code == 409 and res.data["code"] == "not_cancellable" and res.data["status"] == state
    _untouched(world, status=state)


def test_the_state_machine_itself_still_allows_approved_to_cancelled():
    """The endpoint does not open this edge; the plan-cancel path needs it, so it must stay."""
    assert DispatchStatus.CANCELLED in DispatchRecord.VALID_TRANSITIONS[DispatchStatus.APPROVED]


def test_a_draft_is_not_a_proposal(world):
    DispatchRecord.all_objects.filter(pk=world["record"].pk).update(status=DispatchStatus.DRAFT)
    res = _cancel(world["client_a"], world["record"])
    assert res.status_code == 409 and res.data["code"] == "not_cancellable"


def test_cancelling_a_plan_dispatch_sends_the_stop_back_to_pending():
    home, away = plan.tenant("CN_DIYU"), plan.tenant("EG_DUAT")
    soul, p = plan.planned(home, [(away, plan.stop_realm(away), 5)])
    plan.serve(soul, p, 1)
    assert plan.node(p, 2).status == "DISPATCHING"
    record = DispatchRecord.all_objects.get(pk=plan.node(p, 2).dispatch_record_id)
    officer = plan.officer("cx_cn_mod", "MODERATOR", home)

    res = _cancel(_client(officer, home), record)

    assert res.status_code == 200, res.data
    assert plan.node(p, 2).status == "PENDING"
    assert SoulEvent.objects.filter(soul=soul, event_type="SENTENCE_NODE_REFUSED").count() == 1


# ── DELETE 不能绕过状态机 ──────────────────────────────────────────────────


@pytest.mark.parametrize("state", [DispatchStatus.PROPOSED, DispatchStatus.APPROVED, DispatchStatus.EXECUTED])
def test_only_a_draft_can_be_deleted(world, state):
    DispatchRecord.all_objects.filter(pk=world["record"].pk).update(status=state)
    res = world["client_a"].delete(f"{BASE}{world['record'].pk}/")
    assert res.status_code == 409, res.status_code
    record = DispatchRecord.all_objects.get(pk=world["record"].pk)
    assert record.status == state and not record.is_deleted


def test_a_draft_can_still_be_abandoned(world):
    DispatchRecord.all_objects.filter(pk=world["record"].pk).update(status=DispatchStatus.DRAFT)
    res = world["client_a"].delete(f"{BASE}{world['record'].pk}/")
    assert res.status_code == 204
    assert DispatchRecord.all_objects.get(pk=world["record"].pk).is_deleted


def test_the_service_cancel_used_by_the_plan_is_unchanged(world):
    """`DispatchService.cancel` (no reason, any state the machine allows) keeps working for its other caller."""
    DispatchRecord.all_objects.filter(pk=world["record"].pk).update(status=DispatchStatus.APPROVED)
    record = DispatchRecord.all_objects.get(pk=world["record"].pk)
    DispatchService.cancel(record, None)
    assert DispatchRecord.all_objects.get(pk=record.pk).status == DispatchStatus.CANCELLED
